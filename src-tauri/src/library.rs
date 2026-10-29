//! Durable local library. Only paths granted by native UI may be read or edited.
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag, TagExt};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_TRACKS: usize = 250_000;
const MAX_BACKUP_BYTES: usize = 64 * 1024 * 1024;
const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "aac", "m4a", "aiff", "aif"];

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryTrack {
    pub id: String,
    pub path: String,
    pub name: String,
    pub artist: String,
    pub album: Option<String>,
    pub format: Option<String>,
    pub artwork_path: Option<String>,
    pub duration: Option<f64>,
    pub date_added: Option<u64>,
    pub source: Option<String>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub is_liked: bool,
    pub missing: bool,
    pub play_count: u64,
    pub listening_seconds: f64,
    pub replay_gain_track: Option<f32>,
    pub replay_gain_album: Option<f32>,
    pub track_number: Option<u32>,
    pub fingerprint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub track_id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SmartRule {
    pub query: Option<String>,
    pub artist: Option<String>,
    pub genre: Option<String>,
    pub format: Option<String>,
    pub liked_only: bool,
    pub unplayed_only: bool,
    pub added_within_days: Option<u32>,
    pub min_sample_rate: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub track_ids: Vec<String>,
    pub smart_rule: Option<SmartRule>,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub current_queue_id: Option<String>,
    #[serde(default)]
    pub position: f64,
    pub playback_mode: String,
}

impl Default for PlaybackSession {
    fn default() -> Self {
        Self {
            current_queue_id: None,
            position: 0.0,
            playback_mode: "SEQUENCE".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub schema_version: u32,
    #[serde(default)]
    pub tracks: Vec<LibraryTrack>,
    #[serde(default)]
    pub queue: Vec<QueueEntry>,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
    #[serde(default)]
    pub session: PlaybackSession,
    #[serde(default)]
    pub watched_folders: Vec<String>,
}

impl Default for LibrarySnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            tracks: vec![],
            queue: vec![],
            playlists: vec![],
            session: PlaybackSession::default(),
            watched_folders: vec![],
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub processed: usize,
    pub total: usize,
    pub skipped: usize,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Waveform {
    pub peaks: Vec<f32>,
    pub duration: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEdit {
    pub name: String,
    pub artist: String,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
}

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

impl NativeLibrary {
    pub fn open(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(error)?;
        for name in ["artwork", "waveforms", "metadata-backups"] {
            fs::create_dir_all(data_dir.join(name)).map_err(error)?;
        }
        let db = Connection::open(data_dir.join("library.sqlite3")).map_err(error)?;
        db.busy_timeout(Duration::from_secs(5)).map_err(error)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )
        .map_err(error)?;
        let version: u32 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(error)?;
        if version > 1 {
            return Err("This library was created by a newer RawhPlayer. Update the application before opening it.".into());
        }
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE tracks(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
                CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
                CREATE TABLE grants(path TEXT PRIMARY KEY);
                CREATE TABLE metadata_undo(track_id TEXT PRIMARY KEY, original_path TEXT NOT NULL, backup_path TEXT NOT NULL, edited_hash TEXT, pending INTEGER NOT NULL);
                CREATE VIRTUAL TABLE tracks_fts USING fts5(id UNINDEXED, title, artist, album, genre);
                PRAGMA user_version=1; COMMIT;").map_err(error)?;
        }
        let grants = {
            let mut statement = db.prepare("SELECT path FROM grants").map_err(error)?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(error)?;
            values.filter_map(Result::ok).map(PathBuf::from).collect()
        };
        let result = Self {
            db: Mutex::new(db),
            data_dir,
            grants: Mutex::new(grants),
            scan_lock: Mutex::new(()),
            cancel_scan: AtomicBool::new(false),
            edit_lock: Mutex::new(()),
        };
        result.recover_pending_edits()?;
        Ok(result)
    }

    /// Called only from native file picker/drop handlers, never exposed as an IPC command.
    pub fn authorize_paths(&self, paths: &[String]) -> Result<(), String> {
        let canonical: Vec<PathBuf> = paths
            .iter()
            .map(|path| fs::canonicalize(path).map_err(error))
            .collect::<Result<_, _>>()?;
        let mut db = self.db.lock();
        let tx = db.transaction().map_err(error)?;
        for path in &canonical {
            tx.execute(
                "INSERT OR IGNORE INTO grants(path) VALUES (?1)",
                [path_string(path)],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)?;
        let mut grants = self.grants.lock();
        for path in canonical {
            if !grants.contains(&path) {
                grants.push(path);
            }
        }
        Ok(())
    }

    pub fn authorize_path(&self, path: &str) -> Result<PathBuf, String> {
        let path = fs::canonicalize(path).map_err(|_| {
            "The file is unavailable. Reconnect the drive or locate the file.".to_string()
        })?;
        if self
            .grants
            .lock()
            .iter()
            .any(|root| path == *root || (root.is_dir() && path.starts_with(root)))
        {
            Ok(path)
        } else {
            Err("Select this file or its folder using Import before accessing it.".into())
        }
    }

    fn load_state(&self, db: &Connection) -> Result<LibrarySnapshot, String> {
        let value = db
            .query_row("SELECT data FROM state WHERE id=1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(error)?;
        match value {
            Some(value) => serde_json::from_str(&value).map_err(|e| {
                format!("Library state could not be read: {e}. Your database has been preserved.")
            }),
            None => Ok(LibrarySnapshot::default()),
        }
    }

    pub fn load(&self) -> Result<LibrarySnapshot, String> {
        let db = self.db.lock();
        let mut snapshot = self.load_state(&db)?;
        let mut statement = db
            .prepare("SELECT data FROM tracks ORDER BY rowid")
            .map_err(error)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(error)?;
        snapshot.tracks = rows
            .map(|row| serde_json::from_str(&row.map_err(error)?).map_err(error))
            .collect::<Result<_, _>>()?;
        validate_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    pub fn save(&self, mut snapshot: LibrarySnapshot) -> Result<(), String> {
        validate_snapshot(&snapshot)?;
        let mut db = self.db.lock();
        // File metadata is native-authoritative; UI may only change user metadata.
        let mut known = HashMap::new();
        {
            let mut statement = db.prepare("SELECT id,data FROM tracks").map_err(error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(error)?;
            for row in rows {
                let (id, data) = row.map_err(error)?;
                known.insert(
                    id,
                    serde_json::from_str::<LibraryTrack>(&data).map_err(error)?,
                );
            }
        }
        for track in &mut snapshot.tracks {
            let mut original = known
                .remove(&track.id)
                .ok_or_else(|| "Import files before adding them to the library.".to_string())?;
            if original.path != track.path {
                return Err("Track paths must be changed through native import or repair.".into());
            }
            original.is_liked = track.is_liked;
            original.play_count = track.play_count;
            original.listening_seconds = track.listening_seconds;
            *track = original;
        }
        // Concurrent scans may have inserted tracks since the UI took its snapshot.
        // Deletion is an explicit command; a stale UI save must not delete new imports.
        snapshot.tracks.extend(known.into_values());
        // Watch configuration changes only through scoped native commands. A stale
        // playback/session save must not undo a newly selected or removed folder.
        snapshot.watched_folders = self.load_state(&db)?.watched_folders;
        let tx = db.transaction().map_err(error)?;
        for track in &snapshot.tracks {
            upsert(&tx, track)?;
        }
        snapshot.tracks.clear();
        tx.execute("INSERT INTO state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&snapshot).map_err(error)?]).map_err(error)?;
        tx.commit().map_err(error)
    }

    pub fn remove_track(&self, track_id: &str) -> Result<LibrarySnapshot, String> {
        let _scan = self.scan_lock.lock();
        let mut db = self.db.lock();
        let mut snapshot = self.load_state(&db)?;
        snapshot.queue.retain(|entry| entry.track_id != track_id);
        for playlist in &mut snapshot.playlists {
            playlist.track_ids.retain(|id| id != track_id);
        }
        if !snapshot
            .queue
            .iter()
            .any(|entry| Some(&entry.id) == snapshot.session.current_queue_id.as_ref())
        {
            snapshot.session.current_queue_id = None;
            snapshot.session.position = 0.0;
        }
        let tx = db.transaction().map_err(error)?;
        tx.execute("DELETE FROM tracks WHERE id=?1", [track_id])
            .map_err(error)?;
        tx.execute("DELETE FROM tracks_fts WHERE id=?1", [track_id])
            .map_err(error)?;
        let mut state = snapshot.clone();
        state.tracks.clear();
        tx.execute("INSERT INTO state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&state).map_err(error)?]).map_err(error)?;
        tx.commit().map_err(error)?;
        drop(db);
        self.load()
    }

    pub fn relink_track(&self, track_id: &str, selected: &str) -> Result<LibraryTrack, String> {
        let _scan = self.scan_lock.lock();
        let _edit = self.edit_lock.lock();
        let path = self.authorize_path(selected)?;
        if !supported(&path) {
            return Err("Select a supported audio file.".into());
        }
        let original = self.track(track_id)?;
        let mut replacement = self.read_track(&path)?;
        let mut db = self.db.lock();
        // Re-read under the write lock so concurrent favorites/play statistics survive.
        let original: LibraryTrack = db
            .query_row(
                "SELECT data FROM tracks WHERE id=?1",
                [&original.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(error)
            .and_then(|data| serde_json::from_str(&data).map_err(error))?;
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tracks WHERE path=?1 AND id<>?2)",
                params![replacement.path, track_id],
                |row| row.get(0),
            )
            .map_err(error)?;
        if exists {
            return Err("That file is already linked to another library entry.".into());
        }
        replacement.id = original.id;
        replacement.is_liked = original.is_liked;
        replacement.play_count = original.play_count;
        replacement.listening_seconds = original.listening_seconds;
        replacement.date_added = original.date_added;
        let tx = db.transaction().map_err(error)?;
        upsert(&tx, &replacement)?;
        tx.execute("DELETE FROM metadata_undo WHERE track_id=?1", [track_id])
            .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(replacement)
    }

    pub fn import_paths(&self, paths: Vec<String>) -> Result<Vec<LibraryTrack>, String> {
        self.import_with_progress(paths, |_| {})
    }

    pub fn import_with_progress(
        &self,
        paths: Vec<String>,
        progress: impl Fn(ScanProgress),
    ) -> Result<Vec<LibraryTrack>, String> {
        let _scan = self
            .scan_lock
            .try_lock()
            .ok_or_else(|| "Another library scan is running.".to_string())?;
        self.cancel_scan.store(false, Ordering::Relaxed);
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        for path in paths {
            let root = self.authorize_path(&path)?;
            self.collect_files(&root, &root, 0, &mut seen, &mut files)?;
        }
        let existing = self.load()?.tracks;
        let by_path: HashMap<_, _> = existing
            .iter()
            .map(|track| (path_key(&track.path), track.clone()))
            .collect();
        let mut missing_by_fingerprint: HashMap<String, Vec<LibraryTrack>> = HashMap::new();
        for track in existing
            .iter()
            .filter(|track| !Path::new(&track.path).is_file())
        {
            if let Some(fingerprint) = &track.fingerprint {
                missing_by_fingerprint
                    .entry(fingerprint.clone())
                    .or_default()
                    .push(track.clone());
            }
        }
        let mut imported = Vec::new();
        let total = files.len();
        let mut skipped = 0;
        for (index, path) in files.into_iter().enumerate() {
            if self.cancel_scan.load(Ordering::Relaxed) {
                break;
            }
            match self.read_track(&path) {
                Ok(mut track) => {
                    let previous = by_path.get(&path_key(&track.path)).cloned().or_else(|| {
                        track
                            .fingerprint
                            .as_ref()
                            .and_then(|key| missing_by_fingerprint.get_mut(key))
                            .and_then(|matches| {
                                if matches.len() == 1 {
                                    matches.pop()
                                } else {
                                    None
                                }
                            })
                    });
                    if let Some(previous) = previous {
                        track.id = previous.id;
                        track.is_liked = previous.is_liked;
                        track.play_count = previous.play_count;
                        track.listening_seconds = previous.listening_seconds;
                        track.date_added = previous.date_added;
                    }
                    let mut db = self.db.lock();
                    // Scans may take minutes. Preserve preferences changed while
                    // metadata was being read, under the same lock as the write.
                    if let Some(value) = db
                        .query_row("SELECT data FROM tracks WHERE id=?1", [&track.id], |row| {
                            row.get::<_, String>(0)
                        })
                        .optional()
                        .map_err(error)?
                    {
                        let latest: LibraryTrack = serde_json::from_str(&value).map_err(error)?;
                        track.is_liked = latest.is_liked;
                        track.play_count = latest.play_count;
                        track.listening_seconds = latest.listening_seconds;
                    }
                    let tx = db.transaction().map_err(error)?;
                    upsert(&tx, &track)?;
                    tx.commit().map_err(error)?;
                    imported.push(track);
                }
                Err(_) => skipped += 1,
            }
            if index % 20 == 0 {
                progress(ScanProgress {
                    processed: index + 1,
                    total,
                    skipped,
                    cancelled: false,
                });
            }
        }
        progress(ScanProgress {
            processed: imported.len() + skipped,
            total,
            skipped,
            cancelled: self.cancel_scan.load(Ordering::Relaxed),
        });
        Ok(imported)
    }

    fn collect_files(
        &self,
        root: &Path,
        path: &Path,
        depth: usize,
        seen: &mut HashSet<PathBuf>,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        if self.cancel_scan.load(Ordering::Relaxed) {
            return Ok(());
        }
        if depth > 32 || files.len() >= MAX_TRACKS {
            return Err("Library scan limit reached. Import a smaller folder.".into());
        }
        if fs::symlink_metadata(path)
            .map_err(error)?
            .file_type()
            .is_symlink()
        {
            return Ok(());
        }
        let canonical = fs::canonicalize(path).map_err(error)?;
        if !canonical.starts_with(root) || !seen.insert(canonical.clone()) {
            return Ok(());
        }
        if canonical.is_file() {
            if supported(&canonical) {
                files.push(canonical);
            }
        } else if canonical.is_dir() {
            for entry in fs::read_dir(&canonical).map_err(error)?.flatten() {
                self.collect_files(root, &entry.path(), depth + 1, seen, files)?;
            }
        }
        Ok(())
    }

    fn read_track(&self, path: &Path) -> Result<LibraryTrack, String> {
        let tagged = Probe::open(path)
            .and_then(|probe| probe.read())
            .map_err(error)?;
        let properties = tagged.properties();
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let path_text = path_string(path);
        let mut track = LibraryTrack {
            id: format!("local-{}", digest(path_text.as_bytes())),
            path: path_text,
            name: tag
                .and_then(|tag| tag.title())
                .map(|value| value.into_owned())
                .unwrap_or_else(|| {
                    path.file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                }),
            artist: tag
                .and_then(|tag| tag.artist())
                .map(|value| value.into_owned())
                .unwrap_or_else(|| "Unknown Artist".into()),
            album: tag
                .and_then(|tag| tag.album())
                .map(|value| value.into_owned()),
            genre: tag
                .and_then(|tag| tag.genre())
                .map(|value| value.into_owned()),
            year: tag
                .and_then(|tag| tag.year())
                .map(|value| value.to_string()),
            track_number: tag.and_then(|tag| tag.track()),
            format: path
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_uppercase()),
            duration: Some(properties.duration().as_secs_f64()),
            sample_rate: properties.sample_rate(),
            bit_depth: properties.bit_depth(),
            bitrate: properties.audio_bitrate(),
            date_added: Some(now_ms()),
            source: Some("local".into()),
            replay_gain_track: gain(
                tag.and_then(|tag| tag.get_string(&ItemKey::ReplayGainTrackGain)),
            ),
            replay_gain_album: gain(
                tag.and_then(|tag| tag.get_string(&ItemKey::ReplayGainAlbumGain)),
            ),
            fingerprint: Some(file_fingerprint(path)?),
            ..LibraryTrack::default()
        };
        if let Some(picture) = tag.and_then(|tag| tag.pictures().first()) {
            let data = picture.data();
            if data.len() <= MAX_ARTWORK_BYTES {
                let extension = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    Some("png")
                } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
                    Some("jpg")
                } else {
                    None
                };
                if let Some(extension) = extension {
                    let cached = self.data_dir.join("artwork").join(format!(
                        "{}.{}",
                        digest(data),
                        extension
                    ));
                    if !cached.exists() {
                        write_new_file(&cached, data)?;
                    }
                    track.artwork_path = Some(path_string(&cached));
                }
            }
        }
        Ok(track)
    }

    pub fn reconcile(&self, progress: impl Fn(ScanProgress)) -> Result<LibrarySnapshot, String> {
        let snapshot = self.load()?;
        let roots: Vec<String> = snapshot
            .watched_folders
            .iter()
            .filter(|path| Path::new(path).is_dir())
            .cloned()
            .collect();
        if !roots.is_empty() {
            self.import_with_progress(roots, progress)?;
        }
        let mut db = self.db.lock();
        let mut snapshot = self.load_state(&db)?;
        {
            let mut statement = db
                .prepare("SELECT data FROM tracks ORDER BY rowid")
                .map_err(error)?;
            snapshot.tracks = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(error)?
                .map(|row| serde_json::from_str(&row.map_err(error)?).map_err(error))
                .collect::<Result<_, _>>()?;
        }
        let tx = db.transaction().map_err(error)?;
        for track in &mut snapshot.tracks {
            track.missing = self
                .authorize_path(&track.path)
                .map(|path| !path.is_file())
                .unwrap_or(true);
            upsert(&tx, track)?;
        }
        tx.commit().map_err(error)?;
        Ok(snapshot)
    }

    pub fn cancel(&self) {
        self.cancel_scan.store(true, Ordering::Relaxed);
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<LibraryTrack>, String> {
        if query.len() > 500 {
            return Err("Search query is too long.".into());
        }
        let terms = query
            .split_whitespace()
            .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ");
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let db = self.db.lock();
        let mut statement = db.prepare("SELECT t.data FROM tracks_fts f JOIN tracks t ON t.id=f.id WHERE tracks_fts MATCH ?1 ORDER BY rank LIMIT ?2").map_err(error)?;
        let rows = statement
            .query_map(params![terms, limit.clamp(1, 500)], |row| {
                row.get::<_, String>(0)
            })
            .map_err(error)?;
        rows.map(|row| serde_json::from_str(&row.map_err(error)?).map_err(error))
            .collect()
    }

    pub fn export(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.load()?).map_err(error)
    }

    pub fn migrate_legacy(&self, backup: &str) -> Result<LibrarySnapshot, String> {
        if backup.len() > MAX_BACKUP_BYTES {
            return Err("Legacy library exceeds the 64 MiB limit.".into());
        }
        let mut snapshot: LibrarySnapshot = serde_json::from_str(backup).map_err(error)?;
        // Browser-only objects and remote provider results are not local audio.
        // Preserve the original browser data; migration never grants filesystem access.
        let mut paths = HashSet::new();
        snapshot.tracks.retain(|track| {
            Path::new(&track.path).is_absolute()
                && !track.path.contains('\0')
                && paths.insert(path_key(&track.path))
        });
        let ids: HashSet<_> = snapshot
            .tracks
            .iter()
            .map(|track| track.id.clone())
            .collect();
        snapshot.queue.retain(|entry| ids.contains(&entry.track_id));
        for playlist in &mut snapshot.playlists {
            playlist.track_ids.retain(|id| ids.contains(id));
        }
        if !snapshot
            .queue
            .iter()
            .any(|entry| Some(&entry.id) == snapshot.session.current_queue_id.as_ref())
        {
            snapshot.session.current_queue_id = None;
            snapshot.session.position = 0.0;
        }
        for track in &mut snapshot.tracks {
            track.missing = self.authorize_path(&track.path).is_err();
            track.artwork_path = None;
        }
        snapshot.watched_folders.clear();
        validate_snapshot(&snapshot)?;
        {
            let mut db = self.db.lock();
            let tx = db.transaction().map_err(error)?;
            let initialized: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM state) OR EXISTS(SELECT 1 FROM tracks)",
                    [],
                    |row| row.get(0),
                )
                .map_err(error)?;
            if !initialized {
                for track in &snapshot.tracks {
                    upsert(&tx, track)?;
                }
                snapshot.tracks.clear();
                tx.execute(
                    "INSERT INTO state(id,data) VALUES(1,?1)",
                    [serde_json::to_string(&snapshot).map_err(error)?],
                )
                .map_err(error)?;
            }
            tx.commit().map_err(error)?;
        }
        self.load()
    }

    pub fn restore(&self, backup: &str) -> Result<LibrarySnapshot, String> {
        let _scan = self.scan_lock.lock();
        if backup.len() > MAX_BACKUP_BYTES {
            return Err("Backup exceeds the 64 MiB limit.".into());
        }
        let mut snapshot: LibrarySnapshot =
            serde_json::from_str(backup).map_err(|e| format!("Invalid library backup: {e}"))?;
        validate_snapshot(&snapshot)?;
        // Backups contain references, never grant filesystem access and never restore credentials.
        for track in &mut snapshot.tracks {
            track.missing = self.authorize_path(&track.path).is_err();
            track.artwork_path = None;
            if !track.missing {
                if let Ok(native) = self.read_track(Path::new(&track.path)) {
                    track.artwork_path = native.artwork_path;
                }
            }
        }
        snapshot.watched_folders.retain(|path| {
            self.authorize_path(path)
                .map(|path| path.is_dir())
                .unwrap_or(false)
        });
        let mut db = self.db.lock();
        let tx = db.transaction().map_err(error)?;
        tx.execute("DELETE FROM tracks", []).map_err(error)?;
        tx.execute("DELETE FROM tracks_fts", []).map_err(error)?;
        for track in &snapshot.tracks {
            upsert(&tx, track)?;
        }
        let mut state = snapshot.clone();
        state.tracks.clear();
        tx.execute("INSERT INTO state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&state).map_err(error)?]).map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(snapshot)
    }

    fn track(&self, id: &str) -> Result<LibraryTrack, String> {
        let db = self.db.lock();
        let value = db
            .query_row("SELECT data FROM tracks WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(error)?
            .ok_or_else(|| "Track was not found in the library.".to_string())?;
        serde_json::from_str(&value).map_err(error)
    }

    pub fn read_lyrics(&self, track_id: &str) -> Result<Option<String>, String> {
        let track = self.track(track_id)?;
        let path = self.authorize_path(&track.path)?;
        let lyrics = path.with_extension("lrc");
        if !lyrics.is_file() {
            return Ok(None);
        }
        // A companion file beside an explicitly imported track is allowed; symlinks are not.
        if fs::symlink_metadata(&lyrics)
            .map_err(error)?
            .file_type()
            .is_symlink()
        {
            return Err("Linked lyric files are not supported.".into());
        }
        let canonical = fs::canonicalize(&lyrics).map_err(error)?;
        if canonical.parent() != path.parent() {
            return Err("Lyric file must be beside the track.".into());
        }
        if fs::metadata(&canonical).map_err(error)?.len() > 1024 * 1024 {
            return Err("Lyric file is too large.".into());
        }
        fs::read_to_string(canonical).map(Some).map_err(error)
    }

    pub fn waveform(&self, track_id: &str, bins: usize) -> Result<Waveform, String> {
        use rodio::{Decoder, Source};
        let bins = bins.clamp(32, 4096);
        let track = self.track(track_id)?;
        let path = self.authorize_path(&track.path)?;
        let fingerprint = file_fingerprint(&path)?;
        let cache = self
            .data_dir
            .join("waveforms")
            .join(format!("{fingerprint}-{bins}.json"));
        if let Ok(data) = fs::read(&cache) {
            if let Ok(waveform) = serde_json::from_slice(&data) {
                return Ok(waveform);
            }
        }
        let decoder =
            Decoder::new(BufReader::new(File::open(path).map_err(error)?)).map_err(error)?;
        let sample_rate = decoder.sample_rate() as f64;
        let channels = decoder.channels() as f64;
        let duration = decoder
            .total_duration()
            .map(|duration| duration.as_secs_f64())
            .or(track.duration)
            .filter(|duration| *duration > 0.0 && duration.is_finite())
            .ok_or_else(|| "Waveform requires a known track duration.".to_string())?;
        if duration > 4.0 * 3600.0 {
            return Err("Waveform analysis supports tracks up to four hours.".into());
        }
        let samples_per_bin = (duration * sample_rate * channels / bins as f64).max(1.0);
        let mut peaks = vec![0.0_f32; bins];
        for (index, sample) in decoder.convert_samples::<f32>().enumerate() {
            if index % 65536 == 0 && self.cancel_scan.load(Ordering::Relaxed) {
                return Err("Analysis cancelled.".into());
            }
            let bin = ((index as f64 / samples_per_bin) as usize).min(bins - 1);
            if sample.is_finite() {
                peaks[bin] = peaks[bin].max(sample.abs().min(1.0));
            }
        }
        let waveform = Waveform { peaks, duration };
        write_new_file(&cache, &serde_json::to_vec(&waveform).map_err(error)?)?;
        Ok(waveform)
    }

    pub fn update_metadata(
        &self,
        track_id: &str,
        edit: MetadataEdit,
    ) -> Result<LibraryTrack, String> {
        let _scan = self.scan_lock.lock();
        let _guard = self.edit_lock.lock();
        for text in [&edit.name, &edit.artist] {
            if text.len() > 4096 || text.contains('\0') {
                return Err("Metadata value is invalid.".into());
            }
        }
        for text in [&edit.album, &edit.genre].into_iter().flatten() {
            if text.len() > 4096 || text.contains('\0') {
                return Err("Metadata value is invalid.".into());
            }
        }
        if edit.year.is_some_and(|year| !(1..=9999).contains(&year)) {
            return Err("Year must be between 1 and 9999.".into());
        }
        let original = self.track(track_id)?;
        let path = self.authorize_path(&original.path)?;
        let backup = self
            .data_dir
            .join("metadata-backups")
            .join(format!("{}.audio", digest(track_id.as_bytes())));
        fs::copy(&path, &backup).map_err(|e| format!("Could not back up metadata edit: {e}"))?;
        // Windows FlushFileBuffers requires a writable handle.
        OpenOptions::new()
            .write(true)
            .open(&backup)
            .and_then(|file| file.sync_all())
            .map_err(error)?;
        self.db.lock().execute("INSERT INTO metadata_undo(track_id,original_path,backup_path,edited_hash,pending) VALUES(?1,?2,?3,NULL,1) ON CONFLICT(track_id) DO UPDATE SET original_path=excluded.original_path,backup_path=excluded.backup_path,edited_hash=NULL,pending=1", params![track_id, path_string(&path), path_string(&backup)]).map_err(error)?;
        let result = (|| {
            let tagged = Probe::open(&path)
                .and_then(|probe| probe.read())
                .map_err(error)?;
            let mut tag = tagged
                .primary_tag()
                .or_else(|| tagged.first_tag())
                .cloned()
                .unwrap_or_else(|| Tag::new(tagged.primary_tag_type()));
            tag.set_title(edit.name);
            tag.set_artist(edit.artist);
            if let Some(album) = edit.album {
                tag.set_album(album);
            } else {
                tag.remove_album();
            }
            if let Some(genre) = edit.genre {
                tag.set_genre(genre);
            } else {
                tag.remove_genre();
            }
            if let Some(year) = edit.year {
                tag.set_year(year);
            } else {
                tag.remove_year();
            }
            if let Some(number) = edit.track_number {
                tag.set_track(number);
            } else {
                tag.remove_track();
            }
            if fs::canonicalize(&original.path).map_err(error)? != path {
                return Err("File changed while editing; retry the operation.".into());
            }
            tag.save_to_path(&path, WriteOptions::new())
                .map_err(error)?;
            let mut updated = self.read_track(&path)?;
            updated.id = original.id.clone();
            updated.is_liked = original.is_liked;
            updated.play_count = original.play_count;
            updated.listening_seconds = original.listening_seconds;
            updated.date_added = original.date_added;
            let edited_hash = full_hash(&path)?;
            let mut db = self.db.lock();
            let tx = db.transaction().map_err(error)?;
            upsert(&tx, &updated)?;
            tx.execute(
                "UPDATE metadata_undo SET edited_hash=?1,pending=0 WHERE track_id=?2",
                params![edited_hash, track_id],
            )
            .map_err(error)?;
            tx.commit().map_err(error)?;
            Ok(updated)
        })();
        if result.is_err() {
            fs::copy(&backup, &path).map_err(|e| {
                format!("Edit failed and automatic recovery failed: {e}. Backup is retained.")
            })?;
            self.db
                .lock()
                .execute("DELETE FROM metadata_undo WHERE track_id=?1", [track_id])
                .map_err(error)?;
        }
        result
    }

    pub fn undo_metadata(&self, track_id: &str) -> Result<LibraryTrack, String> {
        let _scan = self.scan_lock.lock();
        let _guard = self.edit_lock.lock();
        let original = self.track(track_id)?;
        let path = self.authorize_path(&original.path)?;
        let (backup, expected): (String, String) = self
            .db
            .lock()
            .query_row(
                "SELECT backup_path,edited_hash FROM metadata_undo WHERE track_id=?1 AND pending=0",
                [track_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "No metadata edit is available to undo.".to_string())?;
        if full_hash(&path)? != expected {
            return Err("The file changed outside RawhPlayer. Undo was cancelled to preserve those changes.".into());
        }
        let backup = fs::canonicalize(backup).map_err(error)?;
        if !backup
            .starts_with(fs::canonicalize(self.data_dir.join("metadata-backups")).map_err(error)?)
        {
            return Err("Invalid metadata backup.".into());
        }
        fs::copy(backup, &path).map_err(error)?;
        let mut updated = self.read_track(&path)?;
        updated.id = original.id;
        updated.is_liked = original.is_liked;
        updated.play_count = original.play_count;
        updated.listening_seconds = original.listening_seconds;
        updated.date_added = original.date_added;
        let mut db = self.db.lock();
        let tx = db.transaction().map_err(error)?;
        upsert(&tx, &updated)?;
        tx.execute("DELETE FROM metadata_undo WHERE track_id=?1", [track_id])
            .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(updated)
    }

    fn recover_pending_edits(&self) -> Result<(), String> {
        let records: Vec<(String, String, String)> = {
            let db = self.db.lock();
            let mut statement = db
                .prepare(
                    "SELECT track_id,original_path,backup_path FROM metadata_undo WHERE pending=1",
                )
                .map_err(error)?;
            let values = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(error)?;
            values.collect::<Result<_, _>>().map_err(error)?
        };
        for (id, original, backup) in records {
            let path = self.authorize_path(&original)?;
            let backup = fs::canonicalize(backup).map_err(error)?;
            if !backup.starts_with(
                fs::canonicalize(self.data_dir.join("metadata-backups")).map_err(error)?,
            ) {
                return Err("Invalid recovery backup; no file was changed.".into());
            }
            fs::copy(backup, path).map_err(error)?;
            self.db
                .lock()
                .execute("DELETE FROM metadata_undo WHERE track_id=?1", [id])
                .map_err(error)?;
        }
        Ok(())
    }

    pub fn add_watched_folder(&self, path: &str) -> Result<(), String> {
        let path = self.authorize_path(path)?;
        if !path.is_dir() {
            return Err("Select a folder to watch.".into());
        }
        self.update_watched_folders(Some(path_string(&path)), None)
    }

    pub fn clear_watched_folders(&self) -> Result<(), String> {
        self.update_watched_folders(None, None)
    }

    pub fn remove_watched_folder(&self, path: &str) -> Result<(), String> {
        // Removing an unavailable/disconnected folder must not require canonicalization.
        self.update_watched_folders(None, Some(path))
    }

    pub fn watched_folders(&self) -> Result<Vec<String>, String> {
        self.load_state(&self.db.lock())
            .map(|state| state.watched_folders)
    }

    fn update_watched_folders(
        &self,
        add: Option<String>,
        remove: Option<&str>,
    ) -> Result<(), String> {
        let db = self.db.lock();
        let mut snapshot = self.load_state(&db)?;
        if let Some(path) = add {
            if !snapshot.watched_folders.contains(&path) {
                if snapshot.watched_folders.len() >= 1000 {
                    return Err("At most 1000 watched folders are supported.".into());
                }
                snapshot.watched_folders.push(path);
            }
        } else if let Some(path) = remove {
            snapshot.watched_folders.retain(|folder| folder != path);
        } else {
            snapshot.watched_folders.clear();
        }
        db.execute("INSERT INTO state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&snapshot).map_err(error)?]).map_err(error)?;
        Ok(())
    }
}

fn upsert(tx: &Transaction<'_>, track: &LibraryTrack) -> Result<(), String> {
    tx.execute("INSERT INTO tracks(id,path,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET path=excluded.path,data=excluded.data", params![track.id, track.path, serde_json::to_string(track).map_err(error)?]).map_err(error)?;
    tx.execute("DELETE FROM tracks_fts WHERE id=?1", [&track.id])
        .map_err(error)?;
    tx.execute(
        "INSERT INTO tracks_fts(id,title,artist,album,genre) VALUES(?1,?2,?3,?4,?5)",
        params![track.id, track.name, track.artist, track.album, track.genre],
    )
    .map_err(error)?;
    Ok(())
}

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

pub fn validate_snapshot(snapshot: &LibrarySnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1 {
        return Err("Unsupported library backup version.".into());
    }
    if snapshot.tracks.len() > MAX_TRACKS
        || snapshot.queue.len() > MAX_TRACKS
        || snapshot.playlists.len() > 10_000
        || snapshot.watched_folders.len() > 1000
    {
        return Err("Library exceeds supported limits.".into());
    }
    if !snapshot.session.position.is_finite()
        || snapshot.session.position < 0.0
        || snapshot.session.position > 7.0 * 86400.0
    {
        return Err("Invalid playback position.".into());
    }
    if !["SEQUENCE", "LOOP", "SHUFFLE"].contains(&snapshot.session.playback_mode.as_str()) {
        return Err("Invalid playback mode.".into());
    }
    let mut tracks = HashSet::new();
    let mut paths = HashSet::new();
    for track in &snapshot.tracks {
        if track.id.is_empty()
            || track.id.len() > 256
            || !tracks.insert(&track.id)
            || !paths.insert(path_key(&track.path))
        {
            return Err("Library contains duplicate or invalid track identifiers.".into());
        }
        if track.path.len() > 32_768
            || !Path::new(&track.path).is_absolute()
            || track.path.contains('\0')
        {
            return Err("Library contains an invalid file path.".into());
        }
        if track.name.len() > 4096
            || track.artist.len() > 4096
            || !track.listening_seconds.is_finite()
            || track.listening_seconds < 0.0
            || track
                .duration
                .is_some_and(|value| !value.is_finite() || value < 0.0)
        {
            return Err("Library contains invalid track metadata.".into());
        }
    }
    let mut entries = HashSet::new();
    for entry in &snapshot.queue {
        if entry.id.is_empty()
            || entry.id.len() > 256
            || !entries.insert(&entry.id)
            || !tracks.contains(&entry.track_id)
        {
            return Err("Queue references an invalid track or entry.".into());
        }
    }
    if snapshot
        .session
        .current_queue_id
        .as_ref()
        .is_some_and(|id| !entries.contains(id))
    {
        return Err("Playback session references a missing queue entry.".into());
    }
    let mut playlists = HashSet::new();
    for playlist in &snapshot.playlists {
        if playlist.id.is_empty()
            || playlist.id.len() > 256
            || !playlists.insert(&playlist.id)
            || playlist.name.trim().is_empty()
            || playlist.name.len() > 256
            || playlist.track_ids.len() > MAX_TRACKS
            || playlist.track_ids.iter().any(|id| !tracks.contains(id))
        {
            return Err("Library contains an invalid playlist.".into());
        }
        if let Some(rule) = &playlist.smart_rule {
            if [&rule.query, &rule.artist, &rule.genre, &rule.format]
                .iter()
                .any(|value| value.as_ref().is_some_and(|value| value.len() > 512))
                || rule.added_within_days.is_some_and(|value| value > 36_500)
                || rule.min_sample_rate.is_some_and(|value| value > 768_000)
            {
                return Err("Playlist contains an invalid smart rule.".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn library_load(app: AppHandle) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().load())
        .await
        .map_err(error)?
}
#[tauri::command]
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
pub async fn library_save(app: AppHandle, snapshot: LibrarySnapshot) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().save(snapshot))
        .await
        .map_err(error)?
}
#[tauri::command]
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
pub fn library_cancel_scan(library: State<'_, NativeLibrary>) {
    library.cancel();
}
#[tauri::command]
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
pub async fn library_export(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().export())
        .await
        .map_err(error)?
}
#[tauri::command]
pub async fn library_restore(app: AppHandle, backup: String) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().restore(&backup))
        .await
        .map_err(error)?
}
#[tauri::command]
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
mod tests {
    use super::*;
    struct Fixture {
        directory: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!(
                "rawh-library-test-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&directory).unwrap();
            Self { directory }
        }
        fn library(&self) -> NativeLibrary {
            NativeLibrary::open(self.directory.join("data")).unwrap()
        }
        fn wav(&self, name: &str) -> PathBuf {
            let path = self.directory.join(name);
            let samples: Vec<i16> = (0..4410)
                .map(|index| ((index as f32 * 0.1).sin() * 10000.0) as i16)
                .collect();
            let size = (samples.len() * 2) as u32;
            let mut bytes = b"RIFF".to_vec();
            bytes.extend((36 + size).to_le_bytes());
            bytes.extend(b"WAVEfmt ");
            bytes.extend(16_u32.to_le_bytes());
            bytes.extend(1_u16.to_le_bytes());
            bytes.extend(1_u16.to_le_bytes());
            bytes.extend(44100_u32.to_le_bytes());
            bytes.extend(88200_u32.to_le_bytes());
            bytes.extend(2_u16.to_le_bytes());
            bytes.extend(16_u16.to_le_bytes());
            bytes.extend(b"data");
            bytes.extend(size.to_le_bytes());
            for sample in samples {
                bytes.extend(sample.to_le_bytes());
            }
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn ungranted_files_are_rejected_and_grants_persist() {
        let fixture = Fixture::new();
        let path = path_string(&fixture.wav("one.wav"));
        let library = fixture.library();
        assert!(library.import_paths(vec![path.clone()]).is_err());
        library
            .authorize_paths(std::slice::from_ref(&path))
            .unwrap();
        let imported = library.import_paths(vec![path.clone()]).unwrap();
        assert_eq!(imported.len(), 1);
        drop(library);
        let reopened = fixture.library();
        assert!(reopened.authorize_path(&path).is_ok());
        assert_eq!(reopened.load().unwrap().tracks.len(), 1);
    }
    #[test]
    fn repair_preserves_identity_and_rejects_ungranted_or_duplicate_files() {
        let fixture = Fixture::new();
        let first = path_string(&fixture.wav("original.wav"));
        let other = path_string(&fixture.wav("other.wav"));
        let moved = path_string(&fixture.wav("moved.wav"));
        let library = fixture.library();
        library
            .authorize_paths(&[first.clone(), other.clone()])
            .unwrap();
        let imported = library.import_paths(vec![first, other.clone()]).unwrap();
        let id = imported[0].id.clone();
        let mut snapshot = library.load().unwrap();
        let original = snapshot
            .tracks
            .iter_mut()
            .find(|track| track.id == id)
            .unwrap();
        original.is_liked = true;
        original.play_count = 7;
        snapshot.queue.push(QueueEntry {
            id: "queued".into(),
            track_id: id.clone(),
        });
        snapshot.playlists.push(Playlist {
            id: "saved".into(),
            name: "Saved".into(),
            track_ids: vec![id.clone()],
            smart_rule: None,
            created_at: 0,
        });
        library.save(snapshot).unwrap();
        assert!(library.relink_track(&id, &moved).is_err());
        assert!(library.relink_track(&id, &other).is_err());
        library
            .authorize_paths(std::slice::from_ref(&moved))
            .unwrap();
        let repaired = library.relink_track(&id, &moved).unwrap();
        assert_eq!(repaired.id, id);
        assert!(repaired.is_liked);
        assert_eq!(repaired.play_count, 7);
        let after = library.load().unwrap();
        assert_eq!(after.queue[0].track_id, id);
        assert_eq!(after.playlists[0].track_ids, vec![id]);
        assert_eq!(after.tracks.len(), 2);
    }
    #[test]
    fn invalid_smart_rules_are_rejected_before_persistence() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let mut snapshot = LibrarySnapshot::default();
        snapshot.playlists.push(Playlist {
            id: "smart".into(),
            name: "Smart".into(),
            track_ids: vec![],
            smart_rule: Some(SmartRule {
                min_sample_rate: Some(900_000),
                ..Default::default()
            }),
            created_at: 0,
        });
        assert!(library.save(snapshot).is_err());
        assert!(library.load().unwrap().playlists.is_empty());
    }
    #[test]
    fn repeat_import_deduplicates_and_keeps_user_metadata() {
        let fixture = Fixture::new();
        let path = path_string(&fixture.wav("one.wav"));
        let library = fixture.library();
        library
            .authorize_paths(std::slice::from_ref(&path))
            .unwrap();
        library.import_paths(vec![path.clone()]).unwrap();
        let mut snapshot = library.load().unwrap();
        snapshot.tracks[0].is_liked = true;
        snapshot.tracks[0].play_count = 7;
        library.save(snapshot).unwrap();
        library.import_paths(vec![path]).unwrap();
        let snapshot = library.load().unwrap();
        assert_eq!(snapshot.tracks.len(), 1);
        assert!(snapshot.tracks[0].is_liked);
        assert_eq!(snapshot.tracks[0].play_count, 7);
    }
    #[test]
    fn restore_rejects_invalid_queue_without_changing_database() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let mut snapshot = LibrarySnapshot::default();
        snapshot.queue.push(QueueEntry {
            id: "queue".into(),
            track_id: "missing".into(),
        });
        assert!(library
            .restore(&serde_json::to_string(&snapshot).unwrap())
            .is_err());
        assert!(library.load().unwrap().queue.is_empty());
    }
    #[test]
    fn backup_restore_never_grants_access() {
        let fixture = Fixture::new();
        let path = path_string(&fixture.wav("one.wav"));
        let library = fixture.library();
        let mut snapshot = LibrarySnapshot::default();
        snapshot.tracks.push(LibraryTrack {
            id: "track".into(),
            path: path.clone(),
            name: "One".into(),
            ..LibraryTrack::default()
        });
        let restored = library
            .restore(&serde_json::to_string(&snapshot).unwrap())
            .unwrap();
        assert!(restored.tracks[0].missing);
        assert!(library.authorize_path(&path).is_err());
    }
    #[test]
    fn library_clear_queue_keeps_tracks_and_waveform_is_bounded() {
        let fixture = Fixture::new();
        let path = path_string(&fixture.wav("one.wav"));
        let library = fixture.library();
        library
            .authorize_paths(std::slice::from_ref(&path))
            .unwrap();
        library.import_paths(vec![path]).unwrap();
        let snapshot = library.load().unwrap();
        let id = snapshot.tracks[0].id.clone();
        library.save(snapshot).unwrap();
        let waveform = library.waveform(&id, 64).unwrap();
        assert_eq!(waveform.peaks.len(), 64);
        assert!(waveform
            .peaks
            .iter()
            .all(|peak| peak.is_finite() && (0.0..=1.0).contains(peak)));
        assert_eq!(library.load().unwrap().tracks.len(), 1);
    }
    #[test]
    fn query_text_cannot_inject_fts_operators() {
        let fixture = Fixture::new();
        let library = fixture.library();
        assert!(library.search("\" OR *", 50).unwrap().is_empty());
    }

    #[test]
    fn metadata_edit_roundtrip_restores_original_file_bytes() {
        let fixture = Fixture::new();
        let file = fixture.wav("editable.wav");
        let before = fs::read(&file).unwrap();
        let path = path_string(&file);
        let library = fixture.library();
        library
            .authorize_paths(std::slice::from_ref(&path))
            .unwrap();
        let imported = library.import_paths(vec![path]).unwrap();
        let id = &imported[0].id;
        let updated = library
            .update_metadata(
                id,
                MetadataEdit {
                    name: "Edited title".into(),
                    artist: "Artist".into(),
                    album: Some("Album".into()),
                    genre: None,
                    year: Some(2026),
                    track_number: Some(3),
                },
            )
            .unwrap();
        assert_eq!(updated.name, "Edited title");
        assert_eq!(updated.track_number, Some(3));
        assert_eq!(library.search("Edited", 10).unwrap().len(), 1);
        let restored = library.undo_metadata(id).unwrap();
        assert_eq!(restored.id, *id);
        assert_eq!(fs::read(&file).unwrap(), before);
        assert!(library.undo_metadata(id).is_err());
    }

    #[test]
    fn stale_session_save_cannot_change_watched_folders() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let folder = path_string(&fixture.directory);
        library
            .authorize_paths(std::slice::from_ref(&folder))
            .unwrap();
        let stale = library.load().unwrap();
        library.add_watched_folder(&folder).unwrap();
        library.save(stale).unwrap();
        let configured = library.load().unwrap();
        assert_eq!(configured.watched_folders.len(), 1);
        library
            .remove_watched_folder(&configured.watched_folders[0])
            .unwrap();
        library.save(configured).unwrap();
        assert!(library.watched_folders().unwrap().is_empty());
    }

    #[test]
    fn legacy_migration_is_once_only_and_never_grants_access() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let path = path_string(&fixture.wav("legacy.wav"));
        let mut legacy = LibrarySnapshot::default();
        legacy.tracks.push(LibraryTrack {
            id: "legacy".into(),
            path: path.clone(),
            name: "Legacy".into(),
            is_liked: true,
            ..LibraryTrack::default()
        });
        legacy.tracks.push(LibraryTrack {
            id: "browser".into(),
            path: "blob:obsolete".into(),
            ..LibraryTrack::default()
        });
        legacy.queue.push(QueueEntry {
            id: "q1".into(),
            track_id: "legacy".into(),
        });
        legacy.queue.push(QueueEntry {
            id: "q2".into(),
            track_id: "browser".into(),
        });
        let backup = serde_json::to_string(&legacy).unwrap();
        let migrated = library.migrate_legacy(&backup).unwrap();
        assert_eq!(migrated.tracks.len(), 1);
        assert_eq!(migrated.queue.len(), 1);
        assert!(migrated.tracks[0].is_liked && migrated.tracks[0].missing);
        assert!(library.authorize_path(&path).is_err());
        library
            .authorize_paths(std::slice::from_ref(&path))
            .unwrap();
        library.import_paths(vec![path]).unwrap();
        let reconnected = library.load().unwrap();
        assert_eq!(reconnected.tracks.len(), 1);
        assert_eq!(reconnected.tracks[0].id, "legacy");
        assert!(reconnected.tracks[0].is_liked);
        library.remove_track("legacy").unwrap();
        assert!(library.migrate_legacy(&backup).unwrap().tracks.is_empty());
    }

    #[test]
    fn watched_scan_preserves_identity_through_rename_delete_and_return() {
        let fixture = Fixture::new();
        let music = fixture.directory.join("music");
        fs::create_dir(&music).unwrap();
        let path = fixture.wav("original.wav");
        let original = music.join("original.wav");
        fs::rename(path, &original).unwrap();
        let library = fixture.library();
        let folder = path_string(&music);
        library
            .authorize_paths(std::slice::from_ref(&folder))
            .unwrap();
        library.add_watched_folder(&folder).unwrap();
        let mut snapshot = library.reconcile(|_| {}).unwrap();
        let id = snapshot.tracks[0].id.clone();
        snapshot.tracks[0].is_liked = true;
        library.save(snapshot).unwrap();
        let renamed = music.join("renamed.wav");
        fs::rename(&original, &renamed).unwrap();
        let snapshot = library.reconcile(|_| {}).unwrap();
        assert_eq!(snapshot.tracks.len(), 1);
        assert_eq!(snapshot.tracks[0].id, id);
        assert!(snapshot.tracks[0].is_liked);
        let offline = fixture.directory.join("offline.wav");
        fs::rename(&renamed, &offline).unwrap();
        assert!(library.reconcile(|_| {}).unwrap().tracks[0].missing);
        fs::rename(&offline, &renamed).unwrap();
        let snapshot = library.reconcile(|_| {}).unwrap();
        assert!(!snapshot.tracks[0].missing);
        assert_eq!(snapshot.tracks[0].id, id);
    }
}
