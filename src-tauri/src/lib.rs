#[path = "engine.rs"]
mod audio_engine;
mod desktop;
mod library;
mod open_files;
mod policy;
mod support;
mod watcher;

use audio_engine::{AudioDeviceInfo, AudioEngine, AudioInfo};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn play_file(
    path: String,
    queue_id: String,
    library: State<'_, library::NativeLibrary>,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    library.authorize_path(&path)?;
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .play_file_with_id(path, queue_id)
}

#[tauri::command]
fn toggle_play(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .toggle_play()
}

#[tauri::command]
fn seek_audio(position: f64, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .seek(position)
}

#[tauri::command]
fn set_volume(volume: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_volume(volume)
}

#[tauri::command]
fn set_equalizer_band(
    index: usize,
    gain: f32,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_equalizer_band(index, gain)
}

#[tauri::command]
fn set_purist_mode(is_purist: bool, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_purist_mode(is_purist)
}

#[tauri::command]
fn set_playback_rate(rate: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_playback_rate(rate)
}

#[tauri::command]
fn list_audio_devices(
    engine: State<'_, Option<AudioEngine>>,
) -> Result<Vec<AudioDeviceInfo>, String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .list_audio_devices()
}

#[tauri::command]
fn set_crossfade_duration(
    seconds: f32,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_crossfade_duration(seconds)
}

#[tauri::command]
fn queue_next_file(
    path: String,
    queue_id: String,
    library: State<'_, library::NativeLibrary>,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    library.authorize_path(&path)?;
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .queue_next_file_with_id(path, queue_id)
}

#[tauri::command]
fn get_audio_info(engine: State<'_, Option<AudioEngine>>) -> Result<AudioInfo, String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .get_audio_info()
}

#[tauri::command]
fn stop_audio(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or("Audio engine unavailable")?.stop()
}

#[tauri::command]
fn clear_pending(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .clear_pending()
}

#[tauri::command]
fn set_paused(paused: bool, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .set_paused(paused)
}
#[tauri::command]
fn set_output_device(
    device_id: Option<String>,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .set_output_device(device_id)
}
#[tauri::command]
fn set_normalization(
    mode: String,
    preamp_db: f32,
    engine: State<'_, Option<AudioEngine>>,
) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .set_normalization(mode, preamp_db)
}

