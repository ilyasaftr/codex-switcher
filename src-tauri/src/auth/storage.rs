//! Account storage module - manages reading and writing accounts.json

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};

use crate::types::{AccountsStore, AuthData, StoredAccount};

const CHATGPT_NAME_SEPARATOR: &str = " \u{00B7} ";

/// Get the path to the codex-switcher config directory
pub fn get_config_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Could not find home directory")?;
    Ok(home.join(".codex-switcher"))
}

/// Get the path to accounts.json
pub fn get_accounts_file() -> Result<PathBuf> {
    Ok(get_config_dir()?.join("accounts.json"))
}

/// Load the accounts store from disk
pub fn load_accounts() -> Result<AccountsStore> {
    let path = get_accounts_file()?;

    if !path.exists() {
        return Ok(AccountsStore::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read accounts file: {}", path.display()))?;

    let store: AccountsStore = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse accounts file: {}", path.display()))?;

    Ok(store)
}

/// Save the accounts store to disk
pub fn save_accounts(store: &AccountsStore) -> Result<()> {
    let path = get_accounts_file()?;

    // Ensure the config directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create config directory: {}", parent.display()))?;
    }

    let content =
        serde_json::to_string_pretty(store).context("Failed to serialize accounts store")?;

    fs::write(&path, content)
        .with_context(|| format!("Failed to write accounts file: {}", path.display()))?;

    // Set restrictive permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }

    Ok(())
}

/// Add a new account to the store
pub fn add_account(account: StoredAccount) -> Result<StoredAccount> {
    let mut store = load_accounts()?;

    let mut account = account;

    if matches!(account.auth_data, AuthData::ChatGPT { .. }) {
        if is_duplicate_chatgpt_account(&store.accounts, &account) {
            anyhow::bail!("This ChatGPT account already exists");
        }
        account.name = generate_chatgpt_display_name(&store.accounts, &account);
    }

    // Check for duplicate names
    if store.accounts.iter().any(|a| a.name == account.name) {
        anyhow::bail!("An account with name '{}' already exists", account.name);
    }

    let account_clone = account.clone();
    store.accounts.push(account);

    // If this is the first account, make it active
    if store.accounts.len() == 1 {
        store.active_account_id = Some(account_clone.id.clone());
    }

    save_accounts(&store)?;
    Ok(account_clone)
}

/// Remove an account by ID
pub fn remove_account(account_id: &str) -> Result<()> {
    let mut store = load_accounts()?;

    let initial_len = store.accounts.len();
    store.accounts.retain(|a| a.id != account_id);

    if store.accounts.len() == initial_len {
        anyhow::bail!("Account not found: {account_id}");
    }

    // If we removed the active account, clear it or set to first available
    if store.active_account_id.as_deref() == Some(account_id) {
        store.active_account_id = store.accounts.first().map(|a| a.id.clone());
    }

    save_accounts(&store)?;
    Ok(())
}

/// Update the active account ID
pub fn set_active_account(account_id: &str) -> Result<()> {
    let mut store = load_accounts()?;

    // Verify the account exists
    if !store.accounts.iter().any(|a| a.id == account_id) {
        anyhow::bail!("Account not found: {account_id}");
    }

    store.active_account_id = Some(account_id.to_string());
    save_accounts(&store)?;
    Ok(())
}

/// Get an account by ID
pub fn get_account(account_id: &str) -> Result<Option<StoredAccount>> {
    let store = load_accounts()?;
    Ok(store.accounts.into_iter().find(|a| a.id == account_id))
}

/// Get the currently active account
pub fn get_active_account() -> Result<Option<StoredAccount>> {
    let store = load_accounts()?;
    let active_id = match &store.active_account_id {
        Some(id) => id,
        None => return Ok(None),
    };
    Ok(store.accounts.into_iter().find(|a| a.id == *active_id))
}

/// Update an account's last_used_at timestamp
pub fn touch_account(account_id: &str) -> Result<()> {
    let mut store = load_accounts()?;

    if let Some(account) = store.accounts.iter_mut().find(|a| a.id == account_id) {
        account.last_used_at = Some(chrono::Utc::now());
        save_accounts(&store)?;
    }

    Ok(())
}

/// Update an account's metadata (name, email, plan_type)
pub fn update_account_metadata(
    account_id: &str,
    name: Option<String>,
    email: Option<String>,
    plan_type: Option<String>,
    team_name: Option<String>,
    team_info_updated_at: Option<DateTime<Utc>>,
) -> Result<()> {
    let mut store = load_accounts()?;

    // Check for duplicate names first (if renaming)
    if let Some(ref new_name) = name {
        if store
            .accounts
            .iter()
            .any(|a| a.id != account_id && a.name == *new_name)
        {
            anyhow::bail!("An account with name '{new_name}' already exists");
        }
    }

    // Now find and update the account
    let account = store
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .context("Account not found")?;

    if let Some(new_name) = name {
        account.name = new_name;
    }

    if email.is_some() {
        account.email = email;
    }

    if plan_type.is_some() {
        account.plan_type = plan_type;
    }

    if team_name.is_some() {
        account.team_name = team_name;
    }

    if team_info_updated_at.is_some() {
        account.team_info_updated_at = team_info_updated_at;
    }

    save_accounts(&store)?;
    Ok(())
}

/// Update ChatGPT OAuth tokens for an account and return the updated account.
pub fn update_account_chatgpt_tokens(
    account_id: &str,
    id_token: String,
    access_token: String,
    refresh_token: String,
    chatgpt_account_id: Option<String>,
    email: Option<String>,
    plan_type: Option<String>,
) -> Result<StoredAccount> {
    let mut store = load_accounts()?;

    let account = store
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .context("Account not found")?;

    match &mut account.auth_data {
        AuthData::ChatGPT {
            id_token: stored_id_token,
            access_token: stored_access_token,
            refresh_token: stored_refresh_token,
            account_id: stored_account_id,
        } => {
            *stored_id_token = id_token;
            *stored_access_token = access_token;
            *stored_refresh_token = refresh_token;
            if let Some(new_account_id) = chatgpt_account_id {
                *stored_account_id = Some(new_account_id);
            }
        }
        AuthData::ApiKey { .. } => {
            anyhow::bail!("Cannot update OAuth tokens for an API key account");
        }
    }

    if let Some(new_email) = email {
        account.email = Some(new_email);
    }

    if let Some(new_plan_type) = plan_type {
        account.plan_type = Some(new_plan_type);
    }

    let updated = account.clone();
    save_accounts(&store)?;
    Ok(updated)
}

/// Update cached ChatGPT account metadata and return the updated account.
pub fn update_account_team_metadata(
    account_id: &str,
    email: Option<String>,
    plan_type: Option<String>,
    team_name: Option<String>,
    team_info_updated_at: DateTime<Utc>,
) -> Result<StoredAccount> {
    let mut store = load_accounts()?;

    let account = store
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .context("Account not found")?;

    if let Some(email) = email {
        account.email = Some(email);
    }

    if let Some(plan_type) = plan_type {
        account.plan_type = Some(plan_type);
    }

    account.team_name = team_name;
    account.team_info_updated_at = Some(team_info_updated_at);

    let updated = account.clone();
    save_accounts(&store)?;
    Ok(updated)
}

/// Get the list of masked account IDs
pub fn get_masked_account_ids() -> Result<Vec<String>> {
    let store = load_accounts()?;
    Ok(store.masked_account_ids.clone())
}

/// Set the list of masked account IDs
pub fn set_masked_account_ids(ids: Vec<String>) -> Result<()> {
    let mut store = load_accounts()?;
    store.masked_account_ids = ids;
    save_accounts(&store)?;
    Ok(())
}

fn is_duplicate_chatgpt_account(existing_accounts: &[StoredAccount], candidate: &StoredAccount) -> bool {
    let AuthData::ChatGPT {
        refresh_token: candidate_refresh_token,
        account_id: candidate_account_id,
        ..
    } = &candidate.auth_data
    else {
        return false;
    };

    if let (Some(candidate_email), Some(candidate_id)) =
        (candidate.email.as_deref(), candidate_account_id.as_deref())
    {
        return existing_accounts.iter().any(|existing| {
            let AuthData::ChatGPT {
                account_id: existing_account_id,
                ..
            } = &existing.auth_data
            else {
                return false;
            };

            existing.email.as_deref() == Some(candidate_email)
                && existing_account_id.as_deref() == Some(candidate_id)
        });
    }

    existing_accounts.iter().any(|existing| {
        let AuthData::ChatGPT {
            refresh_token: existing_refresh_token,
            ..
        } = &existing.auth_data
        else {
            return false;
        };

        existing_refresh_token == candidate_refresh_token
    })
}

fn generate_chatgpt_display_name(existing_accounts: &[StoredAccount], candidate: &StoredAccount) -> String {
    let base = candidate
        .email
        .as_deref()
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| candidate.name.clone());

    if !name_exists(existing_accounts, &base) {
        return base;
    }

    if let Some(team_name) = candidate
        .team_name
        .as_deref()
        .map(str::trim)
        .filter(|team| !team.is_empty())
    {
        let team_candidate = format!("{base}{CHATGPT_NAME_SEPARATOR}{team_name}");
        if !name_exists(existing_accounts, &team_candidate) {
            return team_candidate;
        }
    }

    if let AuthData::ChatGPT {
        account_id: Some(account_id),
        ..
    } = &candidate.auth_data
    {
        let id_candidate = format!(
            "{base}{CHATGPT_NAME_SEPARATOR}{}",
            shorten_account_id(account_id)
        );
        if !name_exists(existing_accounts, &id_candidate) {
            return id_candidate;
        }
    }

    let mut index = 2;
    loop {
        let fallback = format!("{base} #{index}");
        if !name_exists(existing_accounts, &fallback) {
            return fallback;
        }
        index += 1;
    }
}

