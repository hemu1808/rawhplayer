//! Credentials never cross back into the webview or diagnostic exports.
use serde::Serialize;
use tauri::Manager;
#[derive(Serialize)]
pub struct UpdateStatus {
    pub enabled: bool,
    managed: bool,
}

#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> UpdateStatus {
    let managed = std::env::var("RAWH_DISABLE_UPDATES").is_ok_and(|value| value == "1")
        || !app.state::<crate::policy::Policy>().allow_updates;
    let configured = app.config().plugins.0.get("updater").is_some_and(|config| {
        config
            .get("pubkey")
            .and_then(|key| key.as_str())
            .is_some_and(|key| !key.is_empty())
            && config
                .get("endpoints")
                .and_then(|endpoints| endpoints.as_array())
                .is_some_and(|endpoints| !endpoints.is_empty())
    });
    UpdateStatus {
        enabled: configured && !managed,
        managed,
    }
}

#[derive(Serialize)]
pub struct CredentialStatus {
    gemini: bool,
    youtube: bool,
}
fn entry(service: &str) -> Result<keyring::Entry, String> {
    if !["gemini", "youtube"].contains(&service) {
        return Err("Unknown integration".into());
    }
    keyring::Entry::new("com.rawhplayer.app", service)
        .map_err(|_| "Credential storage is unavailable".into())
}
pub fn read_credential(service: &str) -> Result<String, String> {
    entry(service)?
        .get_password()
        .map_err(|_| "Configure this integration in Settings first".into())
}
#[tauri::command]
pub fn credential_status() -> CredentialStatus {
    CredentialStatus {
        gemini: read_credential("gemini").is_ok(),
        youtube: read_credential("youtube").is_ok(),
    }
}
#[tauri::command]
pub fn credential_set(service: String, key: String) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("Enter a valid API key".into());
    }
    entry(&service)?
        .set_password(key.trim())
        .map_err(|_| "Could not save the credential".into())
}
#[tauri::command]
pub fn credential_delete(service: String) -> Result<(), String> {
    match entry(&service)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not delete credential".into()),
    }
}
#[tauri::command]
pub fn diagnostics_export(app: tauri::AppHandle) -> String {
    let audio = app
        .state::<Option<crate::audio_engine::AudioEngine>>()
        .as_ref()
        .and_then(|engine| engine.get_audio_info().ok());
    let audio = audio.map(|info| serde_json::json!({"ready":info.ready,"outputSampleRate":info.output_sample_rate,"outputChannels":info.output_channels,"outputFormat":info.output_format,"underruns":info.underrun_count,"clipping":info.clipping_count,"normalization":info.normalization}));
    serde_json::json!({"app":"RawhPlayer","version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"audio":audio,"policy":app.state::<crate::policy::Policy>().inner(),"containsPaths":false,"containsCredentials":false}).to_string()
}
