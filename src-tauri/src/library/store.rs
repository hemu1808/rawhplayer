use super::*;

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
        if version > 3 {
            return Err("This library was created by a newer RawhPlayer. Update the application before opening it.".into());
        }
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE tracks(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
                CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
                CREATE TABLE grants(path TEXT PRIMARY KEY);
                CREATE TABLE metadata_undo(track_id TEXT PRIMARY KEY, original_path TEXT NOT NULL, backup_path TEXT NOT NULL, edited_hash TEXT, pending INTEGER NOT NULL);
                CREATE VIRTUAL TABLE tracks_fts USING fts5(id UNINDEXED, title, artist, album, genre);
                PRAGMA user_version=2; COMMIT;").map_err(error)?;
        } else if version == 1 {
            // Keep a consistent rollback copy, including committed WAL contents.
            let backup = data_dir.join(format!("library-v1-backup-{}.sqlite3", now_ms()));
            db.execute("VACUUM INTO ?1", [path_string(&backup)])
                .map_err(error)?;
            OpenOptions::new()
                .write(true)
                .open(&backup)
                .and_then(|file| file.sync_all())
                .map_err(error)?;
            // Align FTS rowids once; future updates use indexed rowid lookups.
            db.execute_batch("BEGIN IMMEDIATE;
                DELETE FROM tracks_fts;
                INSERT INTO tracks_fts(rowid,id,title,artist,album,genre)
                    SELECT rowid,id,json_extract(data,'$.name'),json_extract(data,'$.artist'),
                        coalesce(json_extract(data,'$.album'),''),coalesce(json_extract(data,'$.genre'),'') FROM tracks;
                PRAGMA user_version=2; COMMIT;").map_err(error)?;
        }
        if version == 2 {
            let backup = data_dir.join(format!("library-v2-backup-{}.sqlite3", now_ms()));
            db.execute("VACUUM INTO ?1", [path_string(&backup)])
                .map_err(error)?;
            OpenOptions::new()
                .write(true)
                .open(&backup)
                .and_then(|file| file.sync_all())
                .map_err(error)?;
        }
        mutations::migrate(&db)?;
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

    pub(super) fn load_state(&self, db: &Connection) -> Result<LibrarySnapshot, String> {
        let value = db
            .query_row("SELECT data FROM state WHERE id=1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(error)?;
        let state = match value {
            Some(value) => serde_json::from_str(&value).map_err(|e| {
                format!("Library state could not be read: {e}. Your database has been preserved.")
            }),
            None => Ok(LibrarySnapshot::default()),
        }?;
        mutations::read_normalized(db, state)
    }

    pub fn load(&self) -> Result<LibrarySnapshot, String> {
        let db = self.db.lock();
        let mut snapshot = self.load_state(&db)?;
        let mut statement = db
            .prepare(&format!(
                "SELECT {} FROM {} ORDER BY t.rowid",
                catalog::TRACK_COLUMNS,
                catalog::TRACK_JOIN
            ))
            .map_err(error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(error)?;
        snapshot.tracks = rows
            .map(|row| {
                let (data, analysis) = row.map_err(error)?;
                catalog::decode_track(data, analysis)
            })
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
        let mut changed = Vec::new();
        for track in &snapshot.tracks {
            let mut original = known
                .remove(&track.id)
                .ok_or_else(|| "Import files before adding them to the library.".to_string())?;
            if original.path != track.path {
                return Err("Track paths must be changed through native import or repair.".into());
            }
            if original.is_liked != track.is_liked
                || original.play_count != track.play_count
                || original.listening_seconds != track.listening_seconds
            {
                original.is_liked = track.is_liked;
                original.play_count = track.play_count;
                original.listening_seconds = track.listening_seconds;
                changed.push(original);
            }
        }
        // Concurrent scans may have inserted tracks since the UI took its snapshot.
        // Deletion is an explicit command; a stale UI save must not delete new imports.
        // Existing/imported rows remain in place; only explicit removal deletes them.
        // Watch configuration changes only through scoped native commands. A stale
        // playback/session save must not undo a newly selected or removed folder.
        snapshot.watched_folders = self.load_state(&db)?.watched_folders;
        let tx = db.transaction().map_err(error)?;
        let previous_revision = catalog::revision(&tx)?.0;
        let preferences_changed = !changed.is_empty();
        for track in changed {
            // User preferences do not affect the full-text index or native metadata.
            tx.execute(
                "UPDATE tracks SET data=?2 WHERE id=?1",
                params![track.id, serde_json::to_string(&track).map_err(error)?],
            )
            .map_err(error)?;
        }
        snapshot.tracks.clear();
        mutations::persist_state(&tx, &snapshot)?;
        if preferences_changed && catalog::revision(&tx)?.0 == previous_revision {
            catalog::bump_revision(&tx)?;
        }
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
        tx.execute(
            "DELETE FROM tracks_fts WHERE rowid=(SELECT rowid FROM tracks WHERE id=?1)",
            [track_id],
        )
        .map_err(error)?;
        tx.execute("DELETE FROM tracks WHERE id=?1", [track_id])
            .map_err(error)?;
        let mut state = snapshot.clone();
        state.tracks.clear();
        mutations::persist_state(&tx, &state)?;
        catalog::bump_revision(&tx)?;
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
        let mut statement = db.prepare("SELECT t.data FROM tracks_fts f JOIN tracks t ON t.rowid=f.rowid WHERE tracks_fts MATCH ?1 ORDER BY rank LIMIT ?2").map_err(error)?;
        let rows = statement
            .query_map(params![terms, limit.clamp(1, 500)], |row| {
                row.get::<_, String>(0)
            })
            .map_err(error)?;
        rows.map(|row| serde_json::from_str(&row.map_err(error)?).map_err(error))
            .collect()
    }
}
pub(super) fn upsert(tx: &Transaction<'_>, track: &LibraryTrack) -> Result<(), String> {
    let mut track = track.clone();
    track.analysis = None; // Measurements live in their validated, versioned cache.
    let track = &track;
    let rowid: i64 = tx.query_row("INSERT INTO tracks(id,path,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET path=excluded.path,data=excluded.data RETURNING rowid", params![track.id, track.path, serde_json::to_string(track).map_err(error)?], |row| row.get(0)).map_err(error)?;
    tx.execute("DELETE FROM tracks_fts WHERE rowid=?1", [rowid])
        .map_err(error)?;
    tx.execute(
        "INSERT INTO tracks_fts(rowid,id,title,artist,album,genre) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            rowid,
            track.id,
            track.name,
            track.artist,
            track.album,
            track.genre
        ],
    )
    .map_err(error)?;
    Ok(())
}
