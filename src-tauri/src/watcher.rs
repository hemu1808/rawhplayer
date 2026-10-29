//! A bounded wake channel coalesces filesystem bursts into native library scans.
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

pub struct FolderWatcher {
    wake: SyncSender<()>,
    stop: Arc<AtomicBool>,
}

impl FolderWatcher {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (wake, events) = mpsc::sync_channel(1);
        let signal = wake.clone();
        let dirty = Arc::new(AtomicBool::new(true));
        let changed = dirty.clone();
        let watcher = RecommendedWatcher::new(
            move |event: notify::Result<notify::Event>| {
                // Read/access events are caused by our own scan and must not retrigger it.
                if event
                    .as_ref()
                    .map(|event| {
                        !event.kind.is_access()
                            && event.paths.iter().any(|path| {
                                path.is_dir()
                                    || path.extension().is_none()
                                    || path
                                        .extension()
                                        .and_then(|ext| ext.to_str())
                                        .map(|ext| {
                                            [
                                                "mp3", "flac", "wav", "ogg", "aac", "m4a", "aiff",
                                                "aif", "opus",
                                            ]
                                            .contains(&ext.to_ascii_lowercase().as_str())
                                        })
                                        .unwrap_or(false)
                            })
                    })
                    .unwrap_or(true)
                {
                    changed.store(true, Ordering::Release);
                    let _ = signal.try_send(());
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Cannot initialize folder watching: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        std::thread::Builder::new().name("rawh-library-watch".into()).spawn(move || {
            let mut watcher = watcher;
            let mut active = HashSet::<String>::new();
            let mut failed = HashSet::<String>::new();
            let mut last_sync = Instant::now() - Duration::from_secs(5);
            while !stopped.load(Ordering::Acquire) {
                let _ = events.recv_timeout(Duration::from_secs(2));
                if stopped.load(Ordering::Acquire) { break; }
                let library = app.state::<crate::library::NativeLibrary>();
                if last_sync.elapsed() >= Duration::from_secs(2) || dirty.load(Ordering::Acquire) {
                    last_sync = Instant::now();
                    let desired = match library.watched_folders() {
                        Ok(folders) => folders.into_iter().collect::<HashSet<_>>(),
                        Err(error) => { let _ = app.emit("library_error", error); continue; }
                    };
                    for path in active.clone() {
                        if !desired.contains(&path) || !std::path::Path::new(&path).is_dir() {
                            let _ = watcher.unwatch(std::path::Path::new(&path));
                            active.remove(&path);
                            dirty.store(true, Ordering::Release);
                        }
                    }
                    failed.retain(|path| desired.contains(path));
                    for path in desired.difference(&active) {
                        let result = library.authorize_path(path).and_then(|canonical| {
                            watcher.watch(&canonical, RecursiveMode::Recursive).map_err(|e| e.to_string())
                        });
                        match result {
                            Ok(()) => {
                                failed.remove(path);
                                dirty.store(true, Ordering::Release);
                            }
                            Err(_) => {
                                if failed.insert(path.clone()) {
                                    let _ = app.emit("library_error", "A watched folder is unavailable. It will be retried automatically.");
                                    dirty.store(true, Ordering::Release);
                                }
                            }
                        }
                    }
                    active = desired.into_iter().filter(|path| !failed.contains(path)).collect();
                }
                if !dirty.swap(false, Ordering::AcqRel) { continue; }
                // Quiet-period debounce with a maximum delay under continuous writes.
                let burst = Instant::now();
                while burst.elapsed() < Duration::from_secs(2) {
                    if events.recv_timeout(Duration::from_millis(300)).is_err() { break; }
                }
                if stopped.load(Ordering::Acquire) { break; }
                // Clear before scanning: changes during the scan schedule another pass.
                dirty.store(false, Ordering::Release);
                match library.reconcile(|progress| { let _ = app.emit("library_scan_progress", progress); }) {
                    Ok(snapshot) => { let _ = app.emit("library_changed", snapshot); }
                    Err(error) => {
                        // A picker/manual scan may already hold the scan lock. Retry
                        // once the worker wakes, without losing the filesystem change.
                        dirty.store(true, Ordering::Release);
                        let _ = app.emit("library_error", error);
                    }
                }
            }
        }).map_err(|e| e.to_string())?;
        Ok(Self { wake, stop })
    }

    fn refresh(&self) {
        let _ = self.wake.try_send(());
    }
}

impl Drop for FolderWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.refresh();
    }
}

#[tauri::command]
pub fn start_watching(path: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .add_watched_folder(&path)?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
pub fn stop_watching(app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .clear_watched_folders()?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
pub fn remove_watched_folder(path: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .remove_watched_folder(&path)?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
pub fn get_watched_folders(app_handle: AppHandle) -> Result<Vec<String>, String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .watched_folders()
}

#[tauri::command]
pub async fn pick_watched_folder(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<crate::library::NativeLibrary>();
        if let Some(selected) = app.dialog().file().blocking_pick_folder() {
            let path = selected.into_path().map_err(|e| e.to_string())?;
            let path = path.to_string_lossy().into_owned();
            library.authorize_paths(std::slice::from_ref(&path))?;
            library.add_watched_folder(&path)?;
            app.state::<FolderWatcher>().refresh();
        }
        library.watched_folders()
    })
    .await
    .map_err(|e| e.to_string())?
}
