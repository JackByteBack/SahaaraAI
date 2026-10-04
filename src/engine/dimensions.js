/**
 * Sahaara AI — Multidimensional Trauma & Vulnerability Engine
 *
 * §2 Core Tenet 1: psychological distress, immediate physical danger and
 * socioeconomic vulnerability are DISTINCT ORTHOGONAL dimensions. Severe
 * trauma can occur with no imminent danger; imminent danger can present with
 * flat, calm affect. They are never collapsed into a single score.
 *
 * Each dimension accumulates signed evidence contributions:
 *
 *      score = 1 − exp( −Σ w_i / τ )          (saturating, bounded to [0,1])
 *
 * τ (scale) per dimension controls how much evidence is needed to saturate.
 * Negative weights (protective factors) reduce the sum, which is why a strong
 * support network demonstrably lowers vulnerability rather than merely being
 * noted and ignored.
 */

import { SIGNALS, matchSignal } from "./lexicon.js";
import { acousticDistress } from "./acoustic.js";

/** Dimension registry. Order is the display order on the Intelligence Panel. */
export const DIMENSIONS = [
  { key: "psychological_distress", label: "Psychological Distress", scale: 2.6,
    bands: [ {max:0.24,level:"LOW"}, {max:0.54,level:"MODERATE"}, {max:0.80,level:"HIGH"}, {max:1.01,level:"ACUTE"} ] },
  { key: "immediate_physical_safety", label: "Immediate Physical Safety", scale: 1.0,
    bands: [ {max:0.14,level:"SAFE"}, {max:0.44,level:"LOW"}, {max:0.85,level:"HIGH_RISK"}, {max:1.01,level:"EXTREME_LETHALITY_RISK"} ] },
  { key: "contextual_vulnerability", label: "Contextual Vulnerability", scale: 2.4,
    bands: [ {max:0.24,level:"LOW"}, {max:0.54,level:"MODERATE"}, {max:0.80,level:"HIGH"}, {max:1.01,level:"SEVERE"} ] },
];

const DISTRESS_ONLY = new Set(["distress"]);
const SAFETY_ONLY = new Set(["safety", "self_harm"]);
const VULN_ONLY = new Set(["vulnerability", "support"]);

/** Which lexicon dimensions feed which assessment dimension. */
const FEEDERS = {
  psychological_distress: DISTRESS_ONLY,
  immediate_physical_safety: SAFETY_ONLY,
  contextual_vulnerability: VULN_ONLY,
};

/**
 * Saturating score from a signed evidence sum.
 * @param {number} sum
 * @param {number} scale
 */
export function saturate(sum, scale) {
  if (sum <= 0) return 0;
  return Math.min(1, 1 - Math.exp(-sum / scale));
}

/**
 * Map a 0..1 score to a band label.
 */
export function band(score, def) {
  for (const b of def.bands) if (score <= b.max) return b.level;
  return def.bands[def.bands.length - 1].level;
}

/**
 * Score one dimension.
 *
 * @param {string} dimKey    One of DIMENSIONS[].key
 * @param {Array} utterances [{ text, timestamp, speaker }]
 * @param {Object} ac        Normalised acoustic metrics (see acoustic.js)
 * @param {Array} evidence   Pre-built evidence items (reused for provenance)
 * @returns {{key,label,level,score,confidence,contributions,evidence_ids,audio}}
 */
