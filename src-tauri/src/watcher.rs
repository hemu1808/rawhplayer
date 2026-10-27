use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub struct FolderWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_folders: HashSet<String>,
    app_handle: Option<AppHandle>,
}

pub struct FolderWatcher {
    pub state: Arc<Mutex<FolderWatcherState>>,
}

impl FolderWatcher {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(FolderWatcherState {
                watcher: None,
                watched_folders: HashSet::new(),
                app_handle: None,
            })),
        }
    }
}

pub fn start_folder_watch(path: String, app_handle: AppHandle) -> Result<(), String> {
    let watcher_state = app_handle.state::<FolderWatcher>();
    let mut state = watcher_state.state.lock();

    state.app_handle = Some(app_handle.clone());
    
    if state.watcher.is_none() {
        let app_handle_clone = app_handle.clone();
        let (tx, rx) = std::sync::mpsc::channel();

        let watcher = notify::RecommendedWatcher::new(
            tx,
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        state.watcher = Some(watcher);

        thread::spawn(move || {
            for res in rx {
                match res {
                    Ok(event) => {
                        if event.kind.is_create() || event.kind.is_modify() {
                            for path in event.paths {
                                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                                    let ext_lower = ext.to_lowercase();
                                    if ["mp3", "flac", "wav", "ogg", "aac", "m4a", "aiff"].contains(&ext_lower.as_str()) {
                                        let _ = app_handle_clone.emit("new_file_detected", path.to_string_lossy().to_string());
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => log::error!("watch error: {:?}", e),
                }
            }
        });
    }

    if let Some(watcher) = &mut state.watcher {
        watcher
            .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch path: {}", e))?;
        state.watched_folders.insert(path);
    }

    Ok(())
}

pub fn stop_folder_watch(app_handle: AppHandle) -> Result<(), String> {
    let watcher_state = app_handle.state::<FolderWatcher>();
    let mut state = watcher_state.state.lock();

    if let Some(mut watcher) = state.watcher.take() {
        for folder in &state.watched_folders {
            let _ = watcher.unwatch(std::path::Path::new(folder));
        }
    }
    state.watched_folders.clear();
    Ok(())
}

#[tauri::command]
pub fn start_watching(path: String, app_handle: AppHandle) -> Result<(), String> {
    start_folder_watch(path, app_handle)
}

#[tauri::command]
pub fn stop_watching(app_handle: AppHandle) -> Result<(), String> {
    stop_folder_watch(app_handle)
}

#[tauri::command]
pub fn get_watched_folders(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let watcher_state = app_handle.state::<FolderWatcher>();
    let state = watcher_state.state.lock();
    Ok(state.watched_folders.iter().cloned().collect())
}
