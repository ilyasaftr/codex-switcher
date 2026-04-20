//! Usage query Tauri commands

use crate::api::usage::{get_account_usage, refresh_all_usage, warmup_account as send_warmup};
use crate::auth::{get_account, load_accounts};
use crate::types::{UsageQueryResult, WarmupAccountResult, WarmupSummary};
use futures::{stream, StreamExt};

/// Get usage info for a specific account
#[tauri::command]
pub async fn get_usage(account_id: String) -> Result<UsageQueryResult, String> {
    let account = get_account(&account_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Account not found: {account_id}"))?;

    get_account_usage(&account).await.map_err(|e| e.to_string())
}

/// Refresh usage info for all accounts
#[tauri::command]
pub async fn refresh_all_accounts_usage() -> Result<Vec<UsageQueryResult>, String> {
    let store = load_accounts().map_err(|e| e.to_string())?;
    Ok(refresh_all_usage(&store.accounts).await)
}

/// Send a minimal warm-up request for one account
#[tauri::command]
pub async fn warmup_account(account_id: String) -> Result<WarmupAccountResult, String> {
    let account = get_account(&account_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Account not found: {account_id}"))?;

    send_warmup(&account).await.map_err(|e| e.to_string())
}

/// Send minimal warm-up requests for all accounts
#[tauri::command]
pub async fn warmup_all_accounts() -> Result<WarmupSummary, String> {
    let store = load_accounts().map_err(|e| e.to_string())?;
    let total_accounts = store.accounts.len();
    let concurrency = total_accounts.min(10).max(1);

    let results: Vec<(String, Option<_>, bool)> = stream::iter(store.accounts.into_iter())
        .map(|account| async move {
            let account_id = account.id.clone();
            match send_warmup(&account).await {
                Ok(result) => (account_id, result.auto_removed, false),
                Err(_) => (account_id, None, true),
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let failed_account_ids = results
        .iter()
        .filter_map(|(account_id, _, failed)| failed.then_some(account_id.clone()))
        .collect::<Vec<_>>();

    let auto_removed_accounts = results
        .into_iter()
        .filter_map(|(_, auto_removed, _)| auto_removed)
        .collect::<Vec<_>>();

    let warmed_accounts = total_accounts
        .saturating_sub(failed_account_ids.len())
        .saturating_sub(auto_removed_accounts.len());
    Ok(WarmupSummary {
        total_accounts,
        warmed_accounts,
        failed_account_ids,
        auto_removed_accounts,
    })
}
