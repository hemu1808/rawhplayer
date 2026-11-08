use super::*;

#[test]
fn import_budget_counts_only_new_identities_and_never_exceeds_capacity() {
    let mut budget = ImportBudget::new(["existing".to_owned()], 2);
    budget.admit("existing").unwrap();
    budget.admit("second").unwrap();
    budget.admit("second").unwrap();
    assert!(budget.admit("third").unwrap_err().contains("No new files"));
    assert_eq!(budget.ids.len(), 2);
}

#[test]
fn version_one_migration_preserves_library_and_rebuilds_index_with_a_rollback_copy() {
    let fixture = Fixture::new();
    let path = path_string(&fixture.wav("migrated.wav"));
    let library = fixture.library();
    library
        .authorize_paths(std::slice::from_ref(&path))
        .unwrap();
    let imported = library.import_paths(vec![path.clone()]).unwrap();
    let id = imported[0].id.clone();
    let mut snapshot = library.load().unwrap();
    snapshot.tracks[0].is_liked = true;
    library.save(snapshot).unwrap();
    {
        let db = library.db.lock();
        db.execute(
            "UPDATE state SET data=?1 WHERE id=1",
            [serde_json::to_string(&library.load_state(&db).unwrap()).unwrap()],
        )
        .unwrap();
        db.execute_batch("DROP TRIGGER catalog_insert; DROP TRIGGER catalog_update; DROP TRIGGER catalog_delete; DROP TABLE library_clock; DROP TABLE library_queue; DROP TABLE library_playlists; DROP TABLE library_session; DROP TABLE audio_analysis; DROP INDEX tracks_title; DROP INDEX tracks_artist; DROP INDEX tracks_album; DROP INDEX tracks_added; DELETE FROM tracks_fts; INSERT INTO tracks_fts(rowid,id,title,artist,album,genre) SELECT 999,id,json_extract(data,'$.name'),json_extract(data,'$.artist'),'','' FROM tracks; PRAGMA user_version=1;").unwrap();
    }
    drop(library);
    let reopened = fixture.library();
    assert!(reopened.authorize_path(&path).is_ok());
    assert!(reopened.load().unwrap().tracks[0].is_liked);
    assert_eq!(reopened.search("migrated", 10).unwrap()[0].id, id);
    let db = reopened.db.lock();
    let aligned: bool = db
        .query_row(
            "SELECT t.rowid=f.rowid FROM tracks t JOIN tracks_fts f ON t.id=f.id",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(aligned);
    let version: u32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 3);
    drop(db);
    let backup = fs::read_dir(fixture.directory.join("data"))
        .unwrap()
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("library-v1-backup-")
        })
        .expect("rollback backup");
    let backup_db = Connection::open(backup.path()).unwrap();
    assert_eq!(
        backup_db
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        backup_db
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    drop(backup_db);
    assert_eq!(reopened.import_paths(vec![path]).unwrap().len(), 1);
    assert_eq!(reopened.search("migrated", 10).unwrap().len(), 1);
    reopened.remove_track(&id).unwrap();
    assert!(reopened.search("migrated", 10).unwrap().is_empty());
}

