//! The hardware callback never decodes, performs DSP, takes application mutexes or emits IPC.
//! Standard bounded channels are used; hard real-time lock freedom is not claimed.
use super::super::{AudioDeviceInfo, RenderNotice};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, SizedSample,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError},
    Arc,
};

pub const BLOCK_FRAMES: usize = 256;
pub const QUEUED_BLOCKS: usize = 12;

pub struct OutputSignals {
    pub generation: AtomicU64,
    pub paused: AtomicBool,
    pub playing: AtomicBool,
    pub position: AtomicU64,
    pub serial: AtomicU64,
    pub underruns: AtomicU64,
    pub device_failed: AtomicBool,
}

impl Default for OutputSignals {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(1),
            paused: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            position: AtomicU64::new(0.0_f64.to_bits()),
            serial: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            device_failed: AtomicBool::new(false),
        }
    }
}

pub struct AudioBlock {
    pub generation: u64,
    pub serial: u64,
    pub samples: Vec<f32>,
    pub position: f64,
    pub seconds_per_frame: f64,
    pub notices: std::collections::VecDeque<RenderNotice>,
    pub finishes: bool,
}

pub struct OutputDevice {
    // Must be created and dropped exclusively on the engine owner thread.
    pub _stream: cpal::Stream,
    pub sender: SyncSender<AudioBlock>,
    pub retired: Receiver<AudioBlock>,
    pub sample_rate: u32,
    pub channels: usize,
    pub name: String,
    pub sample_format: String,
}

pub fn list_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = host.default_output_device().and_then(|d| d.name().ok());
    let devices = host
        .output_devices()
        .map_err(|e| format!("Cannot list output devices: {e}"))?;
    let mut seen = std::collections::HashSet::new();
    Ok(devices
        .filter_map(|device| device.name().ok())
        .filter(|name| seen.insert(name.clone()))
        .map(|name| AudioDeviceInfo {
            id: name.clone(),
            is_default: default_name.as_ref() == Some(&name),
            name,
        })
        .collect())
}

fn unique_device_index(names: &[String], selected: &str) -> Result<usize, String> {
    let mut matches = names
        .iter()
        .enumerate()
        .filter(|(_, name)| name.as_str() == selected);
    let first = matches
        .next()
        .map(|(index, _)| index)
        .ok_or("No matching audio output device is connected")?;
    if matches.next().is_some() {
        return Err("Multiple output devices have this name. Rename them in system settings or select the system default output.".into());
    }
    Ok(first)
}

pub fn open(
    selected: Option<&str>,
    signals: Arc<OutputSignals>,
    notices: SyncSender<RenderNotice>,
) -> Result<OutputDevice, String> {
    let host = cpal::default_host();
    let device = if let Some(name) = selected {
        let mut devices: Vec<_> = host
            .output_devices()
            .map_err(|e| format!("Cannot list output devices: {e}"))?
            .filter_map(|device| device.name().ok().map(|name| (device, name)))
            .collect();
        let names = devices
            .iter()
            .map(|(_, name)| name.clone())
            .collect::<Vec<_>>();
        let index = unique_device_index(&names, name)?;
        Some(devices.swap_remove(index).0)
    } else {
        host.default_output_device()
    }
    .ok_or("No matching audio output device is connected")?;
    let name = device
        .name()
        .map_err(|e| format!("Cannot identify output device: {e}"))?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("Cannot configure audio output: {e}"))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    if config.channels == 0
        || config.channels as usize > super::decoder::MAX_CHANNELS
        || config.sample_rate.0 == 0
    {
        return Err("Output device must support between one and eight channels".into());
    }
    let (sender, receiver) = sync_channel(QUEUED_BLOCKS);
    let (retire, retired) = sync_channel(QUEUED_BLOCKS + 2);
    let state = CallbackState {
        receiver,
        retire,
        signals,
        notices,
        active: None,
        offset: 0,
        channels: config.channels as usize,
    };
    let stream = match format {
        cpal::SampleFormat::I8 => build::<i8>(&device, &config, state),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, state),
        cpal::SampleFormat::I32 => build::<i32>(&device, &config, state),
        cpal::SampleFormat::I64 => build::<i64>(&device, &config, state),
        cpal::SampleFormat::U8 => build::<u8>(&device, &config, state),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, state),
        cpal::SampleFormat::U32 => build::<u32>(&device, &config, state),
        cpal::SampleFormat::U64 => build::<u64>(&device, &config, state),
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, state),
        cpal::SampleFormat::F64 => build::<f64>(&device, &config, state),
        _ => return Err("The output device uses an unsupported sample format".into()),
    }?;
    stream
        .play()
        .map_err(|e| format!("Cannot start audio output: {e}"))?;
    Ok(OutputDevice {
        _stream: stream,
        sender,
        retired,
        sample_rate: config.sample_rate.0,
        channels: config.channels as usize,
        name,
        sample_format: format.to_string(),
    })
}

