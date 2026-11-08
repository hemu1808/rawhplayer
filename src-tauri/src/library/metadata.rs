use super::*;

impl NativeLibrary {
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

    pub(super) fn recover_pending_edits(&self) -> Result<(), String> {
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
}
