//! Opt-in, local analysis. One cancellable worker streams audio with bounded working memory.
use super::*;
use crate::audio_engine::audio::decoder::MediaDecoder;
use ebur128::{EbuR128, Mode};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use tauri_specta::Event;

pub const VERSION: u32 = 1;
const MAX_SECONDS: u64 = 3600;
const FFT_SIZE: usize = 2048;
const ANALYSIS_RATE: f64 = 11025.0;

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub job_id: String,
    pub running: bool,
    pub processed: usize,
    pub total: usize,
    pub cached: usize,
    pub failed: usize,
    pub current: Option<String>,
    pub percent: f64,
    pub cancelled: bool,
    pub error: Option<String>,
}
#[derive(Default)]
pub struct AnalysisWorker {
    running: AtomicBool,
    cancel: AtomicBool,
    progress: Mutex<AnalysisProgress>,
}
impl AnalysisWorker {
    fn publish(&self, app: &AppHandle) {
        let _ = self.progress.lock().clone().emit(app);
    }
}
fn modified(path: &Path) -> Result<String, String> {
    Ok(fs::metadata(path)
        .map_err(error)?
        .modified()
        .map_err(error)?
        .duration_since(UNIX_EPOCH)
        .map_err(error)?
        .as_nanos()
        .to_string())
}
fn content_hash(path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut input = File::open(path).map_err(error)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Analysis cancelled.".into());
        }
        let count = input.read(&mut buffer).map_err(error)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}

struct Features {
    rate: f64,
    ring: Vec<f32>,
    count: usize,
    previous: Vec<f64>,
    onsets: Vec<f64>,
    chroma: [f64; 12],
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    scratch: Vec<Complex<f32>>,
    bins: Vec<Complex<f32>>,
}
impl Features {
    fn new(rate: f64) -> Self {
        let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        Self {
            rate,
            ring: vec![0.0; FFT_SIZE],
            count: 0,
            previous: vec![0.0; FFT_SIZE / 2],
            onsets: Vec::new(),
            chroma: [0.0; 12],
            fft,
            scratch,
            bins: vec![Complex::default(); FFT_SIZE],
        }
    }
    fn sample(&mut self, value: f32) {
        self.ring[self.count % FFT_SIZE] = value;
        self.count += 1;
        if self.count < FFT_SIZE || !self.count.is_multiple_of(512) {
            return;
        }
        for (index, bin) in self.bins.iter_mut().enumerate() {
            let window =
                0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / (FFT_SIZE - 1) as f32).cos();
            *bin = Complex::new(self.ring[(self.count + index) % FFT_SIZE] * window, 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.bins, &mut self.scratch);
        let mut onset = 0.0;
        for index in 1..FFT_SIZE / 2 {
            let frequency = index as f64 * self.rate / FFT_SIZE as f64;
            let magnitude = f64::from(self.bins[index].norm()).ln_1p();
            if (40.0..=5000.0).contains(&frequency) {
                onset += (magnitude - self.previous[index]).max(0.0);
            }
            self.previous[index] = magnitude;
            if (65.0..=2000.0).contains(&frequency) {
                let note = (69.0 + 12.0 * (frequency / 440.0).log2()).round() as i32;
                self.chroma[note.rem_euclid(12) as usize] += magnitude * magnitude;
            }
        }
        self.onsets.push(onset);
    }
}

pub(super) fn tempo(onsets: &[f64], rate: f64) -> (Option<f64>, f64) {
    if onsets.len() < rate as usize * 8 {
        return (None, 0.0);
    }
    let mean = onsets.iter().sum::<f64>() / onsets.len() as f64;
    let centered = onsets
        .iter()
        .map(|value| (value - mean).max(0.0))
        .collect::<Vec<_>>();
    let power = centered.iter().map(|value| value * value).sum::<f64>();
    if power < 1e-9 {
        return (None, 0.0);
    }
    let mut best = (0, 0.0);
    let first = (rate * 60.0 / 180.0).floor() as usize;
    let last = (rate * 60.0 / 60.0).ceil() as usize;
    for lag in first.max(1)..=last {
        let score = centered
            .iter()
            .skip(lag)
            .zip(&centered)
            .map(|(a, b)| a * b)
            .sum::<f64>()
            / power;
        if score > best.1 {
            best = (lag, score);
        }
    }
    let confidence = best.1.clamp(0.0, 1.0);
    if confidence < 0.12 {
        return (None, confidence);
    }
    (Some(60.0 * rate / best.0 as f64), confidence)
}
pub(super) fn key(chroma: &[f64; 12]) -> (Option<String>, f64) {
    const MAJOR: [f64; 12] = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ];
    const MINOR: [f64; 12] = [
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ];
    let mean = chroma.iter().sum::<f64>() / 12.0;
    let power = chroma
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>();
    if power < 1e-9 {
        return (None, 0.0);
    }
    let mut scores = Vec::new();
    for (minor, profile) in [(false, MAJOR), (true, MINOR)] {
        let center = profile.iter().sum::<f64>() / 12.0;
        let norm = profile
            .iter()
            .map(|value| (value - center).powi(2))
            .sum::<f64>();
        for tonic in 0..12 {
            let correlation = (0..12)
                .map(|index| (chroma[(index + tonic) % 12] - mean) * (profile[index] - center))
                .sum::<f64>()
                / (power * norm).sqrt();
            scores.push((correlation, tonic, minor));
        }
    }
    scores.sort_by(|a, b| b.0.total_cmp(&a.0));
    let best = scores[0];
    let confidence = (best.0.max(0.0) * (best.0 - scores[1].0).max(0.0) * 4.0).clamp(0.0, 1.0);
    if best.0 < 0.45 || confidence < 0.08 {
        return (None, confidence);
    }
    let names = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    (
        Some(format!(
            "{} {}",
            names[best.1],
            if best.2 { "minor" } else { "major" }
        )),
        confidence,
    )
}