struct CallbackState {
    receiver: Receiver<AudioBlock>,
    retire: SyncSender<AudioBlock>,
    signals: Arc<OutputSignals>,
    notices: SyncSender<RenderNotice>,
    active: Option<AudioBlock>,
    offset: usize,
    channels: usize,
}

impl CallbackState {
    // Return allocations to the worker. If reclamation is temporarily full,
    // retain ownership and output silence; never free PCM on the callback.
    fn retire_active(&mut self) -> bool {
        if let Some(block) = self.active.take() {
            match self.retire.try_send(block) {
                Ok(()) => (),
                Err(TrySendError::Full(block) | TrySendError::Disconnected(block)) => {
                    self.active = Some(block);
                    return false;
                }
            }
        }
        true
    }
    fn next_sample(&mut self) -> Option<f32> {
        let generation = self.signals.generation.load(Ordering::Acquire);
        if self
            .active
            .as_ref()
            .is_some_and(|block| block.generation != generation)
        {
            if !self.retire_active() {
                return Some(0.0);
            }
            self.offset = 0;
        }
        if self.signals.paused.load(Ordering::Relaxed) {
            return Some(0.0);
        }
        loop {
            if self.active.is_none() {
                let block = match self.receiver.try_recv() {
                    Ok(block) => block,
                    Err(TryRecvError::Empty | TryRecvError::Disconnected) => return None,
                };
                if block.generation != generation {
                    self.active = Some(block);
                    if !self.retire_active() {
                        return Some(0.0);
                    }
                    continue;
                }
                self.active = Some(block);
                self.offset = 0;
            }
            let block = self.active.as_mut()?;
            // A full control channel never loses a track boundary. Keep it until the
            // engine worker can drain it, rather than misreporting the audible track.
            while let Some(notice) = block.notices.pop_front() {
                match self.notices.try_send(notice) {
                    Ok(()) => (),
                    Err(TrySendError::Full(notice)) => {
                        block.notices.push_front(notice);
                        return Some(0.0);
                    }
                    Err(TrySendError::Disconnected(_)) => return Some(0.0),
                }
            }
            if let Some(sample) = block.samples.get(self.offset).copied() {
                self.offset += 1;
                self.signals.serial.store(block.serial, Ordering::Release);
                let position =
                    block.position + (self.offset / self.channels) as f64 * block.seconds_per_frame;
                self.signals
                    .position
                    .store(position.to_bits(), Ordering::Release);
                return Some(sample);
            }
            if block.finishes {
                self.signals.playing.store(false, Ordering::Release);
            }
            if !self.retire_active() {
                return Some(0.0);
            }
        }
    }
}

