use rodio::{source::Source, Decoder, OutputStream, OutputStreamHandle, Sink};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use log::info;
use cpal::traits::{DeviceTrait, HostTrait};

/// SAFETY: We wrap rodio's OutputStream which is not strictly Send + Sync
/// because it might contain platform-specific COM pointers (on Windows).
/// However, we only store it to keep the audio thread alive and never mutate
/// it from multiple threads. The OutputStreamHandle handles the actual thread-safe
/// communication with the underlying audio stream. Thus, it is safe to hold it
/// across threads inside a parking_lot::Mutex as long as we don't call its methods from
/// other threads.
pub struct SendSyncOutputStream(OutputStream);
unsafe impl Send for SendSyncOutputStream {}
unsafe impl Sync for SendSyncOutputStream {}

pub struct AudioState {
    sink: Option<Sink>,
    _stream: SendSyncOutputStream,
    stream_handle: OutputStreamHandle,
    current_path: Option<String>,
    duration: f64,
    pub channels: u16,
    pub volume: f32,
    pub sample_rate: u32,
    pub bit_depth: u16,
    app_handle: AppHandle,
    queue: VecDeque<(String, f64, u32, u16, u16)>, // path, duration, sample_rate, bit_depth, channels
}

#[derive(Serialize, Clone)]
pub struct PlaybackUpdate {
    pub current_time: f64,
    pub duration: f64,
    pub is_playing: bool,
    pub sample_rate: u32,
    pub bit_depth: u16,
}

#[derive(Serialize, Clone)]
pub struct FftUpdate {
    pub fft: Vec<f32>,
    pub waveform: Vec<f32>,
}

#[derive(Serialize, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize, Clone)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub device_name: String,
}

pub const EQ_FREQUENCIES: [f32; 10] = [32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];

#[derive(Clone)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

struct EqualizerBandFilter {
    frequency: f32,
    gain: f32,
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    channels_state: Vec<BiquadState>,
}

impl EqualizerBandFilter {
    pub fn new(frequency: f32, gain: f32, sample_rate: f32, num_channels: usize) -> Self {
        let mut filter = Self {
            frequency,
            gain,
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            channels_state: vec![BiquadState { x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }; num_channels],
        };
        filter.update_coefficients(sample_rate);
        filter
    }

    pub fn update_coefficients(&mut self, sample_rate: f32) {
        let q = 1.4142f32; 
        let rate = if sample_rate > 0.0 { sample_rate } else { 44100.0 };
        let a = 10.0f32.powf(self.gain / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * self.frequency / rate;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn process_sample(&mut self, channel_idx: usize, x: f32) -> f32 {
        if channel_idx >= self.channels_state.len() {
            return x;
        }
        let state = &mut self.channels_state[channel_idx];
        let y = self.b0 * x + self.b1 * state.x1 + self.b2 * state.x2 - self.a1 * state.y1 - self.a2 * state.y2;
        state.x2 = state.x1;
        state.x1 = x;
        state.y2 = state.y1;
        state.y1 = y;
        y
    }
}

struct FftInterceptor<I> {
    inner: I,
    buffer: Arc<parking_lot::Mutex<VecDeque<f32>>>,
    eq_gains: Arc<Vec<AtomicI32>>,
    is_purist: Arc<AtomicBool>,
    bands: Vec<EqualizerBandFilter>,
    current_channel: usize,
    sample_counter: usize,
    clipping_counter: Arc<AtomicU32>,
}

impl<I: Source<Item = f32>> Source for FftInterceptor<I> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

impl<I: Source<Item = f32>> Iterator for FftInterceptor<I> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let mut sample = self.inner.next()?;
        
        let sample_rate = self.inner.sample_rate() as f32;
        let channels = self.inner.channels() as usize;

        self.sample_counter = self.sample_counter.wrapping_add(1);

        if self.sample_counter % 256 == 0 {
            for i in 0..10 {
                let target_gain = self.eq_gains[i].load(Ordering::Relaxed) as f32 / 1000.0;
                let band = &mut self.bands[i];
                if (band.gain - target_gain).abs() > 0.001 {
                    band.gain = target_gain;
                    band.update_coefficients(sample_rate);
                }
            }
        }

        if !self.is_purist.load(Ordering::Relaxed) {
            for i in 0..10 {
                sample = self.bands[i].process_sample(self.current_channel, sample);
            }
            if sample.abs() > 1.0 {
                self.clipping_counter.fetch_add(1, Ordering::Relaxed);
                sample = sample.clamp(-1.0, 1.0);
            }
        }

        self.current_channel = (self.current_channel + 1) % channels;

        if let Some(mut buf) = self.buffer.try_lock() {
            buf.push_back(sample);
            if buf.len() > 4096 {
                buf.pop_front();
            }
        }
        Some(sample)
    }
}

