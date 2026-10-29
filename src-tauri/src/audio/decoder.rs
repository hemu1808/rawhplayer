//! Decoding and resampling stay on the engine worker, never in the device callback.
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL},
    errors::Error,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
    io::MediaSourceStream,
    probe::Hint,
    units::{Time, TimeBase},
};

pub const MAX_CHANNELS: usize = 8;
pub type Frame = [f32; MAX_CHANNELS];

#[derive(Clone, Debug)]
pub struct MediaInfo {
    pub path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: u16,
    pub format: String,
    pub track_gain: Option<f32>,
    pub album_gain: Option<f32>,
    pub track_peak: Option<f32>,
    pub album_peak: Option<f32>,
}

pub struct MediaDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    time_base: TimeBase,
    samples: Vec<f32>,
    offset: usize,
    seek_target: Option<f64>,
    pub info: MediaInfo,
}

impl MediaDecoder {
    pub fn open(path: &str) -> Result<Self, String> {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() {
            return Err("Select an existing local audio file with an absolute path".into());
        }
        let file = File::open(path).map_err(|e| format!("Cannot open audio file: {e}"))?;
        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let mut hint = Hint::new();
        hint.with_extension(extension);
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                MediaSourceStream::new(Box::new(file), Default::default()),
                &FormatOptions {
                    enable_gapless: true,
                    ..Default::default()
                },
                &Default::default(),
            )
            .map_err(|e| format!("Unsupported or damaged audio file: {e}"))?;
        let track = probed
            .format
            .default_track()
            .filter(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .or_else(|| {
                probed
                    .format
                    .tracks()
                    .iter()
                    .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            })
            .ok_or("No supported audio stream")?;
        let params = track.codec_params.clone();
        let track_id = track.id;
        let rate = params.sample_rate.unwrap_or(0);
        if rate == 0 || rate > 768_000 {
            return Err("The file has an unsupported sample rate".into());
        }
        let channels = params.channels.map(|c| c.count()).unwrap_or(0);
        if channels == 0 || channels > MAX_CHANNELS {
            return Err("Only one to eight audio channels are supported".into());
        }
        let time_base = params.time_base.unwrap_or(TimeBase::new(1, rate));
        let duration = params
            .n_frames
            .map(|n| {
                let time = time_base.calc_time(n);
                time.seconds as f64 + time.frac
            })
            .unwrap_or(0.0);
        let decoder = symphonia::default::get_codecs()
            .make(&params, &DecoderOptions::default())
            .map_err(|e| format!("Audio codec is not supported: {e}"))?;
        let (track_gain, album_gain, track_peak, album_peak) = read_replay_gain(path);
        let mut result = Self {
            format: probed.format,
            decoder,
            track_id,
            time_base,
            samples: Vec::new(),
            offset: 0,
            seek_target: None,
            info: MediaInfo {
                path: path.to_string_lossy().into_owned(),
                duration,
                sample_rate: rate,
                channels: channels as u16,
                bit_depth: params.bits_per_sample.unwrap_or(0) as u16,
                format: extension.to_ascii_uppercase(),
                track_gain,
                album_gain,
                track_peak,
                album_peak,
            },
        };
        // Validate the decoder before replacing a currently healthy track.
        if !result.fill()? {
            return Err("The audio file contains no playable samples".into());
        }
        Ok(result)
    }

    fn fill(&mut self) -> Result<bool, String> {
        let mut invalid_packets = 0;
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(false)
                }
                Err(e) => return Err(format!("Cannot read audio packet: {e}")),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(decoded) => decoded,
                Err(Error::DecodeError(_)) if invalid_packets < 3 => {
                    invalid_packets += 1;
                    continue;
                }
                Err(e) => return Err(format!("Cannot decode audio packet: {e}")),
            };
            if decoded.spec().rate != self.info.sample_rate
                || decoded.spec().channels.count() != self.info.channels as usize
            {
                return Err("Audio format changes inside a track are not supported".into());
            }
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buffer.copy_interleaved_ref(decoded);
            self.samples.clear();
            self.samples.extend_from_slice(buffer.samples());
            self.offset = 0;
            // Symphonia's decoders apply the Packet gapless trim themselves.
            if let Some(target) = self.seek_target {
                let packet_time = self.time_base.calc_time(packet.ts());
                let packet_start = packet_time.seconds as f64 + packet_time.frac;
                let frames = ((target - packet_start).max(0.0) * self.info.sample_rate as f64)
                    .round() as usize;
                self.offset = frames
                    .saturating_mul(self.info.channels as usize)
                    .min(self.samples.len());
                if self.offset < self.samples.len() {
                    self.seek_target = None;
                }
            }
            if self.offset < self.samples.len() {
                return Ok(true);
            }
        }
    }

    pub fn next_frame(&mut self) -> Result<Option<Frame>, String> {
        if self.offset >= self.samples.len() && !self.fill()? {
            return Ok(None);
        }
        let channels = self.info.channels as usize;
        if self.samples.len().saturating_sub(self.offset) < channels {
            return Ok(None);
        }
        let mut frame = [0.0; MAX_CHANNELS];
        for (dest, source) in frame
            .iter_mut()
            .zip(&self.samples[self.offset..self.offset + channels])
        {
            *dest = if source.is_finite() { *source } else { 0.0 };
        }
        self.offset += channels;
        Ok(Some(frame))
    }

    pub fn seek(&mut self, position: f64) -> Result<(), String> {
        if !position.is_finite()
            || position < 0.0
            || (self.info.duration > 0.0 && position > self.info.duration)
        {
            return Err("Seek position must be finite and inside the track".into());
        }
        // At EOF seek to the final frame; the renderer then finishes normally.
        let target = if self.info.duration > 0.0 {
            position.min((self.info.duration - 1.0 / self.info.sample_rate as f64).max(0.0))
        } else {
            position
        };
        self.format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: Time::from(target),
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|e| format!("This file cannot seek to that position: {e}"))?;
        self.decoder.reset();
        self.samples.clear();
        self.offset = 0;
        self.seek_target = Some(target);
        Ok(())
    }
}

