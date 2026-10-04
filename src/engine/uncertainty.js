/**
 * Sahaara AI — Uncertainty, Abstention, Conflict & Anomaly Engine
 *
 * Implements §7.3 (epistemic abstention & conformal uncertainty) and the
 * anomaly/conflict behaviour of TC-09, TC-10 and TC-13.
 *
 * Evidence Sufficiency Metric:
 *
 *        Es = α · (N_substantive / N_total)  +  β · SNR_acoustic  +  γ · (1 − H_ambiguity)
 *
 *   α = 0.4, β = 0.3, γ = 0.3     (empirically calibrated weights, §7.3)
 *   θ_safe = 0.65                  (abstention threshold)
 *
 *   H_ambiguity = − 1/log₂(K) · Σ P(C_k)·log₂ P(C_k)     (normalised Shannon entropy)
 *
 * ABSTAIN when Es < θ_safe. Abstention is a *successful* outcome, not a
 * failure: an AI that guesses on sparse input is dangerous (TC-09).
 */

import { SIGNALS, matchSignal } from "./lexicon.js";

export const ALPHA = 0.4;
export const BETA = 0.3;
export const GAMMA = 0.3;
export const THETA_SAFE = 0.65;

/** Priority classes used for the ambiguity distribution. */
export const PRIORITY_CLASSES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const K = PRIORITY_CLASSES.length;

/** Function words, contractions and conversational fillers (English + Indic Romanised). */
const STOPWORDS = new Set([
  // determiners / prepositions / conjunctions
  "the","a","an","this","that","these","those","some","any","every","each","all","both","another","such",
  "of","to","in","on","at","for","with","by","from","as","into","onto","over","under","between","through",
  "during","before","after","above","below","about","against","among","within","without","upon","across",
  "behind","beyond","near","off","out","up","down","along","around","past","since","until","via","per",
  "and","or","but","if","then","else","because","although","though","while","whereas","unless","so","than",
  "whether",
  // pronouns
  "i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their",
  "mine","yours","hers","ours","theirs","myself","yourself","himself","herself","itself","ourselves",
  "themselves","who","whom","whose","which","what",
  // copula & auxiliaries
  "am","are","is","was","were","be","been","being","do","does","did","have","has","had",
  "will","would","shall","should","can","could","may","might","must","ought","need","dare",
  // contractions
  "it's","i'm","i've","i'd","i'll","that's","there's","he's","she's","we're","they're","don't","doesn't",
  "didn't","isn't","aren't","wasn't","weren't","won't","can't","couldn't","wouldn't","shouldn't","haven't",
  "hasn't","hadn't","let's","you're","you've","i'll","we'll","he'll","she'll","it'll","there'll","i'm",
  // common adverbs / hedges
  "very","just","only","also","too","even","already","always","never","often","sometimes","usually",
  "really","quite","rather","almost","enough","perhaps","maybe","probably","actually","honestly","simply",
  "immediately","still","again","now","then","here","there","something","anything","everything","nothing",
  // discourse markers
  "not","yes","yeah","yeh","nah","ok","okay","fine","well","oh","ah","um","uh","please","sorry","thank",
  "thanks","hello","hi","bye","goodbye","sure","right","okay",
  // Romanised Indic fillers / function words
  "ho","gaya","gaye","nahi","nahin","pata","kuch","kya","kaise","kyun","chahiye","tha","thi","the","hai",
  "hain","hen","bas","theek","bolo","bola","raha","rahi","hoon","hun","bhi","toh","aur","phir","matlab",
  "haan","ha","ji","acha","achha","accha","abhi","yahan","wahan","iska","uska","mera","tera","aap","tum",
  "main","mai","mein","se","ko","ka","ke","ki","par","liye","wala","gaya","kar","kiye","nahi?",
]);

/**
 * Informative-token ratio (§7.3 first term).
 *
 * A token is informative when it is a content word — i.e. not a function word,
 * hedge, contraction or conversational filler. This is the standard reading of
 * "informative factual tokens": it separates a coherent narrative (roughly half
 * content words) from a monosyllabic stall ("Yes. Maybe. Just stuff.") whose
 * tokens are all fillers.
 *
 * Devanagari tokens count as content: Indic input must not be penalised for
 * script (CRIT-09). Romanised Indic fillers are listed in STOPWORDS instead.
 *
 * @param {string} text
 * @returns {{ratio:number, total:number, substantive:number}}
 */
