mod audio_engine;

use audio_engine::AudioEngine;
use tauri::{AppHandle, Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::new().build())
    .setup(|app| {
      let handle = app.handle().clone();
      let engine = AudioEngine::new(handle);
      app.manage(engine);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        play_file, toggle_play, seek_audio, set_volume
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
