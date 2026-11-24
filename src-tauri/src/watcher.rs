//! A bounded wake channel coalesces filesystem bursts into native library scans.
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
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

#[derive(Default)]
struct Changes {
    full: bool,
    paths: HashSet<PathBuf>,
}

impl Changes {
    fn request_full(&mut self) {
        self.full = true;
        self.paths.clear();
    }

    fn add(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        if self.full {
            return;
        }
        for path in paths {
            self.paths.insert(path);
            if self.paths.len() > 1024 {
                self.request_full();
                break;
            }
        }
    }
}

impl FolderWatcher {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (wake, events) = mpsc::sync_channel(1);
        let signal = wake.clone();
        let changes = Arc::new(Mutex::new(Changes {
            full: true,
            paths: HashSet::new(),
        }));
        let queued = changes.clone();
        let watcher = RecommendedWatcher::new(
            move |event: notify::Result<notify::Event>| {
                match event {
                    Ok(event) if event.need_rescan() || event.paths.is_empty() => {
                        queued.lock().request_full()
                    }
                    Ok(event) if event.kind.is_access() => return,
                    // Deleted paths may have been directories. Keep event paths
                    // intact and resolve their scope on the scan worker.
                    Ok(event) => queued.lock().add(event.paths),
                    Err(_) => queued.lock().request_full(),
                }
                let _ = signal.try_send(());
            },
            Config::default(),
        )
        .map_err(|e| format!("Cannot initialize folder watching: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let _ = wake.try_send(());
        std::thread::Builder::new().name("rawh-library-watch".into()).spawn(move || {
            let mut watcher = watcher;
            let mut active = HashSet::<String>::new();
            let mut failed = HashSet::<String>::new();
            let mut last_sync = Instant::now() - Duration::from_secs(5);
            while !stopped.load(Ordering::Acquire) {
                let _ = events.recv_timeout(Duration::from_secs(2));
                if stopped.load(Ordering::Acquire) { break; }
                let library = app.state::<crate::library::NativeLibrary>();
                if last_sync.elapsed() >= Duration::from_secs(2) {
                    last_sync = Instant::now();
                    let desired = match library.watched_folders() {
                        Ok(folders) => folders.into_iter().collect::<HashSet<_>>(),
                        Err(error) => { let _ = app.emit("library_error", error); continue; }
                    };
                    for path in active.clone() {
                        if !desired.contains(&path) || !Path::new(&path).is_dir() {
                            let _ = watcher.unwatch(Path::new(&path));
                            active.remove(&path);
                            changes.lock().request_full();
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
                                changes.lock().request_full();
                            }
                            Err(_) => {
                                if failed.insert(path.clone()) {
                                    let _ = app.emit("library_error", "A watched folder is unavailable. It will be retried automatically.");
                                    changes.lock().request_full();
                                }
                            }
                        }
                    }
                    active = desired.into_iter().filter(|path| !failed.contains(path)).collect();
                }
                {
                    let queued = changes.lock();
                    if !queued.full && queued.paths.is_empty() { continue; }
                }
                // Quiet-period debounce with a maximum delay under continuous writes.
                let burst = Instant::now();
                while burst.elapsed() < Duration::from_secs(2) {
                    if events.recv_timeout(Duration::from_millis(300)).is_err() { break; }
                }
                if stopped.load(Ordering::Acquire) { break; }
                let batch = std::mem::take(&mut *changes.lock());
                let progress = |progress| { let _ = app.emit("library_scan_progress", progress); };
                let result = if batch.full {
                    library.reconcile_watched(progress)
                } else {
                    library.reconcile_paths(&batch.paths, progress)
                };
                match result {
                    Ok(_) => { crate::library::catalog::notify(&app); }
                    Err(error) => {
                        // A picker/manual scan may already hold the scan lock. Retry
                        // once the worker wakes, without losing the filesystem change.
                        let mut queued = changes.lock();
                        if batch.full { queued.request_full(); } else { queued.add(batch.paths); }
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
#[specta::specta]
pub fn start_watching(path: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .add_watched_folder(&path)?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn stop_watching(app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .clear_watched_folders()?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_watched_folder(path: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .remove_watched_folder(&path)?;
    app_handle.state::<FolderWatcher>().refresh();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_watched_folders(app_handle: AppHandle) -> Result<Vec<String>, String> {
    app_handle
        .state::<crate::library::NativeLibrary>()
        .watched_folders()
}

#[tauri::command]
#[specta::specta]
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
