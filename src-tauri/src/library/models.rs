use serde::de::{IgnoredAny, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::marker::PhantomData;

use crate::library_contract::{
    MAX_PLAYLISTS, MAX_PLAYLIST_TRACKS, MAX_QUEUE_ENTRIES, MAX_TRACKS, MAX_WATCHED_FOLDERS,
};

fn limited_vec<'de, D, T, const LIMIT: usize>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Limited<T, const LIMIT: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const LIMIT: usize> Visitor<'de> for Limited<T, LIMIT> {
        type Value = Vec<T>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(formatter, "a list with at most {LIMIT} entries")
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Vec<T>, A::Error> {
            let mut values = Vec::new();
            while values.len() < LIMIT {
                match sequence.next_element()? {
                    Some(value) => values.push(value),
                    None => return Ok(values),
                }
            }
            if sequence.next_element::<IgnoredAny>()?.is_some() {
                return Err(serde::de::Error::invalid_length(LIMIT + 1, &self));
            }
            Ok(values)
        }
    }
    deserializer.deserialize_seq(Limited::<T, LIMIT>(PhantomData))
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, specta::Type)]
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
    pub source_modified: Option<String>,
    pub analysis: Option<TrackAnalysis>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrackAnalysis {
    pub version: u32,
    pub content_hash: String,
    pub analyzed_seconds: f64,
    pub complete: bool,
    pub bpm: Option<f64>,
    pub bpm_confidence: f64,
    pub musical_key: Option<String>,
    pub key_confidence: f64,
    pub integrated_lufs: Option<f64>,
    pub true_peak_db: Option<f64>,
    pub energy: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub track_id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
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

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "limited_vec::<_, _, MAX_PLAYLIST_TRACKS>")]
    pub track_ids: Vec<String>,
    pub smart_rule: Option<SmartRule>,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
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

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub schema_version: u32,
    #[serde(default, deserialize_with = "limited_vec::<_, _, MAX_TRACKS>")]
    pub tracks: Vec<LibraryTrack>,
    #[serde(default, deserialize_with = "limited_vec::<_, _, MAX_QUEUE_ENTRIES>")]
    pub queue: Vec<QueueEntry>,
    #[serde(default, deserialize_with = "limited_vec::<_, _, MAX_PLAYLISTS>")]
    pub playlists: Vec<Playlist>,
    #[serde(default)]
    pub session: PlaybackSession,
    #[serde(default, deserialize_with = "limited_vec::<_, _, MAX_WATCHED_FOLDERS>")]
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

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub processed: usize,
    pub total: usize,
    pub skipped: usize,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
pub struct Waveform {
    pub peaks: Vec<f32>,
    pub duration: f64,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEdit {
    pub name: String,
    pub artist: String,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
}
