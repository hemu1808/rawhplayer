use super::*;

impl NativeLibrary {
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
        self.import_scopes(paths, progress)
    }

    fn import_scopes(
        &self,
        paths: Vec<String>,
        progress: impl Fn(ScanProgress),
    ) -> Result<Vec<LibraryTrack>, String> {
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        for path in paths {
            let root = self.authorize_path(&path)?;
            self.collect_files(&root, &root, 0, &mut seen, &mut files)?;
        }
        let existing = {
            let db = self.read_connection()?;
            let mut query = db.prepare("SELECT data FROM tracks").map_err(error)?;
            let rows = query
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(error)?;
            rows.map(|row| serde_json::from_str(&row.map_err(error)?).map_err(error))
                .collect::<Result<Vec<_>, _>>()?
        };
        let total = existing.len();
        self.import_files(files, existing, total, progress)
    }

    fn import_files(
        &self,
        files: Vec<PathBuf>,
        existing: Vec<LibraryTrack>,
        track_count: usize,
        progress: impl Fn(ScanProgress),
    ) -> Result<Vec<LibraryTrack>, String> {
        let mut budget =
            ImportBudget::new(existing.iter().map(|track| track.id.clone()), MAX_TRACKS);
        budget.total = track_count;
        let by_path: HashMap<_, _> = existing
            .into_iter()
            .map(|track| (path_key(&track.path), track))
            .collect();
        let mut relocated = HashSet::new();
        let mut imported = Vec::new();
        let total = files.len();
        let mut skipped = 0;
        for (index, path) in files.into_iter().enumerate() {
            if self.cancel_scan.load(Ordering::Relaxed) {
                break;
            }
            match self.read_track(&path) {
                Ok(mut track) => {
                    let previous = match by_path.get(&path_key(&track.path)) {
                        Some(previous) => Some(previous.clone()),
                        None if track_count > 0 => {
                            self.find_relocated_track(&track, &mut relocated)?
                        }
                        None => None,
                    };
                    if let Some(previous) = previous {
                        track.id = previous.id;
                        budget.ids.insert(track.id.clone());
                        track.is_liked = previous.is_liked;
                        track.play_count = previous.play_count;
                        track.listening_seconds = previous.listening_seconds;
                        track.date_added = previous.date_added;
                    }
                    budget.admit(&track.id)?;
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
        // Capacity is checked for the complete batch before inserting any rows.
        // Bound transactions so UI preference writes can interleave with large imports.
        for batch in imported.chunks_mut(100) {
            let mut db = self.db.lock();
            let tx = db.transaction().map_err(error)?;
            for track in batch {
                // Scans may take minutes. Preserve preferences changed while
                // metadata was being read, under the same lock as the write.
                if let Some(value) = tx
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
                upsert(&tx, track)?;
            }
            tx.commit().map_err(error)?;
        }
        progress(ScanProgress {
            processed: imported.len() + skipped,
            total,
            skipped,
            cancelled: self.cancel_scan.load(Ordering::Relaxed),
        });
        Ok(imported)
    }

    fn find_relocated_track(
        &self,
        track: &LibraryTrack,
        relocated: &mut HashSet<String>,
    ) -> Result<Option<LibraryTrack>, String> {
        let Some(fingerprint) = &track.fingerprint else {
            return Ok(None);
        };
        let candidates = {
            let db = self.db.lock();
            let mut query = db
                .prepare_cached(
                    "SELECT data FROM tracks WHERE json_extract(data,'$.fingerprint')=?1",
                )
                .map_err(error)?;
            let rows = query
                .query_map([fingerprint], |row| row.get::<_, String>(0))
                .map_err(error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(error)?
        };
        let mut found = None;
        for data in candidates {
            let candidate: LibraryTrack = serde_json::from_str(&data).map_err(error)?;
            if Path::new(&candidate.path).is_file() {
                continue;
            }
            if found.is_some() {
                return Ok(None);
            }
            found = Some(candidate);
        }
        Ok(found.filter(|candidate| relocated.insert(candidate.id.clone())))
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
        if depth > 32 {
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
                if files.len() >= MAX_TRACKS {
                    return Err("Library scan limit reached. Import a smaller folder.".into());
                }
                files.push(canonical);
            }
        } else if canonical.is_dir() {
            for entry in fs::read_dir(&canonical).map_err(error)?.flatten() {
                self.collect_files(root, &entry.path(), depth + 1, seen, files)?;
            }
        }
        Ok(())
    }

    pub(super) fn read_track(&self, path: &Path) -> Result<LibraryTrack, String> {
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
            source_modified: fs::metadata(path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|time| time.as_nanos().to_string()),
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
        self.reconcile_watched(progress)?;
        self.load()
    }

    pub(crate) fn reconcile_watched(&self, progress: impl Fn(ScanProgress)) -> Result<(), String> {
        let _scan = self
            .scan_lock
            .try_lock()
            .ok_or("Another library scan is running.")?;
        self.cancel_scan.store(false, Ordering::Relaxed);
        let roots: Vec<String> = self
            .watched_folders()?
            .iter()
            .filter(|path| Path::new(path).is_dir())
            .cloned()
            .collect();
        if !roots.is_empty() {
            self.import_scopes(roots, progress)?;
        }
        let paths = {
            let db = self.read_connection()?;
            let mut statement = db.prepare("SELECT id,path FROM tracks").map_err(error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(error)?
        };
        self.refresh_availability(paths)
    }

    pub(crate) fn reconcile_paths(
        &self,
        paths: &HashSet<PathBuf>,
        progress: impl Fn(ScanProgress),
    ) -> Result<(), String> {
        let _scan = self
            .scan_lock
            .try_lock()
            .ok_or("Another library scan is running.")?;
        self.cancel_scan.store(false, Ordering::Relaxed);
        let roots: Vec<_> = self
            .watched_folders()?
            .iter()
            .map(|path| path_key(path))
            .collect();
        let in_scope = |path: &Path| {
            let key = path_key(&path_string(path));
            roots.iter().any(|root| Path::new(&key).starts_with(root))
        };
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        let mut affected = HashMap::new();
        let db = self.read_connection()?;
        for path in paths.iter().filter(|path| in_scope(path)) {
            if let Ok(canonical) = self.authorize_path(&path_string(path)) {
                if in_scope(&canonical) {
                    self.collect_files(&canonical, &canonical, 0, &mut seen, &mut files)?;
                }
            }
            for track in Self::tracks_under(&db, path)? {
                affected.insert(track.id.clone(), track);
            }
        }
        let availability = affected
            .values()
            .map(|track| (track.id.clone(), track.path.clone()))
            .collect();
        if !files.is_empty() {
            let track_count = self
                .db
                .lock()
                .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
                .map_err(error)?;
            self.import_files(
                files,
                affected.into_values().collect(),
                track_count,
                progress,
            )?;
        }
        self.refresh_availability(availability)
    }

    fn tracks_under(db: &Connection, path: &Path) -> Result<Vec<LibraryTrack>, String> {
        use std::path::MAIN_SEPARATOR;
        let mut paths = vec![path_string(path)];
        #[cfg(windows)]
        {
            let key = path_key(&paths[0]);
            let canonical = if let Some(network) = key.strip_prefix(r"\\") {
                format!(r"\\?\UNC\{network}")
            } else {
                format!(r"\\?\{key}")
            };
            paths.extend([key, canonical]);
        }
        paths.sort_unstable();
        paths.dedup();
        let collate = if cfg!(windows) { " COLLATE NOCASE" } else { "" };
        let mut query = db.prepare_cached(&format!(
            "SELECT data FROM tracks WHERE path{collate}=?1 OR (path{collate}>=?2 AND path{collate}<?3)"
        )).map_err(error)?;
        let mut tracks = Vec::new();
        for path in paths {
            let base = path.trim_end_matches(MAIN_SEPARATOR);
            let lower = format!("{base}{MAIN_SEPARATOR}");
            let upper = format!(
                "{base}{}",
                char::from_u32(MAIN_SEPARATOR as u32 + 1).unwrap()
            );
            let rows = query
                .query_map(params![path, lower, upper], |row| row.get::<_, String>(0))
                .map_err(error)?;
            for data in rows {
                tracks.push(serde_json::from_str(&data.map_err(error)?).map_err(error)?);
            }
        }
        Ok(tracks)
    }

    fn refresh_availability(&self, paths: Vec<(String, String)>) -> Result<(), String> {
        for batch in paths.chunks(100) {
            if self.cancel_scan.load(Ordering::Relaxed) {
                break;
            }
            // Drive and permission checks can block. Keep them outside SQLite.
            let availability = batch
                .iter()
                .map(|(id, path)| {
                    let missing = self
                        .authorize_path(path)
                        .map(|path| !path.is_file())
                        .unwrap_or(true);
                    (id, path, if missing { "true" } else { "false" })
                })
                .collect::<Vec<_>>();
            let mut db = self.db.lock();
            let tx = db.transaction().map_err(error)?;
            {
                let mut update = tx.prepare_cached("UPDATE tracks SET data=json_set(data,'$.missing',json(?3)) WHERE id=?1 AND path=?2 AND coalesce(json_extract(data,'$.missing'),0)!=json_extract(?3,'$')").map_err(error)?;
                for (id, path, missing) in availability {
                    update.execute(params![id, path, missing]).map_err(error)?;
                }
            }
            tx.commit().map_err(error)?;
        }
        Ok(())
    }

    pub fn cancel(&self) {
        self.cancel_scan.store(true, Ordering::Relaxed);
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
        Self::load_configuration(&self.db.lock()).map(|state| state.watched_folders)
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
                if snapshot.watched_folders.len() >= MAX_WATCHED_FOLDERS {
                    return Err(format!(
                        "At most {MAX_WATCHED_FOLDERS} watched folders are supported."
                    ));
                }
                snapshot.watched_folders.push(path);
            }
        } else if let Some(path) = remove {
            snapshot.watched_folders.retain(|folder| folder != path);
        } else {
            snapshot.watched_folders.clear();
        }
        mutations::persist_state(&db, &snapshot)?;
        Ok(())
    }
}