pub(super) fn analyze(
    path: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(f64),
) -> Result<TrackAnalysis, String> {
    let hash = content_hash(path, cancel)?;
    let mut decoder = MediaDecoder::open(&path_string(path))?;
    let channels = decoder.info.channels as usize;
    let rate = decoder.info.sample_rate;
    let maximum = u64::from(rate) * MAX_SECONDS;
    let duration = decoder.info.duration;
    // Channel layouts beyond stereo cannot safely be inferred from a channel count.
    let mut meter = if channels <= 2 {
        Some(
            EbuR128::new(
                channels as u32,
                rate,
                Mode::I | Mode::TRUE_PEAK | Mode::HISTOGRAM,
            )
            .map_err(error)?,
        )
    } else {
        None
    };
    let mut block = Vec::with_capacity(16384 * channels);
    let feature_rate = ANALYSIS_RATE.min(f64::from(rate));
    let mut features = Features::new(feature_rate);
    let (mut frames, mut power, mut phase, mut average, mut averaged) =
        (0_u64, 0.0, 0.0, 0.0, 0_usize);
    let mut at = std::time::Instant::now();
    let mut complete = true;
    while let Some(frame) = decoder.next_frame()? {
        if frames >= maximum {
            complete = false;
            break;
        }
        if frames.is_multiple_of(16384) {
            if cancel.load(Ordering::Relaxed) {
                return Err("Analysis cancelled.".into());
            }
            if at.elapsed() > Duration::from_millis(500) {
                progress(if duration > 0.0 {
                    (frames as f64 / f64::from(rate) / duration).min(1.0)
                } else {
                    0.0
                });
                at = std::time::Instant::now();
            }
        }
        let mut mono = 0.0;
        for sample in &frame[..channels] {
            let sample = if sample.is_finite() { *sample } else { 0.0 };
            power += f64::from(sample).powi(2);
            mono += f64::from(sample);
            if meter.is_some() {
                block.push(sample);
            }
        }
        average += mono / channels as f64;
        averaged += 1;
        phase += feature_rate;
        if phase >= f64::from(rate) {
            features.sample((average / averaged as f64) as f32);
            average = 0.0;
            averaged = 0;
            phase -= f64::from(rate);
        }
        frames += 1;
        if block.len() >= 16384 * channels {
            if let Some(meter) = &mut meter {
                meter.add_frames_f32(&block).map_err(error)?;
            }
            block.clear();
        }
    }
    if let Some(meter) = &mut meter {
        if !block.is_empty() {
            meter.add_frames_f32(&block).map_err(error)?;
        }
    }
    if frames == 0 {
        return Err("This track contains no audio frames.".into());
    }
    let integrated_lufs = meter
        .as_ref()
        .and_then(|meter| meter.loudness_global().ok())
        .and_then(finite);
    let true_peak_db = meter
        .as_ref()
        .and_then(|meter| {
            (0..channels as u32)
                .filter_map(|channel| meter.true_peak(channel).ok())
                .reduce(f64::max)
        })
        .and_then(|peak| finite(20.0 * peak.log10()));
    let (bpm, bpm_confidence) = tempo(&features.onsets, feature_rate / 512.0);
    let (musical_key, key_confidence) = key(&features.chroma);
    Ok(TrackAnalysis {
        version: VERSION,
        content_hash: hash,
        analyzed_seconds: frames as f64 / f64::from(rate),
        complete,
        bpm,
        bpm_confidence,
        musical_key,
        key_confidence,
        integrated_lufs,
        true_peak_db,
        energy: (power / (frames as f64 * channels as f64))
            .sqrt()
            .clamp(0.0, 1.0),
    })
}