fn shorten_account_id(account_id: &str) -> String {
    account_id.chars().take(6).collect()
}

fn name_exists(accounts: &[StoredAccount], name: &str) -> bool {
    accounts.iter().any(|account| account.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chatgpt(
        name: &str,
        email: Option<&str>,
        team_name: Option<&str>,
        account_id: Option<&str>,
        refresh_token: &str,
    ) -> StoredAccount {
        let mut account = StoredAccount::new_chatgpt(
            name.to_string(),
            email.map(str::to_string),
            Some("team".to_string()),
            format!("id-token-{refresh_token}"),
            format!("access-token-{refresh_token}"),
            refresh_token.to_string(),
            account_id.map(str::to_string),
        );
        account.name = name.to_string();
        account.team_name = team_name.map(str::to_string);
        account
    }

    #[test]
    fn duplicate_chatgpt_uses_email_and_account_id_when_present() {
        let existing = vec![make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team A"),
            Some("workspace-123"),
            "refresh-a",
        )];
        let candidate = make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team B"),
            Some("workspace-123"),
            "refresh-b",
        );

        assert!(is_duplicate_chatgpt_account(&existing, &candidate));
    }

    #[test]
    fn same_workspace_id_for_different_email_is_not_duplicate() {
        let existing = vec![make_chatgpt(
            "one@example.com",
            Some("one@example.com"),
            Some("Team A"),
            Some("workspace-123"),
            "refresh-a",
        )];
        let candidate = make_chatgpt(
            "two@example.com",
            Some("two@example.com"),
            Some("Team B"),
            Some("workspace-123"),
            "refresh-b",
        );

        assert!(!is_duplicate_chatgpt_account(&existing, &candidate));
    }

    #[test]
    fn duplicate_chatgpt_falls_back_to_refresh_token_when_account_id_missing() {
        let existing = vec![make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            None,
            Some("workspace-123"),
            "refresh-a",
        )];
        let candidate = make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            None,
            None,
            "refresh-a",
        );

        assert!(is_duplicate_chatgpt_account(&existing, &candidate));
    }

    #[test]
    fn same_email_different_workspace_is_not_duplicate() {
        let existing = vec![make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team A"),
            Some("workspace-aaa"),
            "refresh-a",
        )];
        let candidate = make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team B"),
            Some("workspace-bbb"),
            "refresh-b",
        );

        assert!(!is_duplicate_chatgpt_account(&existing, &candidate));
    }

    #[test]
    fn name_generation_uses_email_then_workspace_suffix() {
        let existing = vec![make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team A"),
            Some("workspace-aaa"),
            "refresh-a",
        )];
        let candidate = make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            Some("Team B"),
            Some("workspace-bbb"),
            "refresh-b",
        );

        assert_eq!(
            generate_chatgpt_display_name(&existing, &candidate),
            "user@example.com \u{00B7} Team B"
        );
    }

    #[test]
    fn name_generation_falls_back_to_short_account_id_then_counter() {
        let existing = vec![
            make_chatgpt(
                "user@example.com",
                Some("user@example.com"),
                None,
                Some("workspace-aaa111"),
                "refresh-a",
            ),
            make_chatgpt(
                "user@example.com \u{00B7} worksp",
                Some("user@example.com"),
                None,
                Some("workspace-aaa111"),
                "refresh-b",
            ),
            make_chatgpt(
                "user@example.com #2",
                Some("user@example.com"),
                None,
                Some("workspace-aaa222"),
                "refresh-c",
            ),
        ];

        let candidate = make_chatgpt(
            "user@example.com",
            Some("user@example.com"),
            None,
            Some("workspace-aaa111"),
            "refresh-d",
        );

        assert_eq!(
            generate_chatgpt_display_name(&existing, &candidate),
            "user@example.com #3"
        );
    }
}
