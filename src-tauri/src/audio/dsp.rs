use super::decoder::{Frame, MAX_CHANNELS};

pub const EQ_FREQUENCIES: [f32; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Copy, Default)]
struct Delay {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

#[derive(Clone)]
struct Band {
    coefficients: [f32; 5],
    delay: [Delay; MAX_CHANNELS],
}

impl Band {
    fn new(frequency: f32, gain: f32, rate: u32) -> Self {
        let mut result = Self {
            coefficients: [1.0, 0.0, 0.0, 0.0, 0.0],
            delay: [Delay::default(); MAX_CHANNELS],
        };
        if gain.abs() < 0.001 || frequency >= rate as f32 * 0.49 {
            return result;
        }
        let a = 10.0_f32.powf(gain / 40.0);
        let omega = 2.0 * std::f32::consts::PI * frequency / rate as f32;
        let alpha = omega.sin() / (2.0 * std::f32::consts::SQRT_2);
        let a0 = 1.0 + alpha / a;
        result.coefficients = [
            (1.0 + alpha * a) / a0,
            -2.0 * omega.cos() / a0,
            (1.0 - alpha * a) / a0,
            -2.0 * omega.cos() / a0,
            (1.0 - alpha / a) / a0,
        ];
        result
    }
    fn process(&mut self, channel: usize, x: f32) -> f32 {
        let d = &mut self.delay[channel];
        let [b0, b1, b2, a1, a2] = self.coefficients;
        let y = b0 * x + b1 * d.x1 + b2 * d.x2 - a1 * d.y1 - a2 * d.y2;
        d.x2 = d.x1;
        d.x1 = x;
        d.y2 = d.y1;
        d.y1 = if y.is_finite() { y } else { 0.0 };
        d.y1
    }
}

pub struct Equalizer {
    bands: Vec<Band>,
}
impl Equalizer {
    pub fn new(rate: u32, gains: &[f32; 10]) -> Self {
        Self {
            bands: EQ_FREQUENCIES
                .iter()
                .zip(gains)
                .map(|(&f, &g)| Band::new(f, g, rate))
                .collect(),
        }
    }
    pub fn process(&mut self, frame: &mut Frame, channels: usize) {
        for (channel, sample) in frame.iter_mut().take(channels).enumerate() {
            for band in &mut self.bands {
                *sample = band.process(channel, *sample);
            }
        }
    }
}

pub fn normalization_gain(gain_db: Option<f32>, peak: Option<f32>, preamp_db: f32) -> f32 {
    let gain = 10.0_f32.powf((gain_db.unwrap_or(0.0) + preamp_db) / 20.0);
    peak.filter(|p| p.is_finite() && *p > 0.0)
        .map(|p| gain.min(1.0 / p))
        .unwrap_or(gain)
}

pub fn crossfade_gains(progress: f32) -> (f32, f32) {
    let phase = progress.clamp(0.0, 1.0) * std::f32::consts::FRAC_PI_2;
    (phase.cos(), phase.sin())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flat_equalizer_preserves_samples_and_stereo_separation() {
        let mut eq = Equalizer::new(48_000, &[0.0; 10]);
        for n in 0..1000 {
            let mut frame = [0.0; 8];
            frame[0] = (n as f32 * 0.1).sin();
            let expected = frame[0];
            eq.process(&mut frame, 2);
            assert_eq!(frame[0], expected);
            assert_eq!(frame[1], 0.0);
        }
    }
    #[test]
    fn positive_gain_above_nyquist_does_not_create_unstable_filter() {
        let mut eq = Equalizer::new(8_000, &[12.0; 10]);
        for _ in 0..10_000 {
            let mut frame = [0.1; 8];
            eq.process(&mut frame, 2);
            assert!(frame[0].is_finite());
        }
    }
    #[test]
    fn replay_gain_uses_peak_headroom() {
        assert!((normalization_gain(Some(6.0), Some(0.8), 0.0) - 1.25).abs() < 0.0001);
        assert_eq!(normalization_gain(None, None, 0.0), 1.0);
    }
    #[test]
    fn crossfade_has_equal_power_and_exact_endpoints() {
        let (a, b) = crossfade_gains(0.5);
        assert!((a * a + b * b - 1.0).abs() < 0.0001);
        assert_eq!(crossfade_gains(0.0), (1.0, 0.0));
        assert!(crossfade_gains(1.0).0.abs() < 0.0001);
    }
}