fn build<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut state: CallbackState,
) -> Result<cpal::Stream, String> {
    let error_signals = state.signals.clone();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut underrun = false;
                for dest in data {
                    let sample = state.next_sample().unwrap_or_else(|| {
                        underrun = true;
                        0.0
                    });
                    *dest = T::from_sample(sample);
                }
                if underrun
                    && state.signals.playing.load(Ordering::Relaxed)
                    && !state.signals.paused.load(Ordering::Relaxed)
                {
                    state.signals.underruns.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |_| {
                error_signals.device_failed.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| format!("Cannot open audio output: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_output_must_be_unambiguous() {
        let names = vec!["Speakers".into(), "USB DAC".into(), "USB DAC".into()];
        assert_eq!(unique_device_index(&names, "Speakers").unwrap(), 0);
        assert!(unique_device_index(&names, "USB DAC")
            .unwrap_err()
            .contains("Multiple"));
        assert!(unique_device_index(&names, "Disconnected").is_err());
    }

    #[test]
    #[ignore = "requires an available physical output device; emits digital silence only"]
    fn hardware_output_smoke() {
        let signals = Arc::new(OutputSignals::default());
        let (send_notices, _notices) = sync_channel(128);
        let output = open(None, signals.clone(), send_notices).expect("open system default output");
        signals.playing.store(true, Ordering::Release);
        for serial in 1..=8 {
            output
                .sender
                .send(AudioBlock {
                    generation: 1,
                    serial,
                    samples: vec![0.0; BLOCK_FRAMES * output.channels],
                    position: (serial - 1) as f64 * BLOCK_FRAMES as f64 / output.sample_rate as f64,
                    seconds_per_frame: 1.0 / output.sample_rate as f64,
                    notices: Default::default(),
                    finishes: serial == 8,
                })
                .unwrap();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while signals.playing.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
            while output.retired.try_recv().is_ok() {}
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(
            signals.serial.load(Ordering::Acquire),
            8,
            "hardware callback consumed the final block"
        );
        assert!(!signals.device_failed.load(Ordering::Acquire));
        println!(
            "Silent hardware output passed: {} Hz, {} channels, {}, {} underruns",
            output.sample_rate,
            output.channels,
            output.sample_format,
            signals.underruns.load(Ordering::Relaxed)
        );
    }
    #[test]
    fn exhausted_blocks_stay_owned_until_worker_can_reclaim_them() {
        let (_sender, receiver) = sync_channel(2);
        let (notices, _) = sync_channel(4);
        let (retire, retired) = sync_channel(1);
        let block = |serial| AudioBlock {
            generation: 1,
            serial,
            samples: vec![0.5],
            position: 0.0,
            seconds_per_frame: 1.0,
            notices: Default::default(),
            finishes: false,
        };
        retire.send(block(1)).unwrap();
        let mut state = CallbackState {
            receiver,
            retire,
            signals: Arc::new(OutputSignals::default()),
            notices,
            active: Some(block(2)),
            offset: 1,
            channels: 1,
        };
        assert_eq!(state.next_sample(), Some(0.0));
        assert_eq!(state.active.as_ref().unwrap().serial, 2);
        assert_eq!(retired.try_recv().unwrap().serial, 1);
        assert_eq!(state.next_sample(), None);
        assert_eq!(retired.try_recv().unwrap().serial, 2);
        assert!(state.active.is_none());
    }
    #[test]
    fn stale_generation_is_discarded_before_any_sample_plays() {
        let (sender, receiver) = sync_channel(2);
        let (notices, _) = sync_channel(4);
        let (retire, _retired) = sync_channel(4);
        let signals = Arc::new(OutputSignals::default());
        sender
            .send(AudioBlock {
                generation: 1,
                serial: 1,
                samples: vec![0.8],
                position: 0.0,
                seconds_per_frame: 1.0,
                notices: Default::default(),
                finishes: false,
            })
            .unwrap();
        signals.generation.store(2, Ordering::Release);
        let mut state = CallbackState {
            receiver,
            retire,
            signals,
            notices,
            active: None,
            offset: 0,
            channels: 1,
        };
        assert_eq!(state.next_sample(), None);
    }
    #[test]
    fn pause_does_not_consume_audio_or_advance_position() {
        let (sender, receiver) = sync_channel(2);
        let (notices, _) = sync_channel(4);
        let (retire, _retired) = sync_channel(4);
        let signals = Arc::new(OutputSignals::default());
        sender
            .send(AudioBlock {
                generation: 1,
                serial: 1,
                samples: vec![0.8],
                position: 0.0,
                seconds_per_frame: 0.1,
                notices: Default::default(),
                finishes: false,
            })
            .unwrap();
        signals.paused.store(true, Ordering::Relaxed);
        let mut state = CallbackState {
            receiver,
            retire,
            signals: signals.clone(),
            notices,
            active: None,
            offset: 0,
            channels: 1,
        };
        assert_eq!(state.next_sample(), Some(0.0));
        signals.paused.store(false, Ordering::Relaxed);
        assert_eq!(state.next_sample(), Some(0.8));
        assert_eq!(
            f64::from_bits(signals.position.load(Ordering::Relaxed)),
            0.1
        );
    }
}
