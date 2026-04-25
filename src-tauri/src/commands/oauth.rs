//! OAuth login Tauri commands

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::api::refresh_account_metadata;
use crate::auth::oauth_server::{start_oauth_login, wait_for_oauth_login, OAuthLoginResult};
use crate::auth::{
    add_account, load_accounts, set_active_account, switch_to_account, touch_account,
};
use crate::types::{AccountInfo, OAuthLoginInfo};

struct PendingOAuth {
    rx: Option<oneshot::Receiver<anyhow::Result<OAuthLoginResult>>>,
    cancelled: Arc<AtomicBool>,
}

// Global state for pending OAuth login
static PENDING_OAUTH: Mutex<Option<PendingOAuth>> = Mutex::new(None);

/// Start the OAuth login flow
#[tauri::command]
pub async fn start_login() -> Result<OAuthLoginInfo, String> {
    // Cancel any previous pending flow so it does not keep the callback port occupied.
    if let Some(previous) = {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        pending.take()
    } {
        previous.cancelled.store(true, Ordering::Relaxed);
    }

    let (info, rx, cancelled) = start_oauth_login().await.map_err(|e| e.to_string())?;

    // Store the receiver for later
    {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        *pending = Some(PendingOAuth {
            rx: Some(rx),
            cancelled,
        });
    }

    Ok(info)
}

/// Wait for the OAuth login to complete and add the account
#[tauri::command]
pub async fn complete_login() -> Result<AccountInfo, String> {
    let (rx, cancelled) = {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        let pending = pending
            .as_mut()
            .ok_or_else(|| "No pending OAuth login".to_string())?;
        let rx = pending
            .rx
            .take()
            .ok_or_else(|| "OAuth login is already waiting".to_string())?;
        (rx, pending.cancelled.clone())
    };

    let login_result = wait_for_oauth_login(rx).await;

    {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        if pending
            .as_ref()
            .map(|pending| Arc::ptr_eq(&pending.cancelled, &cancelled))
            .unwrap_or(false)
        {
            pending.take();
        }
    }

    let account = login_result.map_err(|e| e.to_string())?;

    let had_active_account = load_accounts()
        .map_err(|e| e.to_string())?
        .active_account_id
        .is_some();

    // Add the account to storage
    let stored = add_account(account).map_err(|e| e.to_string())?;

    // Keep existing active account unless this is first-account onboarding.
    if !had_active_account {
        set_active_account(&stored.id).map_err(|e| e.to_string())?;
        switch_to_account(&stored).map_err(|e| e.to_string())?;
        touch_account(&stored.id).map_err(|e| e.to_string())?;
    }

    if let Err(err) = refresh_account_metadata(&stored.id).await {
        println!(
            "[OAuth] Account metadata refresh failed for {}: {err}",
            stored.id
        );
    }

    let store = load_accounts().map_err(|e| e.to_string())?;
    let active_id = store.active_account_id.as_deref();
    let refreshed = store
        .accounts
        .iter()
        .find(|account| account.id == stored.id)
        .unwrap_or(&stored);

    Ok(AccountInfo::from_stored(refreshed, active_id))
}

/// Cancel a pending OAuth login
#[tauri::command]
pub async fn cancel_login() -> Result<(), String> {
    let mut pending = PENDING_OAUTH.lock().unwrap();
    if let Some(pending_oauth) = pending.take() {
        pending_oauth.cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_login_stops_waiting_complete_login() {
        let _ = cancel_login().await;
        let _info = start_login().await.expect("start login");

        let waiter = tokio::spawn(async { complete_login().await });
        tokio::time::sleep(Duration::from_millis(50)).await;

        cancel_login().await.expect("cancel login");

        let result = tokio::time::timeout(Duration::from_secs(3), waiter)
            .await
            .expect("complete_login should exit after cancellation")
            .expect("join complete_login task");

        assert!(result
            .expect_err("cancelled login should not complete successfully")
            .contains("cancelled"));
    }
}
