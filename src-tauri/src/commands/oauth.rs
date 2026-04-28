//! OAuth login Tauri commands

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::api::refresh_account_metadata;
use crate::auth::oauth_server::{
    cancel_oauth_state, start_oauth_login, wait_for_oauth_login, OAuthLoginResult,
};
use crate::auth::{
    add_account, load_accounts, set_active_account, switch_to_account, touch_account,
};
use crate::types::{AccountInfo, OAuthLoginInfo};

struct PendingOAuth {
    rx: Option<oneshot::Receiver<anyhow::Result<OAuthLoginResult>>>,
    cancelled: Arc<AtomicBool>,
    created_at: Instant,
    state: String,
}

const OAUTH_LOGIN_TIMEOUT_SECONDS: u64 = 300;

// Global state for pending OAuth login flows.
static PENDING_OAUTH: Mutex<Option<HashMap<String, PendingOAuth>>> = Mutex::new(None);

fn with_pending_oauth<R>(f: impl FnOnce(&mut HashMap<String, PendingOAuth>) -> R) -> R {
    let mut pending = PENDING_OAUTH.lock().unwrap();
    f(pending.get_or_insert_with(HashMap::new))
}

fn cleanup_expired_flows(pending: &mut HashMap<String, PendingOAuth>) {
    let timeout = Duration::from_secs(OAUTH_LOGIN_TIMEOUT_SECONDS);
    pending.retain(|_, flow| {
        let keep = flow.created_at.elapsed() <= timeout;
        if !keep {
            flow.cancelled.store(true, Ordering::Relaxed);
            cancel_oauth_state(&flow.state);
        }
        keep
    });
}

/// Start the OAuth login flow
#[tauri::command]
pub async fn start_login() -> Result<OAuthLoginInfo, String> {
    with_pending_oauth(cleanup_expired_flows);

    let flow_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let registration = start_oauth_login(flow_id.clone(), created_at)
        .await
        .map_err(|e| e.to_string())?;

    with_pending_oauth(|pending| {
        pending.insert(
            flow_id,
            PendingOAuth {
                rx: Some(registration.rx),
                cancelled: registration.cancelled,
                created_at: Instant::now(),
                state: registration.state,
            },
        );
    });

    Ok(registration.info)
}

/// Wait for the OAuth login to complete and add the account
#[tauri::command]
pub async fn complete_login(flow_id: String) -> Result<AccountInfo, String> {
    let (rx, cancelled) = with_pending_oauth(|pending| {
        cleanup_expired_flows(pending);
        let pending_flow = pending
            .get_mut(&flow_id)
            .ok_or_else(|| "No pending OAuth login for this flow".to_string())?;
        let rx = pending_flow
            .rx
            .take()
            .ok_or_else(|| "OAuth login is already waiting".to_string())?;
        Ok::<_, String>((rx, pending_flow.cancelled.clone()))
    })?;

    let login_result = wait_for_oauth_login(rx).await;

    with_pending_oauth(|pending| {
        if pending
            .get(&flow_id)
            .map(|pending_flow| Arc::ptr_eq(&pending_flow.cancelled, &cancelled))
            .unwrap_or(false)
        {
            pending.remove(&flow_id);
        }
    });

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
pub async fn cancel_login(flow_id: String) -> Result<(), String> {
    with_pending_oauth(|pending| {
        if let Some(pending_oauth) = pending.remove(&flow_id) {
            pending_oauth.cancelled.store(true, Ordering::Relaxed);
            cancel_oauth_state(&pending_oauth.state);
        }
    });
    Ok(())
}

/// Cancel all pending OAuth logins.
#[tauri::command]
pub async fn cancel_all_logins() -> Result<(), String> {
    with_pending_oauth(|pending| {
        for (_, pending_oauth) in pending.drain() {
            pending_oauth.cancelled.store(true, Ordering::Relaxed);
            cancel_oauth_state(&pending_oauth.state);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::oauth_server::oauth_callback_port;

    static TEST_OAUTH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_login_allows_multiple_pending_flows() {
        let _guard = TEST_OAUTH_LOCK.lock().await;
        let _ = cancel_all_logins().await;

        let first = start_login().await.expect("start first login");
        let second = start_login().await.expect("start second login");

        assert_ne!(first.flow_id, second.flow_id);
        let callback_port = oauth_callback_port();
        let encoded_redirect =
            format!("redirect_uri=http%3A%2F%2Flocalhost%3A{callback_port}%2Fauth%2Fcallback");
        assert_eq!(first.callback_port, callback_port);
        assert_eq!(second.callback_port, callback_port);
        assert!(first.auth_url.contains(&encoded_redirect));
        assert!(second.auth_url.contains(&encoded_redirect));

        with_pending_oauth(|pending| {
            assert!(pending.contains_key(&first.flow_id));
            assert!(pending.contains_key(&second.flow_id));
        });

        cancel_all_logins().await.expect("cancel all logins");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unknown_state_callback_does_not_cancel_pending_flows() {
        let _guard = TEST_OAUTH_LOCK.lock().await;
        let _ = cancel_all_logins().await;

        let first = start_login().await.expect("start first login");
        let second = start_login().await.expect("start second login");
        let response = reqwest::get(format!(
            "http://127.0.0.1:{}/auth/callback?state=unknown&code=fake",
            oauth_callback_port()
        ))
        .await
        .expect("unknown state callback response");

        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        with_pending_oauth(|pending| {
            assert!(pending.contains_key(&first.flow_id));
            assert!(pending.contains_key(&second.flow_id));
        });

        cancel_all_logins().await.expect("cancel all logins");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_login_only_cancels_selected_flow() {
        let _guard = TEST_OAUTH_LOCK.lock().await;
        let _ = cancel_all_logins().await;

        let first = start_login().await.expect("start first login");
        let second = start_login().await.expect("start second login");

        cancel_login(first.flow_id.clone())
            .await
            .expect("cancel first login");

        with_pending_oauth(|pending| {
            assert!(!pending.contains_key(&first.flow_id));
            assert!(pending.contains_key(&second.flow_id));
        });

        cancel_all_logins().await.expect("cancel all logins");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn complete_login_rejects_unknown_flow() {
        let _guard = TEST_OAUTH_LOCK.lock().await;
        let result = complete_login("missing-flow".to_string()).await;

        assert!(result
            .expect_err("unknown flow should not complete successfully")
            .contains("No pending OAuth login for this flow"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_all_logins_stops_waiting_complete_login() {
        let _guard = TEST_OAUTH_LOCK.lock().await;
        let _ = cancel_all_logins().await;
        let info = start_login().await.expect("start login");
        let flow_id = info.flow_id.clone();

        let waiter = tokio::spawn(async move { complete_login(flow_id).await });
        tokio::time::sleep(Duration::from_millis(50)).await;

        cancel_all_logins().await.expect("cancel all logins");

        let result = tokio::time::timeout(Duration::from_secs(3), waiter)
            .await
            .expect("complete_login should exit after cancellation")
            .expect("join complete_login task");

        assert!(result
            .expect_err("cancelled login should not complete successfully")
            .contains("cancelled"));
    }
}
