use super::super::{EndedEvent, RenderNotice, TrackEvent};
use super::{
    decoder::{MediaInfo, ResampledTrack},
    dsp::{crossfade_gains, normalization_gain, Equalizer},
    output::{AudioBlock, BLOCK_FRAMES},
};
use std::collections::VecDeque;

pub struct Pipeline {
    pub current: Option<ResampledTrack>,
    pub pending: Option<ResampledTrack>,
    fading: Option<(ResampledTrack, usize, usize)>,
    pub volume: f32,
    pub speed: f32,
    pub purist: bool,
    pub crossfade: f32,
    pub normalization: String,
    pub preamp_db: f32,
    pub gains: [f32; 10],
    pub sample_rate: u32,
    pub channels: usize,
    eq: Equalizer,
    pub serial: u64,
    notices: VecDeque<RenderNotice>,
    pub clipping: u64,
    pub analysis: VecDeque<f32>,
    pub render_error: Option<String>,
}

impl Pipeline {
    pub fn new() -> Self {
        Self {
            current: None,
            pending: None,
            fading: None,
            volume: 1.0,
            speed: 1.0,
            purist: true,
            crossfade: 0.0,
            normalization: "off".into(),
            preamp_db: 0.0,
            gains: [0.0; 10],
            sample_rate: 48_000,
            channels: 2,
            eq: Equalizer::new(48_000, &[0.0; 10]),
            serial: 0,
            notices: VecDeque::new(),
            clipping: 0,
            analysis: VecDeque::with_capacity(4096),
            render_error: None,
        }
    }

    pub fn set_current(&mut self, track: ResampledTrack, generation: u64) {
        self.current = Some(track);
        self.pending = None;
        self.fading = None;
        self.notices.clear();
        self.render_error = None;
        self.serial = self.serial.wrapping_add(1);
        self.reset_dsp();
        if let Some(track) = &self.current {
            self.notices.push_back(RenderNotice::Started {
                generation,
                serial: self.serial,
                event: event(track),
            });
        }
    }

    pub fn reset_dsp(&mut self) {
        self.eq = Equalizer::new(self.sample_rate, &self.gains);
        self.analysis.clear();
    }

    pub fn stop(&mut self) {
        self.current = None;
        self.pending = None;
        self.fading = None;
        self.notices.clear();
        self.reset_dsp();
    }

    fn transition(&mut self, generation: u64, fade: bool) -> bool {
        let Some(incoming) = self.pending.take() else {
            return false;
        };
        if let Some(outgoing) = self.current.take() {
            self.notices.push_back(RenderNotice::Ended {
                generation,
                event: EndedEvent {
                    queue_id: outgoing.queue_id.clone(),
                    path: outgoing.decoder.info.path.clone(),
                    next_queue_id: Some(incoming.queue_id.clone()),
                    reason: "transition".into(),
                },
            });
            if fade {
                let remaining = (outgoing.decoder.info.duration - outgoing.position).max(0.0)
                    / self.speed as f64;
                let frames = (remaining.min(self.crossfade as f64) * self.sample_rate as f64)
                    .round()
                    .max(1.0) as usize;
                self.fading = Some((outgoing, 0, frames));
            }
        }
        self.current = Some(incoming);
        self.serial = self.serial.wrapping_add(1);
        self.reset_dsp();
        if let Some(track) = &self.current {
            self.notices.push_back(RenderNotice::Started {
                generation,
                serial: self.serial,
                event: event(track),
            });
        }
        true
    }

