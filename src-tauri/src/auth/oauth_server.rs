//! Local OAuth server for handling ChatGPT login flow

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tiny_http::{Header, Request, Response, Server};
use tokio::sync::oneshot;

use crate::types::{parse_chatgpt_id_token_claims, OAuthLoginInfo, StoredAccount};

const DEFAULT_ISSUER: &str = "https://auth.openai.com";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const DEFAULT_PORT: u16 = 1455; // Same as official Codex
const OAUTH_LOGIN_TIMEOUT_SECONDS: u64 = 300;

#[cfg(test)]
static TEST_CALLBACK_PORT: OnceLock<u16> = OnceLock::new();

pub(crate) fn oauth_callback_port() -> u16 {
    #[cfg(test)]
    {
        *TEST_CALLBACK_PORT.get_or_init(|| {
            let listener =
                std::net::TcpListener::bind("127.0.0.1:0").expect("bind test OAuth callback port");
            let port = listener
                .local_addr()
                .expect("read test OAuth callback port")
                .port();
            drop(listener);
            port
        })
    }

    #[cfg(not(test))]
    {
        DEFAULT_PORT
    }
}

/// PKCE codes for OAuth
#[derive(Debug, Clone)]
pub struct PkceCodes {
    pub code_verifier: String,
    pub code_challenge: String,
}

/// Generate PKCE codes
pub fn generate_pkce() -> PkceCodes {
    let mut bytes = [0u8; 64];
    rand::rng().fill_bytes(&mut bytes);

    let code_verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);

    PkceCodes {
        code_verifier,
        code_challenge,
    }
}

/// Generate a random state parameter
fn generate_state() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Build the OAuth authorization URL
fn build_authorize_url(
    issuer: &str,
    client_id: &str,
    redirect_uri: &str,
    pkce: &PkceCodes,
    state: &str,
) -> String {
    let params = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", "openid profile email offline_access"),
        ("code_challenge", &pkce.code_challenge),
        ("code_challenge_method", "S256"),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("state", state),
        ("originator", "codex_cli_rs"), // Required by OpenAI OAuth
    ];

    let query_string = params
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{issuer}/oauth/authorize?{query_string}")
}

/// Token response from the OAuth server
#[derive(Debug, Clone, serde::Deserialize)]
struct TokenResponse {
    id_token: String,
    access_token: String,
    refresh_token: String,
}

/// Exchange authorization code for tokens
async fn exchange_code_for_tokens(
    issuer: &str,
    client_id: &str,
    redirect_uri: &str,
    pkce: &PkceCodes,
    code: &str,
) -> Result<TokenResponse> {
    let client = reqwest::Client::new();

    let body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
        urlencoding::encode(code),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(client_id),
        urlencoding::encode(&pkce.code_verifier)
    );

    let resp = client
        .post(format!("{issuer}/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .context("Failed to send token request")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Token exchange failed: {status} - {body}");
    }

    let tokens: TokenResponse = resp
        .json()
        .await
        .context("Failed to parse token response")?;
    Ok(tokens)
}

/// OAuth login flow result
pub struct OAuthLoginResult {
    pub account: StoredAccount,
}

pub struct OAuthLoginRegistration {
    pub info: OAuthLoginInfo,
    pub rx: oneshot::Receiver<Result<OAuthLoginResult>>,
    pub cancelled: Arc<AtomicBool>,
    pub state: String,
}

struct SharedOAuthServer {
    flows: Arc<Mutex<HashMap<String, SharedOAuthFlow>>>,
}

struct SharedOAuthFlow {
    flow_id: String,
    pkce: PkceCodes,
    tx: Option<oneshot::Sender<Result<OAuthLoginResult>>>,
    cancelled: Arc<AtomicBool>,
    created_at: Instant,
}

static SHARED_OAUTH_SERVER: Mutex<Option<SharedOAuthServer>> = Mutex::new(None);

fn with_shared_flows<R>(
    flows: &Arc<Mutex<HashMap<String, SharedOAuthFlow>>>,
    f: impl FnOnce(&mut HashMap<String, SharedOAuthFlow>) -> R,
) -> R {
    let mut flows = flows.lock().unwrap();
    f(&mut flows)
}

