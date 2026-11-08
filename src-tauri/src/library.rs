//! Durable local library. Only paths granted by native UI may be read or edited.
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag, TagExt};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library_contract::{
    AUDIO_EXTENSIONS, MAX_BACKUP_BYTES, MAX_PLAYLISTS, MAX_PLAYLIST_TRACKS, MAX_QUEUE_ENTRIES,
    MAX_TRACKS, MAX_WATCHED_FOLDERS,
};
const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;

mod models;
pub use models::*;
pub mod analysis;
pub mod catalog;
pub mod maintenance;
pub mod mutations;

pub struct NativeLibrary {
    db: Mutex<Connection>,
    data_dir: PathBuf,
    grants: Mutex<Vec<PathBuf>>,
    scan_lock: Mutex<()>,
    cancel_scan: AtomicBool,
    edit_lock: Mutex<()>,
}

fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
fn path_key(path: &str) -> String {
    #[cfg(windows)]
    {
        let path = path.replace('/', "\\");
        let normalized = if let Some(network) = path.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{network}")
        } else {
            path.strip_prefix("\\\\?\\").unwrap_or(&path).to_owned()
        };
        normalized.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_owned()
    }
}
fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| AUDIO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
fn gain(value: Option<&str>) -> Option<f32> {
    value
        .and_then(|value| {
            value
                .trim()
                .trim_end_matches("dB")
                .trim()
                .parse::<f32>()
                .ok()
        })
        .filter(|value| value.is_finite() && (-60.0..=30.0).contains(value))
}

/// Counts distinct library identities, not reimports or path repairs.
struct ImportBudget {
    ids: HashSet<String>,
    maximum: usize,
}
impl ImportBudget {
    fn new(ids: impl IntoIterator<Item = String>, maximum: usize) -> Self {
        Self {
            ids: ids.into_iter().collect(),
            maximum,
        }
    }
    fn admit(&mut self, id: &str) -> Result<(), String> {
        if self.ids.contains(id) {
            return Ok(());
        }
        if self.ids.len() >= self.maximum {
            return Err(format!("The library supports at most {} tracks. No new files from this scan were imported.", self.maximum));
        }
        self.ids.insert(id.to_owned());
        Ok(())
    }
}

mod backup;
mod media;
mod metadata;
mod scan;
mod store;
use store::upsert;

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(bytes).map_err(error)?;
            file.sync_all().map_err(error)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(failure) => Err(error(failure)),
    }
}

fn file_fingerprint(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(error)?;
    let length = file.metadata().map_err(error)?.len();
    let mut hash = Sha256::new();
    hash.update(length.to_le_bytes());
    let mut buffer = [0_u8; 65536];
    let read = file.read(&mut buffer).map_err(error)?;
    hash.update(&buffer[..read]);
    if length > 65536 {
        file.seek(SeekFrom::End(-65536)).map_err(error)?;
        let read = file.read(&mut buffer).map_err(error)?;
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn full_hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(error)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let read = file.read(&mut buffer).map_err(error)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

mod validation;
pub use validation::validate_snapshot;

#[tauri::command]
#[specta::specta]
pub async fn library_load(app: AppHandle) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().load())
        .await
        .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_locate_track(
    app: AppHandle,
    track_id: String,
) -> Result<Option<LibraryTrack>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .add_filter("Audio", AUDIO_EXTENSIONS)
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(error)?;
        let path = path_string(&path);
        let library = app.state::<NativeLibrary>();
        library.authorize_paths(std::slice::from_ref(&path))?;
        library.relink_track(&track_id, &path).map(Some)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_migrate_legacy(
    app: AppHandle,
    backup: String,
) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().migrate_legacy(&backup)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_save(app: AppHandle, snapshot: LibrarySnapshot) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().save(snapshot))
        .await
        .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_import_paths(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<LibraryTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>()
            .import_with_progress(paths, |progress| {
                let _ = app.emit("library_scan_progress", progress);
            })
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_remove_track(
    app: AppHandle,
    track_id: String,
) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().remove_track(&track_id)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_reconcile(app: AppHandle) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().reconcile(|progress| {
            let _ = app.emit("library_scan_progress", progress);
        })
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub fn library_cancel_scan(library: State<'_, NativeLibrary>) {
    library.cancel();
}
#[tauri::command]
#[specta::specta]
pub async fn library_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<LibraryTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>()
            .search(&query, limit.unwrap_or(100))
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_export(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().export())
        .await
        .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_restore(app: AppHandle, backup: String) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().restore(&backup))
        .await
        .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_waveform(
    app: AppHandle,
    track_id: String,
    bins: Option<usize>,
) -> Result<Waveform, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>()
            .waveform(&track_id, bins.unwrap_or(256))
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_read_lyrics(
    app: AppHandle,
    track_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().read_lyrics(&track_id)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_update_metadata(
    app: AppHandle,
    track_id: String,
    edit: MetadataEdit,
) -> Result<LibraryTrack, String> {
    app.state::<crate::policy::Policy>().metadata_edits()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>()
            .update_metadata(&track_id, edit)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
#[specta::specta]
pub async fn library_undo_metadata(
    app: AppHandle,
    track_id: String,
) -> Result<LibraryTrack, String> {
    app.state::<crate::policy::Policy>().metadata_edits()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().undo_metadata(&track_id)
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod catalog_tests;
#[cfg(test)]
mod tests;
