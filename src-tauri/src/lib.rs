mod audio_engine;
mod watcher;
mod spatial_audio;
mod ai_dj;
mod vst_host;
mod room_correction;

use audio_engine::{AudioEngine, AudioDeviceInfo, AudioInfo};
use tauri::{Manager, State, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState, Code};

#[tauri::command]
fn play_file(path: String, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.play_file(path)
}

#[tauri::command]
fn toggle_play(engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.toggle_play()
}

#[tauri::command]
fn seek_audio(position: f64, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.seek(position)
}

#[tauri::command]
fn set_volume(volume: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.set_volume(volume)
}

#[tauri::command]
fn set_equalizer_band(index: usize, gain: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.set_equalizer_band(index, gain)
}

#[tauri::command]
fn set_purist_mode(is_purist: bool, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.set_purist_mode(is_purist)
}

#[tauri::command]
fn set_playback_rate(rate: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.set_playback_rate(rate)
}

#[tauri::command]
fn list_audio_devices(engine: State<'_, Option<AudioEngine>>) -> Result<Vec<AudioDeviceInfo>, String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.list_audio_devices()
}

#[tauri::command]
fn set_crossfade_duration(seconds: f32, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.set_crossfade_duration(seconds)
}

#[tauri::command]
fn queue_next_file(path: String, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.queue_next_file(path)
}

#[tauri::command]
fn get_audio_info(engine: State<'_, Option<AudioEngine>>) -> Result<AudioInfo, String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.get_audio_info()
}

#[tauri::command]
fn read_metadata(path: String, engine: State<'_, Option<AudioEngine>>) -> Result<audio_engine::TrackMetadata, String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.read_metadata(path)
}

#[tauri::command]
fn write_metadata(path: String, metadata: audio_engine::TrackMetadata, engine: State<'_, Option<AudioEngine>>) -> Result<(), String> {
    engine.as_ref().ok_or_else(|| "Audio Engine is not available".to_string())?.write_metadata(path, metadata)
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
async fn get_track_insight(artist: String, title: String, client: State<'_, reqwest::Client>) -> Result<String, String> {
    let api_key = std::env::var("GEMINI_API_KEY")
        .or_else(|_| std::env::var("VITE_GEMINI_API_KEY"))
        .map_err(|_| "Gemini API key is not configured. Please set the GEMINI_API_KEY environment variable on the host.".to_string())?;

    let prompt = format!(
        "Provide a short, engaging 2-sentence \"Vibe Check\" description for the song \"{}\" by \"{}\". Focus on the musical style, mood, and cultural impact. Do not use markdown formatting.",
        title, artist
    );

    let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    
    let response = client.post(url)
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

    let res_json: GeminiResponse = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let text = res_json.candidates.first()
        .and_then(|c| c.content.parts.first())
        .map(|p| &p.text)
        .ok_or_else(|| "Invalid response format from Gemini".to_string())?;

    Ok(text.trim().to_string())
}

#[tauri::command]
async fn search_youtube(query: String, client: State<'_, reqwest::Client>) -> Result<serde_json::Value, String> {
    let api_key = std::env::var("YOUTUBE_API_KEY")
        .or_else(|_| std::env::var("VITE_YOUTUBE_API_KEY"))
        .map_err(|_| "YouTube API key is not configured. Please set the YOUTUBE_API_KEY environment variable on the host.".to_string())?;

    let response = client.get("https://www.googleapis.com/youtube/v3/search")
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

    let res_json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse YouTube response: {}", e))?;

    Ok(res_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            if shortcut.id() == "MediaPlayPause".parse::<Shortcut>().unwrap().id() {
                let _ = app.emit("media_play_pause", ());
            } else if shortcut.id() == "MediaTrackNext".parse::<Shortcut>().unwrap().id() {
                let _ = app.emit("media_next", ());
            } else if shortcut.id() == "MediaTrackPrevious".parse::<Shortcut>().unwrap().id() {
                let _ = app.emit("media_prev", ());
            }
        }
    }).build())
    .setup(|app| {
      let handle = app.handle().clone();
      
      let engine_opt = match AudioEngine::new(handle.clone()) {
          Ok(engine) => Some(engine),
          Err(e) => {
              log::error!("Failed to initialize AudioEngine: {}", e);
              None
          }
      };
      app.manage(engine_opt);
      
      let watcher = watcher::FolderWatcher::new();
      app.manage(watcher);
      
      let client = reqwest::Client::new();
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
        play_file, toggle_play, seek_audio, set_volume, get_track_insight, search_youtube, set_equalizer_band, set_purist_mode,
        set_playback_rate, list_audio_devices, set_crossfade_duration, queue_next_file, get_audio_info,
        read_metadata, write_metadata,
        watcher::start_watching, watcher::stop_watching, watcher::get_watched_folders
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
