//! Output streams and decoders are owned by one worker; IPC carries only commands.
#[path = "audio/mod.rs"]
mod audio;
use audio::{
    decoder::ResampledTrack,
    output::{self, OutputSignals},
    pipeline::Pipeline,
};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::{
    atomic::Ordering,
    mpsc::{self, SyncSender, TrySendError},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}
#[derive(Clone, Serialize)]
pub struct TrackEvent {
    pub queue_id: String,
    pub path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub format: String,
}
#[derive(Clone, Serialize)]
pub struct EndedEvent {
    pub queue_id: String,
    pub path: String,
    pub next_queue_id: Option<String>,
    pub reason: String,
}
pub enum RenderNotice {
    Started {
        generation: u64,
        serial: u64,
        event: TrackEvent,
    },
    Ended {
        generation: u64,
        event: EndedEvent,
    },
}
#[derive(Clone, Serialize, Default)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub device_name: Option<String>,
    pub output_sample_rate: Option<u32>,
    pub output_channels: Option<usize>,
    pub output_format: Option<String>,
    pub queue_id: Option<String>,
    pub path: Option<String>,
    pub current_time: f64,
    pub duration: f64,
    pub is_playing: bool,
    pub volume: f32,
    pub playback_rate: f32,
    pub is_purist: bool,
    pub crossfade_seconds: f32,
    pub normalization: String,
    pub preamp_db: f32,
    pub clipping_count: u64,
    pub underrun_count: u64,
    pub ready: bool,
    pub error: Option<String>,
}
enum Command {
    Play(String, String),
    Queue(String, String),
    Clear,
    Stop,
    Pause(bool),
    Toggle,
    Seek(f64),
    Volume(f32),
    Speed(f32),
    Eq(usize, f32),
    Purist(bool),
    Crossfade(f32),
    Normalize(String, f32),
    Device(Option<String>),
}
struct Request {
    command: Command,
    response: SyncSender<Result<(), String>>,
    deadline: Instant,
}
fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("Audio operation expired before it could be applied".into())
    } else {
        Ok(())
    }
}
pub struct AudioEngine {
    sender: SyncSender<Request>,
    info: Arc<Mutex<AudioInfo>>,
}
fn bounded(value: f64, min: f64, max: f64) -> Result<(), String> {
    if value.is_finite() && value >= min && value <= max {
        Ok(())
    } else {
        Err(format!("Value must be between {min} and {max}"))
    }
}
impl AudioEngine {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel::<Request>(64);
        let info = Arc::new(Mutex::new(AudioInfo::default()));
        let shared = info.clone();
        std::thread::Builder::new()
            .name("rawh-audio".into())
            .spawn(move || worker(app, receiver, shared))
            .map_err(|e| e.to_string())?;
        Ok(Self { sender, info })
    }
    fn send(&self, command: Command) -> Result<(), String> {
        let (response, result) = mpsc::sync_channel(1);
        self.sender
            .try_send(Request {
                command,
                response,
                deadline: Instant::now() + Duration::from_secs(15),
            })
            .map_err(|_| "Audio engine is busy or unavailable".to_string())?;
        result
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Audio operation timed out".to_string())?
    }
    pub fn play_file_with_id(&self, path: String, id: String) -> Result<(), String> {
        self.send(Command::Play(path, id))
    }
    pub fn queue_next_file_with_id(&self, path: String, id: String) -> Result<(), String> {
        self.send(Command::Queue(path, id))
    }
    pub fn clear_pending(&self) -> Result<(), String> {
        self.send(Command::Clear)
    }
    pub fn stop(&self) -> Result<(), String> {
        self.send(Command::Stop)
    }
    pub fn set_paused(&self, value: bool) -> Result<(), String> {
        self.send(Command::Pause(value))
    }
    pub fn toggle_play(&self) -> Result<(), String> {
        self.send(Command::Toggle)
    }
    pub fn seek(&self, value: f64) -> Result<(), String> {
        bounded(value, 0.0, 864000.0)?;
        self.send(Command::Seek(value))
    }
    pub fn set_volume(&self, value: f32) -> Result<(), String> {
        bounded(value as f64, 0.0, 1.0)?;
        self.send(Command::Volume(value))
    }
    pub fn set_playback_rate(&self, value: f32) -> Result<(), String> {
        bounded(value as f64, 0.25, 4.0)?;
        self.send(Command::Speed(value))
    }
    pub fn set_equalizer_band(&self, index: usize, gain: f32) -> Result<(), String> {
        if index >= 10 {
            return Err("Invalid equalizer band".into());
        }
        bounded(gain as f64, -12.0, 12.0)?;
        self.send(Command::Eq(index, gain))
    }
    pub fn set_purist_mode(&self, value: bool) -> Result<(), String> {
        self.send(Command::Purist(value))
    }
    pub fn set_crossfade_duration(&self, value: f32) -> Result<(), String> {
        bounded(value as f64, 0.0, 12.0)?;
        self.send(Command::Crossfade(value))
    }
    pub fn set_normalization(&self, mode: String, preamp: f32) -> Result<(), String> {
        if !["off", "track", "album"].contains(&mode.as_str()) {
            return Err("Invalid normalization mode".into());
        }
        bounded(preamp as f64, -24.0, 12.0)?;
        self.send(Command::Normalize(mode, preamp))
    }
    pub fn set_output_device(&self, id: Option<String>) -> Result<(), String> {
        self.send(Command::Device(id))
    }
    pub fn list_audio_devices(&self) -> Result<Vec<AudioDeviceInfo>, String> {
        output::list_devices()
    }
    pub fn get_audio_info(&self) -> Result<AudioInfo, String> {
        Ok(self.info.lock().clone())
    }
}

