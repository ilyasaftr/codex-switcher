//! Usage API client for fetching rate limits and credits

use anyhow::{Context, Result};
use chrono::Utc;
use futures::{stream, StreamExt};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, USER_AGENT},
    StatusCode,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{
    ensure_chatgpt_tokens_fresh, get_account, refresh_chatgpt_tokens, remove_account,
    update_account_team_metadata,
};
use crate::types::{
    AccountRefreshResult, AutoRemovedAccount, AutoRemovedAccountReason, AuthData,
    CreditStatusDetails, RateLimitDetails, RateLimitStatusPayload, RateLimitWindow, StoredAccount,
    UsageInfo, UsageQueryResult, WarmupAccountResult,
};

const CHATGPT_BACKEND_API: &str = "https://chatgpt.com/backend-api";
const CHATGPT_CODEX_RESPONSES_API: &str = "https://chatgpt.com/backend-api/codex/responses";
const CHATGPT_ACCOUNT_CHECK_API: &str = "https://chatgpt.com/backend-api/wham/accounts/check";
const OPENAI_API: &str = "https://api.openai.com/v1";
const CODEX_USER_AGENT: &str = "codex-cli/1.0.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountMetadata {
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub team_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AccountsCheckResponse {
    accounts: Vec<AccountsCheckAccount>,
}

#[derive(Debug, Deserialize)]
struct AccountsCheckAccount {
    id: String,
    #[serde(default)]
    plan_type: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

pub(crate) enum ChatgptRequestOutcome<T> {
    Success(T),
    AutoRemoved(AutoRemovedAccount),
}

/// Get usage information for an account
pub async fn get_account_usage(account: &StoredAccount) -> Result<UsageQueryResult> {
    println!("[Usage] Fetching usage for account: {}", account.name);

    match &account.auth_data {
        AuthData::ApiKey { .. } => {
            println!("[Usage] API key accounts don't support usage info");
            Ok(UsageQueryResult::success(UsageInfo {
                account_id: account.id.clone(),
                plan_type: Some("api_key".to_string()),
                primary_used_percent: None,
                primary_window_minutes: None,
                primary_resets_at: None,
                secondary_used_percent: None,
                secondary_window_minutes: None,
                secondary_resets_at: None,
                has_credits: None,
                unlimited_credits: None,
                credits_balance: None,
                error: Some("Usage info not available for API key accounts".to_string()),
            }))
        }
        AuthData::ChatGPT { .. } => get_usage_with_chatgpt_auth(account).await,
    }
}

/// Send a minimal authenticated request to warm up account traffic paths.
pub async fn warmup_account(account: &StoredAccount) -> Result<WarmupAccountResult> {
    println!(
        "[Warmup] Sending warm-up request for account: {}",
        account.name
    );

    match &account.auth_data {
        AuthData::ApiKey { key } => {
            warmup_with_api_key(key).await?;
            Ok(WarmupAccountResult { auto_removed: None })
        }
        AuthData::ChatGPT { .. } => warmup_with_chatgpt_auth(account).await,
    }
}

/// Refresh and persist cached account metadata for one stored ChatGPT account.
pub async fn refresh_account_metadata(account_id: &str) -> Result<AccountRefreshResult> {
    let account = get_account(account_id)?
        .ok_or_else(|| anyhow::anyhow!("Account not found: {account_id}"))?;

    match &account.auth_data {
        AuthData::ApiKey { .. } => Ok(AccountRefreshResult {
            account: None,
            auto_removed: None,
        }),
        AuthData::ChatGPT { .. } => {
            let fresh_account = match prepare_chatgpt_account_for_request(&account).await? {
                ChatgptRequestOutcome::Success(account) => account,
                ChatgptRequestOutcome::AutoRemoved(auto_removed) => {
                    return Ok(AccountRefreshResult {
                        account: None,
                        auto_removed: Some(auto_removed),
                    });
                }
            };

            match fetch_account_metadata_for_account(&fresh_account).await? {
                ChatgptRequestOutcome::Success(metadata) => {
                    let updated = update_account_team_metadata(
                        &fresh_account.id,
                        metadata.email.clone(),
                        metadata.plan_type.clone(),
                        metadata.team_name.clone(),
                        Utc::now(),
                    )?;
                    Ok(AccountRefreshResult {
                        account: Some(crate::types::AccountInfo::from_stored(&updated, None)),
                        auto_removed: None,
                    })
                }
                ChatgptRequestOutcome::AutoRemoved(auto_removed) => Ok(AccountRefreshResult {
                    account: None,
                    auto_removed: Some(auto_removed),
                }),
            }
        }
    }
}

pub(crate) async fn fetch_account_metadata_for_account(
    account: &StoredAccount,
) -> Result<ChatgptRequestOutcome<AccountMetadata>> {
    let (access_token, chatgpt_account_id) = extract_chatgpt_auth(account)?;
    let response = send_chatgpt_accounts_check_request(access_token, chatgpt_account_id).await?;

    fetch_account_metadata_from_response(account, response).await
}

async fn fetch_account_metadata_from_response(
    account: &StoredAccount,
    response: reqwest::Response,
) -> Result<ChatgptRequestOutcome<AccountMetadata>> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        println!("[Metadata] Error response: {body}");
        if let Some(reason) = detect_invalid_chatgpt_account_reason(&body) {
            return Ok(ChatgptRequestOutcome::AutoRemoved(
                auto_remove_invalid_account(account, reason)?,
            ));
        }
        anyhow::bail!("Account metadata request failed with status {status}");
    }

    let body = response
        .text()
        .await
        .context("Failed to read account metadata response body")?;
    let payload: AccountsCheckResponse =
        serde_json::from_str(&body).context("Failed to parse account metadata response")?;

    let account_id = match &account.auth_data {
        AuthData::ChatGPT { account_id, .. } => account_id.as_deref(),
        AuthData::ApiKey { .. } => None,
    };

    Ok(ChatgptRequestOutcome::Success(build_account_metadata(
        account.email.clone(),
        account.plan_type.clone(),
        account_id,
        payload,
    )))
}

