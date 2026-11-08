//! Preallocated, anti-aliasing conversion on the worker. The output callback never calls Rubato.
use super::decoder::{Frame, MediaDecoder, MAX_CHANNELS};
use rubato::audioadapter_buffers::direct::SequentialSliceOfVecs;
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};

pub struct SincStream {
    processor: Async<f32>,
    input: Vec<Vec<f32>>,
    output: Vec<Vec<f32>>,
    cursor: usize,
    frames: usize,
    discard: usize,
    input_frames: u64,
    start: f64,
    pub end: Option<f64>,
    pub rate: u32,
    pub speed: f32,
}
impl SincStream {
    pub fn new(
        input_rate: u32,
        channels: usize,
        rate: u32,
        speed: f32,
        start: f64,
    ) -> Result<Self, String> {
        let ratio = rate as f64 / (input_rate as f64 * f64::from(speed));
        let processor = Async::<f32>::new_sinc(
            ratio,
            1.0,
            &SincInterpolationParameters {
                sinc_len: 256,
                f_cutoff: None,
                interpolation: SincInterpolationType::Cubic,
                oversampling_factor: 128,
                window: WindowFunction::BlackmanHarris2,
            },
            256,
            channels,
            FixedAsync::Input,
        )
        .map_err(|e| format!("Cannot initialize sample-rate conversion: {e}"))?;
        let input = vec![vec![0.0; processor.input_frames_max()]; channels];
        let output = vec![vec![0.0; processor.output_frames_max()]; channels];
        let discard = processor.output_delay();
        Ok(Self {
            processor,
            input,
            output,
            cursor: 0,
            frames: 0,
            discard,
            input_frames: 0,
            start,
            end: None,
            rate,
            speed,
        })
    }
    pub fn next(
        &mut self,
        decoder: &mut MediaDecoder,
        position: f64,
    ) -> Result<Option<Frame>, String> {
        if self.end.is_some_and(|end| position + 1e-10 >= end) {
            return Ok(None);
        }
        while self.cursor >= self.frames {
            let count = self.processor.input_frames_next();
            for channel in &mut self.input {
                channel[..count].fill(0.0);
            }
            if self.end.is_none() {
                for index in 0..count {
                    match decoder.next_frame()? {
                        Some(frame) => {
                            for (channel, samples) in self.input.iter_mut().enumerate() {
                                samples[index] = frame[channel];
                            }
                            self.input_frames += 1;
                        }
                        None => {
                            self.end = Some(
                                self.start
                                    + self.input_frames as f64 / decoder.info.sample_rate as f64,
                            );
                            break;
                        }
                    }
                }
            }
            if self.end.is_some_and(|end| position + 1e-10 >= end) {
                return Ok(None);
            }
            let channels = self.input.len();
            let input = SequentialSliceOfVecs::new(&self.input, channels, count)
                .map_err(|e| e.to_string())?;
            let capacity = self.output[0].len();
            let mut output = SequentialSliceOfVecs::new_mut(&mut self.output, channels, capacity)
                .map_err(|e| e.to_string())?;
            let (_, written) = self
                .processor
                .process_into_buffer(&input, &mut output, None)
                .map_err(|e| format!("Sample-rate conversion failed: {e}"))?;
            let skip = self.discard.min(written);
            self.discard -= skip;
            self.cursor = skip;
            self.frames = written;
        }
        let mut frame = [0.0; MAX_CHANNELS];
        for (channel, samples) in self.output.iter().enumerate() {
            frame[channel] = samples[self.cursor];
        }
        self.cursor += 1;
        Ok(Some(frame))
    }
}