export function substantiveRatio(text) {
  const DEVANAGARI_TOKEN = /[\u0900-\u097F]/;
  const tokens = String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’-]+/u)
    .filter(Boolean);
  if (!tokens.length) return { ratio: 0, total: 0, substantive: 0 };

  const substantive = tokens.filter((t) => {
    if (STOPWORDS.has(t)) return false;
    if (DEVANAGARI_TOKEN.test(t)) return true;
    return true;
  }).length;

  return { ratio: substantive / tokens.length, total: tokens.length, substantive };
}

/**
 * Normalised Shannon entropy of a probability vector.
 *
 *      H = − 1/log₂(K) · Σ P(C_k)·log₂ P(C_k)
 *
 * @param {number[]} p
 * @returns {number} 0 (certain) .. 1 (uniform)
 */
export function normalisedEntropy(p) {
  const total = p.reduce((s, x) => s + x, 0);
  if (total <= 0) return 1;
  const probs = p.map((x) => x / total).filter((x) => x > 0);
  if (probs.length <= 1) return 0;
  const h = -probs.reduce((s, x) => s + x * Math.log2(x), 0);
  return Math.min(1, h / Math.log2(K));
}

/**
 * Acoustic SNR normalised to 0..1.
 *
 * A text-only transcript carries no acoustic degradation, so SNR is treated as
 * perfect (1.0) rather than as missing evidence — the abstention signal for
 * sparse *text* must come from the substantive-token and entropy terms, not
 * from a channel measurement that was never requested.
 *
 * @param {number|null} snrDb
 * @param {boolean} acousticPresent
 */
export function snrNormalised(snrDb, acousticPresent) {
  // No SNR measurement requested → nothing reduces sufficiency. Absence of a
  // channel measurement is not evidence of a noisy channel; only a *measured*
  // low SNR should count against evidence quality.
  if (!acousticPresent) return 1.0;
  if (!Number.isFinite(snrDb)) return 1.0;
  // 0 dB → 0, 30 dB+ → 1 (telephony quality).
  return Math.min(1, Math.max(0, snrDb / 30));
}

/**
 * Evidence Sufficiency Metric.
 *
 * @param {Object} p
 * @param {string} p.text
 * @param {number[]|null} p.distribution  Priority-class probabilities.
 * @param {number|null} p.snrDb
 * @param {boolean} p.acousticPresent
 * @returns {{Es:number, terms:{substantive:number,snr:number,uncertainty:number},
 *            substantive:object, snrNorm:number, ambiguity:number}}
 */
export function evidenceSufficiency({ text, distribution, snrDb = null, acousticPresent = false }) {
  const sub = substantiveRatio(text);
  const snrNorm = snrNormalised(snrDb, acousticPresent);
  const ambiguity = normalisedEntropy(distribution || []);

  const t1 = ALPHA * sub.ratio;
  const t2 = BETA * snrNorm;
  const t3 = GAMMA * (1 - ambiguity);

  return {
    Es: Number((t1 + t2 + t3).toFixed(4)),
    terms: { substantive: Number(t1.toFixed(4)), snr: Number(t2.toFixed(4)), uncertainty: Number(t3.toFixed(4)) },
    substantive: sub,
    snrNorm,
    ambiguity: Number(ambiguity.toFixed(4)),
  };
}

/**
 * Derive a priority-class distribution from dimensional scores.
 *
 * The distribution is used ONLY to measure ambiguity — it is never presented
 * as a calibrated posterior. Its temperature is driven by evidence confidence:
 *
 *   T = T_MIN + T_RANGE · (1 − λ)
 *
 * where λ is the mean dimension confidence. Strong, time-anchored evidence
 * produces a sharp distribution (low H → high sufficiency); sparse evidence
 * produces a near-uniform one (H → 1 → abstention). This is what makes the
 * ambiguity term discriminate TC-09 from TC-01 rather than merely echoing
 * the scores themselves.
 *
 * @param {{immediate_physical_safety:number, psychological_distress:number,
 *          contextual_vulnerability:number}} dims
 * @param {number} [lambda] Mean evidence confidence in 0..1.
 * @returns {number[]} Four class probabilities (LOW, MODERATE, HIGH, CRITICAL).
 */
