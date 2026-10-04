/**
 * Sahaara AI — Acoustic DSP & Prosodic Feature Extraction
 *
 * Implements the four biomarker formulations specified in
 * SAHAARA_AI_Test_Cases_and_Demo_Evaluation_Suite.md §7.2, following the
 * openSMILE / eGeMAPS parameter definitions.
 *
 *   1. Relative Pitch Jitter      J_rel      (%)
 *   2. Amplitude Perturbation     S_apq3     (%)   (Shimmer, 3-cycle)
 *   3. Harmonics-to-Noise Ratio  HNR        (dB)
 *   4. Pause Ratio                PR         (0..1)
 *
 * Two input modes are supported:
 *
 *   a) RAW — caller supplies glottal cycle periods / amplitudes / frames and
 *      the formulas are evaluated exactly as written in the spec.
 *
 *   b) DESCRIPTOR — caller supplies already-measured values (as the demo
 *      fixtures do). Values are validated and clamped, never invented.
 *
 * CRITICAL SAFETY PROPERTY
 * ─────────────────────────
 * Acoustic features feed ONLY the `psychological_distress` dimension.
 * They can never raise `immediate_physical_safety`. This is the mechanical
 * realisation of "Distress ≠ Danger" (TC-07) and "Content ≠ Emotion" (TC-06).
 */

/** Baseline reference ranges from the specification (§7.2). */
export const BASELINE = {
  /** Healthy, unstressed baseline. */
  jitterHealthyPct: 1.0,
  /** Acute trauma / panic threshold. */
  jitterAcutePct: 2.5,
  /** Normal resting speech rate (words per minute). */
  speechRateNormalWpm: 140,
  /** Pressured / elevated speech rate. */
  speechRatePressuredWpm: 175,
  /** Pause ratio above which dissociation / freezing is indicated. */
  pauseRatioElevated: 0.28,
};

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * 1. Relative Pitch Jitter (%)
 *
 *        1/(N-1) · Σ_{i=1}^{N-1} |T_i − T_{i+1}|
 * J_rel = ───────────────────────────────────────── × 100
 *              1/N · Σ_{i=1}^{N} T_i
 *
 * @param {number[]} periods Fundamental periods T_i (seconds or ms — units cancel).
 * @returns {number} Jitter as a percentage.
 */
export function relativePitchJitter(periods) {
  if (!Array.isArray(periods) || periods.length < 3) return NaN;
  const n = periods.length;
  let diffSum = 0;
  for (let i = 0; i < n - 1; i++) diffSum += Math.abs(periods[i] - periods[i + 1]);
  const meanPeriod = mean(periods);
  if (!meanPeriod) return NaN;
  return (diffSum / (n - 1)) / meanPeriod * 100;
}

/**
 * 2. Amplitude Perturbation Quotient / Shimmer, 3-cycle (%)
 *
 *          1/(N-2) · Σ_{i=2}^{N-1} |A_i − (A_{i-1}+A_i+A_{i+1})/3|
 * S_apq3 = ───────────────────────────────────────────────────────── × 100
 *                        1/N · Σ_{i=1}^{N} A_i
 *
 * @param {number[]} amplitudes Peak-to-peak amplitudes A_i.
 */
export function shimmerApq3(amplitudes) {
  if (!Array.isArray(amplitudes) || amplitudes.length < 4) return NaN;
  const n = amplitudes.length;
  let dev = 0;
  for (let i = 1; i < n - 1; i++) {
    const localMean = (amplitudes[i - 1] + amplitudes[i] + amplitudes[i + 1]) / 3;
    dev += Math.abs(amplitudes[i] - localMean);
  }
  const mA = mean(amplitudes);
  if (!mA) return NaN;
  return (dev / (n - 2)) / mA * 100;
}

/**
 * 3. Harmonics-to-Noise Ratio (dB)
 *
 * HNR = 10 · log10( r_x(τ_max) / ( r_x(0) − r_x(τ_max) ) )
 *
 * @param {number[]} frame Windowed speech frame samples.
 * @param {number[]} [autocorr] Pre-computed autocorrelation r_x(τ); computed if omitted.
 */
export function harmonicsToNoiseRatio(frame, autocorr) {
  if (!Array.isArray(frame) || frame.length < 64) return NaN;
  let rx = autocorr;
  if (!rx) {
    rx = [];
    for (let lag = 0; lag < Math.min(frame.length, 400); lag++) {
      let s = 0;
      for (let i = 0; i < frame.length - lag; i++) s += frame[i] * frame[i + lag];
      rx.push(s);
    }
  }
  if (rx.length < 8) return NaN;
  // τ_max = lag of maximum autocorrelation beyond a plausible pitch range.
  const searchFrom = Math.max(8, Math.floor(rx.length / 40));
  let tauMax = searchFrom, best = rx[searchFrom];
  for (let i = searchFrom; i < rx.length; i++) {
    if (rx[i] > best) { best = rx[i]; tauMax = i; }
  }
  const r0 = rx[0];
  const denom = r0 - rx[tauMax];
  if (!r0 || denom <= 0) return NaN;
  return 10 * Math.log10(rx[tauMax] / denom);
}

/**
 * 4. Pause Ratio
 *
 * PR = Σ Duration(silence frames with energy < θ_silence) / Total duration
 *
 * @param {number[]} frameEnergies Per-frame energies.
 * @param {number} frameDurationMs Duration of one frame.
 * @param {number} [thetaSilence] Energy threshold (fraction of mean energy).
 */