    pub fn next_block(&mut self, generation: u64) -> Option<AudioBlock> {
        self.current.as_ref()?;
        if self.fading.is_none() && self.pending.is_some() && self.crossfade > 0.0 {
            if let Some(track) = &self.current {
                let remaining = track.decoder.info.duration - track.position;
                if track.decoder.info.duration > 0.0
                    && remaining <= f64::from(self.crossfade * self.speed)
                {
                    self.transition(generation, true);
                }
            }
        }
        let position = self.current.as_ref().map(|t| t.position).unwrap_or(0.0);
        let serial = self.serial;
        let mut block = AudioBlock {
            generation,
            serial,
            samples: Vec::with_capacity(BLOCK_FRAMES * self.channels),
            position,
            seconds_per_frame: self.speed as f64 / self.sample_rate as f64,
            notices: std::mem::take(&mut self.notices),
            finishes: false,
        };
        for _ in 0..BLOCK_FRAMES {
            let Some(track) = self.current.as_mut() else {
                break;
            };
            let track_gain = gain_for(&track.decoder.info, &self.normalization, self.preamp_db);
            let mut frame = match track.render(self.sample_rate, self.channels, self.speed) {
                Ok(Some(frame)) => frame,
                Ok(None) => {
                    if self.pending.is_some() {
                        // End this block at the exact boundary. The next block starts
                        // immediately in the same device callback, without a new stream.
                        self.transition(generation, false);
                    } else if let Some(ended) = self.current.take() {
                        // End notices belong after the final samples, not before them.
                        self.notices.push_back(RenderNotice::Ended {
                            generation,
                            event: EndedEvent {
                                queue_id: ended.queue_id,
                                path: ended.decoder.info.path,
                                next_queue_id: None,
                                reason: "ended".into(),
                            },
                        });
                    }
                    break;
                }
                Err(message) => {
                    self.render_error = Some(message);
                    self.current = None;
                    self.pending = None;
                    self.fading = None;
                    break;
                }
            };
            for sample in frame.iter_mut().take(self.channels) {
                *sample *= track_gain;
            }
            let mut fade_done = false;
            if let Some((outgoing, elapsed, total)) = &mut self.fading {
                let (old_gain, new_gain) = crossfade_gains(*elapsed as f32 / *total as f32);
                let old = outgoing
                    .render(self.sample_rate, self.channels, self.speed)
                    .ok()
                    .flatten()
                    .unwrap_or([0.0; 8]);
                let outgoing_gain =
                    gain_for(&outgoing.decoder.info, &self.normalization, self.preamp_db);
                for i in 0..self.channels {
                    frame[i] = frame[i] * new_gain + old[i] * outgoing_gain * old_gain;
                }
                *elapsed += 1;
                fade_done = *elapsed >= *total;
            }
            if fade_done {
                self.fading = None;
            }
            if !self.purist {
                self.eq.process(&mut frame, self.channels);
            }
            let headroom = if self.purist {
                1.0
            } else {
                10.0_f32.powf(-self.gains.iter().copied().fold(0.0, f32::max) / 20.0)
            };
            for sample in frame.iter_mut().take(self.channels) {
                *sample *= self.volume * headroom;
                if !sample.is_finite() {
                    *sample = 0.0;
                }
                if sample.abs() > 1.0 {
                    self.clipping += 1;
                    *sample = sample.clamp(-1.0, 1.0);
                }
                block.samples.push(*sample);
            }
            self.analysis.push_back(frame[0]);
            self.analysis.push_back(if self.channels == 1 {
                frame[0]
            } else {
                frame[1]
            });
            while self.analysis.len() > 4096 {
                self.analysis.pop_front();
            }
        }
        // Terminal notices need their own empty block AFTER all previous PCM.
        if block.samples.is_empty() && self.current.is_none() {
            block.notices.append(&mut self.notices);
            block.finishes = true;
        }
        Some(block)
    }

    pub fn terminal_block(&mut self, generation: u64) -> Option<AudioBlock> {
        if self.current.is_some() || self.notices.is_empty() {
            return None;
        }
        Some(AudioBlock {
            generation,
            serial: self.serial,
            samples: Vec::new(),
            position: 0.0,
            seconds_per_frame: 0.0,
            notices: std::mem::take(&mut self.notices),
            finishes: true,
        })
    }
}

pub fn event(track: &ResampledTrack) -> TrackEvent {
    TrackEvent {
        queue_id: track.queue_id.clone(),
        path: track.decoder.info.path.clone(),
        duration: track.decoder.info.duration,
        sample_rate: track.decoder.info.sample_rate,
        bit_depth: track.decoder.info.bit_depth,
        channels: track.decoder.info.channels,
        format: track.decoder.info.format.clone(),
    }
}

fn gain_for(info: &MediaInfo, mode: &str, preamp: f32) -> f32 {
    match mode {
        "track" => normalization_gain(info.track_gain, info.track_peak, preamp),
        "album" => normalization_gain(
            info.album_gain.or(info.track_gain),
            info.album_peak.or(info.track_peak),
            preamp,
        ),
        _ => 1.0,
    }
}
