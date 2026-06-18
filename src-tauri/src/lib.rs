mod audio_engine;

use audio_engine::AudioEngine;
use tauri::{Manager, State};

#[tauri::command]
fn play_file(path: String, engine: State<'_, AudioEngine>) -> Result<(), String> {
    engine.play_file(path)
}

#[tauri::command]
fn toggle_play(engine: State<'_, AudioEngine>) -> Result<(), String> {
    engine.toggle_play()
}

#[tauri::command]
fn seek_audio(position: f64, engine: State<'_, AudioEngine>) -> Result<(), String> {
    engine.seek(position)
}

#[tauri::command]
fn set_volume(volume: f32, engine: State<'_, AudioEngine>) -> Result<(), String> {
    engine.set_volume(volume)
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
async fn get_track_insight(artist: String, title: String) -> Result<String, String> {
    let api_key = std::env::var("GEMINI_API_KEY")
        .or_else(|_| std::env::var("VITE_GEMINI_API_KEY"))
        .map_err(|_| "Gemini API key is not configured. Please set the GEMINI_API_KEY environment variable on the host.".to_string())?;

    let client = reqwest::Client::new();
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
async fn search_youtube(query: String) -> Result<serde_json::Value, String> {
    let api_key = std::env::var("YOUTUBE_API_KEY")
        .or_else(|_| std::env::var("VITE_YOUTUBE_API_KEY"))
        .map_err(|_| "YouTube API key is not configured. Please set the YOUTUBE_API_KEY environment variable on the host.".to_string())?;

    let client = reqwest::Client::new();
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
    .setup(|app| {
      let handle = app.handle().clone();
      let engine = AudioEngine::new(handle)
          .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
      app.manage(engine);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        play_file, toggle_play, seek_audio, set_volume, get_track_insight, search_youtube
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