export function pauseRatio(frameEnergies, frameDurationMs = 25, thetaSilence = 0.05) {
  if (!Array.isArray(frameEnergies) || !frameEnergies.length) return NaN;
  const m = mean(frameEnergies);
  if (!m) return NaN;
  const theta = thetaSilence * m;
  const silent = frameEnergies.filter((e) => e < theta).length;
  return (silent * frameDurationMs) / (frameEnergies.length * frameDurationMs);
}

/**
 * Turn a descriptor object into validated, normalised acoustic metrics.
 * Absent values stay `null` — they are never fabricated.
 *
 * @param {Object} d Descriptor (`pitch_jitter_pct`, `speech_rate_wpm`, `pause_ratio`,
 *                    `hnr_db`, `shimmer_pct`, `decibel_spl`, `snr_db`, `affect`).
 * @returns {{pitchJitterPct:number|null, speechRateWpm:number|null, pauseRatio:number|null,
 *            hnrDb:number|null, shimmerPct:number|null, decibelSpl:number|null,
 *            snrDb:number|null, affect:string, present:boolean, source:string}}
 */
export function describeAcoustics(d = {}) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const affect = typeof d.affect === "string" ? d.affect.toLowerCase() : "unknown";
  const present = Object.keys(d).length > 0;
  return {
    pitchJitterPct: num(d.pitch_jitter_pct ?? d.pitchJitterPct),
    speechRateWpm: num(d.speech_rate_wpm ?? d.speechRateWpm),
    pauseRatio: num(d.pause_ratio ?? d.pauseRatio),
    hnrDb: num(d.hnr_db ?? d.hnrDb),
    shimmerPct: num(d.shimmer_pct ?? d.shimmerPct),
    decibelSpl: num(d.decibel_spl ?? d.decibelSpl),
    snrDb: num(d.snr_db ?? d.snrDb),
    // Interference/anomaly descriptors (TC-10) — carried through untouched so
    // detectAnomaly() can read them; they never influence dimension scores.
    volumeDeltaDb: num(d.volume_delta_db ?? d.volumeDeltaDb),
    offMicVoice: d.off_mic_voice === true || d.offMicVoice === true,
    transientTimestamp: d.transient_timestamp ?? d.transientTimestamp ?? null,
    affect,
    present,
    source: present ? "descriptor" : "absent",
  };
}

/**
 * Map acoustic metrics onto a 0..1 DISTRESS index.
 *
 * @returns {{score:number, confidence:number, contributors:Array<{feature:string,value:number|string,direction:string}>}}
 *          `confidence` is 0 when no acoustic evidence exists — text-only
 *          input must not be mistaken for "measured calm".
 */
export function acousticDistress(ac) {
  const contributors = [];
  if (!ac || !ac.present) {
    return { score: null, confidence: 0, contributors: [{ feature: "acoustic_stream", value: "absent", direction: "none" }] };
  }

  let weighted = 0, totalWeight = 0;
  const add = (feature, value, sub, weight, direction) => {
    contributors.push({ feature, value, direction });
    weighted += sub * weight;
    totalWeight += weight;
  };

  if (ac.pitchJitterPct !== null) {
    // 0% jitter → 0; >2.5% (acute trauma) → 1; clamp between.
    const sub = clamp01((ac.pitchJitterPct - BASELINE.jitterHealthyPct) /
      (BASELINE.jitterAcutePct - BASELINE.jitterHealthyPct));
    add("pitch_jitter_pct", ac.pitchJitterPct, sub, 0.35,
      ac.pitchJitterPct > BASELINE.jitterAcutePct ? "elevated" : "baseline");
  }
  if (ac.speechRateWpm !== null) {
    const sub = clamp01((ac.speechRateWpm - BASELINE.speechRateNormalWpm) /
      (BASELINE.speechRatePressuredWpm - BASELINE.speechRateNormalWpm));
    add("speech_rate_wpm", ac.speechRateWpm, sub, 0.2,
      sub > 0.5 ? "pressured" : "normal");
  }
  if (ac.pauseRatio !== null) {
    add("pause_ratio", ac.pauseRatio, clamp01(ac.pauseRatio / BASELINE.pauseRatioElevated), 0.2,
      ac.pauseRatio >= BASELINE.pauseRatioElevated ? "elevated" : "normal");
  }
  if (ac.shimmerPct !== null) {
    add("shimmer_pct", ac.shimmerPct, clamp01(ac.shimmerPct / 6), 0.15,
      ac.shimmerPct > 4 ? "elevated" : "baseline");
  }
  if (ac.hnrDb !== null) {
    // Lower HNR = more noise/breathiness = higher arousal. Normal ≈ 20 dB.
    add("hnr_db", ac.hnrDb, clamp01((20 - ac.hnrDb) / 20), 0.1,
      ac.hnrDb < 12 ? "breathy" : "normal");
  }

  // Descriptor-only affect tag (used when no numeric features supplied).
  if (!totalWeight) {
    const map = { flat: 0.1, calm: 0.1, neutral: 0.3, elevated: 0.7, high: 0.85, severe: 0.95 };
    const sub = map[ac.affect];
    if (sub === undefined) return { score: null, confidence: 0, contributors };
    add("affect_descriptor", ac.affect, sub, 1, ac.affect);
  }

  return {
    score: totalWeight ? weighted / totalWeight : null,
    confidence: totalWeight ? clamp01(0.4 + 0.15 * contributors.length) : 0,
    contributors,
  };
}
