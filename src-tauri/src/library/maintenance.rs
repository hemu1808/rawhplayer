use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePreview {
    pub tracks: Vec<LibraryTrack>,
    pub total: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MaintenancePage {
    pub missing: Vec<LibraryTrack>,
    pub missing_total: u64,
    pub duplicates: Vec<DuplicatePreview>,
    pub duplicate_total: u64,
}

impl NativeLibrary {
    pub fn maintenance(
        &self,
        missing_offset: usize,
        duplicate_offset: usize,
    ) -> Result<MaintenancePage, String> {
        let db = self.db.lock();
        let missing_total = db
            .query_row(
                "SELECT count(*) FROM tracks WHERE json_extract(data,'$.missing')=1",
                [],
                |row| row.get(0),
            )
            .map_err(error)?;
        let mut missing_query=db.prepare("SELECT data FROM tracks WHERE json_extract(data,'$.missing')=1 ORDER BY id LIMIT 100 OFFSET ?1").map_err(error)?;
        let missing = missing_query
            .query_map([missing_offset.min(MAX_TRACKS) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(error)?
            .map(|data| serde_json::from_str(&data.map_err(error)?).map_err(error))
            .collect::<Result<Vec<_>, _>>()?;
        let key="json_array(lower(trim(json_extract(data,'$.artist'))),lower(trim(json_extract(data,'$.name'))),round(coalesce(json_extract(data,'$.duration'),0)))";
        let grouped = format!(
            "SELECT {key} AS identity,count(*) AS size FROM tracks GROUP BY identity HAVING size>1"
        );
        let duplicate_total = db
            .query_row(&format!("SELECT count(*) FROM ({grouped})"), [], |row| {
                row.get(0)
            })
            .map_err(error)?;
        let mut groups = db
            .prepare(&format!(
                "SELECT identity,size FROM ({grouped}) ORDER BY identity LIMIT 10 OFFSET ?1"
            ))
            .map_err(error)?;
        let identities = groups
            .query_map([duplicate_offset.min(MAX_TRACKS) as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
            })
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        let mut query = db
            .prepare(&format!(
                "SELECT data FROM tracks WHERE {key}=?1 ORDER BY id LIMIT 50"
            ))
            .map_err(error)?;
        let mut duplicates = Vec::new();
        for (identity, total) in identities {
            let tracks = query
                .query_map([identity], |row| row.get::<_, String>(0))
                .map_err(error)?
                .map(|data| serde_json::from_str(&data.map_err(error)?).map_err(error))
                .collect::<Result<_, _>>()?;
            duplicates.push(DuplicatePreview { tracks, total });
        }
        Ok(MaintenancePage {
            missing,
            missing_total,
            duplicates,
            duplicate_total,
        })
    }
}
#[tauri::command]
#[specta::specta]
pub async fn library_maintenance(
    app: AppHandle,
    missing_offset: usize,
    duplicate_offset: usize,
) -> Result<MaintenancePage, catalog::IpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeLibrary>()
            .maintenance(missing_offset, duplicate_offset)
    })
    .await
    .map_err(|e| catalog::IpcError::internal(e.to_string()))?
    .map_err(Into::into)
}
