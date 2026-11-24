//! Audio rendering consumes prepared decoders and output ports without waiting on setup I/O.
#[path = "audio/mod.rs"]
pub(crate) mod audio;
use audio::{
    equalizer::{EqualizerMode, EqualizerSettings, GRAPHIC_FREQUENCIES},
    output::{self, OutputPort, OutputSignals},
    pipeline::Pipeline,
    preparation::{
        DeviceJob, Preparation, Prepared, Reply, Revision, Stamp, TrackAction, TrackJob,
    },
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
use tauri_specta::Event;

#[derive(Clone, Serialize, specta::Type)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}
#[derive(Clone, Serialize, specta::Type)]
pub struct TrackEvent {
    pub queue_id: String,
    pub path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub format: String,
}
impl tauri_specta::Event for TrackEvent {
    const NAME: &'static str = "track_started";
}
#[derive(Clone, Serialize, specta::Type)]
pub struct EndedEvent {
    pub queue_id: String,
    pub path: String,
    pub next_queue_id: Option<String>,
    pub reason: String,
}
impl tauri_specta::Event for EndedEvent {
    const NAME: &'static str = "track_ended";
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
#[derive(Clone, Serialize, Default, specta::Type)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub device_name: Option<String>,
    pub output_sample_rate: Option<u32>,
    pub output_channels: Option<usize>,
    pub output_format: Option<String>,
    pub resampler: String,
    pub queue_id: Option<String>,
    pub path: Option<String>,
    pub current_time: f64,
    pub duration: f64,
    pub is_playing: bool,
    pub volume: f32,
    pub playback_rate: f32,
    pub is_purist: bool,
    pub eq_mode: EqualizerMode,
    pub eq_preamp_db: f64,
    pub crossfade_seconds: f32,
    pub normalization: String,
    pub preamp_db: f32,
    pub clipping_count: u64,
    pub underrun_count: u64,
    pub ready: bool,
    pub error: Option<String>,
}
impl tauri_specta::Event for AudioInfo {
    const NAME: &'static str = "playback_update";
}
enum Command {
    Play(String, String, Option<f64>, Stamp),
    Queue(String, String),
    Clear,
    Stop,
    Pause(bool),
    Toggle,
    Seek(f64, Stamp),
    Volume(f32),
    Speed(f32),
    Eq(usize, f32),
    ConfigureEq(EqualizerSettings, bool),
    Purist(bool),
    Crossfade(f32),
    Normalize(String, f32),
    Device(Option<String>),
}
struct Request {
    command: Command,
    reply: Reply,
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
    transport: Revision,
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
        let preparation = Preparation::new()?;
        let (sender, receiver) = mpsc::sync_channel::<Request>(64);
        let info = Arc::new(Mutex::new(AudioInfo::default()));
        let shared = info.clone();
        std::thread::Builder::new()
            .name("rawh-audio".into())
            .spawn(move || worker(app, receiver, shared, preparation))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sender,
            info,
            transport: Revision::default(),
        })
    }
    fn send(&self, command: Command) -> Result<(), String> {
        let (response, result) = mpsc::sync_channel(1);
        self.sender
            .try_send(Request {
                command,
                reply: Reply {
                    sender: response,
                    deadline: Instant::now() + Duration::from_secs(15),
                },
            })
            .map_err(|_| "Audio engine is busy or unavailable".to_string())?;
        result
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Audio operation timed out".to_string())?
    }
    pub fn play_file_with_id(&self, path: String, id: String) -> Result<(), String> {
        self.play_reserved(path, id, None, self.reserve_play())
    }
    pub(crate) fn reserve_play(&self) -> Stamp {
        self.transport.advance()
    }
    pub(crate) fn play_reserved(
        &self,
        path: String,
        id: String,
        position: Option<f64>,
        stamp: Stamp,
    ) -> Result<(), String> {
        if let Some(position) = position {
            bounded(position, 0.0, 864000.0)?;
        }
        self.send(Command::Play(path, id, position, stamp))
    }
    pub fn queue_next_file_with_id(&self, path: String, id: String) -> Result<(), String> {
        self.send(Command::Queue(path, id))
    }
    pub fn clear_pending(&self) -> Result<(), String> {
        self.send(Command::Clear)
    }
    pub fn stop(&self) -> Result<(), String> {
        self.transport.advance();
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
        self.send(Command::Seek(value, self.transport.advance()))
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
        if index >= GRAPHIC_FREQUENCIES.len() {
            return Err("Invalid equalizer band".into());
        }
        bounded(gain as f64, -12.0, 12.0)?;
        self.send(Command::Eq(index, gain))
    }
    pub fn configure_equalizer(
        &self,
        settings: EqualizerSettings,
        bypass: bool,
    ) -> Result<(), String> {
        settings.validate()?;
        self.send(Command::ConfigureEq(settings, bypass))
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

fn worker(
    app: AppHandle,
    receiver: mpsc::Receiver<Request>,
    shared: Arc<Mutex<AudioInfo>>,
    preparation: Preparation,
) {
    let signals = Arc::new(OutputSignals::default());
    let (notice_tx, notices) = mpsc::sync_channel(128);
    let upcoming = Revision::default();
    let route = Revision::default();
    let mut device: Option<OutputPort> = None;
    let mut opening = false;
    let mut waiting_for_output: Option<Request> = None;
    let mut selected: Option<String> = None;
    let mut pipe = Pipeline::new();
    let mut pending = None;
    let mut audible: Option<TrackEvent> = None;
    let mut last_update = Instant::now();
    let mut retry = Instant::now() - Duration::from_secs(3);
    let mut last_fft = Instant::now();
    let mut media = crate::media_session::Publisher::default();
    let fft = rustfft::FftPlanner::<f32>::new().plan_fft_forward(1024);
    loop {
        while let Ok(notice) = notices.try_recv() {
            let generation = signals.generation.load(Ordering::Acquire);
            match notice {
                RenderNotice::Started {
                    generation: g,
                    serial,
                    event,
                } if g == generation => {
                    let _ = serial;
                    audible = Some(event.clone());
                    let _ = event.emit(&app);
                }
                RenderNotice::Ended {
                    generation: g,
                    event,
                } if g == generation => {
                    let _ = event.emit(&app);
                }
                _ => (),
            }
        }
        if device
            .as_ref()
            .is_some_and(|out| out.failed.load(Ordering::Acquire))
        {
            device = None;
            signals.generation.fetch_add(1, Ordering::AcqRel);
            pending = None;
            upcoming.advance();
            signals.paused.store(true, Ordering::Release);
            shared.lock().error =
                Some("Audio device disconnected. Reconnect it and press play.".into());
            let _ = app.emit(
                "audio_error",
                "Audio device disconnected. Reconnect it and press play.",
            );
        }
        if device.is_none() && !opening && retry.elapsed() > Duration::from_secs(2) {
            retry = Instant::now();
            let job = DeviceJob {
                id: selected.clone(),
                stamp: route.advance(),
                generation: signals.generation.load(Ordering::Acquire),
                resume: audible.clone(),
                speed: pipe.speed,
                reply: None,
            };
            opening = preparation
                .device(job, signals.clone(), notice_tx.clone())
                .is_ok();
        }

        let request = if waiting_for_output.as_ref().is_some_and(|request| {
            device.is_some() || !opening || Instant::now() >= request.reply.deadline
        }) {
            Ok(waiting_for_output.take().unwrap())
        } else {
            receiver.try_recv()
        };
        match request {
            Ok(request)
                if device.is_none()
                    && opening
                    && Instant::now() < request.reply.deadline
                    && matches!(&request.command, Command::Play(..)) =>
            {
                // A file-association launch may reach playback while the first
                // output is still opening. Keep processing other commands.
                if let Some(previous) = waiting_for_output.replace(request) {
                    previous
                        .reply
                        .finish(Err("A newer audio operation replaced this request.".into()));
                }
            }
            Ok(Request { command, reply }) => {
                let result = (|| -> Result<bool, String> {
                    check_deadline(reply.deadline)?;
                    let generation = signals.generation.load(Ordering::Acquire);
                    let sample_rate = pipe.sample_rate;
                    let speed = pipe.speed;
                    let open_track = |action, path, queue_id, stamp| {
                        preparation.track(TrackJob {
                            action,
                            path,
                            queue_id,
                            sample_rate,
                            speed,
                            stamp,
                            generation,
                            reply: reply.clone(),
                        })?;
                        Ok::<_, String>(true)
                    };
                    match command {
                        Command::Play(path, id, position, stamp) => {
                            if device.is_none() {
                                return Err("Connect an audio output device first".into());
                            }
                            return open_track(TrackAction::Play(position), path, id, stamp);
                        }
                        Command::Queue(path, id) => {
                            return open_track(TrackAction::Queue, path, id, upcoming.advance());
                        }
                        Command::Clear => {
                            upcoming.advance();
                            pipe.pending = None;
                        }
                        Command::Stop => {
                            if let Some(start) = waiting_for_output.take() {
                                start.reply.finish(Err("Playback was stopped.".into()));
                            }
                            upcoming.advance();
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
                        Command::Seek(position, stamp) => {
                            let track = audible.as_ref().ok_or("No track loaded")?;
                            if track.duration > 0.0 && position > track.duration {
                                return Err("Seek exceeds track duration".into());
                            }
                            return open_track(
                                TrackAction::Seek(position),
                                track.path.clone(),
                                track.queue_id.clone(),
                                stamp,
                            );
                        }
                        Command::Volume(value) => pipe.volume = value,
                        Command::Speed(value) => pipe.speed = value,
                        Command::Eq(index, value) => {
                            let mut settings = pipe.eq_settings.clone();
                            settings.graphic_gains[index] = f64::from(value);
                            pipe.configure_eq(settings, pipe.purist);
                        }
                        Command::ConfigureEq(settings, bypass) => {
                            pipe.configure_eq(settings, bypass)
                        }
                        Command::Purist(value) => pipe.bypass_eq(value),
                        Command::Crossfade(value) => pipe.crossfade = value,
                        Command::Normalize(mode, preamp) => {
                            pipe.normalization = mode;
                            pipe.preamp_db = preamp;
                        }
                        Command::Device(id) => {
                            let job = DeviceJob {
                                id,
                                stamp: route.advance(),
                                generation,
                                resume: audible.clone(),
                                speed,
                                reply: Some(reply.clone()),
                            };
                            opening = false;
                            preparation.device(job, signals.clone(), notice_tx.clone())?;
                            opening = true;
                            return Ok(true);
                        }
                    }
                    Ok(false)
                })();
                match result {
                    Ok(true) => (),
                    Ok(false) => reply.finish(Ok(())),
                    Err(error) => reply.finish(Err(error)),
                }
            }
            Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => (),
        }

        while let Ok(prepared) = preparation.results.try_recv() {
            match prepared {
                Prepared::Track(job, result) => {
                    let result = (|| {
                        job.stamp.check(job.reply.deadline)?;
                        let track = result?;
                        let generation = signals.generation.load(Ordering::Acquire);
                        match job.action {
                            TrackAction::Queue if job.generation == generation => {
                                pipe.pending = Some(track);
                                return Ok(());
                            }
                            TrackAction::Queue => {
                                return Err(
                                    "Playback changed before the next track was ready.".into()
                                )
                            }
                            TrackAction::Seek(_)
                                if job.generation != generation
                                    || audible.as_ref().map(|current| &current.queue_id)
                                        != Some(&job.queue_id) =>
                            {
                                return Err("Playback changed before the seek was ready.".into());
                            }
                            _ => (),
                        }
                        if device.is_none() {
                            return Err("Connect an audio output device first".into());
                        }
                        let next = if matches!(job.action, TrackAction::Seek(_)) {
                            pipe.pending.take()
                        } else {
                            None
                        };
                        if matches!(job.action, TrackAction::Play(_)) {
                            signals.paused.store(false, Ordering::Release);
                        }
                        let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
                        signals
                            .position
                            .store(track.position.to_bits(), Ordering::Release);
                        upcoming.advance();
                        pending = None;
                        pipe.set_current(track, generation);
                        pipe.pending = next;
                        shared.lock().error = None;
                        signals.playing.store(true, Ordering::Release);
                        Ok(())
                    })();
                    job.reply.finish(result);
                }
                Prepared::Device(job, output, restored) => {
                    let current = job.stamp.is_current();
                    if current {
                        opening = false;
                    }
                    let result = (|| {
                        if !current
                            || job.generation != signals.generation.load(Ordering::Acquire)
                            || job.resume.as_ref().map(|track| &track.queue_id)
                                != audible.as_ref().map(|track| &track.queue_id)
                        {
                            return Err("Playback changed before the output was ready.".into());
                        }
                        if let Some(reply) = &job.reply {
                            check_deadline(reply.deadline)?;
                        }
                        let output = output?;
                        if output.failed.load(Ordering::Acquire) {
                            return Err(
                                "The output device disconnected before it was ready.".into()
                            );
                        }
                        let restored = if job.reply.is_some() {
                            restored?
                        } else {
                            match restored {
                                Ok(track) => track,
                                Err(error) => {
                                    pipe.stop();
                                    audible = None;
                                    signals.playing.store(false, Ordering::Release);
                                    let _ = app.emit("audio_error", error);
                                    None
                                }
                            }
                        };
                        drop(device.take());
                        let generation = signals.generation.fetch_add(1, Ordering::AcqRel) + 1;
                        pending = None;
                        pipe.sample_rate = output.sample_rate;
                        pipe.channels = output.channels;
                        if let Some(track) = restored {
                            let next = pipe.pending.take();
                            signals
                                .position
                                .store(track.position.to_bits(), Ordering::Release);
                            upcoming.advance();
                            pipe.set_current(track, generation);
                            pipe.pending = next;
                        } else {
                            pipe.reset_dsp();
                        }
                        device = Some(output);
                        selected = job.id;
                        shared.lock().error = None;
                        let _ = app.emit("audio_device_changed", ());
                        Ok(())
                    })();
                    if let Some(reply) = job.reply {
                        reply.finish(result);
                    } else if current {
                        if let Err(error) = result {
                            shared.lock().error = Some(error);
                        }
                    }
                }
            }
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
                            out.failed.store(true, Ordering::Release)
                        }
                    }
                }
            }
            out.enabled.store(true, Ordering::Release);
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
            info.resampler = if info.sample_rate == 0 {
                "Inactive"
            } else if info.output_sample_rate == Some(info.sample_rate) && pipe.speed == 1.0 {
                "Bypassed (matching rate)"
            } else {
                "Rubato sinc (256 taps)"
            }
            .into();
            info.is_purist = pipe.purist;
            info.eq_mode = pipe.eq_settings.mode;
            info.eq_preamp_db = pipe.applied_eq_preamp();
            info.crossfade_seconds = pipe.crossfade;
            info.normalization = pipe.normalization.clone();
            info.preamp_db = pipe.preamp_db;
            info.clipping_count = pipe.clipping;
            info.underrun_count = signals.underruns.load(Ordering::Relaxed);
            let _ = info.clone().emit(&app);
            media.update(&app, &info);
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
