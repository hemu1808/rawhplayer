use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Policy {
    pub allow_updates: bool,
    pub allow_external_services: bool,
    pub allow_metadata_edits: bool,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            allow_updates: true,
            allow_external_services: true,
            allow_metadata_edits: true,
        }
    }
}
impl Policy {
    pub fn load() -> Result<Self, String> {
        #[cfg(windows)]
        let path = std::path::PathBuf::from(
            std::env::var_os("ProgramData").ok_or("ProgramData is unavailable")?,
        )
        .join("RawhPlayer/policy.json");
        #[cfg(target_os = "macos")]
        let path = std::path::PathBuf::from("/Library/Application Support/RawhPlayer/policy.json");
        #[cfg(not(any(windows, target_os = "macos")))]
        let path = std::path::PathBuf::from("/etc/rawhplayer/policy.json");
        match std::fs::read(path) {
            Ok(bytes) if bytes.len() <= 16_384 => {
                serde_json::from_slice(&bytes).map_err(|_| "Invalid administrator policy".into())
            }
            Ok(_) => Err("Administrator policy exceeds 16 KiB".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("Administrator policy cannot be read".into()),
        }
    }
    pub fn external_services(&self) -> Result<(), String> {
        if self.allow_external_services {
            Ok(())
        } else {
            Err("External services are disabled by administrator policy".into())
        }
    }
    pub fn metadata_edits(&self) -> Result<(), String> {
        if self.allow_metadata_edits {
            Ok(())
        } else {
            Err("File metadata edits are disabled by administrator policy".into())
        }
    }
}
#[tauri::command]
pub fn deployment_policy(policy: tauri::State<'_, Policy>) -> Policy {
    policy.inner().clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restrictions_are_explicit_and_unknown_fields_are_rejected() {
        let policy: Policy = serde_json::from_str(
            r#"{"allowUpdates":false,"allowExternalServices":false,"allowMetadataEdits":false}"#,
        )
        .unwrap();
        assert!(!policy.allow_updates);
        assert!(policy.external_services().is_err());
        assert!(policy.metadata_edits().is_err());
        assert!(serde_json::from_str::<Policy>(r#"{"allowUpdate":false}"#).is_err());
    }
}
