use super::catalog::{
    bump_revision, revision, ErrorCode, IpcError, LibraryPatch, PatchReceipt, QueueOperation,
};
use super::*;

pub(super) fn migrate(db: &Connection) -> Result<(), String> {
    let version: u32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(error)?;
    if version >= 3 {
        return Ok(());
    }
    db.execute_batch("BEGIN IMMEDIATE;
        CREATE TABLE library_clock(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,catalog_revision INTEGER NOT NULL);
        INSERT INTO library_clock VALUES(1,0,0);
        CREATE TABLE library_queue(id TEXT PRIMARY KEY,track_id TEXT NOT NULL,position REAL NOT NULL);
        CREATE INDEX library_queue_order ON library_queue(position,id);
        CREATE TABLE library_playlists(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE library_session(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
        CREATE TABLE audio_analysis(track_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,source_modified TEXT NOT NULL,data TEXT NOT NULL);
        CREATE INDEX tracks_title ON tracks(json_extract(data,'$.name') COLLATE NOCASE,id);
        CREATE INDEX tracks_artist ON tracks(json_extract(data,'$.artist') COLLATE NOCASE,id);
        CREATE INDEX tracks_album ON tracks(json_extract(data,'$.album') COLLATE NOCASE,id);
        CREATE INDEX tracks_added ON tracks(coalesce(json_extract(data,'$.dateAdded'),0) DESC,id);
        CREATE TRIGGER catalog_insert AFTER INSERT ON tracks BEGIN UPDATE library_clock SET catalog_revision=catalog_revision+1 WHERE id=1; END;
        CREATE TRIGGER catalog_update AFTER UPDATE ON tracks WHEN OLD.data!=NEW.data OR OLD.path!=NEW.path BEGIN UPDATE library_clock SET catalog_revision=catalog_revision+1 WHERE id=1; END;
        CREATE TRIGGER catalog_delete AFTER DELETE ON tracks BEGIN DELETE FROM audio_analysis WHERE track_id=OLD.id; UPDATE library_clock SET catalog_revision=catalog_revision+1 WHERE id=1; END;
    ").map_err(error)?;
    let result = (|| -> Result<(), String> {
        let raw: Option<String> = db
            .query_row("SELECT data FROM state WHERE id=1", [], |row| row.get(0))
            .optional()
            .map_err(error)?;
        if let Some(raw) = raw {
            let state: LibrarySnapshot = serde_json::from_str(&raw).map_err(error)?;
            persist_state(db, &state)?;
        } else {
            db.execute(
                "INSERT INTO library_session(id,data) VALUES(1,?1)",
                [serde_json::to_string(&PlaybackSession::default()).map_err(error)?],
            )
            .map_err(error)?;
        }
        db.execute_batch("PRAGMA user_version=3; COMMIT;")
            .map_err(error)
    })();
    if result.is_err() {
        let _ = db.execute_batch("ROLLBACK;");
    }
    result
}

pub(super) fn read_normalized(
    db: &Connection,
    mut state: LibrarySnapshot,
) -> Result<LibrarySnapshot, String> {
    state.queue = db
        .prepare("SELECT id,track_id FROM library_queue ORDER BY position,id")
        .map_err(error)?
        .query_map([], |row| {
            Ok(QueueEntry {
                id: row.get(0)?,
                track_id: row.get(1)?,
            })
        })
        .map_err(error)?
        .collect::<Result<_, _>>()
        .map_err(error)?;
    state.playlists = db
        .prepare("SELECT data FROM library_playlists ORDER BY rowid")
        .map_err(error)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error)?
        .map(|data| serde_json::from_str(&data.map_err(error)?).map_err(error))
        .collect::<Result<_, _>>()?;
    if let Some(data) = db
        .query_row("SELECT data FROM library_session WHERE id=1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(error)?
    {
        state.session = serde_json::from_str(&data).map_err(error)?;
    }
    Ok(state)
}

/// Compatibility for backup/import/native maintenance; interactive writes use small patches.
pub(super) fn persist_state(db: &Connection, state: &LibrarySnapshot) -> Result<(), String> {
    let old = read_normalized(db, LibrarySnapshot::default())?;
    let mut changed = false;
    if serde_json::to_string(&old.queue).map_err(error)?
        != serde_json::to_string(&state.queue).map_err(error)?
    {
        db.execute("DELETE FROM library_queue", []).map_err(error)?;
        let mut insert = db
            .prepare_cached("INSERT INTO library_queue(id,track_id,position) VALUES(?1,?2,?3)")
            .map_err(error)?;
        for (index, entry) in state.queue.iter().enumerate() {
            insert
                .execute(params![entry.id, entry.track_id, index as f64 * 1024.0])
                .map_err(error)?;
        }
        changed = true;
    }
    if serde_json::to_string(&old.playlists).map_err(error)?
        != serde_json::to_string(&state.playlists).map_err(error)?
    {
        db.execute("DELETE FROM library_playlists", [])
            .map_err(error)?;
        for playlist in &state.playlists {
            db.execute(
                "INSERT INTO library_playlists(id,data) VALUES(?1,?2)",
                params![playlist.id, serde_json::to_string(playlist).map_err(error)?],
            )
            .map_err(error)?;
        }
        changed = true;
    }
    let session = serde_json::to_string(&state.session).map_err(error)?;
    if db.execute("INSERT INTO library_session(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE data!=excluded.data",[session]).map_err(error)?>0{changed=true;}
    let mut configuration = state.clone();
    configuration.tracks.clear();
    configuration.queue.clear();
    configuration.playlists.clear();
    configuration.session = PlaybackSession::default();
    db.execute("INSERT INTO state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE data!=excluded.data",[serde_json::to_string(&configuration).map_err(error)?]).map_err(error)?;
    if changed {
        bump_revision(db)?;
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), IpcError> {
    if id.is_empty() || id.len() > 256 || id.contains('\0') {
        Err(IpcError::invalid("Invalid library identity."))
    } else {
        Ok(())
    }
}
fn position_before(db: &Connection, before: Option<&str>) -> Result<f64, String> {
    let upper: Option<f64> = match before {
        Some(id) => Some(
            db.query_row(
                "SELECT position FROM library_queue WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(error)?,
        ),
        None => None,
    };
    let lower: Option<f64> = match upper {
        Some(value) => db
            .query_row(
                "SELECT max(position) FROM library_queue WHERE position<?1",
                [value],
                |row| row.get(0),
            )
            .map_err(error)?,
        None => db
            .query_row("SELECT max(position) FROM library_queue", [], |row| {
                row.get(0)
            })
            .map_err(error)?,
    };
    if matches!((lower,upper),(Some(low),Some(high)) if high-low<0.000001) {
        rebalance_queue(db)?;
        return position_before(db, before);
    }
    Ok(match (lower, upper) {
        (Some(low), Some(high)) => (low + high) * 0.5,
        (None, Some(high)) => high - 1024.0,
        (Some(low), None) => low + 1024.0,
        (None, None) => 0.0,
    })
}
fn rebalance_queue(db: &Connection) -> Result<(), String> {
    let ids = db
        .prepare("SELECT id FROM library_queue ORDER BY position,id")
        .map_err(error)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    let mut statement = db
        .prepare_cached("UPDATE library_queue SET position=?2 WHERE id=?1")
        .map_err(error)?;
    for (index, id) in ids.iter().enumerate() {
        statement
            .execute(params![id, index as f64 * 1024.0])
            .map_err(error)?;
    }
    Ok(())
}

impl NativeLibrary {
    pub fn apply_patch(&self, patch: LibraryPatch) -> Result<PatchReceipt, IpcError> {
        if patch.tracks.len() > 500
            || patch.queue_operations.len() > 1000
            || patch.upsert_playlists.len() > 100
            || patch.remove_playlists.len() > 100
        {
            return Err(IpcError::invalid("Edit batch is too large."));
        }
        let mut db = self.db.lock();
        let tx = db
            .transaction()
            .map_err(|e| IpcError::internal(e.to_string()))?;
        if revision(&tx)?.0 != patch.base_revision {
            return Err(IpcError::conflict());
        }
        let before = tx.total_changes();
        let queue_changed = patch.replace_queue.is_some() || !patch.queue_operations.is_empty();
        for edit in patch.tracks {
            validate_id(&edit.id)?;
            let data: Option<String> = tx
                .query_row("SELECT data FROM tracks WHERE id=?1", [&edit.id], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(|e| IpcError::internal(e.to_string()))?;
            let mut track: LibraryTrack = serde_json::from_str(&data.ok_or_else(|| IpcError {
                code: ErrorCode::NotFound,
                message: "This track was removed from the library.".into(),
                retryable: true,
            })?)
            .map_err(|e| IpcError::internal(e.to_string()))?;
            if let Some(value) = edit.is_liked {
                track.is_liked = value;
            }
            if let Some(value) = edit.play_count {
                if value > 9_007_199_254_740_991 {
                    return Err(IpcError::invalid("Invalid play count."));
                }
                track.play_count = track.play_count.max(value);
            }
            if let Some(value) = edit.listening_seconds {
                if !value.is_finite() || value < 0.0 {
                    return Err(IpcError::invalid("Invalid listening duration."));
                }
                track.listening_seconds = track.listening_seconds.max(value);
            }
            let data =
                serde_json::to_string(&track).map_err(|e| IpcError::internal(e.to_string()))?;
            tx.execute(
                "UPDATE tracks SET data=?2 WHERE id=?1 AND data!=?2",
                params![edit.id, data],
            )
            .map_err(|e| IpcError::internal(e.to_string()))?;
        }
        if let Some(queue) = patch.replace_queue {
            if queue.len() > MAX_QUEUE_ENTRIES {
                return Err(IpcError::invalid("Queue limit exceeded."));
            }
            let mut ids = HashSet::new();
            tx.execute("DELETE FROM library_queue", [])
                .map_err(|e| IpcError::internal(e.to_string()))?;
            for (index, entry) in queue.into_iter().enumerate() {
                validate_id(&entry.id)?;
                if !ids.insert(entry.id.clone()) {
                    return Err(IpcError::invalid("Duplicate queue identity."));
                }
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM tracks WHERE id=?1)",
                        [&entry.track_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| IpcError::internal(e.to_string()))?;
                if !exists {
                    return Err(IpcError::invalid("The queue references an unknown track."));
                }
                tx.execute(
                    "INSERT INTO library_queue(id,track_id,position) VALUES(?1,?2,?3)",
                    params![entry.id, entry.track_id, index as f64 * 1024.0],
                )
                .map_err(|e| IpcError::internal(e.to_string()))?;
            }
        }
        for operation in patch.queue_operations {
            match operation {
                QueueOperation::Remove { id } => {
                    tx.execute("DELETE FROM library_queue WHERE id=?1", [id])
                        .map_err(|e| IpcError::internal(e.to_string()))?;
                }
                QueueOperation::Insert { entry, after_id } => {
                    validate_id(&entry.id)?;
                    let count: u64 = tx
                        .query_row("SELECT count(*) FROM library_queue", [], |row| row.get(0))
                        .map_err(|e| IpcError::internal(e.to_string()))?;
                    if count >= MAX_QUEUE_ENTRIES as u64 {
                        return Err(IpcError::invalid("Queue limit exceeded."));
                    }
                    let exists: bool = tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM tracks WHERE id=?1)",
                            [&entry.track_id],
                            |row| row.get(0),
                        )
                        .map_err(|e| IpcError::internal(e.to_string()))?;
                    if !exists {
                        return Err(IpcError::invalid("Unknown queued track."));
                    }
                    let before: Option<String> = if let Some(id) = after_id {
                        let position: f64 = tx
                            .query_row(
                                "SELECT position FROM library_queue WHERE id=?1",
                                [id],
                                |row| row.get(0),
                            )
                            .map_err(|_| IpcError::conflict())?;
                        tx.query_row("SELECT id FROM library_queue WHERE position>?1 ORDER BY position,id LIMIT 1",[position],|row|row.get(0)).optional().map_err(|e|IpcError::internal(e.to_string()))?
                    } else {
                        tx.query_row(
                            "SELECT id FROM library_queue ORDER BY position,id LIMIT 1",
                            [],
                            |row| row.get(0),
                        )
                        .optional()
                        .map_err(|e| IpcError::internal(e.to_string()))?
                    };
                    let position = position_before(&tx, before.as_deref())?;
                    tx.execute(
                        "INSERT INTO library_queue(id,track_id,position) VALUES(?1,?2,?3)",
                        params![entry.id, entry.track_id, position],
                    )
                    .map_err(|_| IpcError::invalid("Queue identity already exists."))?;
                }
                QueueOperation::Move { id, before_id } => {
                    if before_id.as_ref() == Some(&id) {
                        continue;
                    }
                    let position = position_before(&tx, before_id.as_deref())?;
                    if tx
                        .execute(
                            "UPDATE library_queue SET position=?2 WHERE id=?1",
                            params![id, position],
                        )
                        .map_err(|e| IpcError::internal(e.to_string()))?
                        == 0
                    {
                        return Err(IpcError::conflict());
                    }
                }
            }
        }
        if queue_changed && patch.session.is_none() {
            let data: String = tx
                .query_row("SELECT data FROM library_session WHERE id=1", [], |row| {
                    row.get(0)
                })
                .map_err(|e| IpcError::internal(e.to_string()))?;
            let mut session: PlaybackSession =
                serde_json::from_str(&data).map_err(|e| IpcError::internal(e.to_string()))?;
            if let Some(id) = &session.current_queue_id {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_queue WHERE id=?1)",
                        [id],
                        |row| row.get(0),
                    )
                    .map_err(|e| IpcError::internal(e.to_string()))?;
                if !exists {
                    session.current_queue_id = None;
                    session.position = 0.0;
                    tx.execute(
                        "UPDATE library_session SET data=?1 WHERE id=1",
                        [serde_json::to_string(&session)
                            .map_err(|e| IpcError::internal(e.to_string()))?],
                    )
                    .map_err(|e| IpcError::internal(e.to_string()))?;
                }
            }
        }
        for id in patch.remove_playlists {
            tx.execute("DELETE FROM library_playlists WHERE id=?1", [id])
                .map_err(|e| IpcError::internal(e.to_string()))?;
        }
        for playlist in patch.upsert_playlists {
            validate_id(&playlist.id)?;
            if playlist.name.trim().is_empty()
                || playlist.name.len() > 256
                || playlist.track_ids.len() > MAX_PLAYLIST_TRACKS
            {
                return Err(IpcError::invalid("Invalid playlist."));
            }
            if let Some(rule) = &playlist.smart_rule {
                super::validation::validate_rule(rule).map_err(IpcError::invalid)?;
            }
            let missing:u64=tx.query_row("SELECT count(*) FROM json_each(?1) r LEFT JOIN tracks t ON t.id=r.value WHERE t.id IS NULL",[serde_json::to_string(&playlist.track_ids).map_err(|e|IpcError::internal(e.to_string()))?],|row|row.get(0)).map_err(|e|IpcError::internal(e.to_string()))?;
            if missing > 0 {
                return Err(IpcError::invalid("Playlist references an unknown track."));
            }
            tx.execute("INSERT INTO library_playlists(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE data!=excluded.data",params![playlist.id,serde_json::to_string(&playlist).map_err(|e|IpcError::internal(e.to_string()))?]).map_err(|e|IpcError::internal(e.to_string()))?;
        }
        let playlist_count: u64 = tx
            .query_row("SELECT count(*) FROM library_playlists", [], |row| {
                row.get(0)
            })
            .map_err(|e| IpcError::internal(e.to_string()))?;
        if playlist_count > MAX_PLAYLISTS as u64 {
            return Err(IpcError::invalid("Playlist limit exceeded."));
        }
        if let Some(mut session) = patch.session {
            if !session.position.is_finite()
                || session.position < 0.0
                || session.position > 7.0 * 86400.0
                || !["SEQUENCE", "LOOP", "SHUFFLE"].contains(&session.playback_mode.as_str())
            {
                return Err(IpcError::invalid("Invalid playback session."));
            }
            if let Some(id) = &session.current_queue_id {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM library_queue WHERE id=?1)",
                        [id],
                        |row| row.get(0),
                    )
                    .map_err(|e| IpcError::internal(e.to_string()))?;
                if !exists {
                    session.current_queue_id = None;
                    session.position = 0.0;
                }
            }
            tx.execute("INSERT INTO library_session(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE data!=excluded.data",[serde_json::to_string(&session).map_err(|e|IpcError::internal(e.to_string()))?]).map_err(|e|IpcError::internal(e.to_string()))?;
        }
        if tx.total_changes() > before {
            bump_revision(&tx)?;
        }
        let (revision, catalog_revision) = revision(&tx)?;
        tx.commit().map_err(|e| IpcError::internal(e.to_string()))?;
        Ok(PatchReceipt {
            revision,
            catalog_revision,
        })
    }
}

#[tauri::command]
#[specta::specta]
pub async fn library_patch(app: AppHandle, patch: LibraryPatch) -> Result<PatchReceipt, IpcError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().apply_patch(patch))
        .await
        .map_err(|e| IpcError::internal(e.to_string()))?
}
