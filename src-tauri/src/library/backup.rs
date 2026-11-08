use super::*;

impl NativeLibrary {
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
                mutations::persist_state(&tx, &snapshot)?;
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
        mutations::persist_state(&tx, &state)?;
        catalog::bump_revision(&tx)?;
        tx.commit().map_err(error)?;
        Ok(snapshot)
    }
}