pub struct AudioEngine {
    state: Arc<parking_lot::Mutex<AudioState>>,
    fft_buffer: Arc<parking_lot::Mutex<VecDeque<f32>>>,
    shutdown: Arc<AtomicBool>,
    eq_gains: Arc<Vec<AtomicI32>>,
    is_purist: Arc<AtomicBool>,
    playback_rate: Arc<AtomicU32>,
    crossfade_duration: Arc<AtomicU32>,
    clipping_counter: Arc<AtomicU32>,
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

impl AudioEngine {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        info!("Initializing native AudioEngine...");
        
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| format!("Failed to open default audio output device: {}", e))?;

        let fft_buffer = Arc::new(parking_lot::Mutex::new(VecDeque::with_capacity(4096)));
        let eq_gains = Arc::new((0..10).map(|_| AtomicI32::new(0)).collect::<Vec<_>>());
        let is_purist = Arc::new(AtomicBool::new(true));
        let playback_rate = Arc::new(AtomicU32::new(1000));
        let crossfade_duration = Arc::new(AtomicU32::new(0));
        let clipping_counter = Arc::new(AtomicU32::new(0));

        let state = Arc::new(parking_lot::Mutex::new(AudioState {
            sink: None,
            _stream: SendSyncOutputStream(stream),
            stream_handle,
            current_path: None,
            duration: 0.0,
            channels: 2,
            volume: 1.0,
            sample_rate: 44100,
            bit_depth: 16,
            app_handle: app_handle.clone(),
            queue: VecDeque::new(),
        }));

        let shutdown = Arc::new(AtomicBool::new(false));

        // FFT thread
        let fft_buffer_clone = fft_buffer.clone();
        let app_handle_clone = app_handle.clone();
        let shutdown_clone1 = shutdown.clone();
        let state_clone_fft = state.clone();
        let clipping_clone = clipping_counter.clone();
        
        thread::spawn(move || {
            let mut planner = FftPlanner::new();
            let fft = planner.plan_fft_forward(1024);
            let mut last_channels = 2;
            
            while !shutdown_clone1.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(33)); 
                
                let clips = clipping_clone.swap(0, Ordering::Relaxed);
                if clips > 0 {
                    let _ = app_handle_clone.emit("clipping_detected", ());
                }
                
                let mut channels = last_channels;
                if let Some(state_lock) = state_clone_fft.try_lock() {
                    channels = state_lock.channels;
                    last_channels = channels;
                }
                
                let required_samples = if channels == 2 { 2048 } else { 1024 };
                let mut samples = Vec::with_capacity(required_samples);
                if let Some(buf_lock) = fft_buffer_clone.try_lock() {
                    if buf_lock.len() >= required_samples {
                        samples = buf_lock.iter().rev().take(required_samples).copied().collect();
                        samples.reverse();
                    }
                }
                
                if !samples.is_empty() {
                    let mono_samples = if channels == 2 {
                        let mut downmixed = Vec::with_capacity(1024);
                        for chunk in samples.chunks_exact(2) {
                            downmixed.push((chunk[0] + chunk[1]) * 0.5);
                        }
                        downmixed
                    } else {
                        samples.clone()
                    };
                    
                    let n = mono_samples.len();
                    let n_f = if n > 1 { (n - 1) as f32 } else { 1.0 };
                    let mut buffer: Vec<Complex<f32>> = mono_samples.iter().enumerate()
                        .map(|(i, &s)| {
                            let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n_f).cos());
                            Complex { re: s * window, im: 0.0 }
                        })
                        .collect();
                        
                    fft.process(&mut buffer);
                    
                    let magnitudes: Vec<f32> = buffer.iter()
                        .take(512) 
                        .map(|c| c.norm())
                        .collect();
                        
