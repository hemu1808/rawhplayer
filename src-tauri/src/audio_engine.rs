use rodio::{OutputStream, OutputStreamHandle, Sink, Source, Decoder};
use rustfft::{FftPlanner, num_complex::Complex};
use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;
use std::collections::VecDeque;
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use std::thread;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use log::{info, error, warn};

#[allow(dead_code)]
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
    app_handle: AppHandle,
}

#[derive(Serialize, Clone)]
pub struct PlaybackUpdate {
    pub current_time: f64,
    pub duration: f64,
    pub is_playing: bool,
}

#[derive(Serialize, Clone)]
pub struct FftUpdate {
    pub fft: Vec<f32>,
    pub waveform: Vec<f32>,
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
        let q = 1.4142f32; // Default Q for 1-octave band spacing
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

// A custom Source wrapper to intercept samples for FFT and apply EQ
struct FftInterceptor<I> {
    inner: I,
    buffer: Arc<parking_lot::Mutex<VecDeque<f32>>>,
    eq_gains: Arc<Vec<AtomicI32>>,
    is_purist: Arc<AtomicBool>,
    bands: Vec<EqualizerBandFilter>,
    current_channel: usize,
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

        // Check if gains changed and update coefficients
        for i in 0..10 {
            let target_gain = self.eq_gains[i].load(Ordering::Relaxed) as f32 / 1000.0;
            let band = &mut self.bands[i];
            if (band.gain - target_gain).abs() > 0.001 {
                band.gain = target_gain;
                band.update_coefficients(sample_rate);
            }
        }

        // Apply filters in series if not in purist mode
        if !self.is_purist.load(Ordering::Relaxed) {
            for i in 0..10 {
                sample = self.bands[i].process_sample(self.current_channel, sample);
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

        let state = Arc::new(parking_lot::Mutex::new(AudioState {
            sink: None,
            _stream: SendSyncOutputStream(stream),
            stream_handle,
            current_path: None,
            duration: 0.0,
            channels: 2,
            volume: 1.0,
            app_handle: app_handle.clone(),
        }));

        let shutdown = Arc::new(AtomicBool::new(false));

        // Start FFT broadcast thread
        let fft_buffer_clone = fft_buffer.clone();
        let app_handle_clone = app_handle.clone();
        let shutdown_clone1 = shutdown.clone();
        let state_clone_fft = state.clone();
        thread::spawn(move || {
            let mut planner = FftPlanner::new();
            let fft = planner.plan_fft_forward(1024);
            let mut last_channels = 2;
            
            while !shutdown_clone1.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(33)); // ~30fps
                
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
                            // Apply Hann window to reduce spectral leakage
                            let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n_f).cos());
                            Complex { re: s * window, im: 0.0 }
                        })
                        .collect();
                        
                    fft.process(&mut buffer);
                    
                    let magnitudes: Vec<f32> = buffer.iter()
                        .take(512) // Nyquist limit
                        .map(|c| c.norm())
                        .collect();
                        
                    // Send 1024 samples (512 L/R frames) for visualization
                    let waveform: Vec<f32> = samples.iter().take(1024).copied().collect();
                    
