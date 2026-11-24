use super::*;

impl NativeLibrary {
    pub fn track_at_path(&self, path: &str) -> Result<Option<LibraryTrack>, String> {
        let Some(db) = self.db.try_lock() else {
            return Ok(None);
        };
        db.query_row("SELECT data FROM tracks WHERE path=?1", [path], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(error)?
        .map(|data| serde_json::from_str(&data).map_err(error))
        .transpose()
    }
    pub(super) fn track(&self, id: &str) -> Result<LibraryTrack, String> {
        self.tracks_by_ids(&[id.to_owned()])?
            .into_iter()
            .next()
            .ok_or_else(|| "Track was not found in the library.".to_string())
    }

    pub fn read_lyrics(&self, track_id: &str) -> Result<Option<String>, String> {
        let track = self.track(track_id)?;
        let path = self.authorize_path(&track.path)?;
        let lyrics = path.with_extension("lrc");
        if !lyrics.is_file() {
            return Ok(None);
        }
        // A companion file beside an explicitly imported track is allowed; symlinks are not.
        if fs::symlink_metadata(&lyrics)
            .map_err(error)?
            .file_type()
            .is_symlink()
        {
            return Err("Linked lyric files are not supported.".into());
        }
        let canonical = fs::canonicalize(&lyrics).map_err(error)?;
        if canonical.parent() != path.parent() {
            return Err("Lyric file must be beside the track.".into());
        }
        if fs::metadata(&canonical).map_err(error)?.len() > 1024 * 1024 {
            return Err("Lyric file is too large.".into());
        }
        fs::read_to_string(canonical).map(Some).map_err(error)
    }

    pub fn waveform(&self, track_id: &str, bins: usize) -> Result<Waveform, String> {
        use crate::audio_engine::audio::decoder::MediaDecoder;
        let bins = bins.clamp(32, 4096);
        let track = self.track(track_id)?;
        let path = self.authorize_path(&track.path)?;
        let fingerprint = file_fingerprint(&path)?;
        let cache = self
            .data_dir
            .join("waveforms")
            .join(format!("{fingerprint}-{bins}.json"));
        if let Ok(data) = fs::read(&cache) {
            if let Ok(waveform) = serde_json::from_slice(&data) {
                return Ok(waveform);
            }
        }
        let mut decoder = MediaDecoder::open(&path_string(&path))?;
        let sample_rate = decoder.info.sample_rate as f64;
        let channels = decoder.info.channels as usize;
        let duration = Some(decoder.info.duration)
            .filter(|duration| *duration > 0.0 && duration.is_finite())
            .ok_or_else(|| "Waveform requires a known track duration.".to_string())?;
        if duration > 4.0 * 3600.0 {
            return Err("Waveform analysis supports tracks up to four hours.".into());
        }
        let frames_per_bin = (duration * sample_rate / bins as f64).max(1.0);
        let mut peaks = vec![0.0_f32; bins];
        let mut index = 0_usize;
        while let Some(frame) = decoder.next_frame()? {
            if index.is_multiple_of(65536) && self.cancel_scan.load(Ordering::Relaxed) {
                return Err("Analysis cancelled.".into());
            }
            let bin = ((index as f64 / frames_per_bin) as usize).min(bins - 1);
            for sample in &frame[..channels] {
                if sample.is_finite() {
                    peaks[bin] = peaks[bin].max(sample.abs().min(1.0));
                }
            }
            index += 1;
        }
        let waveform = Waveform { peaks, duration };
        write_new_file(&cache, &serde_json::to_vec(&waveform).map_err(error)?)?;
        Ok(waveform)
    }
}
