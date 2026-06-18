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
use std::sync::atomic::{AtomicBool, Ordering};
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

// A custom Source wrapper to intercept samples for FFT
struct FftInterceptor<I> {
    inner: I,
    buffer: Arc<parking_lot::Mutex<VecDeque<f32>>>,
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
        let sample = self.inner.next()?;
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
        let state = Arc::new(parking_lot::Mutex::new(AudioState {
            sink: None,
            _stream: SendSyncOutputStream(stream),
            stream_handle,
            current_path: None,
            duration: 0.0,
            app_handle: app_handle.clone(),
        }));

        let shutdown = Arc::new(AtomicBool::new(false));

        // Start FFT broadcast thread
        let fft_buffer_clone = fft_buffer.clone();
        let app_handle_clone = app_handle.clone();
        let shutdown_clone1 = shutdown.clone();
        thread::spawn(move || {
            let mut planner = FftPlanner::new();
            let fft = planner.plan_fft_forward(1024);
            
            while !shutdown_clone1.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(33)); // ~30fps
                
                let mut samples = Vec::with_capacity(1024);
                if let Some(buf_lock) = fft_buffer_clone.try_lock() {
                    if buf_lock.len() >= 1024 {
                        samples = buf_lock.iter().rev().take(1024).copied().collect();
                        samples.reverse();
                    }
                }
                
                if !samples.is_empty() {
                    let n = samples.len();
                    let mut buffer: Vec<Complex<f32>> = samples.iter().enumerate()
                        .map(|(i, &s)| {
                            // Apply Hann window to reduce spectral leakage
                            let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos());
                            Complex { re: s * window, im: 0.0 }
                        })
                        .collect();
                        
                    fft.process(&mut buffer);
                    
                    let magnitudes: Vec<f32> = buffer.iter()
                        .take(512) // Nyquist limit
                        .map(|c| c.norm())
                        .collect();
                        
                    let waveform: Vec<f32> = samples.iter().take(512).copied().collect();
                    
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

        Ok(Self { state, fft_buffer, shutdown })
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

        let file = File::open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let decoder = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Decoder failed to parse file: {}", e))?;
        
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

        let interceptor = FftInterceptor {
            inner: f32_source,
            buffer: self.fft_buffer.clone(),
        };

        sink.append(interceptor);
        sink.play();

        state.sink = Some(sink);
        state.current_path = Some(path);

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
        }
        Ok(())
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
        }
        Ok(())
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        if volume < 0.0 || volume > 1.0 {
            return Err("Volume must be between 0.0 and 1.0".to_string());
        }
        let state = self.state.lock();
        if let Some(sink) = &state.sink {
            sink.set_volume(volume);
        }
        Ok(())
    }
}