async fn get_usage_with_chatgpt_auth(account: &StoredAccount) -> Result<UsageQueryResult> {
    let fresh_account = match prepare_chatgpt_account_for_request(account).await? {
        ChatgptRequestOutcome::Success(account) => account,
        ChatgptRequestOutcome::AutoRemoved(auto_removed) => {
            return Ok(UsageQueryResult::auto_removed(auto_removed));
        }
    };
    let (access_token, chatgpt_account_id) = extract_chatgpt_auth(&fresh_account)?;

    let response = send_chatgpt_usage_request(access_token, chatgpt_account_id).await?;
    parse_usage_response(&fresh_account.id, &fresh_account.name, &fresh_account, response).await
}

async fn parse_usage_response(
    account_id: &str,
    account_name: &str,
    account: &StoredAccount,
    response: reqwest::Response,
) -> Result<UsageQueryResult> {
    let status = response.status();
    println!("[Usage] Response status: {status}");

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        println!("[Usage] Error response: {body}");
        if let Some(reason) = detect_invalid_chatgpt_account_reason(&body) {
            return Ok(UsageQueryResult::auto_removed(auto_remove_invalid_account(
                account, reason,
            )?));
        }
        return Ok(UsageQueryResult::success(UsageInfo::error(
            account_id.to_string(),
            format!("API error: {status}"),
        )));
    }

    let body_text = response
        .text()
        .await
        .context("Failed to read response body")?;
    println!(
        "[Usage] Response body: {}",
        &body_text[..body_text.len().min(200)]
    );

    let payload: RateLimitStatusPayload =
        serde_json::from_str(&body_text).context("Failed to parse usage response")?;

    println!("[Usage] Parsed plan_type: {}", payload.plan_type);

    let usage = convert_payload_to_usage_info(account_id, payload);
    println!(
        "[Usage] {} - primary: {:?}%, plan: {:?}",
        account_name, usage.primary_used_percent, usage.plan_type
    );

    Ok(UsageQueryResult::success(usage))
}

