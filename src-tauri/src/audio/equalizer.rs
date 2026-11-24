use super::decoder::{Frame, MAX_CHANNELS};
use serde::{Deserialize, Serialize};
use std::f64::consts::{SQRT_2, TAU};

pub const GRAPHIC_FREQUENCIES: [f64; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
const MAX_FILTERS: usize = 8;
const RESPONSE_POINTS: usize = 160;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EqualizerMode {
    #[default]
    Graphic,
    Parametric,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FilterKind {
    Peak,
    LowShelf,
    HighShelf,
    LowPass,
    HighPass,
    Notch,
}

impl FilterKind {
    fn adjusts_gain(self) -> bool {
        matches!(self, Self::Peak | Self::LowShelf | Self::HighShelf)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParametricBand {
    pub kind: FilterKind,
    pub frequency: f64,
    pub gain: f64,
    pub q: f64,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EqualizerSettings {
    pub mode: EqualizerMode,
    pub graphic_gains: Vec<f64>,
    pub filters: Vec<ParametricBand>,
    pub preamp_db: f64,
    pub auto_headroom: bool,
}

impl Default for EqualizerSettings {
    fn default() -> Self {
        Self {
            mode: EqualizerMode::Graphic,
            graphic_gains: vec![0.0; GRAPHIC_FREQUENCIES.len()],
            filters: vec![],
            preamp_db: 0.0,
            auto_headroom: true,
        }
    }
}

impl EqualizerSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.graphic_gains.len() != GRAPHIC_FREQUENCIES.len()
            || self
                .graphic_gains
                .iter()
                .any(|gain| !(-12.0..=12.0).contains(gain))
        {
            return Err("Graphic EQ requires ten gains between -12 and +12 dB.".into());
        }
        if !(-24.0..=12.0).contains(&self.preamp_db) {
            return Err("EQ preamp must be between -24 and +12 dB.".into());
        }
        if self.filters.len() > MAX_FILTERS
            || self.filters.iter().any(|band| {
                !(20.0..=20_000.0).contains(&band.frequency)
                    || !(-18.0..=18.0).contains(&band.gain)
                    || !(0.1..=18.0).contains(&band.q)
            })
        {
            return Err("Parametric EQ accepts up to eight bands between 20 and 20,000 Hz, -18 and +18 dB, and Q 0.1 to 18.".into());
        }
        Ok(())
    }

    fn active_filters(&self, rate: u32) -> Vec<(f64, Coefficients)> {
        let bands = match self.mode {
            EqualizerMode::Graphic => GRAPHIC_FREQUENCIES
                .into_iter()
                .zip(self.graphic_gains.iter().copied())
                .map(|(frequency, gain)| ParametricBand {
                    kind: FilterKind::Peak,
                    frequency,
                    gain,
                    q: SQRT_2,
                    enabled: true,
                })
                .collect(),
            EqualizerMode::Parametric => self.filters.clone(),
        };
        bands
            .into_iter()
            .filter(|band| band.enabled && band.frequency < f64::from(rate) * 0.49)
            .filter(|band| !band.kind.adjusts_gain() || band.gain.abs() >= 0.001)
            .map(|band| (band.frequency, Coefficients::new(band, rate)))
            .collect()
    }
}

#[derive(Clone, Copy)]
struct Coefficients {
    numerator: [f64; 3],
    feedback: [f64; 2],
}

impl Coefficients {
    // Robert Bristow-Johnson, Audio EQ Cookbook. Shelves use monotonic slope S=1.
    fn new(band: ParametricBand, rate: u32) -> Self {
        let ParametricBand {
            kind,
            frequency,
            gain,
            q,
            ..
        } = band;
        let (sin, cos) = (TAU * frequency / f64::from(rate)).sin_cos();
        let alpha = sin / (2.0 * q);
        let a = 10.0_f64.powf(gain / 40.0);
        let minus = a - 1.0;
        let plus = a + 1.0;
        let beta = sin * (2.0 * a).sqrt();
        let (b, d) = match kind {
            FilterKind::Peak => (
                [1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a],
                [1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a],
            ),
            FilterKind::LowPass => {
                let n = (1.0 - cos) / 2.0;
                ([n, n * 2.0, n], [1.0 + alpha, -2.0 * cos, 1.0 - alpha])
            }
            FilterKind::HighPass => {
                let n = (1.0 + cos) / 2.0;
                ([n, n * -2.0, n], [1.0 + alpha, -2.0 * cos, 1.0 - alpha])
            }
            FilterKind::Notch => (
                [1.0, -2.0 * cos, 1.0],
                [1.0 + alpha, -2.0 * cos, 1.0 - alpha],
            ),
            FilterKind::LowShelf => (
                [
                    a * (plus - minus * cos + beta),
                    2.0 * a * (minus - plus * cos),
                    a * (plus - minus * cos - beta),
                ],
                [
                    plus + minus * cos + beta,
                    -2.0 * (minus + plus * cos),
                    plus + minus * cos - beta,
                ],
            ),
            FilterKind::HighShelf => (
                [
                    a * (plus + minus * cos + beta),
                    -2.0 * a * (minus + plus * cos),
                    a * (plus + minus * cos - beta),
                ],
                [
                    plus - minus * cos + beta,
                    2.0 * (minus - plus * cos),
                    plus - minus * cos - beta,
                ],
            ),
        };
        Self {
            numerator: b.map(|value| value / d[0]),
            feedback: [d[1] / d[0], d[2] / d[0]],
        }
    }

    fn magnitude_db(self, (sin, cos): (f64, f64)) -> f64 {
        let power = |[a, b, c]: [f64; 3]| {
            let real = a + b * cos + c * (2.0 * cos * cos - 1.0);
            let imaginary = b * sin + c * 2.0 * sin * cos;
            real * real + imaginary * imaginary
        };
        let ratio = power(self.numerator) / power([1.0, self.feedback[0], self.feedback[1]]);
        10.0 * ratio.max(1e-16).log10()
    }
}

struct Biquad {
    coefficients: Coefficients,
    delay: [[f64; 2]; MAX_CHANNELS],
}

impl Biquad {
    fn process(&mut self, channel: usize, input: f64) -> f64 {
        let [b0, b1, b2] = self.coefficients.numerator;
        let [a1, a2] = self.coefficients.feedback;
        let [z1, z2] = &mut self.delay[channel];
        let output = b0 * input + *z1;
        *z1 = b1 * input - a1 * output + *z2;
        *z2 = b2 * input - a2 * output;
        output
    }
}

pub struct Equalizer {
    pub rate: u32,
    filters: Vec<Biquad>,
    preamp: f64,
    pub applied_preamp_db: f64,
}

impl Equalizer {
    pub fn bypass(rate: u32) -> Self {
        Self {
            rate,
            filters: vec![],
            preamp: 1.0,
            applied_preamp_db: 0.0,
        }
    }

    pub fn new(rate: u32, settings: &EqualizerSettings) -> Self {
        let filters = settings.active_filters(rate);
        let applied_preamp_db = applied_gain(rate, settings, &filters);
        Self {
            rate,
            filters: filters
                .into_iter()
                .map(|(_, coefficients)| Biquad {
                    coefficients,
                    delay: [[0.0; 2]; MAX_CHANNELS],
                })
                .collect(),
            preamp: 10.0_f64.powf(applied_preamp_db / 20.0),
            applied_preamp_db,
        }
    }

    pub fn reset(&mut self) {
        for filter in &mut self.filters {
            filter.delay = [[0.0; 2]; MAX_CHANNELS];
        }
    }

    pub fn process(&mut self, frame: &mut Frame, channels: usize) {
        if self.filters.is_empty() && self.preamp == 1.0 {
            return;
        }
        for (channel, sample) in frame.iter_mut().take(channels).enumerate() {
            let mut value = f64::from(*sample) * self.preamp;
            for filter in &mut self.filters {
                value = filter.process(channel, value);
            }
            *sample = value as f32;
        }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EqualizerResponse {
    pub sample_rate: u32,
    pub applied_preamp_db: f64,
    pub points: Vec<ResponsePoint>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePoint {
    pub frequency: f64,
    pub gain: f64,
}

fn filter_gain(rate: u32, filters: &[(f64, Coefficients)], frequency: f64) -> f64 {
    let angle = (TAU * frequency / f64::from(rate)).sin_cos();
    filters
        .iter()
        .map(|(_, filter)| filter.magnitude_db(angle))
        .sum()
}

fn log_frequency(start: f64, end: f64, index: usize) -> f64 {
    start * (end / start).powf(index as f64 / (RESPONSE_POINTS - 1) as f64)
}

fn applied_gain(rate: u32, settings: &EqualizerSettings, filters: &[(f64, Coefficients)]) -> f64 {
    if !settings.auto_headroom {
        return settings.preamp_db;
    }
    if filters.is_empty() {
        return settings.preamp_db.min(0.0);
    }
    let nyquist = f64::from(rate) / 2.0;
    let peak = (0..RESPONSE_POINTS)
        .map(|i| log_frequency(5.0, nyquist, i))
        .chain(filters.iter().map(|&(frequency, _)| frequency))
        .chain([0.0])
        .map(|frequency| filter_gain(rate, filters, frequency))
        .fold(f64::NEG_INFINITY, f64::max);
    settings.preamp_db.min(-peak)
}

pub fn response(settings: &EqualizerSettings, rate: u32) -> Result<EqualizerResponse, String> {
    settings.validate()?;
    if !(1_000..=768_000).contains(&rate) {
        return Err("Invalid EQ response sample rate.".into());
    }
    let filters = settings.active_filters(rate);
    let preamp = applied_gain(rate, settings, &filters);
    let highest = 20_000.0_f64.min(f64::from(rate) * 0.499);
    let mut frequencies: Vec<_> = (0..RESPONSE_POINTS)
        .map(|i| log_frequency(20.0, highest, i))
        .chain(filters.iter().map(|&(frequency, _)| frequency))
        .collect();
    frequencies.sort_unstable_by(f64::total_cmp);
    frequencies.dedup();
    let points = frequencies
        .into_iter()
        .map(|frequency| ResponsePoint {
            frequency,
            gain: (filter_gain(rate, &filters, frequency) + preamp).max(-160.0),
        })
        .collect();
    Ok(EqualizerResponse {
        sample_rate: rate,
        applied_preamp_db: preamp,
        points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn band(kind: FilterKind, frequency: f64, gain: f64) -> ParametricBand {
        ParametricBand {
            kind,
            frequency,
            gain,
            q: 0.707,
            enabled: true,
        }
    }

    #[test]
    fn flat_and_bypassed_chains_preserve_samples() {
        for mut equalizer in [
            Equalizer::new(48_000, &EqualizerSettings::default()),
            Equalizer::bypass(48_000),
        ] {
            let mut frame = [0.17, -0.29, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
            let input = frame;
            equalizer.process(&mut frame, 2);
            assert_eq!(frame, input);
        }
    }

    #[test]
    fn rendered_peak_matches_response_and_preserves_stereo_separation() {
        let settings = EqualizerSettings {
            mode: EqualizerMode::Parametric,
            filters: vec![ParametricBand {
                q: 6.0,
                ..band(FilterKind::Peak, 1_000.0, 9.0)
            }],
            auto_headroom: false,
            ..Default::default()
        };
        let rate = 48_000;
        let filters = settings.active_filters(rate);
        assert!((filter_gain(rate, &filters, 1_000.0) - 9.0).abs() < 0.001);
        assert!(filter_gain(rate, &filters, 100.0) < 0.01);
        let mut equalizer = Equalizer::new(rate, &settings);
        let (mut input, mut output) = (0.0, 0.0);
        for sample in 0..rate {
            let mut frame = [0.0; MAX_CHANNELS];
            frame[0] = (sample as f64 * TAU / 48.0).sin() as f32 * 0.1;
            let value = frame[0];
            equalizer.process(&mut frame, 2);
            assert_eq!(frame[1], 0.0);
            if sample >= rate / 2 {
                input += f64::from(value).powi(2);
                output += f64::from(frame[0]).powi(2);
            }
        }
        assert!((10.0 * (output / input).log10() - 9.0).abs() < 0.01);
    }

    #[test]
    fn shelves_pass_filters_and_notch_have_the_expected_response() {
        let gain = |kind, center, db, frequency| {
            let filters = [(center, Coefficients::new(band(kind, center, db), 48_000))];
            filter_gain(48_000, &filters, frequency)
        };
        assert!((gain(FilterKind::LowShelf, 250.0, 8.0, 20.0) - 8.0).abs() < 0.01);
        assert!((gain(FilterKind::HighShelf, 2_000.0, -8.0, 18_000.0) + 8.0).abs() < 0.01);
        assert!(gain(FilterKind::HighPass, 1_000.0, 0.0, 100.0) < -39.0);
        assert!(gain(FilterKind::LowPass, 1_000.0, 0.0, 10_000.0) < -39.0);
        let settings = EqualizerSettings {
            mode: EqualizerMode::Parametric,
            filters: vec![ParametricBand {
                q: 18.0,
                ..band(FilterKind::Notch, 733.0, 0.0)
            }],
            ..Default::default()
        };
        let response = response(&settings, 48_000).unwrap();
        assert!(response
            .points
            .iter()
            .any(|point| point.frequency == 733.0 && point.gain < -100.0));
    }

    #[test]
    fn automatic_headroom_accounts_for_overlapping_boosts_and_inactive_bands() {
        let bell = band(FilterKind::Peak, 500.0, 6.0);
        let settings = EqualizerSettings {
            mode: EqualizerMode::Parametric,
            filters: vec![
                bell,
                bell,
                ParametricBand {
                    enabled: false,
                    ..bell
                },
                band(FilterKind::Peak, 18_000.0, 18.0),
            ],
            ..Default::default()
        };
        let designed = response(&settings, 8_000).unwrap();
        assert!((designed.applied_preamp_db + 12.0).abs() < 0.001);
        assert_eq!(
            designed.applied_preamp_db,
            Equalizer::new(8_000, &settings).applied_preamp_db
        );
        assert!(designed
            .points
            .iter()
            .all(|point| point.gain.is_finite() && point.gain <= 0.001));
    }

    #[test]
    fn rejects_invalid_settings_before_design() {
        let mut settings = EqualizerSettings::default();
        settings.filters.push(ParametricBand {
            q: f64::NAN,
            ..band(FilterKind::Peak, 1_000.0, 0.0)
        });
        assert!(response(&settings, 48_000).is_err());
        settings.filters = vec![band(FilterKind::Peak, 1_000.0, 0.0); MAX_FILTERS + 1];
        assert!(response(&settings, 48_000).is_err());
    }
}