                    let _ = app_handle_clone.emit("fft_data", FftUpdate { fft: magnitudes, waveform });
                }
            }
        });

        // Start Playback state broadcast thread
        let state_clone = state.clone();
        let shutdown_clone2 = shutdown.clone();
        thread::spawn(move || {
            let mut track_ended_emitted = false;
            
            while !shutdown_clone2.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100)); // More responsive 100ms updates
                
                let mut is_empty = false;
                let mut pos = 0.0;
                let mut duration = 0.0;
                let mut is_playing = false;
                let mut has_sink = false;

                if let Some(state_lock) = state_clone.try_lock() {
                    if let Some(sink) = &state_lock.sink {
                        has_sink = true;
                        is_empty = sink.empty();
                        pos = sink.get_pos().as_secs_f64();
                        duration = state_lock.duration;
                        is_playing = !sink.is_paused() && !is_empty;
                    }
                }

                if has_sink {
                    // Track End Detection
                    if is_empty {
                        if !track_ended_emitted {
                            let state_lock = state_clone.lock();
                            info!("Track finished playing. Emitting track_ended event.");
                            let _ = state_lock.app_handle.emit("track_ended", ());
                            track_ended_emitted = true;
                        }
                    } else {
                        track_ended_emitted = false;
                    }

                    if let Some(state_lock) = state_clone.try_lock() {
                        let _ = state_lock.app_handle.emit("playback_update", PlaybackUpdate {
                            current_time: pos,
                            duration,
                            is_playing,
                        });
                    }
                }
            }
        });

        Ok(Self { state, fft_buffer, shutdown, eq_gains, is_purist })
    }

    pub fn play_file(&self, path: String) -> Result<(), String> {
        info!("AudioEngine: Play file requested for: {}", path);
        
        // Path/Extension Validation on the Backend
        let path_buf = std::path::PathBuf::from(&path);
        if !path_buf.is_file() {
            error!("AudioEngine: File does not exist: {}", path);
            return Err("File does not exist or is not a file".to_string());
        }
        let ext = path_buf.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .ok_or_else(|| "File has no extension".to_string())?;

        if !["mp3", "wav", "flac", "ogg", "aac", "m4a", "aiff", "dsf", "dff"].contains(&ext.as_str()) {
            warn!("AudioEngine: Unsupported file extension: {}", ext);
            return Err("Unsupported file extension".to_string());
        }

        // Duration probe via symphonia
        let mut probed_duration = None;
        if let Ok(file) = File::open(&path) {
            let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());
            let mut hint = symphonia::core::probe::Hint::new();
            hint.with_extension(&ext);
            
            if let Ok(probed) = symphonia::default::get_probe().format(
                &hint,
                mss,
                &symphonia::core::formats::FormatOptions::default(),
                &symphonia::core::meta::MetadataOptions::default()
            ) {
                for track in probed.format.tracks() {
                    if let Some(tb) = track.codec_params.time_base {
                        if let Some(n_frames) = track.codec_params.n_frames {
                            let time = tb.calc_time(n_frames);
                            probed_duration = Some(time.seconds as f64 + time.frac);
                            break;
                        }
                    }
                }
            }
        }

        let mut state = self.state.lock();
        
        // Stop previous playback properly to prevent overlap/glitches (H-11)
        if let Some(old_sink) = state.sink.take() {
            info!("Stopping active sink before loading new track.");
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
        
        // Use probed duration as primary, fallback to rodio's duration if available
        if let Some(dur) = probed_duration {
            state.duration = dur;
            info!("Probed track duration: {:.2}s", dur);
        } else if let Some(dur) = f32_source.total_duration() {
            state.duration = dur.as_secs_f64();
            info!("Fallback track duration: {:.2}s", state.duration);
        } else {
            state.duration = 0.0;
            warn!("Could not determine track duration.");
        }

        // Clear FFT buffer between tracks to prevent visual bleed (M-12)
        if let Some(mut buf) = self.fft_buffer.try_lock() {
            buf.clear();
        }

        let sample_rate = f32_source.sample_rate() as f32;
        let num_channels = f32_source.channels() as usize;
        let mut bands = Vec::with_capacity(10);
        for &freq in &EQ_FREQUENCIES {
            bands.push(EqualizerBandFilter::new(freq, 0.0, sample_rate, num_channels));
        }

        let interceptor = FftInterceptor {
            inner: f32_source,
            buffer: self.fft_buffer.clone(),
            eq_gains: self.eq_gains.clone(),
            is_purist: self.is_purist.clone(),
            bands,
            current_channel: 0,
        };

        sink.append(interceptor);
        sink.play();

        state.sink = Some(sink);
        state.current_path = Some(path);
        state.channels = file_channels;

        Ok(())
    }

    pub fn toggle_play(&self) -> Result<(), String> {
        let state = self.state.lock();
        if let Some(sink) = &state.sink {
            if sink.is_paused() {
                info!("Resuming audio playback.");
                sink.play();
            } else {
                info!("Pausing audio playback.");
                sink.pause();
            }
            Ok(())
        } else {
            Err("No track loaded".to_string())
        }
    }

    pub fn seek(&self, position: f64) -> Result<(), String> {
        if position < 0.0 {
            return Err("Seek position cannot be negative".to_string());
        }
        let state = self.state.lock();
        if position > state.duration && state.duration > 0.0 {
            return Err(format!("Seek position ({:.2}s) exceeds track duration ({:.2}s)", position, state.duration));
        }
        if let Some(sink) = &state.sink {
            info!("Seeking to position: {:.2}s", position);
            sink.try_seek(Duration::from_secs_f64(position))
                .map_err(|e| format!("Seek failed: {}", e))?;
            Ok(())
        } else {
            Err("No track loaded".to_string())
        }
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        if volume < 0.0 || volume > 1.0 {
            return Err("Volume must be between 0.0 and 1.0".to_string());
        }
        let mut state = self.state.lock();
        state.volume = volume;
        if let Some(sink) = &state.sink {
            sink.set_volume(volume);
        }
        Ok(())
    }

    pub fn set_equalizer_band(&self, index: usize, gain: f32) -> Result<(), String> {
        if index >= 10 {
            return Err("Equalizer band index out of bounds".to_string());
        }
        if gain < -12.0 || gain > 12.0 {
            return Err("Equalizer gain must be between -12.0 and 12.0 dB".to_string());
        }
        self.eq_gains[index].store((gain * 1000.0) as i32, Ordering::Relaxed);
        Ok(())
    }

    pub fn set_purist_mode(&self, is_purist: bool) -> Result<(), String> {
        self.is_purist.store(is_purist, Ordering::Relaxed);
        Ok(())
    }
}
