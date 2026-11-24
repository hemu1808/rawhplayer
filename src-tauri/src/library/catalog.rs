//! Bounded catalog queries and revisioned user-data patches. Audio paths stay native-authoritative.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibraryHeader {
    pub revision: u64,
    pub catalog_revision: u64,
    pub track_count: u64,
    pub state: LibrarySnapshot,
    pub initial_tracks: Vec<LibraryTrack>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogQuery {
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
    pub search: Option<String>,
    pub sort: Option<CatalogSort>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub playlist_id: Option<String>,
    #[serde(default)]
    pub favorites_only: bool,
    pub min_bpm: Option<f64>,
    pub max_bpm: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CatalogSort {
    #[default]
    Recent,
    Title,
    Artist,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub revision: u64,
    pub total: u64,
    pub offset: usize,
    pub limit: usize,
    pub tracks: Vec<LibraryTrack>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGroup {
    pub name: String,
    pub tracks: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserTrackPatch {
    pub id: String,
    pub is_liked: Option<bool>,
    pub play_count: Option<u64>,
    pub listening_seconds: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueueOperation {
    Insert {
        entry: QueueEntry,
        #[serde(rename = "afterId")]
        after_id: Option<String>,
    },
    Remove {
        id: String,
    },
    Move {
        id: String,
        #[serde(rename = "beforeId")]
        before_id: Option<String>,
    },
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryPatch {
    pub base_revision: u64,
    #[serde(default)]
    pub tracks: Vec<UserTrackPatch>,
    pub replace_queue: Option<Vec<QueueEntry>>,
    #[serde(default)]
    pub queue_operations: Vec<QueueOperation>,
    #[serde(default)]
    pub upsert_playlists: Vec<Playlist>,
    #[serde(default)]
    pub remove_playlists: Vec<String>,
    pub session: Option<PlaybackSession>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PatchReceipt {
    pub revision: u64,
    pub catalog_revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChanged {
    pub revision: u64,
    pub track_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidInput,
    Conflict,
    NotFound,
    Unavailable,
    Internal,
}
impl IpcError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidInput,
            message: message.into(),
            retryable: false,
        }
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::Internal,
            message: message.into(),
            retryable: false,
        }
    }
    pub fn conflict() -> Self {
        Self {
            code: ErrorCode::Conflict,
            message:
                "The library changed in another operation. Refresh it before retrying this edit."
                    .into(),
            retryable: true,
        }
    }
}
impl From<String> for IpcError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}
type Reply<T> = Result<T, IpcError>;

pub(super) fn revision(db: &Connection) -> Result<(u64, u64), String> {
    db.query_row(
        "SELECT revision,catalog_revision FROM library_clock WHERE id=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(error)
}
pub(super) fn bump_revision(db: &Connection) -> Result<(), String> {
    db.execute(
        "UPDATE library_clock SET revision=revision+1 WHERE id=1",
        [],
    )
    .map(|_| ())
    .map_err(error)
}

pub(super) fn decode_track(data: String, analysis: Option<String>) -> Result<LibraryTrack, String> {
    let mut track: LibraryTrack = serde_json::from_str(&data).map_err(error)?;
    track.analysis = analysis
        .map(|value| serde_json::from_str(&value).map_err(error))
        .transpose()?;
    Ok(track)
}
pub(super) const TRACK_COLUMNS: &str = "t.data,a.data";
pub(super) const TRACK_JOIN: &str = "tracks t LEFT JOIN audio_analysis a ON a.track_id=t.id AND a.source_modified=coalesce(json_extract(t.data,'$.sourceModified'),'') AND a.fingerprint=coalesce(json_extract(t.data,'$.fingerprint'),'')";

impl NativeLibrary {
    pub fn bootstrap(&self) -> Result<LibraryHeader, String> {
        let db = self.db.lock();
        let (revision, catalog_revision) = revision(&db)?;
        let state = self.load_state(&db)?;
        let track_count = db
            .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
            .map_err(error)?;
        let mut ids = state
            .queue
            .iter()
            .take(100)
            .map(|entry| entry.track_id.clone())
            .collect::<Vec<_>>();
        if let Some(id) = state
            .session
            .current_queue_id
            .as_ref()
            .and_then(|id| state.queue.iter().find(|entry| &entry.id == id))
            .map(|entry| entry.track_id.clone())
        {
            ids.push(id);
        }
        let mut initial_tracks = Self::page_db(
            &db,
            &CatalogQuery {
                limit: Some(100),
                ..Default::default()
            },
        )?
        .tracks;
        let mut seen: HashSet<String> = initial_tracks
            .iter()
            .map(|track| track.id.clone())
            .collect();
        for track in Self::tracks_db(&db, &ids)? {
            if seen.insert(track.id.clone()) {
                initial_tracks.push(track);
            }
        }
        Ok(LibraryHeader {
            revision,
            catalog_revision,
            track_count,
            state,
            initial_tracks,
        })
    }

    pub fn catalog_changed(&self) -> Result<CatalogChanged, String> {
        let db = self.db.lock();
        Ok(CatalogChanged {
            revision: revision(&db)?.1,
            track_count: db
                .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
                .map_err(error)?,
        })
    }

    fn query_parts(
        db: &Connection,
        query: &CatalogQuery,
    ) -> Result<(Vec<rusqlite::types::Value>, String, &'static str), String> {
        if query.search.as_ref().is_some_and(|text| text.len() > 500)
            || query.offset > MAX_TRACKS
            || query.artist.as_ref().is_some_and(|text| text.len() > 4096)
            || query.album.as_ref().is_some_and(|text| text.len() > 4096)
        {
            return Err("Catalog query exceeds supported limits.".into());
        }
        for bpm in [query.min_bpm, query.max_bpm].into_iter().flatten() {
            if !bpm.is_finite() || !(20.0..=400.0).contains(&bpm) {
                return Err("Tempo must be between 20 and 400 BPM.".into());
            }
        }
        let mut filters = vec!["1=1".to_owned()];
        let mut values: Vec<rusqlite::types::Value> = vec![];
        if let Some(search) = query
            .search
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            let terms = search
                .split_whitespace()
                .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" AND ");
            filters
                .push("t.rowid IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?)".into());
            values.push(terms.into());
        }
        for (name, value) in [("artist", &query.artist), ("album", &query.album)] {
            if let Some(value) = value {
                filters.push(format!(
                    "coalesce(json_extract(t.data,'$.{name}'),'')=? COLLATE NOCASE"
                ));
                values.push(value.clone().into());
            }
        }
        if query.favorites_only {
            filters.push("json_extract(t.data,'$.isLiked')=1".into());
        }
        for (operator, value) in [(">=", query.min_bpm), ("<=", query.max_bpm)] {
            if let Some(value) = value {
                filters.push(format!("json_extract(a.data,'$.bpm'){operator}?"));
                values.push(value.into());
            }
        }
        if let Some(id) = &query.playlist_id {
            let playlist: Option<String> = db
                .query_row(
                    "SELECT data FROM library_playlists WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(error)?;
            let playlist: Playlist =
                serde_json::from_str(&playlist.ok_or("Playlist no longer exists")?)
                    .map_err(error)?;
            if let Some(rule) = playlist.smart_rule {
                for (field, value) in [
                    ("artist", rule.artist),
                    ("genre", rule.genre),
                    ("format", rule.format),
                ] {
                    if let Some(value) = value.filter(|value| !value.is_empty()) {
                        filters.push(format!("instr(lower(coalesce(json_extract(t.data,'$.{field}'),'')),lower(?))>0"));
                        values.push(value.into());
                    }
                }
                if let Some(value) = rule.query.filter(|value| !value.is_empty()) {
                    filters.push("instr(lower(json_extract(t.data,'$.name')||' '||json_extract(t.data,'$.artist')||' '||coalesce(json_extract(t.data,'$.album'),'')),lower(?))>0".into());
                    values.push(value.into());
                }
                if rule.liked_only {
                    filters.push("json_extract(t.data,'$.isLiked')=1".into());
                }
                if rule.unplayed_only {
                    filters.push("coalesce(json_extract(t.data,'$.playCount'),0)=0".into());
                }
                if let Some(rate) = rule.min_sample_rate {
                    filters.push("coalesce(json_extract(t.data,'$.sampleRate'),0)>=?".into());
                    values.push((rate as i64).into());
                }
                if let Some(days) = rule.added_within_days {
                    filters.push("coalesce(json_extract(t.data,'$.dateAdded'),0)>=?".into());
                    values.push((now_ms().saturating_sub(days as u64 * 86_400_000) as i64).into());
                }
            } else {
                filters.push("t.id IN (SELECT value FROM json_each(?))".into());
                values.push(
                    serde_json::to_string(&playlist.track_ids)
                        .map_err(error)?
                        .into(),
                );
            }
        }
        let where_clause = filters.join(" AND ");
        let order=match query.sort.unwrap_or_default(){CatalogSort::Recent=>"coalesce(json_extract(t.data,'$.dateAdded'),0) DESC,t.id",CatalogSort::Title=>"json_extract(t.data,'$.name') COLLATE NOCASE,t.id",CatalogSort::Artist=>"json_extract(t.data,'$.artist') COLLATE NOCASE,json_extract(t.data,'$.name') COLLATE NOCASE,t.id"};
        Ok((values, where_clause, order))
    }
    fn page_db(db: &Connection, query: &CatalogQuery) -> Result<CatalogPage, String> {
        let (mut values, where_clause, order) = Self::query_parts(db, query)?;
        let limit = query.limit.unwrap_or(100).clamp(1, 500);
        let total = db
            .query_row(
                &format!("SELECT count(*) FROM {TRACK_JOIN} WHERE {where_clause}"),
                rusqlite::params_from_iter(values.iter()),
                |row| row.get(0),
            )
            .map_err(error)?;
        values.push((limit as i64).into());
        values.push((query.offset as i64).into());
        let mut statement=db.prepare(&format!("SELECT {TRACK_COLUMNS} FROM {TRACK_JOIN} WHERE {where_clause} ORDER BY {order} LIMIT ? OFFSET ?")).map_err(error)?;
        let tracks = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(error)?
            .map(|row| {
                let (data, analysis) = row.map_err(error)?;
                decode_track(data, analysis)
            })
            .collect::<Result<_, _>>()?;
        Ok(CatalogPage {
            revision: revision(db)?.1,
            total,
            offset: query.offset,
            limit,
            tracks,
        })
    }
    pub fn page(&self, query: CatalogQuery) -> Result<CatalogPage, String> {
        Self::page_db(&self.db.lock(), &query)
    }

    fn tracks_db(db: &Connection, ids: &[String]) -> Result<Vec<LibraryTrack>, String> {
        if ids.len() > 500 {
            return Err("Request no more than 500 tracks at a time.".into());
        }
        let mut statement = db
            .prepare(&format!(
                "SELECT {TRACK_COLUMNS} FROM {TRACK_JOIN} WHERE t.id=?1"
            ))
            .map_err(error)?;
        ids.iter()
            .filter_map(|id| {
                match statement
                    .query_row([id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                    })
                    .optional()
                {
                    Ok(Some((data, analysis))) => Some(decode_track(data, analysis)),
                    Ok(None) => None,
                    Err(e) => Some(Err(error(e))),
                }
            })
            .collect()
    }
    pub fn tracks_by_ids(&self, ids: &[String]) -> Result<Vec<LibraryTrack>, String> {
        Self::tracks_db(&self.db.lock(), ids)
    }
    pub fn track_ids(&self, playlist_id: Option<String>) -> Result<Vec<String>, String> {
        let db = self.db.lock();
        if let Some(id) = &playlist_id {
            let data: String = db
                .query_row(
                    "SELECT data FROM library_playlists WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(error)?;
            let playlist: Playlist = serde_json::from_str(&data).map_err(error)?;
            if playlist.smart_rule.is_none() {
                let mut statement=db.prepare("SELECT j.value FROM json_each(?1) j JOIN tracks t ON t.id=j.value WHERE coalesce(json_extract(t.data,'$.missing'),0)=0 ORDER BY j.key").map_err(error)?;
                let rows = statement
                    .query_map(
                        [serde_json::to_string(&playlist.track_ids).map_err(error)?],
                        |row| row.get(0),
                    )
                    .map_err(error)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(error)?;
                return Ok(rows);
            }
        }
        let (values, filters, order) = Self::query_parts(
            &db,
            &CatalogQuery {
                playlist_id,
                ..Default::default()
            },
        )?;
        let mut statement=db.prepare(&format!("SELECT t.id FROM {TRACK_JOIN} WHERE {filters} AND coalesce(json_extract(t.data,'$.missing'),0)=0 ORDER BY {order} LIMIT {MAX_TRACKS}")).map_err(error)?;
        let ids = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| row.get(0))
            .map_err(error)?
            .collect::<Result<_, _>>()
            .map_err(error)?;
        Ok(ids)
    }
    pub fn groups(&self, kind: String, offset: usize) -> Result<Vec<CatalogGroup>, String> {
        let field = match kind.as_str() {
            "artist" => "artist",
            "album" => "album",
            _ => return Err("Choose artist or album grouping.".into()),
        };
        let db = self.db.lock();
        let mut statement=db.prepare(&format!("SELECT coalesce(json_extract(data,'$.{field}'),''),count(*) FROM tracks GROUP BY 1 COLLATE NOCASE ORDER BY 1 COLLATE NOCASE LIMIT 100 OFFSET ?1")).map_err(error)?;
        let rows = statement
            .query_map([offset.min(MAX_TRACKS) as i64], |row| {
                Ok(CatalogGroup {
                    name: row.get(0)?,
                    tracks: row.get(1)?,
                })
            })
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        Ok(rows)
    }
}

pub fn notify(app: &AppHandle) {
    use tauri_specta::Event;
    if let Ok(changed) = app.state::<NativeLibrary>().catalog_changed() {
        let _ = changed.emit(app);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn library_remove_catalog(app: AppHandle, track_id: String) -> Reply<LibraryHeader> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<NativeLibrary>();
        library.remove_track(&track_id)?;
        notify(&app);
        library.bootstrap()
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn pick_music_catalog(app: AppHandle, folder: bool) -> Reply<LibraryHeader> {
    crate::pick_music(app.clone(), folder).await?;
    tauri::async_runtime::spawn_blocking(move || {
        notify(&app);
        app.state::<NativeLibrary>().bootstrap()
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn library_restore_catalog(app: AppHandle, backup: String) -> Reply<LibraryHeader> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<NativeLibrary>();
        library.restore(&backup)?;
        notify(&app);
        library.bootstrap()
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn play_library_track(
    app: AppHandle,
    track_id: String,
    queue_id: String,
) -> Reply<LibraryTrack> {
    tauri::async_runtime::spawn_blocking(move || -> Result<LibraryTrack, String> {
        let library = app.state::<NativeLibrary>();
        let track = library.track(&track_id)?;
        let path = library.authorize_path(&track.path)?;
        app.state::<Option<crate::audio_engine::AudioEngine>>()
            .as_ref()
            .ok_or("Audio engine unavailable")?
            .play_file_with_id(path_string(&path), queue_id)?;
        Ok(track)
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn queue_library_track(
    app: AppHandle,
    track_id: String,
    queue_id: String,
) -> Reply<LibraryTrack> {
    tauri::async_runtime::spawn_blocking(move || -> Result<LibraryTrack, String> {
        let library = app.state::<NativeLibrary>();
        let track = library.track(&track_id)?;
        let path = library.authorize_path(&track.path)?;
        app.state::<Option<crate::audio_engine::AudioEngine>>()
            .as_ref()
            .ok_or("Audio engine unavailable")?
            .queue_next_file_with_id(path_string(&path), queue_id)?;
        Ok(track)
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn library_import_catalog(app: AppHandle, paths: Vec<String>) -> Reply<LibraryHeader> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<NativeLibrary>();
        library.import_with_progress(paths, |progress| {
            let _ = app.emit("library_scan_progress", progress);
        })?;
        notify(&app);
        library.bootstrap()
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn library_reconcile_catalog(app: AppHandle) -> Reply<LibraryHeader> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<NativeLibrary>();
        library.reconcile(|progress| {
            let _ = app.emit("library_scan_progress", progress);
        })?;
        notify(&app);
        library.bootstrap()
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn library_bootstrap(app: AppHandle) -> Reply<LibraryHeader> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().bootstrap())
        .await
        .map_err(|e| IpcError::internal(e.to_string()))?
        .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn library_page(app: AppHandle, query: CatalogQuery) -> Reply<CatalogPage> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().page(query))
        .await
        .map_err(|e| IpcError::internal(e.to_string()))?
        .map_err(IpcError::invalid)
}
#[tauri::command]
#[specta::specta]
pub async fn library_tracks(app: AppHandle, ids: Vec<String>) -> Reply<Vec<LibraryTrack>> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().tracks_by_ids(&ids))
        .await
        .map_err(|e| IpcError::internal(e.to_string()))?
        .map_err(IpcError::invalid)
}
#[tauri::command]
#[specta::specta]
pub async fn library_track_ids(app: AppHandle, playlist_id: Option<String>) -> Reply<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>().track_ids(playlist_id)
    })
    .await
    .map_err(|e| IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
#[tauri::command]
#[specta::specta]
pub async fn library_groups(
    app: AppHandle,
    kind: String,
    offset: usize,
) -> Reply<Vec<CatalogGroup>> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeLibrary>().groups(kind, offset))
        .await
        .map_err(|e| IpcError::internal(e.to_string()))?
        .map_err(IpcError::invalid)
}