fn cleanup_expired_shared_flows(flows: &mut HashMap<String, SharedOAuthFlow>) {
    let timeout = Duration::from_secs(OAUTH_LOGIN_TIMEOUT_SECONDS);
    let expired_states = flows
        .iter()
        .filter_map(|(state, flow)| {
            if flow.created_at.elapsed() > timeout {
                Some(state.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    for state in expired_states {
        if let Some(mut flow) = flows.remove(&state) {
            flow.cancelled.store(true, Ordering::Relaxed);
            if let Some(tx) = flow.tx.take() {
                let _ = tx.send(Err(anyhow::anyhow!("OAuth login timed out")));
            }
        }
    }
}

fn ensure_shared_oauth_server() -> Result<Arc<Mutex<HashMap<String, SharedOAuthFlow>>>> {
    let mut shared = SHARED_OAUTH_SERVER.lock().unwrap();
    if let Some(server) = shared.as_ref() {
        return Ok(server.flows.clone());
    }

    let callback_port = oauth_callback_port();
    let server = Server::http(format!("127.0.0.1:{callback_port}")).map_err(|err| {
        anyhow::anyhow!(
            "OAuth callback port {callback_port} is unavailable: {err}. Close the other process using this port and try again."
        )
    })?;
    let server = Arc::new(server);
    let flows = Arc::new(Mutex::new(HashMap::new()));
    let server_flows = flows.clone();
    let server_handle = server.clone();

    thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(run_shared_oauth_server(server_handle, server_flows));
    });

    println!("[OAuth] Shared callback server started on port {callback_port}");
    *shared = Some(SharedOAuthServer {
        flows: flows.clone(),
    });

    Ok(flows)
}

/// Start the OAuth login flow
pub async fn start_oauth_login(
    flow_id: String,
    created_at: String,
) -> Result<OAuthLoginRegistration> {
    let flows = ensure_shared_oauth_server()?;
    let pkce = generate_pkce();
    let state = generate_state();

    println!("[OAuth] PKCE challenge: {}", &pkce.code_challenge[..20]);

    let callback_port = oauth_callback_port();
    let redirect_uri = format!("http://localhost:{callback_port}/auth/callback");
    let auth_url = build_authorize_url(DEFAULT_ISSUER, CLIENT_ID, &redirect_uri, &pkce, &state);

    println!("[OAuth] Redirect URI: {redirect_uri}");
    println!("[OAuth] Auth URL: {auth_url}");

    let login_info = OAuthLoginInfo {
        flow_id: flow_id.clone(),
        auth_url: auth_url.clone(),
        callback_port,
        created_at,
    };

    // Create a channel for the result
    let (tx, rx) = oneshot::channel();
    let cancelled = Arc::new(AtomicBool::new(false));

    with_shared_flows(&flows, |flows| {
        cleanup_expired_shared_flows(flows);
        flows.insert(
            state.clone(),
            SharedOAuthFlow {
                flow_id,
                pkce,
                tx: Some(tx),
                cancelled: cancelled.clone(),
                created_at: Instant::now(),
            },
        );
    });

    Ok(OAuthLoginRegistration {
        info: login_info,
        rx,
        cancelled,
        state,
    })
}

pub fn cancel_oauth_state(state: &str) {
    let flows = {
        let shared = SHARED_OAUTH_SERVER.lock().unwrap();
        shared.as_ref().map(|server| server.flows.clone())
    };

    if let Some(flows) = flows {
        with_shared_flows(&flows, |flows| {
            if let Some(mut flow) = flows.remove(state) {
                flow.cancelled.store(true, Ordering::Relaxed);
                if let Some(tx) = flow.tx.take() {
                    let _ = tx.send(Err(anyhow::anyhow!("OAuth login cancelled")));
                }
            }
        });
    }
}

/// Run the OAuth callback server
async fn run_shared_oauth_server(
    server: Arc<Server>,
    flows: Arc<Mutex<HashMap<String, SharedOAuthFlow>>>,
) {
    loop {
        with_shared_flows(&flows, cleanup_expired_shared_flows);

        // Use recv_timeout to allow checking the timeout
        let request = match server.recv_timeout(Duration::from_secs(1)) {
            Ok(Some(req)) => req,
            Ok(None) => continue,
            Err(_) => continue,
        };

        handle_oauth_request(request, &flows).await;
    }
}

async fn handle_oauth_request(
    request: Request,
    flows: &Arc<Mutex<HashMap<String, SharedOAuthFlow>>>,
) {
    let url_str = request.url().to_string();
    let parsed = match url::Url::parse(&format!("http://localhost{url_str}")) {
        Ok(u) => u,
        Err(_) => {
            let _ = request.respond(Response::from_string("Bad Request").with_status_code(400));
            return;
        }
    };

    let path = parsed.path();

    if path == "/auth/callback" {
        println!("[OAuth] Received callback request");
        let params: std::collections::HashMap<String, String> =
            parsed.query_pairs().into_owned().collect();

        println!(
            "[OAuth] Callback params: {:?}",
            params.keys().collect::<Vec<_>>()
        );

        let state = match params.get("state") {
            Some(state) => state.clone(),
            None => {
                println!("[OAuth] Missing state");
                let _ =
                    request.respond(Response::from_string("Missing state").with_status_code(400));
                return;
            }
        };

        // Check for error response
        if let Some(error) = params.get("error") {
            let error_desc = params
                .get("error_description")
                .map(|s| s.as_str())
                .unwrap_or("Unknown error");
            let message = format!("OAuth error: {error} - {error_desc}");
            println!("[OAuth] Error from provider: {error} - {error_desc}");
            let _ = request.respond(
                Response::from_string(format!("OAuth Error: {error} - {error_desc}"))
                    .with_status_code(400),
            );
            if let Some(mut flow) = with_shared_flows(flows, |flows| flows.remove(&state)) {
                if let Some(tx) = flow.tx.take() {
                    let _ = tx.send(Err(anyhow::anyhow!(message)));
                }
            }
            return;
        }

        // Get the authorization code
        let code = match params.get("code") {
            Some(c) if !c.is_empty() => c.clone(),
            _ => {
                println!("[OAuth] Missing authorization code");
                let _ = request.respond(
                    Response::from_string("Missing authorization code").with_status_code(400),
                );
                if let Some(mut flow) = with_shared_flows(flows, |flows| flows.remove(&state)) {
                    if let Some(tx) = flow.tx.take() {
                        let _ = tx.send(Err(anyhow::anyhow!("Missing authorization code")));
                    }
                }
                return;
            }
        };

        let flow = with_shared_flows(flows, |flows| {
            cleanup_expired_shared_flows(flows);
            flows.remove(&state)
        });

        let mut flow = match flow {
            Some(flow) => flow,
            None => {
                println!("[OAuth] Unknown state");
                let _ = request
                    .respond(Response::from_string("Unknown login state").with_status_code(400));
                return;
            }
        };

        if flow.cancelled.load(Ordering::Relaxed) {
            println!("[OAuth] Login flow was cancelled");
            let _ = request.respond(Response::from_string("Login cancelled").with_status_code(400));
            if let Some(tx) = flow.tx.take() {
                let _ = tx.send(Err(anyhow::anyhow!("OAuth login cancelled")));
            }
            return;
        }

        println!("[OAuth] State verified OK for flow {}", flow.flow_id);
        println!("[OAuth] Got authorization code, exchanging for tokens...");

        // Exchange code for tokens
        let redirect_uri = format!("http://localhost:{}/auth/callback", oauth_callback_port());
        match exchange_code_for_tokens(DEFAULT_ISSUER, CLIENT_ID, &redirect_uri, &flow.pkce, &code)
            .await
        {
            Ok(tokens) => {
                println!("[OAuth] Token exchange successful!");
                // Parse claims from ID token
                let claims = parse_chatgpt_id_token_claims(&tokens.id_token);

                // Create the account
                let account = StoredAccount::new_chatgpt(
                    "ChatGPT Account".to_string(),
                    claims.email,
                    claims.plan_type,
                    claims.subscription_expires_at,
                    tokens.id_token,
                    tokens.access_token,
                    tokens.refresh_token,
                    claims.account_id,
                );

                // Send success response
                let success_html = r#"<!DOCTYPE html>
<html>
<head>
    <title>Login Successful</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .container { text-align: center; background: white; padding: 40px 60px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        h1 { color: #333; margin-bottom: 10px; }
        p { color: #666; }
        .checkmark { font-size: 48px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">✓</div>
        <h1>Login Successful!</h1>
        <p>You can close this window and return to Codex Switcher.</p>
    </div>
</body>
</html>"#;

                let response = Response::from_string(success_html).with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                        .unwrap(),
                );
                let _ = request.respond(response);

                if let Some(tx) = flow.tx.take() {
                    let _ = tx.send(Ok(OAuthLoginResult { account }));
                }
                return;
            }
            Err(e) => {
                println!("[OAuth] Token exchange failed: {e}");
                let _ = request.respond(
                    Response::from_string(format!("Token exchange failed: {e}"))
                        .with_status_code(500),
                );
                if let Some(tx) = flow.tx.take() {
                    let _ = tx.send(Err(e));
                }
                return;
            }
        }
    }

    // Handle other paths
    let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
}

/// Wait for the OAuth login to complete
pub async fn wait_for_oauth_login(
    rx: oneshot::Receiver<Result<OAuthLoginResult>>,
) -> Result<StoredAccount> {
    let result = rx.await.context("OAuth login was cancelled")??;
    Ok(result.account)
}
