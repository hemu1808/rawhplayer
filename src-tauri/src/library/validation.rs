use super::*;

pub(super) fn validate_rule(rule: &SmartRule) -> Result<(), String> {
    if [&rule.query, &rule.artist, &rule.genre, &rule.format]
        .iter()
        .any(|value| value.as_ref().is_some_and(|value| value.len() > 512))
        || rule.added_within_days.is_some_and(|value| value > 36_500)
        || rule.min_sample_rate.is_some_and(|value| value > 768_000)
    {
        return Err("Playlist contains an invalid smart rule.".into());
    }
    Ok(())
}

pub fn validate_snapshot(snapshot: &LibrarySnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1 {
        return Err("Unsupported library backup version.".into());
    }
    if snapshot.tracks.len() > MAX_TRACKS
        || snapshot.queue.len() > MAX_QUEUE_ENTRIES
        || snapshot.playlists.len() > MAX_PLAYLISTS
        || snapshot.watched_folders.len() > MAX_WATCHED_FOLDERS
    {
        return Err("Library exceeds supported limits.".into());
    }
    if !snapshot.session.position.is_finite()
        || snapshot.session.position < 0.0
        || snapshot.session.position > 7.0 * 86400.0
    {
        return Err("Invalid playback position.".into());
    }
    if !["SEQUENCE", "LOOP", "SHUFFLE"].contains(&snapshot.session.playback_mode.as_str()) {
        return Err("Invalid playback mode.".into());
    }
    let mut tracks = HashSet::new();
    let mut paths = HashSet::new();
    for track in &snapshot.tracks {
        if track.id.is_empty()
            || track.id.len() > 256
            || !tracks.insert(&track.id)
            || !paths.insert(path_key(&track.path))
        {
            return Err("Library contains duplicate or invalid track identifiers.".into());
        }
        if track.path.len() > 32_768
            || !Path::new(&track.path).is_absolute()
            || track.path.contains('\0')
        {
            return Err("Library contains an invalid file path.".into());
        }
        if track.name.len() > 4096
            || track.artist.len() > 4096
            || !track.listening_seconds.is_finite()
            || track.listening_seconds < 0.0
            || track
                .duration
                .is_some_and(|value| !value.is_finite() || value < 0.0)
        {
            return Err("Library contains invalid track metadata.".into());
        }
    }
    let mut entries = HashSet::new();
    for entry in &snapshot.queue {
        if entry.id.is_empty()
            || entry.id.len() > 256
            || !entries.insert(&entry.id)
            || !tracks.contains(&entry.track_id)
        {
            return Err("Queue references an invalid track or entry.".into());
        }
    }
    if snapshot
        .session
        .current_queue_id
        .as_ref()
        .is_some_and(|id| !entries.contains(id))
    {
        return Err("Playback session references a missing queue entry.".into());
    }
    let mut playlists = HashSet::new();
    for playlist in &snapshot.playlists {
        if playlist.id.is_empty()
            || playlist.id.len() > 256
            || !playlists.insert(&playlist.id)
            || playlist.name.trim().is_empty()
            || playlist.name.len() > 256
            || playlist.track_ids.len() > MAX_PLAYLIST_TRACKS
            || playlist.track_ids.iter().any(|id| !tracks.contains(id))
        {
            return Err("Library contains an invalid playlist.".into());
        }
        if let Some(rule) = &playlist.smart_rule {
            if [&rule.query, &rule.artist, &rule.genre, &rule.format]
                .iter()
                .any(|value| value.as_ref().is_some_and(|value| value.len() > 512))
                || rule.added_within_days.is_some_and(|value| value > 36_500)
                || rule.min_sample_rate.is_some_and(|value| value > 768_000)
            {
                return Err("Playlist contains an invalid smart rule.".into());
            }
        }
    }
    Ok(())
}
