//! Exercise real decoding and render boundaries without requiring audio hardware.
use super::{decoder::ResampledTrack, pipeline::Pipeline};
use crate::audio_engine::RenderNotice;
use std::{fs, path::PathBuf};

struct Wav(PathBuf);
impl Wav {
    fn new(samples: &[i16]) -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("rawh-audio-{}-{unique}.wav", std::process::id()));
        let size = (samples.len() * 2) as u32;
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF");
        bytes.extend((36 + size).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16_u32.to_le_bytes());
        bytes.extend(1_u16.to_le_bytes());
        bytes.extend(1_u16.to_le_bytes());
        bytes.extend(48_000_u32.to_le_bytes());
        bytes.extend(96_000_u32.to_le_bytes());
        bytes.extend(2_u16.to_le_bytes());
        bytes.extend(16_u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(size.to_le_bytes());
        for sample in samples {
            bytes.extend(sample.to_le_bytes());
        }
        fs::write(&path, bytes).unwrap();
        Self(path)
    }
    fn track(&self, id: &str) -> ResampledTrack {
        ResampledTrack::new(self.0.to_str().unwrap(), id.into()).unwrap()
    }
}
impl Drop for Wav {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[test]
fn seek_discards_buffered_samples_and_replays_exact_frame() {
    let samples: Vec<i16> = (0..5000).collect();
    let wav = Wav::new(&samples);
    let mut track = wav.track("one");
    for _ in 0..41 {
        track.render(48_000, 1, 1.0).unwrap();
    }
    for target in [2401, 0, 4999, 600] {
        track.seek(target as f64 / 48_000.0).unwrap();
        let frame = track.render(48_000, 1, 1.0).unwrap().unwrap();
        assert!((frame[0] - samples[target] as f32 / 32768.0).abs() < 0.00001);
    }
    assert!(track.seek(f64::NAN).is_err());
    assert!(track.seek(-1.0).is_err());
}

#[test]
fn gapless_boundary_preserves_every_frame_and_notice_order() {
    let first = Wav::new(&vec![8192; 513]);
    let second = Wav::new(&vec![-8192; 777]);
    let mut pipe = Pipeline::new();
    pipe.channels = 1;
    pipe.set_current(first.track("one"), 7);
    pipe.pending = Some(second.track("two"));
    let mut samples = Vec::new();
    let mut events = Vec::new();
    for _ in 0..20 {
        let Some(block) = pipe.next_block(7).or_else(|| pipe.terminal_block(7)) else {
            break;
        };
        for notice in block.notices {
            match notice {
                RenderNotice::Started {
                    generation, event, ..
                } => {
                    assert_eq!(generation, 7);
                    events.push((samples.len(), format!("start:{}", event.queue_id)));
                }
                RenderNotice::Ended { generation, event } => {
                    assert_eq!(generation, 7);
                    events.push((samples.len(), format!("end:{}", event.queue_id)));
                }
            }
        }
        samples.extend(block.samples);
    }
    assert_eq!(samples.len(), 1290);
    assert!(samples[..513].iter().all(|&sample| sample == 0.25));
    assert!(samples[513..].iter().all(|&sample| sample == -0.25));
    assert_eq!(
        events,
        [
            (0, "start:one".into()),
            (513, "end:one".into()),
            (513, "start:two".into()),
            (1290, "end:two".into())
        ]
    );
}

#[test]
fn crossfade_overlaps_tracks_with_bounded_finite_output() {
    let first = Wav::new(&vec![8192; 2400]);
    let second = Wav::new(&vec![8192; 2400]);
    let mut pipe = Pipeline::new();
    pipe.channels = 1;
    pipe.crossfade = 0.025;
    pipe.set_current(first.track("one"), 1);
    pipe.pending = Some(second.track("two"));
    let mut samples = Vec::new();
    for _ in 0..30 {
        let Some(block) = pipe.next_block(1).or_else(|| pipe.terminal_block(1)) else {
            break;
        };
        samples.extend(block.samples);
    }
    assert!((3600..=3856).contains(&samples.len()));
    assert!(samples
        .iter()
        .all(|x| x.is_finite() && *x > 0.0 && *x <= 0.354));
    assert!(samples.iter().any(|x| *x > 0.35));
    assert_eq!(pipe.clipping, 0);
}