                    let waveform: Vec<f32> = samples.iter().take(1024).copied().collect();
                    let _ = app_handle_clone.emit("fft_data", FftUpdate { fft: magnitudes, waveform });
                }
            }
        });

        // Playback state thread
        let state_clone = state.clone();
        let shutdown_clone2 = shutdown.clone();
        thread::spawn(move || {
            let mut track_ended_emitted = false;
            let mut last_pos = 0.0;
            
            while !shutdown_clone2.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100)); 
                
                let mut is_empty = false;
                let mut pos = 0.0;
                let mut duration = 0.0;
                let mut is_playing = false;
                let mut has_sink = false;
                let mut sample_rate = 44100;
                let mut bit_depth = 16;

                if let Some(mut state_lock) = state_clone.try_lock() {
                    let sink_exists = state_lock.sink.is_some();
                    if sink_exists {
                        has_sink = true;
                        
                        let sink_empty = state_lock.sink.as_ref().unwrap().empty();
                        let sink_pos = state_lock.sink.as_ref().unwrap().get_pos().as_secs_f64();
                        let sink_paused = state_lock.sink.as_ref().unwrap().is_paused();
                        
                        is_empty = sink_empty;
                        pos = sink_pos;
                        
                        if pos < last_pos && pos < 1.0 && last_pos > 1.0 {
                            if let Some((path, dur, sr, bd, ch)) = state_lock.queue.pop_front() {
                                state_lock.current_path = Some(path);
                                state_lock.duration = dur;
                                state_lock.sample_rate = sr;
                                state_lock.bit_depth = bd;
                                state_lock.channels = ch;
                                info!("Track transition detected. Next track duration: {}", dur);
                            }
                        }
                        
                        duration = state_lock.duration;
                        is_playing = !sink_paused && !is_empty;
                        sample_rate = state_lock.sample_rate;
                        bit_depth = state_lock.bit_depth;
                    }
                }
                
                last_pos = pos;

                if has_sink {
                    if is_empty {
                        if !track_ended_emitted {
                            if let Some(state_lock) = state_clone.try_lock() {
                                info!("Track finished playing. Emitting track_ended event.");
                                let _ = state_lock.app_handle.emit("track_ended", ());
                                track_ended_emitted = true;
                            }
                        }
                    } else {
                        track_ended_emitted = false;
                    }

                    if let Some(state_lock) = state_clone.try_lock() {
                        let _ = state_lock.app_handle.emit("playback_update", PlaybackUpdate {
                            current_time: pos,
                            duration,
                            is_playing,
                            sample_rate,
                            bit_depth,
                        });
                    }
                }
            }
        });

        Ok(Self { state, fft_buffer, shutdown, eq_gains, is_purist, playback_rate, crossfade_duration, clipping_counter })
    }
    
    pub fn list_audio_devices(&self) -> Result<Vec<AudioDeviceInfo>, String> {
        let host = cpal::default_host();
        let default_out = host.default_output_device().map(|d| d.name().unwrap_or_default()).unwrap_or_default();
        
        let mut devices = Vec::new();
        if let Ok(out_devices) = host.output_devices() {
            for device in out_devices {
                if let Ok(name) = device.name() {
                    devices.push(AudioDeviceInfo {
                        is_default: name == default_out,
                        name,
                    });
                }
            }
        }
        // TODO: Switch devices at runtime requires recreating the OutputStream, which is complex.
        Ok(devices)
    }
    
    pub fn set_playback_rate(&self, rate: f32) -> Result<(), String> {
        self.playback_rate.store((rate * 1000.0) as u32, Ordering::Relaxed);
        let state = self.state.lock();
        if let Some(sink) = &state.sink {
            sink.set_speed(rate);
        }
        Ok(())
    }
    
    pub fn set_crossfade_duration(&self, seconds: f32) -> Result<(), String> {
        // TODO: implement full crossfade
        self.crossfade_duration.store((seconds * 1000.0) as u32, Ordering::Relaxed);
        Ok(())
    }
    
    pub fn get_audio_info(&self) -> Result<AudioInfo, String> {
        let state = self.state.lock();
        let host = cpal::default_host();
        let default_out = host.default_output_device().map(|d| d.name().unwrap_or_default()).unwrap_or_default();
        Ok(AudioInfo {
            sample_rate: state.sample_rate,
            bit_depth: state.bit_depth,
            channels: state.channels,
            device_name: default_out,
        })
    }

    fn probe_file(path: &str) -> Result<(f64, u32, u16), String> {
        let path_buf = std::path::PathBuf::from(path);
        let ext = path_buf.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        let mut probed_duration = 0.0;
        let mut sample_rate = 44100;
        let mut bit_depth = 16;
        
        if let Ok(file) = File::open(path) {
            let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());
            let mut hint = symphonia::core::probe::Hint::new();
            if !ext.is_empty() {
                hint.with_extension(&ext);
            }
            
            if let Ok(probed) = symphonia::default::get_probe().format(
                &hint,
                mss,
                &symphonia::core::formats::FormatOptions::default(),
                &symphonia::core::meta::MetadataOptions::default()
            ) {
                for track in probed.format.tracks() {
                    if let Some(sr) = track.codec_params.sample_rate {
                        sample_rate = sr;
                    }
                    if let Some(bps) = track.codec_params.bits_per_sample {
                        bit_depth = bps as u16;
                    }
                    if let Some(tb) = track.codec_params.time_base {
                        if let Some(n_frames) = track.codec_params.n_frames {
                            let time = tb.calc_time(n_frames);
                            probed_duration = time.seconds as f64 + time.frac;
                            break;
                        }
                    }
                }
            }
        }
        Ok((probed_duration, sample_rate, bit_depth))
    }

    pub fn play_file(&self, path: String) -> Result<(), String> {
        info!("AudioEngine: Play file requested for: {}", path);
        
        let path_buf = std::path::PathBuf::from(&path);
        if !path_buf.is_file() {
            return Err("File does not exist or is not a file".to_string());
        }

        let (mut probed_duration, sample_rate, bit_depth) = Self::probe_file(&path)?;

        let mut state = self.state.lock();
        
        if let Some(old_sink) = state.sink.take() {
            old_sink.stop();
        }

        let sink = Sink::try_new(&state.stream_handle)
            .map_err(|e| format!("Failed to create audio Sink: {}", e))?;
        sink.set_volume(state.volume);

        let file = File::open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let decoder = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Decoder failed to parse file: {}", e))?;
        
        let file_channels = decoder.channels();
        let f32_source = decoder.convert_samples::<f32>();
        
        if probed_duration == 0.0 {
            if let Some(dur) = f32_source.total_duration() {
                probed_duration = dur.as_secs_f64();
            }
        }

        state.duration = probed_duration;
        state.sample_rate = sample_rate;
        state.bit_depth = bit_depth;

        if let Some(mut buf) = self.fft_buffer.try_lock() {
            buf.clear();
        }

        let source_sr = f32_source.sample_rate() as f32;
        let num_channels = f32_source.channels() as usize;
        let mut bands = Vec::with_capacity(10);
        for &freq in &EQ_FREQUENCIES {
            bands.push(EqualizerBandFilter::new(freq, 0.0, source_sr, num_channels));
        }

        let interceptor = FftInterceptor {
            inner: f32_source,
            buffer: self.fft_buffer.clone(),
            eq_gains: self.eq_gains.clone(),
            is_purist: self.is_purist.clone(),
            bands,
            current_channel: 0,
            sample_counter: 0,
            clipping_counter: self.clipping_counter.clone(),
        };

        let rate = self.playback_rate.load(Ordering::Relaxed) as f32 / 1000.0;
        let speed_source = interceptor.speed(rate);

        sink.append(speed_source);
        sink.play();

        state.sink = Some(sink);
        state.current_path = Some(path);
        state.channels = file_channels;
        state.queue.clear();

        Ok(())
    }
    
    pub fn queue_next_file(&self, path: String) -> Result<(), String> {
        info!("AudioEngine: Queue next file requested for: {}", path);
        
        let path_buf = std::path::PathBuf::from(&path);
        if !path_buf.is_file() {
            return Err("File does not exist or is not a file".to_string());
        }

        let (mut probed_duration, sample_rate, bit_depth) = Self::probe_file(&path)?;

        let mut state = self.state.lock();
        
        if let Some(sink) = &state.sink {
            let file = File::open(&path)
                .map_err(|e| format!("Failed to open file: {}", e))?;
            let decoder = Decoder::new(BufReader::new(file))
                .map_err(|e| format!("Decoder failed to parse file: {}", e))?;
            
            let file_channels = decoder.channels();
            let f32_source = decoder.convert_samples::<f32>();
            
            if probed_duration == 0.0 {
                if let Some(dur) = f32_source.total_duration() {
                    probed_duration = dur.as_secs_f64();
                }
            }
            
            let source_sr = f32_source.sample_rate() as f32;
            let num_channels = f32_source.channels() as usize;
            let mut bands = Vec::with_capacity(10);
            for &freq in &EQ_FREQUENCIES {
                bands.push(EqualizerBandFilter::new(freq, 0.0, source_sr, num_channels));
            }

            let interceptor = FftInterceptor {
                inner: f32_source,
                buffer: self.fft_buffer.clone(),
                eq_gains: self.eq_gains.clone(),
                is_purist: self.is_purist.clone(),
                bands,
                current_channel: 0,
                sample_counter: 0,
                clipping_counter: self.clipping_counter.clone(),
            };

            let rate = self.playback_rate.load(Ordering::Relaxed) as f32 / 1000.0;
            let speed_source = interceptor.speed(rate);
            
            sink.append(speed_source);
            state.queue.push_back((path, probed_duration, sample_rate, bit_depth, file_channels));
        } else {
            return Err("No active sink to append to".to_string());
        }

        Ok(())
    }

    pub fn toggle_play(&self) -> Result<(), String> {
        let state = self.state.lock();
        if let Some(sink) = &state.sink {
            if sink.is_paused() {
                sink.play();
            } else {
                sink.pause();
            }
            Ok(())
        } else {
            Err("No track loaded".to_string())
        }
    }

    pub fn seek(&self, position: f64) -> Result<(), String> {
        let state = self.state.lock();
        if position > state.duration && state.duration > 0.0 {
            return Err(format!("Seek position ({:.2}s) exceeds track duration ({:.2}s)", position, state.duration));
        }
        if let Some(sink) = &state.sink {
            sink.try_seek(Duration::from_secs_f64(position))
                .map_err(|e| format!("Seek failed: {}", e))?;
            Ok(())
        } else {
            Err("No track loaded".to_string())
        }
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        let mut state = self.state.lock();
        state.volume = volume;
        if let Some(sink) = &state.sink {
            sink.set_volume(volume);
        }
        Ok(())
    }

    pub fn set_equalizer_band(&self, index: usize, gain: f32) -> Result<(), String> {
        self.eq_gains[index].store((gain * 1000.0) as i32, Ordering::Relaxed);
        Ok(())
    }

    pub fn set_purist_mode(&self, is_purist: bool) -> Result<(), String> {
        self.is_purist.store(is_purist, Ordering::Relaxed);
        Ok(())
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub duration: f64,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub file_size: u64,
}