async fn warmup_with_chatgpt_auth(account: &StoredAccount) -> Result<WarmupAccountResult> {
    let fresh_account = match prepare_chatgpt_account_for_request(account).await? {
        ChatgptRequestOutcome::Success(account) => account,
        ChatgptRequestOutcome::AutoRemoved(auto_removed) => {
            return Ok(WarmupAccountResult {
                auto_removed: Some(auto_removed),
            });
        }
    };
    let (access_token, chatgpt_account_id) = extract_chatgpt_auth(&fresh_account)?;

    let response = send_chatgpt_warmup_request(access_token, chatgpt_account_id, true).await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        println!("[Warmup] ChatGPT warm-up error response: {body}");
        if let Some(reason) = detect_invalid_chatgpt_account_reason(&body) {
            return Ok(WarmupAccountResult {
                auto_removed: Some(auto_remove_invalid_account(account, reason)?),
            });
        }
        anyhow::bail!("ChatGPT warm-up failed with status {status}");
    }

    let body = response.text().await.unwrap_or_default();
    log_warmup_response("ChatGPT", &body, true);

    Ok(WarmupAccountResult { auto_removed: None })
}

async fn prepare_chatgpt_account_for_request(
    account: &StoredAccount,
) -> Result<ChatgptRequestOutcome<StoredAccount>> {
    match ensure_chatgpt_tokens_fresh(account).await {
        Ok(account) => Ok(ChatgptRequestOutcome::Success(account)),
        Err(err) => {
            if let Some(reason) = detect_invalid_chatgpt_account_reason_in_error(&err) {
                return Ok(ChatgptRequestOutcome::AutoRemoved(
                    auto_remove_invalid_account(account, reason)?,
                ));
            }
            Err(err)
        }
    }
}

async fn warmup_with_api_key(api_key: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let payload = build_warmup_payload(false, true);
    let response = client
        .post(format!("{OPENAI_API}/responses"))
        .header(USER_AGENT, CODEX_USER_AGENT)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .json(&payload)
        .send()
        .await
        .context("Failed to send API key warm-up request")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        println!("[Warmup] API key warm-up error response: {body}");
        anyhow::bail!("API key warm-up failed with status {status}");
    }

    let body = response.text().await.unwrap_or_default();
    log_warmup_response("API key", &body, false);

    Ok(())
}

fn build_warmup_payload(stream: bool, include_max_output_tokens: bool) -> serde_json::Value {
    let mut payload = json!({
        "model": "gpt-5.3-codex",
        "instructions": "You are Codex.",
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Hi"
                    }
                ]
            }
        ],
        "tools": [],
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "reasoning": {
            "effort": "low"
        },
        "store": false,
        "stream": stream
    });

    if include_max_output_tokens {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("max_output_tokens".to_string(), json!(1));
        }
    }

    payload
}

fn build_chatgpt_headers(
    access_token: &str,
    chatgpt_account_id: Option<&str>,
) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(CODEX_USER_AGENT));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}")).context("Invalid access token")?,
    );

    if let Some(acc_id) = chatgpt_account_id {
        println!("[Usage] Using ChatGPT Account ID: {acc_id}");
        if let Ok(header_name) = HeaderName::from_bytes(b"chatgpt-account-id") {
            if let Ok(header_value) = HeaderValue::from_str(acc_id) {
                headers.insert(header_name, header_value);
            }
        }
    }

    Ok(headers)
}