#[test]
#[ignore = "explicit synthetic scale benchmark; run npm run benchmark:library"]
fn library_scale_benchmark() {
    for count in [10_000, 100_000] {
        let fixture = Fixture::new();
        let library = fixture.library();
        let start = std::time::Instant::now();
        {
            let mut db = library.db.lock();
            let tx = db.transaction().unwrap();
            for index in 0..count {
                upsert(
                    &tx,
                    &LibraryTrack {
                        id: format!("scale-{index}"),
                        path: path_string(&fixture.directory.join(format!("track-{index}.wav"))),
                        name: format!("Benchmark Track {index}"),
                        artist: "Benchmark Artist".into(),
                        missing: true,
                        ..Default::default()
                    },
                )
                .unwrap();
            }
            tx.commit().unwrap();
        }
        let insert_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        let mut snapshot = library.load().unwrap();
        let load_ms = start.elapsed().as_millis();
        let changes = || {
            library
                .db
                .lock()
                .query_row("SELECT total_changes()", [], |row| row.get::<_, u64>(0))
                .unwrap()
        };
        snapshot.tracks[0].is_liked = true;
        let before = changes();
        let start = std::time::Instant::now();
        library.save(snapshot.clone()).unwrap();
        let favorite_ms = start.elapsed().as_millis();
        let favorite_writes = changes() - before;
        let before = changes();
        let start = std::time::Instant::now();
        library.save(snapshot).unwrap();
        let no_op_ms = start.elapsed().as_millis();
        let no_op_writes = changes() - before;
        let start = std::time::Instant::now();
        assert_eq!(library.search("Benchmark", 10).unwrap().len(), 10);
        let search_ms = start.elapsed().as_millis();
        assert_eq!(no_op_writes, 0);
        assert!(
            favorite_writes <= 4,
            "Legacy save may also create the initial configuration row"
        );
        let start = std::time::Instant::now();
        let header = library.bootstrap().unwrap();
        let bootstrap_ms = start.elapsed().as_millis();
        let bootstrap_bytes = serde_json::to_vec(&header).unwrap().len();
        let start = std::time::Instant::now();
        let page = library
            .page(catalog::CatalogQuery {
                offset: count - 100,
                limit: Some(100),
                sort: Some(catalog::CatalogSort::Title),
                ..Default::default()
            })
            .unwrap();
        let page_ms = start.elapsed().as_millis();
        assert_eq!(page.tracks.len(), 100);
        let patch = catalog::LibraryPatch {
            base_revision: header.revision,
            tracks: vec![catalog::UserTrackPatch {
                id: "scale-0".into(),
                is_liked: Some(false),
                ..Default::default()
            }],
            ..Default::default()
        };
        let patch_bytes = serde_json::to_vec(&patch).unwrap().len();
        let before = changes();
        let start = std::time::Instant::now();
        library.apply_patch(patch).unwrap();
        let patch_us = start.elapsed().as_micros();
        let patch_writes = changes() - before;
        assert_eq!(patch_writes, 3);
        assert!(patch_bytes < 500);
        assert!(header.initial_tracks.len() <= 100);
        println!(
            "{}",
            serde_json::json!({"tracks":count,"insertMs":insert_ms,"loadMs":load_ms,"favoriteSaveMs":favorite_ms,"favoriteRowWrites":favorite_writes,"unchangedSaveMs":no_op_ms,"unchangedRowWrites":no_op_writes,"searchMs":search_ms,"bootstrapMs":bootstrap_ms,"bootstrapBytes":bootstrap_bytes,"lastPageMs":page_ms,"favoritePatchMicros":patch_us,"favoritePatchBytes":patch_bytes,"favoritePatchWrites":patch_writes})
        );
    }
}

#[test]
fn unchanged_saves_do_not_rewrite_tracks_or_full_text_indexes() {
    let fixture = Fixture::new();
    let path = path_string(&fixture.wav("preferences.wav"));
    let library = fixture.library();
    library
        .authorize_paths(std::slice::from_ref(&path))
        .unwrap();
    library.import_paths(vec![path]).unwrap();
    let mut snapshot = library.load().unwrap();
    library.save(snapshot.clone()).unwrap();
    let changes = || {
        library
            .db
            .lock()
            .query_row("SELECT total_changes()", [], |row| row.get::<_, u64>(0))
            .unwrap()
    };
    let before = changes();
    library.save(snapshot.clone()).unwrap();
    assert_eq!(
        changes(),
        before,
        "unchanged save must perform zero row writes"
    );
    snapshot.tracks[0].is_liked = true;
    library.save(snapshot).unwrap();
    assert_eq!(
        changes(),
        before + 3,
        "favorite updates one track and two revision counters, without FTS records"
    );
    assert_eq!(library.search("preferences", 10).unwrap().len(), 1);
    assert!(library.load().unwrap().tracks[0].is_liked);
}