impl NativeLibrary {
    pub(super) fn analyze_track(
        &self,
        id: &str,
        force: bool,
        cancel: &AtomicBool,
        progress: impl FnMut(f64),
    ) -> Result<bool, String> {
        let track = self.track(id)?;
        let path = self.authorize_path(&track.path)?;
        let stamp = modified(&path)?;
        let fingerprint = file_fingerprint(&path)?;
        if !force {
            let cached:bool=self.db.lock().query_row("SELECT EXISTS(SELECT 1 FROM audio_analysis WHERE track_id=?1 AND fingerprint=?2 AND source_modified=?3 AND json_extract(data,'$.version')=?4)",params![id,fingerprint,stamp,VERSION],|row|row.get(0)).map_err(error)?;
            if cached {
                return Ok(true);
            }
        }
        let result = analyze(&path, cancel, progress)?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Analysis cancelled.".into());
        }
        if modified(&path)? != stamp || file_fingerprint(&path)? != fingerprint {
            return Err("The audio file changed during analysis; analyze it again.".into());
        }
        let mut db = self.db.lock();
        let tx = db.transaction().map_err(error)?;
        let current: Option<String> = tx
            .query_row("SELECT path FROM tracks WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        if current.as_deref() != Some(track.path.as_str()) {
            return Err("The track was removed or relocated during analysis.".into());
        }
        tx.execute("UPDATE tracks SET data=json_set(data,'$.sourceModified',?2,'$.fingerprint',?3) WHERE id=?1 AND (coalesce(json_extract(data,'$.sourceModified'),'')!=?2 OR coalesce(json_extract(data,'$.fingerprint'),'')!=?3)",params![id,stamp,fingerprint]).map_err(error)?;
        tx.execute("INSERT INTO audio_analysis(track_id,fingerprint,source_modified,data) VALUES(?1,?2,?3,?4) ON CONFLICT(track_id) DO UPDATE SET fingerprint=excluded.fingerprint,source_modified=excluded.source_modified,data=excluded.data",params![id,fingerprint,stamp,serde_json::to_string(&result).map_err(error)?]).map_err(error)?;
        tx.execute(
            "UPDATE library_clock SET catalog_revision=catalog_revision+1 WHERE id=1",
            [],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(false)
    }
}

#[tauri::command]
#[specta::specta]
pub fn analysis_status(worker: State<'_, AnalysisWorker>) -> AnalysisProgress {
    worker.progress.lock().clone()
}
#[tauri::command]
#[specta::specta]
pub fn analysis_cancel(worker: State<'_, AnalysisWorker>) {
    worker.cancel.store(true, Ordering::Relaxed);
}
#[tauri::command]
#[specta::specta]
pub fn analysis_start(
    app: AppHandle,
    track_ids: Option<Vec<String>>,
    force: bool,
) -> Result<AnalysisProgress, catalog::IpcError> {
    let worker = app.state::<AnalysisWorker>();
    if track_ids.as_ref().is_some_and(|ids| ids.len() > MAX_TRACKS) {
        return Err(catalog::IpcError::invalid("Analysis track limit exceeded."));
    }
    if worker
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(catalog::IpcError::invalid(
            "An analysis job is already running.",
        ));
    }
    worker.cancel.store(false, Ordering::Relaxed);
    let initial = AnalysisProgress {
        job_id: now_ms().to_string(),
        running: true,
        ..Default::default()
    };
    *worker.progress.lock() = initial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let worker = app.state::<AnalysisWorker>();
        let library = app.state::<NativeLibrary>();
        let result = (|| -> Result<(), String> {
            let ids = track_ids
                .map(Ok)
                .unwrap_or_else(|| library.track_ids(None))?;
            let mut unique = HashSet::new();
            let ids = ids
                .into_iter()
                .filter(|id| unique.insert(id.clone()))
                .collect::<Vec<_>>();
            worker.progress.lock().total = ids.len();
            worker.publish(&app);
            for id in ids {
                if worker.cancel.load(Ordering::Relaxed) {
                    break;
                }
                {
                    let mut status = worker.progress.lock();
                    status.current = Some(id.clone());
                    status.percent = 0.0;
                }
                match library.analyze_track(&id, force, &worker.cancel, |percent| {
                    worker.progress.lock().percent = percent;
                    worker.publish(&app);
                }) {
                    Ok(cached) => {
                        let mut status = worker.progress.lock();
                        status.processed += 1;
                        if cached {
                            status.cached += 1;
                        }
                    }
                    Err(error) => {
                        if !worker.cancel.load(Ordering::Relaxed) {
                            let mut status = worker.progress.lock();
                            status.processed += 1;
                            status.failed += 1;
                            status.error = Some(error);
                        }
                    }
                }
                worker.publish(&app);
                if let Ok(changed) = library.catalog_changed() {
                    let _ = changed.emit(&app);
                }
            }
            Ok(())
        })();
        {
            let mut status = worker.progress.lock();
            status.running = false;
            status.cancelled = worker.cancel.load(Ordering::Relaxed);
            status.current = None;
            status.percent = 0.0;
            if let Err(error) = result {
                status.error = Some(error);
            }
        }
        worker.running.store(false, Ordering::Release);
        worker.publish(&app);
    });
    Ok(initial)
}