fn parse_gain(value: Option<&str>) -> Option<f32> {
    let value = value?
        .trim()
        .trim_end_matches("dB")
        .trim_end_matches("db")
        .trim()
        .parse::<f32>()
        .ok()?;
    (value.is_finite() && (-60.0..=30.0).contains(&value)).then_some(value)
}

fn parse_peak(value: Option<&str>) -> Option<f32> {
    let value = value?.trim().parse::<f32>().ok()?;
    (value.is_finite() && value > 0.0 && value < 100.0).then_some(value)
}

fn read_replay_gain(path: &Path) -> (Option<f32>, Option<f32>, Option<f32>, Option<f32>) {
    use lofty::{file::TaggedFileExt, probe::Probe, tag::ItemKey};
    let Ok(file) = Probe::open(path).and_then(|p| p.read()) else {
        return (None, None, None, None);
    };
    let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) else {
        return (None, None, None, None);
    };
    (
        parse_gain(tag.get_string(&ItemKey::ReplayGainTrackGain)),
        parse_gain(tag.get_string(&ItemKey::ReplayGainAlbumGain)),
        parse_peak(tag.get_string(&ItemKey::ReplayGainTrackPeak)),
        parse_peak(tag.get_string(&ItemKey::ReplayGainAlbumPeak)),
    )
}

pub struct ResampledTrack {
    pub decoder: MediaDecoder,
    pub queue_id: String,
    pub position: f64,
    left: Option<Frame>,
    right: Option<Frame>,
    fraction: f64,
}

impl ResampledTrack {
    pub fn new(path: &str, queue_id: String) -> Result<Self, String> {
        let decoder = MediaDecoder::open(path)?;
        Ok(Self {
            decoder,
            queue_id,
            position: 0.0,
            left: None,
            right: None,
            fraction: 0.0,
        })
    }

    pub fn seek(&mut self, position: f64) -> Result<(), String> {
        self.decoder.seek(position)?;
        self.left = None;
        self.right = None;
        self.fraction = 0.0;
        self.position = position;
        Ok(())
    }

    pub fn render(
        &mut self,
        output_rate: u32,
        output_channels: usize,
        speed: f32,
    ) -> Result<Option<Frame>, String> {
        if self.left.is_none() {
            self.left = self.decoder.next_frame()?;
            self.right = self.decoder.next_frame()?;
        }
        let Some(left) = self.left else {
            return Ok(None);
        };
        let right = self.right.unwrap_or(left);
        let mut source = [0.0; MAX_CHANNELS];
        for i in 0..self.decoder.info.channels as usize {
            source[i] = left[i] + (right[i] - left[i]) * self.fraction as f32;
        }
        let output = map_channels(source, self.decoder.info.channels as usize, output_channels);
        self.position += f64::from(speed) / output_rate as f64;
        self.fraction +=
            self.decoder.info.sample_rate as f64 * f64::from(speed) / output_rate as f64;
        while self.fraction >= 1.0 {
            self.fraction -= 1.0;
            self.left = self.right;
            self.right = if self.left.is_some() {
                self.decoder.next_frame()?
            } else {
                None
            };
        }
        Ok(Some(output))
    }
}

fn map_channels(source: Frame, input: usize, output: usize) -> Frame {
    let mut result = [0.0; MAX_CHANNELS];
    if input == output {
        return source;
    }
    if input == 1 {
        result[0] = source[0];
        if output > 1 {
            result[1] = source[0];
        }
    } else if output == 1 {
        result[0] = source[..input].iter().sum::<f32>() / input as f32;
    } else {
        result[0] = source[0];
        result[1] = source[1];
        // Preserve energy conservatively when folding additional channels into stereo.
        if output == 2 && input > 2 {
            let extra = source[2..input].iter().sum::<f32>() * 0.5 / (input - 2) as f32;
            result[0] = (result[0] + extra) / 1.5;
            result[1] = (result[1] + extra) / 1.5;
        } else {
            let count = input.min(output);
            result[..count].copy_from_slice(&source[..count]);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replay_gain_rejects_non_finite_and_unreasonable_tags() {
        assert_eq!(parse_gain(Some("-6.2 dB")), Some(-6.2));
        assert_eq!(parse_gain(Some("NaN")), None);
        assert_eq!(parse_gain(Some("999")), None);
        assert_eq!(parse_peak(Some("inf")), None);
    }
    #[test]
    fn mono_is_centered_without_filling_surround_channels() {
        let mut source = [0.0; 8];
        source[0] = 0.4;
        let mapped = map_channels(source, 1, 6);
        assert_eq!(&mapped[..3], &[0.4, 0.4, 0.0]);
    }
}
