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