fn extract_chatgpt_auth(account: &StoredAccount) -> Result<(&str, Option<&str>)> {
    match &account.auth_data {
        AuthData::ChatGPT {
            access_token,
            account_id,
            ..
        } => Ok((access_token.as_str(), account_id.as_deref())),
        AuthData::ApiKey { .. } => anyhow::bail!("Account is not using ChatGPT OAuth"),
    }
}

async fn send_chatgpt_usage_request(
    access_token: &str,
    chatgpt_account_id: Option<&str>,
) -> Result<reqwest::Response> {
    let client = reqwest::Client::new();
    let headers = build_chatgpt_headers(access_token, chatgpt_account_id)?;
    let url = format!("{CHATGPT_BACKEND_API}/wham/usage");
    println!("[Usage] Requesting: {url}");

    client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .context("Failed to send usage request")
}

async fn send_chatgpt_accounts_check_request(
    access_token: &str,
    chatgpt_account_id: Option<&str>,
) -> Result<reqwest::Response> {
    let client = reqwest::Client::new();
    let headers = build_chatgpt_headers(access_token, chatgpt_account_id)?;

    client
        .get(CHATGPT_ACCOUNT_CHECK_API)
        .headers(headers)
        .send()
        .await
        .context("Failed to send account metadata request")
}

async fn send_chatgpt_warmup_request(
    access_token: &str,
    chatgpt_account_id: Option<&str>,
    stream: bool,
) -> Result<reqwest::Response> {
    let client = reqwest::Client::new();
    let headers = build_chatgpt_headers(access_token, chatgpt_account_id)?;
    let payload = build_warmup_payload(stream, false);

    client
        .post(CHATGPT_CODEX_RESPONSES_API)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .context("Failed to send ChatGPT warm-up request")
}

fn log_warmup_response(source: &str, body: &str, is_sse: bool) {
    if body.trim().is_empty() {
        println!("[Warmup] {source} warm-up response was empty");
        return;
    }

    let preview = truncate_text(body, 300);
    println!("[Warmup] {source} warm-up response preview: {preview}");

    let extracted = if is_sse {
        extract_text_from_sse(body)
    } else {
        extract_text_from_json(body)
    };

    if let Some(message) = extracted {
        let message_preview = truncate_text(&message, 200);
        println!("[Warmup] {source} warm-up message: {message_preview}");
    }
}

fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }
    let mut out = text[..max_len].to_string();
    out.push_str("...");
    out
}

fn extract_text_from_sse(body: &str) -> Option<String> {
    let mut last_text: Option<String> = None;
    for line in body.lines() {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let data = line.trim_start_matches("data:").trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            if let Some(text) = extract_last_text_from_value(&value) {
                last_text = Some(text);
            }
        }
    }
    last_text.filter(|text| !text.trim().is_empty())
}

fn extract_text_from_json(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body).ok()?;
    extract_last_text_from_value(&value)
}

fn extract_last_text_from_value(value: &Value) -> Option<String> {
    let mut last: Option<String> = None;
    collect_last_text(value, &mut last);
    last
}

fn collect_last_text(value: &Value, last: &mut Option<String>) {
    match value {
        Value::Object(map) => {
            for (key, val) in map {
                if matches!(key.as_str(), "text" | "delta" | "output_text") {
                    if let Value::String(text) = val {
                        if !text.is_empty() {
                            *last = Some(text.clone());
                        }
                    }
                }
                collect_last_text(val, last);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_last_text(item, last);
            }
        }
        _ => {}
    }
}

