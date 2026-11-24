use super::tests::Fixture;
use super::*;
use catalog::{CatalogQuery, CatalogSort, LibraryPatch, QueueOperation, UserTrackPatch};

fn seed(library: &NativeLibrary, count: usize) {
    let mut db = library.db.lock();
    let tx = db.transaction().unwrap();
    for index in 0..count {
        let track = LibraryTrack {
            id: format!("id{index:06}"),
            path: path_string(&std::env::temp_dir().join(format!("rawh-catalog-{index}.wav"))),
            name: format!("Track {index:06}"),
            artist: if index % 2 == 0 { "Even" } else { "Odd" }.into(),
            date_added: Some(index as u64),
            ..Default::default()
        };
        upsert(&tx, &track).unwrap();
    }
    tx.commit().unwrap();
}
#[test]
fn catalog_pages_search_groups_and_bootstrap_are_bounded() {
    let fixture = Fixture::new();
    let library = fixture.library();
    seed(&library, 1201);
    let header = library.bootstrap().unwrap();
    assert_eq!(header.track_count, 1201);
    assert!(header.state.tracks.is_empty());
    assert_eq!(header.initial_tracks.len(), 100);
    let page = library
        .page(CatalogQuery {
            offset: 100,
            limit: Some(100),
            sort: Some(CatalogSort::Title),
            artist: Some("Even".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.total, 601);
    assert_eq!(page.tracks.len(), 100);
    assert_eq!(page.tracks[0].id, "id000200");
    let search = library
        .page(CatalogQuery {
            search: Some("Track 000200".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(search.total, 1);
    for query in [
        "\" OR *",
        "NEAR(Track) {artist}",
        "Track' UNION SELECT 1 --",
    ] {
        let _ = library
            .page(CatalogQuery {
                search: Some(query.into()),
                ..Default::default()
            })
            .unwrap();
    }
    assert_eq!(
        library
            .page(CatalogQuery {
                limit: Some(999999),
                ..Default::default()
            })
            .unwrap()
            .tracks
            .len(),
        500
    );
    assert_eq!(library.groups("artist".into(), 0).unwrap().len(), 2);
    assert!(library
        .groups("data);DROP TABLE tracks;--".into(), 0)
        .is_err());
    assert_eq!(library.track_ids(None).unwrap().len(), 1201);
}
#[test]
fn patches_are_atomic_revisioned_and_keep_native_metadata() {
    let fixture = Fixture::new();
    let library = fixture.library();
    seed(&library, 2);
    let base = library.bootstrap().unwrap().revision;
    let patch = LibraryPatch {
        base_revision: base,
        tracks: vec![UserTrackPatch {
            id: "id000000".into(),
            is_liked: Some(true),
            ..Default::default()
        }],
        ..Default::default()
    };
    let receipt = library.apply_patch(patch.clone()).unwrap();
    assert_eq!(receipt.revision, base + 1);
    assert!(matches!(
        library.apply_patch(patch).unwrap_err().code,
        catalog::ErrorCode::Conflict
    ));
    let invalid = LibraryPatch {
        base_revision: receipt.revision,
        tracks: vec![UserTrackPatch {
            id: "id000001".into(),
            is_liked: Some(true),
            ..Default::default()
        }],
        queue_operations: vec![QueueOperation::Insert {
            entry: QueueEntry {
                id: "bad".into(),
                track_id: "unknown".into(),
            },
            after_id: None,
        }],
        ..Default::default()
    };
    assert!(library.apply_patch(invalid).is_err());
    assert!(!library.track("id000001").unwrap().is_liked);
    assert_eq!(library.bootstrap().unwrap().revision, receipt.revision);
    assert!(serde_json::from_value::<UserTrackPatch>(
        serde_json::json!({"id":"id000000","path":"C:/ungranted.wav"})
    )
    .is_err());
    assert_eq!(library.track("id000000").unwrap().name, "Track 000000");
}
#[test]
fn queue_operations_preserve_order_and_session_invariants() {
    let fixture = Fixture::new();
    let library = fixture.library();
    seed(&library, 2);
    let queue = vec![
        QueueEntry {
            id: "a".into(),
            track_id: "id000000".into(),
        },
        QueueEntry {
            id: "b".into(),
            track_id: "id000000".into(),
        },
    ];
    let receipt = library
        .apply_patch(LibraryPatch {
            replace_queue: Some(queue),
            session: Some(PlaybackSession {
                current_queue_id: Some("a".into()),
                ..Default::default()
            }),
            ..Default::default()
        })
        .unwrap();
    let mut operations = Vec::new();
    for index in 0..100 {
        operations.push(QueueOperation::Insert {
            entry: QueueEntry {
                id: format!("insert{index:03}"),
                track_id: "id000001".into(),
            },
            after_id: Some("a".into()),
        });
    }
    let receipt = library
        .apply_patch(LibraryPatch {
            base_revision: receipt.revision,
            queue_operations: operations,
            ..Default::default()
        })
        .unwrap();
    let queue = library.load().unwrap().queue;
    assert_eq!(queue[1].id, "insert099");
    assert_eq!(queue[100].id, "insert000");
    assert_eq!(queue[101].id, "b");
    library
        .apply_patch(LibraryPatch {
            base_revision: receipt.revision,
            queue_operations: vec![QueueOperation::Remove { id: "a".into() }],
            ..Default::default()
        })
        .unwrap();
    assert!(library.load().unwrap().session.current_queue_id.is_none());
}
#[test]
fn manual_playlist_play_order_and_duplicates_are_preserved() {
    let fixture = Fixture::new();
    let library = fixture.library();
    seed(&library, 3);
    let ids = vec![
        "id000002".to_owned(),
        "id000000".to_owned(),
        "id000002".to_owned(),
    ];
    library
        .apply_patch(LibraryPatch {
            upsert_playlists: vec![Playlist {
                id: "p".into(),
                name: "Ordered".into(),
                track_ids: ids.clone(),
                created_at: 0,
                smart_rule: None,
            }],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(library.track_ids(Some("p".into())).unwrap(), ids);
}
#[test]
fn local_analysis_cache_invalidates_on_rescan_and_cancellation_keeps_no_result() {
    let fixture = Fixture::new();
    let path = fixture.wav("analysis.wav");
    let library = fixture.library();
    library.authorize_paths(&[path_string(&path)]).unwrap();
    let track = library
        .import_paths(vec![path_string(&path)])
        .unwrap()
        .remove(0);
    let cancel = AtomicBool::new(false);
    assert!(!library
        .analyze_track(&track.id, false, &cancel, |_| {})
        .unwrap());
    assert!(library
        .analyze_track(&track.id, false, &cancel, |_| {})
        .unwrap());
    let analysis = library.track(&track.id).unwrap().analysis.unwrap();
    assert!(analysis.complete);
    assert!((analysis.analyzed_seconds - 0.1).abs() < 1e-5);
    assert_eq!(analysis.content_hash.len(), 64);
    assert!(analysis.energy > 0.1);
    let mut bytes = fs::read(&path).unwrap();
    bytes[50] ^= 17;
    fs::write(&path, bytes).unwrap();
    library.import_paths(vec![path_string(&path)]).unwrap();
    assert!(library.track(&track.id).unwrap().analysis.is_none());
    cancel.store(true, Ordering::Relaxed);
    assert!(library
        .analyze_track(&track.id, true, &cancel, |_| {})
        .is_err());
    assert!(library.track(&track.id).unwrap().analysis.is_none());
}
#[test]
fn tempo_and_key_reject_silence_and_identify_synthetic_patterns() {
    assert!(analysis::tempo(&[0.0; 500], 100.0).0.is_none());
    assert!(analysis::key(&[0.0; 12]).0.is_none());
    let mut onset = vec![0.0; 3000];
    for index in (0..3000).step_by(50) {
        onset[index] = 1.0;
    }
    let (bpm, confidence) = analysis::tempo(&onset, 100.0);
    assert!((bpm.unwrap() - 120.0).abs() < 0.01);
    assert!(confidence > 0.9);
    let profile = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ];
    assert_eq!(analysis::key(&profile).0.as_deref(), Some("C major"));
}

#[test]
fn integrated_loudness_and_true_peak_match_a_calibrated_tone() {
    let fixture = Fixture::new();
    let path = fixture.wav("calibration.wav");
    let mut data = fs::read(&path).unwrap();
    data.truncate(44);
    let frames = 44100 * 3;
    for index in 0..frames {
        let sample =
            (3276.8 * (std::f64::consts::TAU * 1000.0 * index as f64 / 44100.0).sin()) as i16;
        data.extend(sample.to_le_bytes());
    }
    let riff_size = (data.len() - 8) as u32;
    data[4..8].copy_from_slice(&riff_size.to_le_bytes());
    data[40..44].copy_from_slice(&((frames * 2) as u32).to_le_bytes());
    fs::write(&path, data).unwrap();
    let result = analysis::analyze(&path, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(
        (result.integrated_lufs.unwrap() + 23.0).abs() < 0.4,
        "A mono 1 kHz, -20 dBFS sine measures approximately -23 LUFS"
    );
    assert!((result.true_peak_db.unwrap() + 20.0).abs() < 0.1);
    assert!((result.energy - 0.1 / 2.0_f64.sqrt()).abs() < 0.001);
}

#[test]
fn version_two_upgrade_normalizes_legacy_state_and_keeps_recovery_copy() {
    let fixture = Fixture::new();
    let library = fixture.library();
    seed(&library, 2);
    let mut snapshot = library.load().unwrap();
    snapshot.queue = vec![QueueEntry {
        id: "selected".into(),
        track_id: "id000001".into(),
    }];
    snapshot.session = PlaybackSession {
        current_queue_id: Some("selected".into()),
        position: 12.5,
        ..Default::default()
    };
    snapshot.playlists = vec![Playlist {
        id: "legacy".into(),
        name: "Legacy list".into(),
        track_ids: vec!["id000001".into(), "id000000".into()],
        smart_rule: None,
        created_at: 123,
    }];
    snapshot.tracks[0].is_liked = true;
    library.save(snapshot.clone()).unwrap();
    let data_dir = library.data_dir.clone();
    {
        let db = library.db.lock();
        let mut legacy = snapshot.clone();
        legacy.tracks.clear();
        db.execute(
            "UPDATE state SET data=?1 WHERE id=1",
            [serde_json::to_string(&legacy).unwrap()],
        )
        .unwrap();
        db.execute_batch("DROP TRIGGER catalog_insert; DROP TRIGGER catalog_update; DROP TRIGGER catalog_delete; DROP TABLE library_clock; DROP TABLE library_queue; DROP TABLE library_playlists; DROP TABLE library_session; DROP TABLE audio_analysis; DROP INDEX tracks_title; DROP INDEX tracks_artist; DROP INDEX tracks_album; DROP INDEX tracks_added; PRAGMA user_version=2;").unwrap();
    }
    drop(library);
    let reopened = NativeLibrary::open(data_dir.clone()).unwrap();
    let result = reopened.load().unwrap();
    assert_eq!(result.session.position, 12.5);
    assert_eq!(result.queue[0].id, "selected");
    assert_eq!(
        result.playlists[0].track_ids,
        snapshot.playlists[0].track_ids
    );
    assert!(result.tracks[0].is_liked);
    let backup = fs::read_dir(data_dir)
        .unwrap()
        .flatten()
        .find(|file| {
            file.file_name()
                .to_string_lossy()
                .starts_with("library-v2-backup-")
        })
        .unwrap();
    let backup = Connection::open(backup.path()).unwrap();
    assert_eq!(
        backup
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        backup
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
}
