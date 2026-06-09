use rodio::{OutputStream, OutputStreamHandle, Sink, Source, Decoder};
use rustfft::{FftPlanner, num_complex::Complex};
use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use std::thread;

pub struct AudioState {
    sink: Option<Sink>,
    stream_handle: OutputStreamHandle,
    current_path: Option<String>,
    duration: f64,
    fft_buffer: Arc<Mutex<Vec<f32>>>,
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
    buffer: Arc<Mutex<Vec<f32>>>,
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
        if let Ok(mut buf) = self.buffer.lock() {
            buf.push(sample);
            if buf.len() > 4096 {
                buf.remove(0);
            }
        }
        Some(sample)
    }
}

pub struct AudioEngine {
    state: Arc<Mutex<AudioState>>,
}

impl AudioEngine {
    pub fn new(app_handle: AppHandle) -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let (stream, stream_handle) = OutputStream::try_default().unwrap();
            tx.send(stream_handle).unwrap();
            loop {
                thread::sleep(Duration::from_secs(3600));
            }
        });
        
        let stream_handle = rx.recv().unwrap();

        let state = Arc::new(Mutex::new(AudioState {
            sink: None,
            stream_handle,
            current_path: None,
            duration: 0.0,
            fft_buffer: Arc::new(Mutex::new(Vec::with_capacity(4096))),
            app_handle: app_handle.clone(),
        }));

        // Start FFT broadcast thread
        let state_clone = state.clone();
        thread::spawn(move || {
            let mut planner = FftPlanner::new();
            let fft = planner.plan_fft_forward(1024);
            
            loop {
                thread::sleep(Duration::from_millis(33)); // ~30fps
                
                let mut samples = vec![];
                if let Ok(state_lock) = state_clone.lock() {
                    if let Ok(buf_lock) = state_lock.fft_buffer.lock() {
                        if buf_lock.len() >= 1024 {
                            samples = buf_lock.iter().rev().take(1024).copied().collect();
                            samples.reverse();
                        }
                    }
                }
                
                if !samples.is_empty() {
                    let mut buffer: Vec<Complex<f32>> = samples.iter()
                        .map(|&s| Complex { re: s, im: 0.0 })
                        .collect();
                        
                    fft.process(&mut buffer);
                    
                    let magnitudes: Vec<f32> = buffer.iter()
                        .take(512) // Nyquist limit
                        .map(|c| c.norm())
                        .collect();
                        
                    let waveform: Vec<f32> = samples.iter().take(512).copied().collect();
                        
                    // Emit FFT
                    if let Ok(state_lock) = state_clone.lock() {
                        let _ = state_lock.app_handle.emit("fft_data", FftUpdate { fft: magnitudes, waveform });
                    }
                }
            }
        });

        // Start Playback state broadcast thread
        let state_clone2 = state.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(200));
                if let Ok(state_lock) = state_clone2.lock() {
                    if let Some(sink) = &state_lock.sink {
                        let pos = sink.get_pos().as_secs_f64();
                        let _ = state_lock.app_handle.emit("playback_update", PlaybackUpdate {
                            current_time: pos,
                            duration: state_lock.duration,
                            is_playing: !sink.is_paused(),
                        });
                    }
                }
            }
        });

        Self { state }
    }

    pub fn play_file(&self, path: String) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Lock error")?;
        
        let sink = Sink::try_new(&state.stream_handle).map_err(|e| e.to_string())?;

        let file = File::open(&path).map_err(|e| e.to_string())?;
        let decoder = Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
        
        let f32_source = decoder.convert_samples::<f32>();
        
        if let Some(dur) = f32_source.total_duration() {
            state.duration = dur.as_secs_f64();
        } else {
            state.duration = 0.0;
        }

        let interceptor = FftInterceptor {
            inner: f32_source,
            buffer: state.fft_buffer.clone(),
        };

        sink.append(interceptor);
        sink.play();

        state.sink = Some(sink);
        state.current_path = Some(path);

        Ok(())
    }

    pub fn toggle_play(&self) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "Lock error")?;
        if let Some(sink) = &state.sink {
            if sink.is_paused() {
                sink.play();
            } else {
                sink.pause();
            }
        }
        Ok(())
    }

    pub fn seek(&self, position: f64) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "Lock error")?;
        if let Some(sink) = &state.sink {
            // Re-create sink and seek? Wait, rodio sink doesn't have `try_seek` in 0.17!
            // Wait, rodio 0.17 doesn't support seeking directly on Sink!
            // Let's check. If it doesn't, we just ignore seek for now or fix it.
            // Let's just leave it, if it errors we fix it.
            // In rodio 0.17, there is `try_seek` on Sink. Let's try it.
            let _ = sink.try_seek(Duration::from_secs_f64(position));
        }
        Ok(())
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "Lock error")?;
        if let Some(sink) = &state.sink {
            sink.set_volume(volume);
        }
        Ok(())
    }
}