/// Convert API response to UsageInfo
fn convert_payload_to_usage_info(account_id: &str, payload: RateLimitStatusPayload) -> UsageInfo {
    let (primary, secondary) = extract_rate_limits(payload.rate_limit);
    let credits = extract_credits(payload.credits);

    UsageInfo {
        account_id: account_id.to_string(),
        plan_type: Some(payload.plan_type),
        primary_used_percent: primary.as_ref().map(|w| w.used_percent),
        primary_window_minutes: primary
            .as_ref()
            .and_then(|w| w.limit_window_seconds)
            .map(|s| (i64::from(s) + 59) / 60),
        primary_resets_at: primary.as_ref().and_then(|w| w.reset_at),
        secondary_used_percent: secondary.as_ref().map(|w| w.used_percent),
        secondary_window_minutes: secondary
            .as_ref()
            .and_then(|w| w.limit_window_seconds)
            .map(|s| (i64::from(s) + 59) / 60),
        secondary_resets_at: secondary.as_ref().and_then(|w| w.reset_at),
        has_credits: credits.as_ref().map(|c| c.has_credits),
        unlimited_credits: credits.as_ref().map(|c| c.unlimited),
        credits_balance: credits.and_then(|c| c.balance),
        error: None,
    }
}

fn extract_rate_limits(
    rate_limit: Option<RateLimitDetails>,
) -> (Option<RateLimitWindow>, Option<RateLimitWindow>) {
    match rate_limit {
        Some(details) => (details.primary_window, details.secondary_window),
        None => (None, None),
    }
}

fn extract_credits(credits: Option<CreditStatusDetails>) -> Option<CreditStatusDetails> {
    credits
}

fn build_account_metadata(
    email: Option<String>,
    fallback_plan_type: Option<String>,
    selected_account_id: Option<&str>,
    payload: AccountsCheckResponse,
) -> AccountMetadata {
    let matched = selected_account_id
        .and_then(|account_id| payload.accounts.iter().find(|entry| entry.id == account_id));

    let plan_type = matched
        .and_then(|entry| entry.plan_type.clone())
        .or(fallback_plan_type);

    let team_name = matched.and_then(|entry| match entry.plan_type.as_deref() {
        Some("team") => entry.name.clone(),
        _ => None,
    });

    AccountMetadata {
        email,
        plan_type,
        team_name,
    }
}