#[tauri::command]
async fn pick_music(
    app: tauri::AppHandle,
    folder: bool,
) -> Result<Vec<library::LibraryTrack>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file();
        let selected = if folder {
            picker.blocking_pick_folder().map(|p| vec![p])
        } else {
            picker
                .add_filter(
                    "Audio",
                    &["mp3", "flac", "wav", "ogg", "aac", "m4a", "aiff"],
                )
                .blocking_pick_files()
        };
        let paths: Vec<String> = selected
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let library = app.state::<library::NativeLibrary>();
        library.authorize_paths(&paths)?;
        library.import_paths(paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
struct GeminiPart {
    text: String,
}

#[derive(serde::Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(serde::Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(serde::Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[tauri::command]
async fn get_track_insight(
    artist: String,
    title: String,
    client: State<'_, reqwest::Client>,
    policy: State<'_, policy::Policy>,
) -> Result<String, String> {
    policy.external_services()?;
    let api_key = support::read_credential("gemini")?;

    let prompt = format!(
        "Provide a short, engaging 2-sentence \"Vibe Check\" description for the song \"{}\" by \"{}\". Focus on the musical style, mood, and cultural impact. Do not use markdown formatting.",
        title, artist
    );

    let url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    let response = client
        .post(url)
        .header("x-goog-api-key", &api_key)
        .json(&serde_json::json!({
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }]
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Gemini: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API returned error: {}", err_text));
    }

    let res_json: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let text = res_json
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .map(|p| &p.text)
        .ok_or_else(|| "Invalid response format from Gemini".to_string())?;

    Ok(text.trim().to_string())
}

#[tauri::command]
async fn search_youtube(
    query: String,
    client: State<'_, reqwest::Client>,
    policy: State<'_, policy::Policy>,
) -> Result<serde_json::Value, String> {
    policy.external_services()?;
    let api_key = support::read_credential("youtube")?;

    let response = client
        .get("https://www.googleapis.com/youtube/v3/search")
        .query(&[
            ("part", "snippet"),
            ("maxResults", "10"),
            ("q", &query),
            ("type", "video"),
            ("key", &api_key),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to send request to YouTube: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("YouTube API returned error: {}", err_text));
    }

    let res_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse YouTube response: {}", e))?;

    Ok(res_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(open_files::OpenFiles::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_files::queue_arguments(app, args, std::path::Path::new(&cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let paths: Vec<String> = paths
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let library = app.state::<library::NativeLibrary>();
                    let result = library
                        .authorize_paths(&paths)
                        .and_then(|_| library.import_paths(paths));
                    match result {
                        Ok(_) => {
                            if let Ok(snapshot) = library.load() {
                                let _ = app.emit("library_changed", snapshot);
                            }
                        }
                        Err(error) => {
                            let _ = app.emit("audio_error", error);
                        }
                    }
                });
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if shortcut.id() == "MediaPlayPause".parse::<Shortcut>().unwrap().id() {
                            let _ = app.emit("media_play_pause", ());
                        } else if shortcut.id()
                            == "MediaTrackNext".parse::<Shortcut>().unwrap().id()
                        {
                            let _ = app.emit("media_next", ());
                        } else if shortcut.id()
                            == "MediaTrackPrevious".parse::<Shortcut>().unwrap().id()
                        {
                            let _ = app.emit("media_prev", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(policy::Policy::load().map_err(std::io::Error::other)?);
            app.manage(desktop::DesktopState::default());
            desktop::restore_normal_window(&handle)?;
            if let Err(error) = desktop::install_tray(&handle) {
                log::warn!("Tray controls unavailable: {error}");
            }
            if support::update_status(handle.clone()).enabled {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(
                library::NativeLibrary::open(app.path().app_data_dir()?)
                    .map_err(std::io::Error::other)?,
            );
            open_files::queue_arguments(
                &handle,
                std::env::args().collect(),
                &std::env::current_dir()?,
            );

            let engine_opt = match AudioEngine::new(handle.clone()) {
                Ok(engine) => Some(engine),
                Err(e) => {
                    log::error!("Failed to initialize AudioEngine: {}", e);
                    None
                }
            };
            app.manage(engine_opt);

            let watcher =
                watcher::FolderWatcher::new(handle.clone()).map_err(std::io::Error::other)?;
            app.manage(watcher);

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()?;
            app.manage(client);

            if let Ok(play_pause) = "MediaPlayPause".parse::<Shortcut>() {
                let _ = app.handle().global_shortcut().register(play_pause);
            }
            if let Ok(next_track) = "MediaTrackNext".parse::<Shortcut>() {
                let _ = app.handle().global_shortcut().register(next_track);
            }
            if let Ok(prev_track) = "MediaTrackPrevious".parse::<Shortcut>() {
                let _ = app.handle().global_shortcut().register(prev_track);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_music,
            open_files::take_open_files,
            desktop::set_compact_mode,
            policy::deployment_policy,
            library::library_load,
            library::library_migrate_legacy,
            library::library_save,
            library::library_import_paths,
            library::library_remove_track,
            library::library_locate_track,
            library::library_reconcile,
            library::library_cancel_scan,
            library::library_search,
            library::library_export,
            library::library_restore,
            library::library_waveform,
            library::library_read_lyrics,
            library::library_update_metadata,
            library::library_undo_metadata,
            play_file,
            toggle_play,
            seek_audio,
            set_volume,
            get_track_insight,
            search_youtube,
            set_equalizer_band,
            set_purist_mode,
            set_playback_rate,
            list_audio_devices,
            set_crossfade_duration,
            queue_next_file,
            get_audio_info,
            stop_audio,
            clear_pending,
            set_paused,
            set_output_device,
            set_normalization,
            support::credential_status,
            support::credential_set,
            support::credential_delete,
            support::diagnostics_export,
            support::update_status,
            watcher::start_watching,
            watcher::stop_watching,
            watcher::get_watched_folders,
            watcher::remove_watched_folder,
            watcher::pick_watched_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                open_files::queue_paths(
                    _app,
                    urls.into_iter().filter_map(|url| url.to_file_path().ok()),
                );
            }
        });
}
