fn main() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Contract reflection keeps dialog entry points reachable in the test binary too.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    println!("cargo:rerun-if-changed=../shared/library-contract.json");
    let contract: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("../shared/library-contract.json")
            .expect("read shared library contract"),
    )
    .expect("valid shared library contract");
    let mut generated = String::new();
    for (key, name) in [
        ("maxTracks", "MAX_TRACKS"),
        ("maxQueueEntries", "MAX_QUEUE_ENTRIES"),
        ("maxPlaylistTracks", "MAX_PLAYLIST_TRACKS"),
        ("maxPlaylists", "MAX_PLAYLISTS"),
        ("maxWatchedFolders", "MAX_WATCHED_FOLDERS"),
        ("maxBackupBytes", "MAX_BACKUP_BYTES"),
    ] {
        let value = contract[key]
            .as_u64()
            .filter(|value| *value > 0)
            .expect("positive contract limit");
        generated.push_str(&format!("pub const {name}: usize = {value};\n"));
    }
    let extensions = contract["audioExtensions"]
        .as_array()
        .expect("audio extensions array");
    assert!(!extensions.is_empty(), "at least one audio extension");
    for extension in extensions {
        assert!(
            extension.as_str().is_some_and(|value| !value.is_empty()
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())),
            "valid audio extension"
        );
    }
    generated.push_str(&format!(
        "pub const AUDIO_EXTENSIONS: &[&str] = &{};\n",
        contract["audioExtensions"]
    ));
    std::fs::write(
        std::path::Path::new(&std::env::var_os("OUT_DIR").expect("Cargo OUT_DIR"))
            .join("library_contract.rs"),
        generated,
    )
    .expect("write Rust library contract");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Tauri already embeds the main executable's application manifest.
        // The generic flags above are needed by the reflected-command unit-test executable.
        println!("cargo:rustc-link-arg-bin=rawhplayer=/MANIFEST:NO");
    }
}
