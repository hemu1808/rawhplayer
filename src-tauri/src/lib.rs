#[path = "engine.rs"]
mod audio_engine;
mod desktop;
mod ipc;
mod library;
mod library_contract;
mod media_session;
mod open_files;
mod policy;
mod support;
mod watcher;

use audio_engine::{AudioDeviceInfo, AudioEngine, AudioInfo};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
fn toggle_play(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .toggle_play()
}

#[tauri::command]
#[specta::specta]
fn seek_audio(position: f64, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .seek(position)
}

#[tauri::command]
#[specta::specta]
fn set_volume(volume: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_volume(volume)
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
fn set_purist_mode(is_purist: bool, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_purist_mode(is_purist)
}

#[tauri::command]
#[specta::specta]
fn set_playback_rate(rate: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .set_playback_rate(rate)
}

#[tauri::command]
#[specta::specta]
fn list_audio_devices(
    engine: State<'_, Option<AudioEngine>>,
) -> Result<Vec<AudioDeviceInfo>, String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .list_audio_devices()
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
fn get_audio_info(engine: State<'_, Option<AudioEngine>>) -> Result<AudioInfo, String> {
    engine
        .as_ref()
        .ok_or_else(|| "Audio Engine is not available".to_string())?
        .get_audio_info()
}

#[tauri::command]
#[specta::specta]
fn stop_audio(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or("Audio engine unavailable")?.stop()
}

#[tauri::command]
#[specta::specta]
fn clear_pending(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .clear_pending()
}

#[tauri::command]
#[specta::specta]
fn set_paused(paused: bool, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine
        .as_ref()
        .ok_or("Audio engine unavailable")?
        .set_paused(paused)
}
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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
                .add_filter("Audio", library_contract::AUDIO_EXTENSIONS)
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

#[derive(serde::Deserialize, specta::Type)]
struct GeminiPart {
    text: String,
}

#[derive(serde::Deserialize, specta::Type)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(serde::Deserialize, specta::Type)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(serde::Deserialize, specta::Type)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
    let contracts = ipc::builder();
    let handler = contracts.invoke_handler();
    tauri::Builder::default()
        .invoke_handler(handler)
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
                            library::catalog::notify(&app);
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
        .setup(move |app| {
            contracts.mount_events(app);
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
            app.manage(library::analysis::AnalysisWorker::default());

            let has_media_session = match media_session::install(&handle) {
                Ok(()) => true,
                Err(error) => {
                    log::warn!("OS media session unavailable: {error}");
                    false
                }
            };

            let watcher =
                watcher::FolderWatcher::new(handle.clone()).map_err(std::io::Error::other)?;
            app.manage(watcher);

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()?;
            app.manage(client);

            if !has_media_session {
                if let Ok(play_pause) = "MediaPlayPause".parse::<Shortcut>() {
                    let _ = app.handle().global_shortcut().register(play_pause);
                }
                if let Ok(next_track) = "MediaTrackNext".parse::<Shortcut>() {
                    let _ = app.handle().global_shortcut().register(next_track);
                }
                if let Ok(prev_track) = "MediaTrackPrevious".parse::<Shortcut>() {
                    let _ = app.handle().global_shortcut().register(prev_track);
                }
            }

            Ok(())
        })
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