export function priorityDistribution(dims, lambda = 1) {
  const s = dims?.immediate_physical_safety ?? 0;
  const d = dims?.psychological_distress ?? 0;
  const v = dims?.contextual_vulnerability ?? 0;

  // Logits: signed distance of each score from the class-defining thresholds,
  // amplified so a mid-range score still separates MODERATE from HIGH.
  const raw = [
    6 * (0.35 - s) + 2 * Math.max(0.4 - d, 0) + 2 * Math.max(0.4 - v, 0),   // LOW
    4 * Math.max(s - 0.30, 0) + 3 * Math.max(d - 0.30, 0) + 3 * Math.max(v - 0.30, 0), // MODERATE
    6 * (s - 0.55) + 2 * Math.max(d - 0.70, 0),                              // HIGH
    6 * (s - 0.75) + 3 * Math.max(s - 0.90, 0),                              // CRITICAL
  ];
  const logits = raw.map((l) => l * 3);

  // Temperature rises as evidence confidence falls: weak evidence flattens the
  // distribution toward uniform (H → 1 → abstention), strong evidence sharpens
  // it (H → 0 → sufficient).
  const lam = Math.min(1, Math.max(0, Number(lambda) || 0));
  const T = 0.35 + 2.0 * (1 - lam);
  const scaled = logits.map((l) => l / T);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

/**
 * Information-gap analysis for an abstention (TC-09).
 *
 * @param {Array} utterances
 * @returns {{missing_critical_data:string[], data_quality:number, probes:string[]}}
 */
export function informationGaps(utterances) {
  const all = utterances.map((u) => u.text || "").join(" ");
  const lower = all.toLowerCase();

  const gaps = [];
  const probes = [];

  const hasLocation =
    /\b(address|location|street|road|area|pincode|city|village|here at|my place|landmark)\b/i.test(all) ||
    /\d{6}/.test(all);
  if (!hasLocation) {
    gaps.push("IDENTITY_AND_LOCATION_OF_COMPLAINANT");
    probes.push("Can you tell me roughly where you are right now? (area or landmark is enough.)");
  }

  const incidentCues =
    /\b(happened|incident|incident|assault|attack|threat|harass|stalk|abuse|hit|beat|stole|fraud|cheat|rape|molest|follow|blackmail)\b/i;
  if (!incidentCues.test(lower)) {
    gaps.push("NATURE_OF_ALLEGED_INCIDENT");
    probes.push("Can you describe, in your own words, what happened?");
  }

  const immediacy = /\b(right now|tonight|today|tomorrow|coming|outside|waiting|soon|this week|after school)\b/i;
  if (!immediacy.test(lower)) {
    gaps.push("IMMEDIACY_OF_PHYSICAL_THREAT");
    probes.push("Is anyone with you or near you right now? Are you safe at this moment?");
  }

  const others = /\b(my (daughter|son|child|children|mother|father|sister|brother|wife|husband)|family|kids)\b/i;
  if (!others.test(lower)) {
    gaps.push("PRESENCE_OF_OTHER_VULNERABLE_PARTIES");
    probes.push("Is anyone else with you who could be at risk?");
  }

  const hasActor = /\b(he|she|they|them|the man|the woman|my husband|my boss|my father)\b/i.test(all);
  if (!hasActor) {
    gaps.push("IDENTITY_OF_ALLEGED_PERPETRATOR");
    probes.push("Who is involved in this?");
  }

  const hasWhen = /\b(yesterday|today|last (week|month|night)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in (march|january|february|april|may|june|july|august|september|october|november|december)|\d{1,2}[: ]\d{2})\b/i;
  if (!hasWhen) {
    gaps.push("TEMPORAL_ANCHOR_OF_INCIDENT");
    probes.push("When did this happen?");
  }

  return { missing_critical_data: gaps, probes, data_quality: null };
}

/**
 * Detect mutually inconsistent safety statements (TC-13).
 *
 * Three conditions must ALL hold — otherwise a record would be flagged as
 * contradictory merely because it contains both good news and bad news:
 *
 *   1. an ABSOLUTE protective claim ("I am safe", "nobody has contacted me"),
 *      not a time-scoped reassurance ("not right now");
 *   2. positive risk evidence somewhere in the same record;
 *   3. the risk statement occurs STRICTLY AFTER the protective claim, so the
 *      two cannot be reconciled by chronology alone.
 *
 * A later, more specific disclosure is *surfaced*, never substituted — and a
 * protective statement that happens to follow the risk evidence is treated as
 * a possible reversal instead (see detectAnomaly), not as a contradiction.
 *
 * @param {Array} utterances
 * @returns {{detected:boolean, state:string, pairs:Array, confidence:number, note:string}}
 */
export function detectConflict(utterances) {
  const absoluteProtective = [];
  const scopedProtective = [];
  const dangerSignals = [];
  const retractions = [];

  for (const u of utterances) {
    if (!u.text) continue;

    for (const s of SIGNALS) {
      if (s.dimension === "anomaly" && s.id === "CONFLICT_RETRACTION") {
        const r = matchSignal(s, u.text);
        if (r.matched && !r.negated) retractions.push({ ...u, signal_id: s.id });
        continue;
      }
      if (!["safety", "self_harm"].includes(s.dimension)) continue;
      const r = matchSignal(s, u.text);
      if (!r.matched || r.negated) continue;
      if (s.weight >= 0) {
        dangerSignals.push({ ...u, signal_id: s.id, weight: s.weight });
      } else if (s.absolute === true) {
        absoluteProtective.push({ ...u, signal_id: s.id });
      } else {
        scopedProtective.push({ ...u, signal_id: s.id });
      }
    }
  }

  const base = {
    state: "NONE",
    pairs: [],
    confidence: 0,
    scoped_protective_statements: scopedProtective.map((s) => ({
      quote: s.text, timestamp: s.timestamp, signal_id: s.signal_id,
    })),
    retraction_markers: retractions.map((r) => ({ quote: r.text, timestamp: r.timestamp })),
  };

  if (!absoluteProtective.length && !dangerSignals.length) {
    return { detected: false, ...base, note: "no safety claims and no risk statements on record" };
  }
  if (!absoluteProtective.length) {
    return { detected: false, ...base, note: "risk statements only — nothing to contradict" };
  }
  if (!dangerSignals.length) {
    return { detected: false, ...base, note: "protective statements only" };
  }

  // Absolute claim + risk evidence that is strictly LATER than that claim.
  const pairs = [];
  for (const a of absoluteProtective) {
    for (const b of dangerSignals) {
      if (a.text === b.text && a.timestamp === b.timestamp) continue;
      if (temporalIndex(b.timestamp) <= temporalIndex(a.timestamp)) continue;
      pairs.push({
        statement_safe: { quote: a.text, timestamp: a.timestamp, signal_id: a.signal_id },
        statement_risk: { quote: b.text, timestamp: b.timestamp, signal_id: b.signal_id, weight: b.weight },
        gap: temporalGap(a.timestamp, b.timestamp),
        order: "protective_then_risk",
      });
    }
  }

  if (!pairs.length) {
    return {
      detected: false, ...base,
      note:
        "risk evidence exists but does not post-date the protective claim, " +
        "so chronology reconciles the two — reported as context, not contradiction",
    };
  }

  const hasRetraction = retractions.length > 0;
  return {
    detected: true,
    state: "CONFLICTING_EVIDENCE_DETECTED",
    pairs,
    confidence: Number(Math.min(0.95, 0.6 + (hasRetraction ? 0.15 : 0) + 0.05 * pairs.length).toFixed(3)),
    scope: "BOTH_STATEMENTS_RETAINED",
    selected_statement: null,
    selected: null,
    note: hasRetraction
      ? "Risk statement follows an absolute safety claim and is marked by an explicit re-correction. Both statements are retained for human reconciliation — neither is selected, downweighted or discarded."
      : "Risk statement post-dates an absolute safety claim. Both statements are retained for human reconciliation — neither is selected, downweighted or discarded.",
  };
}

function temporalIndex(ts) {
  if (!ts) return 0;
  const parts = String(ts).split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

function temporalGap(a, b) {
  const d = temporalIndex(b) - temporalIndex(a);
  return `${Math.abs(d)}s`;
}

/**
 * Detect possible external interference / coercion (TC-10).
 *
 * CRITICAL GUARDRAIL: output is an UNCONFIRMED HYPOTHESIS. The system must not
 * assert that anyone is present, that anyone is coercing, or that the
 * complainant is lying. An innocent explanation is always offered (CRIT-05).
 *
 * @param {Array} utterances
 * @param {Object} ac  Acoustic metrics
 * @param {Array} priorStatements  Earlier statements (previous sessions) for reversal detection
 * @returns {Object} anomaly block or null
 */
export function detectAnomaly(utterances, ac = {}, priorStatements = []) {
  const signals = [];
  const snippets = [];

  const ordered = utterances.filter((u) => u.text);
  for (let i = 0; i < ordered.length; i++) {
    for (const s of SIGNALS) {
      if (s.dimension !== "anomaly") continue;
      const r = matchSignal(s, ordered[i].text);
      if (!r.matched) continue;
      snippets.push({ index: i, quote: ordered[i].text, timestamp: ordered[i].timestamp, signal_id: s.id });
    }
  }

  if (!snippets.length) return null;

  // Narrative polarity inversion: risk-bearing statement followed later by a
  // total denial or a closure request.
  const riskBefore = ordered.findIndex((u) => SIGNALS.some((s) =>
    ["safety", "self_harm", "vulnerability"].includes(s.dimension) &&
    s.weight > 0 && matchSignal(s, u.text).matched && !matchSignal(s, u.text).negated));

  const denialIndex = snippets.findIndex((s) => s.signal_id === "ANOM_DENIAL_REVERSAL");
  const reversal = riskBefore >= 0 && denialIndex >= 0 && snippets[denialIndex].index > riskBefore;

  if (reversal) {
    signals.push({
      type: "NARRATIVE_POLARITY_INVERSION",
      description:
        `Detailed risk disclosure at ${ordered[riskBefore]?.timestamp ?? "earlier"} followed by total denial or closure request at ${snippets[denialIndex].timestamp}.`,
      snippet_before: ordered[riskBefore]?.text ?? null,
      snippet_after: snippets[denialIndex].quote,
      timestamp: `${ordered[riskBefore]?.timestamp ?? "00:00"} → ${snippets[denialIndex].timestamp}`,
    });
  }

  // Acoustic environment transient.
  const spike = ac.volumeDeltaDb;
  if (Number.isFinite(spike) && spike >= 8) {
    signals.push({
      type: "ACOUSTIC_ENVIRONMENT_TRANSIENT",
      description: `Off-mic acoustic event with abrupt volume change (+${spike} dB) immediately before narrative shift.`,
      timestamp: ac.transientTimestamp || "n/a",
    });
  }
  if (ac.offMicVoice) {
    signals.push({
      type: "THIRD_PARTY_ACOUSTIC_PRESENCE",
      description: "Low-amplitude off-mic vocal formant detected during the interviewee's turn.",
      timestamp: ac.transientTimestamp || "n/a",
    });
  }

  if (!signals.length) return null;

  // Confidence is deliberately capped: this is a hypothesis, never a finding.
  const confidence = Math.min(0.65, 0.35 + signals.length * 0.14);

  return {
    signal_detected: "POSSIBLE_EXTERNAL_INTERFERENCE_OR_COERCION",
    epistemic_status: "UNCONFIRMED_HYPOTHESIS",
    confidence: Number(confidence.toFixed(2)),
    uncertainty_indicators: signals,
    benign_alternatives: [
      "Another household member may simply be in the room and unaware of the call.",
      "The complainant may have reconsidered independently and genuinely wishes to withdraw.",
      "Volume changes can result from movement, line quality or a hand over the microphone.",
      "A prior statement may have been made under stress and later re-evaluated.",
    ],
    guardrail:
      "This is a signal for human verification, NOT a finding of coercion. Sahaara does not assert that any person is present, that any person is coercing the complainant, or that the complainant is being untruthful.",
    required_human_verification: true,
  };
}