#[test]
fn committed_edits_survive_forced_process_termination() {
    let fixture = Fixture::new();
    fixture.wav("child.wav");
    let ready = fixture.directory.join("ready");
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "library::tests::persistence_child", "--ignored"])
        .env("RAWH_PERSISTENCE_TEST_DIRECTORY", &fixture.directory)
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !ready.exists() && std::time::Instant::now() < deadline {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("Persistence child stopped early: {status}");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if !ready.exists() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("Persistence child did not commit in time");
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let snapshot = fixture.library().load().unwrap();
    assert!(snapshot.tracks[0].is_liked);
    assert_eq!(snapshot.playlists[0].name, "Durable playlist");
    assert_eq!(snapshot.session.position, 12.0);
}

#[test]
#[ignore = "subprocess helper; invoked only by the forced-termination test"]
fn persistence_child() {
    let directory =
        PathBuf::from(std::env::var_os("RAWH_PERSISTENCE_TEST_DIRECTORY").expect("test directory"));
    let path = path_string(&directory.join("child.wav"));
    let library = NativeLibrary::open(directory.join("data")).unwrap();
    library
        .authorize_paths(std::slice::from_ref(&path))
        .unwrap();
    library.import_paths(vec![path]).unwrap();
    let mut snapshot = library.load().unwrap();
    snapshot.tracks[0].is_liked = true;
    snapshot.queue.push(QueueEntry {
        id: "child-queue".into(),
        track_id: snapshot.tracks[0].id.clone(),
    });
    snapshot.session.current_queue_id = Some("child-queue".into());
    snapshot.session.position = 12.0;
    snapshot.playlists.push(Playlist {
        id: "child-playlist".into(),
        name: "Durable playlist".into(),
        track_ids: vec![snapshot.tracks[0].id.clone()],
        smart_rule: None,
        created_at: 0,
    });
    library.save(snapshot).unwrap();
    fs::write(directory.join("ready"), b"committed").unwrap();
    std::thread::sleep(Duration::from_secs(60));
}

#[test]
fn real_filesystem_rename_event_reconciles_the_watched_library() {
    use notify::Watcher;
    let fixture = Fixture::new();
    let music = fixture.directory.join("music");
    fs::create_dir(&music).unwrap();
    let original = music.join("original.wav");
    fs::rename(fixture.wav("source.wav"), &original).unwrap();
    let library = fixture.library();
    let folder = path_string(&music);
    library
        .authorize_paths(std::slice::from_ref(&folder))
        .unwrap();
    library.add_watched_folder(&folder).unwrap();
    let id = library.reconcile(|_| {}).unwrap().tracks[0].id.clone();
    let (send, receive) = std::sync::mpsc::channel();
    let mut watcher = notify::RecommendedWatcher::new(
        move |event| {
            let _ = send.send(event);
        },
        notify::Config::default(),
    )
    .unwrap();
    watcher
        .watch(&music, notify::RecursiveMode::Recursive)
        .unwrap();
    let renamed = music.join("renamed.wav");
    fs::rename(&original, &renamed).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut observed = false;
    while std::time::Instant::now() < deadline {
        if let Ok(Ok(event)) = receive.recv_timeout(Duration::from_millis(100)) {
            if event
                .paths
                .iter()
                .any(|path| path == &original || path == &renamed)
            {
                observed = true;
                break;
            }
        }
    }
    assert!(observed, "the OS must deliver a file-change event");
    let snapshot = library.reconcile(|_| {}).unwrap();
    assert_eq!(snapshot.tracks[0].id, id);
    assert_eq!(
        snapshot.tracks[0].path,
        path_string(&fs::canonicalize(renamed).unwrap())
    );
    assert!(!snapshot.tracks[0].missing);
}
pub(super) struct Fixture {
    directory: PathBuf,
}
impl Fixture {
    pub(super) fn new() -> Self {
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
    pub(super) fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.directory.join("data")).unwrap()
    }
    pub(super) fn wav(&self, name: &str) -> PathBuf {
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
