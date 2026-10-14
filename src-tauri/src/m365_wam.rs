//! Official MSAL/WAM helper. Tokens travel only through anonymous native pipes.
use crate::{hidden_command, m365::LOGIN_SCOPES};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use zeroize::Zeroize;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct BrokerAccount {
    pub home_account_id: String,
    pub client_id: String,
    pub tenant_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerResponse {
    pub status: String,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub home_account_id: Option<String>,
    #[serde(default)]
    pub expires_in: u64,
    #[serde(default)]
    pub error_code: Option<String>,
}

impl Drop for BrokerResponse {
    fn drop(&mut self) {
        if let Some(token) = &mut self.access_token {
            token.zeroize();
        }
    }
}

pub(crate) fn validate_response(response: &BrokerResponse, pinned_id: Option<&str>) -> bool {
    response.status == "connected"
        && response
            .access_token
            .as_ref()
            .is_some_and(|token| !token.is_empty())
        && response
            .home_account_id
            .as_ref()
            .is_some_and(|id| !id.is_empty() && pinned_id.is_none_or(|pinned| pinned == id))
        && response.expires_in > 60
}

pub(crate) async fn acquire(
    app: &AppHandle,
    client_id: &str,
    tenant_id: &str,
    pinned_id: Option<&str>,
    login_hint: Option<&str>,
    allow_interactive: bool,
) -> Result<BrokerResponse, String> {
    #[cfg(not(windows))]
    {
        let _ = (
            app,
            client_id,
            tenant_id,
            pinned_id,
            login_hint,
            allow_interactive,
        );
        return Err("platform_unavailable".into());
    }
    #[cfg(windows)]
    {
        let relative = PathBuf::from("m365-wam").join("dmh-m365-wam.exe");
        let mut candidates = Vec::new();
        if let Ok(resources) = app.path().resource_dir() {
            candidates.push(resources.join("resources").join(&relative));
            candidates.push(resources.join(&relative));
        }
        #[cfg(debug_assertions)]
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(&relative),
        );
        let helper = candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or("helper_unavailable")?;
        let hwnd = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|handle| handle.0 as usize as i64)
            .unwrap_or(0);
        let request = serde_json::json!({
            "clientId": client_id, "tenantId": tenant_id,
            "scopes": LOGIN_SCOPES.split_whitespace().filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access")).collect::<Vec<_>>(),
            "homeAccountId": pinned_id, "windowHandle": hwnd,
            "loginHint": login_hint, "allowInteractive": allow_interactive,
        });
        run_helper(&helper, &request).await
    }
}

async fn run_helper(
    helper: &std::path::Path,
    request: &serde_json::Value,
) -> Result<BrokerResponse, String> {
    let mut command = hidden_command(helper.to_str().ok_or("helper_path")?);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "helper_unavailable")?;
    let mut input = child.stdin.take().ok_or("helper_pipe")?;
    input
        .write_all(format!("{request}\n").as_bytes())
        .await
        .map_err(|_| "helper_pipe")?;
    drop(input);
    // Kill the helper if the broker ignores its own cancellation deadline.
    let timeout_seconds = if request["allowInteractive"].as_bool() == Some(true) {
        250
    } else {
        55
    };
    let mut output = tokio::time::timeout(
        Duration::from_secs(timeout_seconds),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "broker_timeout")?
    .map_err(|_| "helper_response")?;
    // Never include process stdout/stderr in errors or diagnostics.
    let parsed = if output.status.success() && output.stdout.len() <= 256 * 1024 {
        serde_json::from_slice::<BrokerResponse>(&output.stdout)
            .map_err(|_| "helper_response".to_string())
    } else {
        Err("helper_response".into())
    };
    output.stdout.zeroize();
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renewal_cannot_switch_accounts_or_accept_expired_tokens() {
        let mut response: BrokerResponse = serde_json::from_value(serde_json::json!({
            "status":"connected", "accessToken":"test-token", "homeAccountId":"one", "expiresIn":100,
        })).unwrap();
        assert!(validate_response(&response, Some("one")));
        assert!(!validate_response(&response, Some("two")));
        response.expires_in = 0;
        assert!(!validate_response(&response, None));
        response.expires_in = 100;
        response.status = "interaction_required".into();
        assert!(!validate_response(&response, None));
    }

    #[test]
    #[ignore = "explicit read-only check against the signed-in Windows account"]
    #[cfg(windows)]
    fn live_windows_login_and_renewal_use_private_pipes() {
        let client =
            std::env::var("M365_WAM_TEST_CLIENT_ID").expect("Set the public test client ID");
        let tenant =
            std::env::var("M365_WAM_TEST_TENANT_ID").expect("Set the public test tenant ID");
        let helper =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/m365-wam/dmh-m365-wam.exe");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let hwnd = unsafe { windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow() }.0 as usize as i64;
            let mut request = serde_json::json!({
                "clientId":client, "tenantId":tenant,
                "scopes":LOGIN_SCOPES.split_whitespace().filter(|scope| !matches!(*scope, "openid" | "profile" | "offline_access")).collect::<Vec<_>>(),
                "homeAccountId":null, "windowHandle":hwnd,
                "loginHint":std::env::var("M365_WAM_TEST_LOGIN_HINT").ok(), "allowInteractive":false,
            });
            let first = run_helper(&helper, &request).await.expect("Private-pipe login failed");
            assert!(validate_response(&first, None), "Silent login status: {} ({})", first.status, first.error_code.as_deref().unwrap_or("none"));
            let profile = crate::m365::http_client().get("https://graph.microsoft.com/v1.0/me?$select=id")
                .bearer_auth(first.access_token.as_deref().unwrap()).timeout(Duration::from_secs(20))
                .send().await.unwrap();
            assert!(profile.status().is_success(), "Graph profile verification failed");
            request["homeAccountId"] = serde_json::json!(first.home_account_id);
            let renewed = run_helper(&helper, &request).await.expect("Private-pipe renewal failed");
            assert!(validate_response(&renewed, first.home_account_id.as_deref()), "Pinned renewal status: {} ({})", renewed.status, renewed.error_code.as_deref().unwrap_or("none"));
            // No account IDs, access tokens, mail or calendar data are printed.
            println!("Silent Windows login, Graph identity check and pinned-account renewal passed; no app data changed.");
        });
    }
}
