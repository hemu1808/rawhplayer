use super::*;
use serde::{ser::SerializeSeq, Serialize, Serializer};
use std::io::{BufReader, BufWriter, Write};
use tauri_plugin_dialog::DialogExt;

// File-based backups bypass webview IPC limits. The same bound applies in both
// directions and allows a full catalog with its queue and typical metadata.
const MAX_BACKUP_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Backup<'a> {
    schema_version: u32,
    tracks: BackupTracks<'a>,
    queue: &'a [QueueEntry],
    playlists: &'a [Playlist],
    session: &'a PlaybackSession,
    watched_folders: &'a [String],
}

struct BackupTracks<'a>(&'a Connection);

impl Serialize for BackupTracks<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error as _;
        let mut statement = self
            .0
            .prepare("SELECT data FROM tracks ORDER BY rowid")
            .map_err(S::Error::custom)?;
        let mut rows = statement.query([]).map_err(S::Error::custom)?;
        let mut sequence = serializer.serialize_seq(None)?;
        while let Some(row) = rows.next().map_err(S::Error::custom)? {
            let data: String = row.get(0).map_err(S::Error::custom)?;
            let mut track: LibraryTrack = serde_json::from_str(&data).map_err(S::Error::custom)?;
            track.analysis = None;
            track.artwork_path = None;
            sequence.serialize_element(&track)?;
        }
        sequence.end()
    }
}

struct LimitedWriter<W> {
    writer: W,
    remaining: u64,
}

impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() as u64 > self.remaining {
            return Err(std::io::Error::other(
                "Library backup exceeds the 512 MiB file limit.",
            ));
        }
        let written = self.writer.write(bytes)?;
        self.remaining -= written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()
    }
}

impl NativeLibrary {
    pub fn export(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.load()?).map_err(error)
    }

    pub fn export_file(&self, path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or("Choose a destination for the library backup.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
        // A separate read transaction gives the streamed export a consistent
        // snapshot without holding the application-wide SQLite mutex.
        let mut db = self.read_connection()?;
        let tx = db.transaction().map_err(error)?;
        let state = self.load_state(&tx)?;
        let mut writer = BufWriter::new(LimitedWriter {
            writer: file.as_file_mut(),
            remaining: MAX_BACKUP_FILE_BYTES,
        });
        let snapshot = Backup {
            schema_version: state.schema_version,
            tracks: BackupTracks(&tx),
            queue: &state.queue,
            playlists: &state.playlists,
            session: &state.session,
            watched_folders: &state.watched_folders,
        };
        serde_json::to_writer(&mut writer, &snapshot).map_err(error)?;
        writer.flush().map_err(error)?;
        drop(writer);
        file.as_file().sync_all().map_err(error)?;
        file.persist(path).map_err(error)?;
        Ok(())
    }

    pub fn restore_file(&self, path: &Path) -> Result<(), String> {
        use std::io::Read;
        let file = fs::File::open(path).map_err(error)?;
        let metadata = file.metadata().map_err(error)?;
        if !metadata.is_file() || metadata.len() > MAX_BACKUP_FILE_BYTES {
            return Err("Select a library backup file of at most 512 MiB.".into());
        }
        let mut reader = file.take(MAX_BACKUP_FILE_BYTES + 1);
        let snapshot = serde_json::from_reader(BufReader::new(&mut reader))
            .map_err(|e| format!("Invalid library backup: {e}"))?;
        if reader.limit() == 0 {
            return Err("Library backup exceeds the 512 MiB file limit.".into());
        }
        self.restore_snapshot(snapshot)?;
        Ok(())
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
                mutations::persist_state(&tx, &snapshot)?;
            }
            tx.commit().map_err(error)?;
        }
        self.load()
    }

    pub fn restore(&self, backup: &str) -> Result<LibrarySnapshot, String> {
        if backup.len() > MAX_BACKUP_BYTES {
            return Err("Backup exceeds the 64 MiB limit.".into());
        }
        let snapshot: LibrarySnapshot =
            serde_json::from_str(backup).map_err(|e| format!("Invalid library backup: {e}"))?;
        self.restore_snapshot(snapshot)
    }

    fn restore_snapshot(&self, mut snapshot: LibrarySnapshot) -> Result<LibrarySnapshot, String> {
        validate_snapshot(&snapshot)?;
        let _scan = self.scan_lock.lock();
        // Backups contain references, never grant filesystem access and never restore credentials.
        for track in &mut snapshot.tracks {
            track.missing = self.authorize_path(&track.path).is_err();
            track.artwork_path = None;
            track.analysis = None;
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
        let tracks = std::mem::take(&mut snapshot.tracks);
        mutations::persist_state(&tx, &snapshot)?;
        catalog::bump_revision(&tx)?;
        tx.commit().map_err(error)?;
        snapshot.tracks = tracks;
        Ok(snapshot)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn save_library_backup(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("RawhPlayer backup", &["json"])
            .set_file_name("rawh-library.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(error)?;
        app.state::<NativeLibrary>().export_file(&path)?;
        Ok(true)
    })
    .await
    .map_err(error)?
}

#[tauri::command]
#[specta::specta]
pub async fn open_library_backup(app: AppHandle) -> Result<Option<catalog::LibraryHeader>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("RawhPlayer backup", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(error)?;
        let library = app.state::<NativeLibrary>();
        library.restore_file(&path)?;
        let header = library.bootstrap()?;
        catalog::notify(&app);
        Ok(Some(header))
    })
    .await
    .map_err(error)?
}