/// Refresh all account usage
pub async fn refresh_all_usage(accounts: &[StoredAccount]) -> Vec<UsageQueryResult> {
    println!("[Usage] Refreshing usage for {} accounts", accounts.len());

    let concurrency = accounts.len().min(10).max(1);
    let results: Vec<UsageQueryResult> = stream::iter(accounts.iter().cloned())
        .map(|account| async move {
            match get_account_usage(&account).await {
                Ok(info) => info,
                Err(e) => {
                    println!("[Usage] Error for {}: {}", account.name, e);
                    UsageQueryResult::success(UsageInfo::error(account.id.clone(), e.to_string()))
                }
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    println!("[Usage] Refresh complete");
    results
}

fn detect_invalid_chatgpt_account_reason(body: &str) -> Option<AutoRemovedAccountReason> {
    let payload: Value = serde_json::from_str(body).ok()?;

    match payload
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
    {
        Some("token_invalidated") => return Some(AutoRemovedAccountReason::TokenInvalidated),
        _ => {}
    }

    match payload
        .get("detail")
        .and_then(|detail| detail.get("code"))
        .and_then(Value::as_str)
    {
        Some("deactivated_workspace") => Some(AutoRemovedAccountReason::DeactivatedWorkspace),
        _ => None,
    }
}

fn detect_invalid_chatgpt_account_reason_in_error(
    error: &anyhow::Error,
) -> Option<AutoRemovedAccountReason> {
    for message in error.chain().map(|item| item.to_string()) {
        if let Some(reason) = detect_invalid_chatgpt_account_reason_in_text(&message) {
            return Some(reason);
        }
    }
    None
}

fn detect_invalid_chatgpt_account_reason_in_text(
    text: &str,
) -> Option<AutoRemovedAccountReason> {
    if let Some(reason) = detect_invalid_chatgpt_account_reason(text) {
        return Some(reason);
    }

    if let Some((_, body)) = text.split_once(" - ") {
        if let Some(reason) = detect_invalid_chatgpt_account_reason(body) {
            return Some(reason);
        }
    }

    if text.contains("token_invalidated") {
        return Some(AutoRemovedAccountReason::TokenInvalidated);
    }

    if text.contains("deactivated_workspace") {
        return Some(AutoRemovedAccountReason::DeactivatedWorkspace);
    }

    None
}

fn auto_remove_invalid_account(
    account: &StoredAccount,
    reason: AutoRemovedAccountReason,
) -> Result<AutoRemovedAccount> {
    let removal = remove_account(&account.id)?;
    Ok(AutoRemovedAccount {
        account_id: account.id.clone(),
        reason,
        replacement_account_id: removal.replacement_account_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_account_metadata, detect_invalid_chatgpt_account_reason,
        detect_invalid_chatgpt_account_reason_in_text, AccountMetadata, AccountsCheckResponse,
    };
    use crate::types::AutoRemovedAccountReason;

    #[test]
    fn account_metadata_uses_matching_team_workspace_name() {
        let payload: AccountsCheckResponse = serde_json::from_str(
            r#"{
                "accounts": [
                    { "id": "team-1", "plan_type": "team", "name": "Lokawave" },
                    { "id": "personal-1", "plan_type": "free", "name": null }
                ]
            }"#,
        )
        .unwrap();

        let metadata = build_account_metadata(
            Some("user@example.com".to_string()),
            Some("team".to_string()),
            Some("team-1"),
            payload,
        );

        assert_eq!(
            metadata,
            AccountMetadata {
                email: Some("user@example.com".to_string()),
                plan_type: Some("team".to_string()),
                team_name: Some("Lokawave".to_string()),
            }
        );
    }

    #[test]
    fn account_metadata_keeps_personal_accounts_without_team_name() {
        let payload: AccountsCheckResponse = serde_json::from_str(
            r#"{
                "accounts": [
                    { "id": "personal-1", "plan_type": "free", "name": null }
                ]
            }"#,
        )
        .unwrap();

        let metadata = build_account_metadata(
            Some("user@example.com".to_string()),
            Some("free".to_string()),
            Some("personal-1"),
            payload,
        );

        assert_eq!(metadata.team_name, None);
        assert_eq!(metadata.plan_type.as_deref(), Some("free"));
    }

    #[test]
    fn detects_token_invalidated_as_auto_remove_reason() {
        let body = r#"{
            "error": {
                "message": "Your authentication token has been invalidated. Please try signing in again.",
                "type": "invalid_request_error",
                "code": "token_invalidated",
                "param": null
            },
            "status": 401
        }"#;

        assert_eq!(
            detect_invalid_chatgpt_account_reason(body),
            Some(AutoRemovedAccountReason::TokenInvalidated)
        );
    }

    #[test]
    fn detects_deactivated_workspace_as_auto_remove_reason() {
        let body = r#"{
            "detail": {
                "code": "deactivated_workspace"
            }
        }"#;

        assert_eq!(
            detect_invalid_chatgpt_account_reason(body),
            Some(AutoRemovedAccountReason::DeactivatedWorkspace)
        );
    }

    #[test]
    fn ignores_generic_auth_failures_for_auto_remove() {
        let body = r#"{
            "error": {
                "message": "Unauthorized",
                "type": "invalid_request_error",
                "code": "invalid_api_key",
                "param": null
            },
            "status": 401
        }"#;

        assert_eq!(detect_invalid_chatgpt_account_reason(body), None);
    }

    #[test]
    fn detects_invalid_reason_inside_refresh_error_text() {
        let text = r#"Token refresh failed: 401 Unauthorized - {"error":{"message":"Your authentication token has been invalidated. Please try signing in again.","type":"invalid_request_error","code":"token_invalidated","param":null},"status":401}"#;

        assert_eq!(
            detect_invalid_chatgpt_account_reason_in_text(text),
            Some(AutoRemovedAccountReason::TokenInvalidated)
        );
    }
}