fn worker(app: AppHandle, receiver: mpsc::Receiver<Request>, shared: Arc<Mutex<AudioInfo>>) {
    let signals = Arc::new(OutputSignals::default());
    let (notice_tx, notices) = mpsc::sync_channel(128);
    let mut device = None;
    let mut selected: Option<String> = None;
    let mut pipe = Pipeline::new();
    let mut pending = None;
    let mut audible: Option<TrackEvent> = None;
    let mut last_update = Instant::now();
    let mut retry = Instant::now() - Duration::from_secs(3);
    let mut last_fft = Instant::now();
    let fft = rustfft::FftPlanner::<f32>::new().plan_fft_forward(1024);
    loop {
        if device.is_none() && retry.elapsed() > Duration::from_secs(2) {
            retry = Instant::now();
            match output::open(selected.as_deref(), signals.clone(), notice_tx.clone()) {
                Ok(out) => {
                    pipe.sample_rate = out.sample_rate;
                    pipe.channels = out.channels;
                    pipe.reset_dsp();
                    device = Some(out);
                    shared.lock().error = None;
                    let _ = app.emit("audio_device_changed", ());
                }
                Err(error) => shared.lock().error = Some(error),
            }
        }
        match receiver.try_recv() {
            Ok(request) => {
                let result = (|| -> Result<(), String> {
                    check_deadline(request.deadline)?;
                    match request.command {
                        Command::Play(path, id) => {
                            if device.is_none() {
                                return Err("Connect an audio output device first".into());
                            }
                            let track = ResampledTrack::new(&path, id)?;
                            check_deadline(request.deadline)?;
                            let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
                            pending = None;
                            pipe.set_current(track, generation);
                            signals.paused.store(false, Ordering::Release);
                            signals.playing.store(true, Ordering::Release);
                        }
                        Command::Queue(path, id) => {
                            let track = ResampledTrack::new(&path, id)?;
                            check_deadline(request.deadline)?;
                            pipe.pending = Some(track);
                        }
                        Command::Clear => {
                            pipe.pending = None;
                        }
                        Command::Stop => {
                            signals.generation.fetch_add(1, Ordering::AcqRel);
                            pending = None;
                            pipe.stop();
                            audible = None;
                            signals.playing.store(false, Ordering::Release);
                            signals.position.store(0.0_f64.to_bits(), Ordering::Release);
                        }
                        Command::Pause(value) => signals.paused.store(value, Ordering::Release),
                        Command::Toggle => {
                            if audible.is_none() {
                                return Err("No track loaded".into());
                            }
                            signals.paused.fetch_xor(true, Ordering::AcqRel);
                        }
                        Command::Seek(position) => {
                            let track = audible.as_ref().ok_or("No track loaded")?;
                            if track.duration > 0.0 && position > track.duration {
                                return Err("Seek exceeds track duration".into());
                            }
                            let mut replacement =
                                ResampledTrack::new(&track.path, track.queue_id.clone())?;
                            replacement.seek(position)?;
                            check_deadline(request.deadline)?;
                            let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
                            pending = None;
                            pipe.set_current(replacement, generation);
                            signals
                                .position
                                .store(position.to_bits(), Ordering::Release);
                            signals.playing.store(true, Ordering::Release);
                        }
                        Command::Volume(value) => pipe.volume = value,
                        Command::Speed(value) => pipe.speed = value,
                        Command::Eq(index, value) => {
                            pipe.gains[index] = value;
                            pipe.reset_dsp();
                        }
                        Command::Purist(value) => {
                            pipe.purist = value;
                            pipe.reset_dsp();
                        }
                        Command::Crossfade(value) => pipe.crossfade = value,
                        Command::Normalize(mode, preamp) => {
                            pipe.normalization = mode;
                            pipe.preamp_db = preamp;
                        }
                        Command::Device(id) => {
                            // The decoder may already be on the next track while the
                            // device is playing queued PCM. Rebuild the audible track.
                            let restored = audible
                                .as_ref()
                                .map(|track| {
                                    let mut restored =
                                        ResampledTrack::new(&track.path, track.queue_id.clone())?;
                                    restored.seek(
                                        f64::from_bits(signals.position.load(Ordering::Acquire))
                                            .min(track.duration.max(0.0)),
                                    )?;
                                    Ok::<_, String>(restored)
                                })
                                .transpose()?;
                            let replacement =
                                output::open(id.as_deref(), signals.clone(), notice_tx.clone())?;
                            check_deadline(request.deadline)?;
                            let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
                            pending = None;
                            pipe.sample_rate = replacement.sample_rate;
                            pipe.channels = replacement.channels;
                            if let Some(track) = restored {
                                let next = if pipe
                                    .current
                                    .as_ref()
                                    .is_some_and(|current| current.queue_id != track.queue_id)
                                {
                                    pipe.current.take()
                                } else {
                                    pipe.pending.take()
                                };
                                pipe.set_current(track, generation);
                                pipe.pending = next;
                            } else {
                                pipe.reset_dsp();
                            }
                            device = Some(replacement);
                            selected = id;
                            let _ = app.emit("audio_device_changed", ());
                        }
                    }
                    Ok(())
                })();
                let _ = request.response.send(result);
            }
            Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => (),
        }
        if signals.device_failed.swap(false, Ordering::AcqRel) {
            let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
            pending = None;
            device = None;
            signals.paused.store(true, Ordering::Release);
            // Buffered decoding can be ahead of the audible track. Reconnect at
            // the last consumed position rather than skipping queued audio.
            let restored = audible
                .as_ref()
                .map(|track| {
                    let mut replacement = ResampledTrack::new(&track.path, track.queue_id.clone())?;
                    replacement.seek(f64::from_bits(signals.position.load(Ordering::Acquire)))?;
                    Ok::<_, String>(replacement)
                })
                .transpose();
            match restored {
                Ok(Some(track)) => {
                    let next = if pipe
                        .current
                        .as_ref()
                        .is_some_and(|current| current.queue_id != track.queue_id)
                    {
                        pipe.current.take()
                    } else {
                        pipe.pending.take()
                    };
                    pipe.set_current(track, generation);
                    pipe.pending = next;
                }
                Ok(None) => pipe.stop(),
                Err(error) => {
                    pipe.stop();
                    audible = None;
                    signals.playing.store(false, Ordering::Release);
                    shared.lock().error = Some(error);
                }
            }
            let _ = app.emit(
                "audio_error",
                "Audio device disconnected. Reconnect it and press play.",
            );
        }
        let generation = signals.generation.load(Ordering::Acquire);
        if let Some(out) = &device {
            // Drop exhausted/stale PCM and event allocations on this worker.
            while out.retired.try_recv().is_ok() {}
            if !signals.paused.load(Ordering::Relaxed) {
                if pending.is_none() {
                    pending = pipe
                        .next_block(generation)
                        .or_else(|| pipe.terminal_block(generation));
                }
                if let Some(block) = pending.take() {
                    match out.sender.try_send(block) {
                        Ok(()) => (),
                        Err(TrySendError::Full(block)) => pending = Some(block),
                        Err(TrySendError::Disconnected(_)) => {
                            signals.device_failed.store(true, Ordering::Release)
                        }
                    }
                }
            }
        }
        while let Ok(notice) = notices.try_recv() {
            match notice {
                RenderNotice::Started {
                    generation: g,
                    serial,
                    event,
                } if g == generation => {
                    let _ = serial;
                    audible = Some(event.clone());
                    let _ = app.emit("track_started", event);
                }
                RenderNotice::Ended {
                    generation: g,
                    event,
                } if g == generation => {
                    let _ = app.emit("track_ended", event);
                }
                _ => (),
            }
        }
        if let Some(error) = pipe.render_error.take() {
            shared.lock().error = Some(error.clone());
            signals.playing.store(false, Ordering::Release);
            let _ = app.emit("audio_error", error);
        }
        if last_update.elapsed() > Duration::from_millis(100) {
            let mut info = shared.lock();
            info.ready = device.is_some();
            info.device_name = device.as_ref().map(|d| d.name.clone());
            info.output_sample_rate = device.as_ref().map(|d| d.sample_rate);
            info.output_channels = device.as_ref().map(|d| d.channels);
            info.output_format = device.as_ref().map(|d| d.sample_format.clone());
            info.queue_id = audible.as_ref().map(|t| t.queue_id.clone());
            info.path = audible.as_ref().map(|t| t.path.clone());
            info.duration = audible.as_ref().map_or(0.0, |t| t.duration);
            info.sample_rate = audible.as_ref().map_or(0, |t| t.sample_rate);
            info.bit_depth = audible.as_ref().map_or(0, |t| t.bit_depth);
            info.channels = audible.as_ref().map_or(0, |t| t.channels);
            info.current_time = f64::from_bits(signals.position.load(Ordering::Acquire));
            info.is_playing =
                signals.playing.load(Ordering::Acquire) && !signals.paused.load(Ordering::Acquire);
            info.volume = pipe.volume;
            info.playback_rate = pipe.speed;
            info.is_purist = pipe.purist;
            info.crossfade_seconds = pipe.crossfade;
            info.normalization = pipe.normalization.clone();
            info.preamp_db = pipe.preamp_db;
            info.clipping_count = pipe.clipping;
            info.underrun_count = signals.underruns.load(Ordering::Relaxed);
            let _ = app.emit("playback_update", info.clone());
            last_update = Instant::now();
        }
        if last_fft.elapsed() > Duration::from_millis(33)
            && signals.playing.load(Ordering::Relaxed)
            && !signals.paused.load(Ordering::Relaxed)
        {
            let waveform: Vec<f32> = pipe
                .analysis
                .iter()
                .rev()
                .take(2048)
                .copied()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if waveform.len() == 2048 {
                let mut bins: Vec<rustfft::num_complex::Complex<f32>> = waveform
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .enumerate()
                    .map(|(i, pair)| {
                        let window =
                            0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / 1023.0).cos());
                        rustfft::num_complex::Complex::new((pair[0] + pair[1]) * 0.5 * window, 0.0)
                    })
                    .collect();
                fft.process(&mut bins);
                let magnitudes: Vec<f32> = bins
                    .iter()
                    .take(512)
                    .map(|v| (v.norm() / 512.0).min(1.0))
                    .collect();
                let _ = app.emit(
                    "fft_data",
                    serde_json::json!({"fft":magnitudes,"waveform":waveform}),
                );
            }
            last_fft = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numeric_boundary_rejects_nonfinite_and_negative() {
        assert!(bounded(f64::NAN, 0.0, 1.0).is_err());
        assert!(bounded(-1.0, 0.0, 1.0).is_err());
        assert!(bounded(0.5, 0.0, 1.0).is_ok());
    }
    #[test]
    fn expired_requests_are_rejected_before_mutation() {
        assert!(check_deadline(Instant::now() - Duration::from_secs(1)).is_err());
        assert!(check_deadline(Instant::now() + Duration::from_secs(1)).is_ok());
    }
}