export function scoreDimension(dimKey, utterances, ac, evidence, opts = {}) {
  // When the record contains contradictory safety statements (TC-13), neither
  // side is allowed to cancel the other numerically: protective claims are
  // surfaced through conflict_analysis instead of silently netting against the
  // risk evidence. This is the scoring expression of "don't pick a winner".
  const neutraliseProtective = opts.neutraliseProtective === true;

  const def = DIMENSIONS.find((d) => d.key === dimKey);
  const feeders = FEEDERS[dimKey];
  const contributions = [];
  let sum = 0;

  for (const u of utterances) {
    if (!u.text) continue;
    // Only the complainant's own speech can raise a risk indicator — an
    // interviewer asking "are you in danger?" must never score as danger.
    const isComplainant = !/^(interviewer|officer|questioner|assessor|reviewer|moderator)$/i
      .test((u.speaker || "").trim());
    for (const signal of SIGNALS) {
      if (!feeders.has(signal.dimension)) continue;
      if (!isComplainant && signal.weight > 0) continue;
      const res = matchSignal(signal, u.text);
      if (!res.matched) continue;

      let note = null;
      let applied = signal.weight;
      if (res.negated) {
        applied = 0;
        note = "matched under negation — recorded, not scored";
      } else if (neutraliseProtective && signal.weight < 0) {
        applied = 0;
        note = "protective statement held in abeyance: contradictory risk evidence on record (CRIT-11)";
      }

      contributions.push({
        signal_id: signal.id,
        quote: u.text,
        timestamp: u.timestamp,
        raw_weight: signal.weight,
        applied,
        negated: res.negated,
        note,
      });
      sum += applied;
    }
  }

  // ── Acoustic contribution ──────────────────────────────────────────────
  // Strictly gated: feeds distress ONLY. This is the mechanical guarantee
  // behind "speech distress must not be treated as proof of danger" (§7 rule 3).
  let audio = null;
  if (dimKey === "psychological_distress") {
    const a = acousticDistress(ac);
    audio = a;
    if (a.score !== null) {
      sum += a.score * 2.2;
      contributions.push({
        signal_id: "ACOUSTIC_PROSODY",
        quote: null,
        timestamp: "acoustic",
        raw_weight: 2.2 * a.score,
        applied: 2.2 * a.score,
        negated: false,
        note: `prosodic contribution ${a.score.toFixed(2)} (distress channel only)`,
        detail: a.contributors,
      });
    }
  } else if (ac && ac.present) {
    contributions.push({
      signal_id: "ACOUSTIC_EXCLUDED",
      quote: null, timestamp: "acoustic",
      raw_weight: 0, applied: 0, negated: false,
      note: `acoustic features present but EXCLUDED from ${dimKey} by design (distress ≠ danger)`,
    });
  }

  const score = saturate(sum, def.scale);
  const level = band(score, def);

  // ── Confidence ─────────────────────────────────────────────────────────
  // Driven by evidence quantity + quality, NOT by how alarming the result is.
  const scored = contributions.filter((c) => c.applied !== 0);
  const positive = scored.filter((c) => c.applied > 0);
  const hasTimeAnchors = scored.filter((c) => c.timestamp && c.timestamp !== "acoustic").length;

  let confidence = 0.25;
  confidence += Math.min(0.35, positive.length * 0.09);
  confidence += Math.min(0.20, hasTimeAnchors * 0.05);
  if (dimKey === "psychological_distress" && audio && audio.confidence) {
    confidence += 0.15 * audio.confidence;
  }
  // Protective-only evidence still yields a confident *negative* finding.
  if (!positive.length && scored.length) confidence += 0.15;
  if (!scored.length) confidence = 0.05;
  confidence = Math.min(0.98, confidence);

  const evidenceIds = evidence
    .filter((e) => e.dimension === dimKey ||
      (dimKey === "psychological_distress" && e.dimension === "distress") ||
      (dimKey === "immediate_physical_safety" && ["safety", "self_harm"].includes(e.dimension)) ||
      (dimKey === "contextual_vulnerability" && ["vulnerability", "support"].includes(e.dimension)))
    .map((e) => `${e.timestamp_offset}::${e.signal_id}`);

  return {
    key: dimKey,
    label: def.label,
    level,
    score: Number(score.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    evidence_sum: Number(sum.toFixed(3)),
    contributions,
    evidence_ids: [...new Set(evidenceIds)],
    audio,
  };
}

/**
 * Score all three dimensions.
 *
 * @param {Array} utterances
 * @param {Object} ac
 * @param {Array} evidence
 */
export function scoreAllDimensions(utterances, ac, evidence, opts = {}) {
  const out = {};
  for (const d of DIMENSIONS) out[d.key] = scoreDimension(d.key, utterances, ac, evidence, opts);
  return out;
}

/**
 * Support-network reading: how much protective evidence is present.
 * Surfaced on the panel so a low vulnerability score is visibly *earned*.
 */
export function supportFactors(evidence) {
  return evidence
    .filter((e) => e.weight < 0)
    .map((e) => ({ signal_id: e.signal_id, quote: e.quote, timestamp: e.timestamp_offset, effect: "protective" }));
}