impl AudioEngine {
    pub fn read_metadata(&self, path: String) -> Result<TrackMetadata, String> {
        let path_buf = std::path::PathBuf::from(&path);
        let file_size = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
        
        let mut track_meta = TrackMetadata {
            title: None,
            artist: None,
            album: None,
            year: None,
            genre: None,
            track_number: None,
            duration: 0.0,
            sample_rate: 0,
            bit_depth: 0,
            file_size,
        };

        if let Ok((duration, sample_rate, bit_depth)) = Self::probe_file(&path) {
            track_meta.duration = duration;
            track_meta.sample_rate = sample_rate;
            track_meta.bit_depth = bit_depth;
        }

        use lofty::file::{AudioFile, TaggedFileExt};
        use lofty::probe::Probe;
        use lofty::tag::Accessor;

        if let Ok(tagged_file) = Probe::open(&path_buf).and_then(|p| p.read()) {
            if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                track_meta.title = tag.title().map(|s| s.into_owned());
                track_meta.artist = tag.artist().map(|s| s.into_owned());
                track_meta.album = tag.album().map(|s| s.into_owned());
                track_meta.year = tag.year();
                track_meta.genre = tag.genre().map(|s| s.into_owned());
                track_meta.track_number = tag.track();
            }
        }

        Ok(track_meta)
    }

    pub fn write_metadata(&self, path: String, metadata: TrackMetadata) -> Result<(), String> {
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;
        use lofty::tag::{Accessor, Tag, TagExt};
        use lofty::config::WriteOptions;

        let path_buf = std::path::PathBuf::from(&path);
        
        let mut tagged_file = Probe::open(&path_buf)
            .and_then(|p| p.read())
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let mut tag = tagged_file.primary_tag_mut().cloned().unwrap_or_else(|| {
            let tag_type = tagged_file.primary_tag_type();
            Tag::new(tag_type)
        });

        if let Some(title) = metadata.title { tag.set_title(title); } else { tag.remove_title(); }
        if let Some(artist) = metadata.artist { tag.set_artist(artist); } else { tag.remove_artist(); }
        if let Some(album) = metadata.album { tag.set_album(album); } else { tag.remove_album(); }
        if let Some(year) = metadata.year { tag.set_year(year); } else { tag.remove_year(); }
        if let Some(genre) = metadata.genre { tag.set_genre(genre); } else { tag.remove_genre(); }
        if let Some(track) = metadata.track_number { tag.set_track(track); } else { tag.remove_track(); }

        tag.save_to_path(path_buf, WriteOptions::new()).map_err(|e| format!("Failed to save tags: {}", e))?;

        Ok(())
    }
}
