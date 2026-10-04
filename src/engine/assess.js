/**
 * Sahaara AI — Assessment Orchestrator
 *
 * Pipeline (§1.1):
 *
 *   Complainant Input
 *     → Multimodal Ingestion (verbatim preserved)
 *     → Layer 0 Deterministic Safety Override      [layer0.js]
 *     → Multidimensional Trauma & Vulnerability    [dimensions.js]
 *     → Uncertainty, Conflict & Abstention         [uncertainty.js]
 *     → Evidence Attribution & Explainability      [evidence.js]
 *     → Non-Diagnostic Gate                        [safeguard.js]
 *
 * Output conforms to the SahaaraAssessmentOutput JSON schema (§5.1).
 */

import { runLayer0, OVERRIDE } from "./layer0.js";
import { scoreAllDimensions, supportFactors, DIMENSIONS } from "./dimensions.js";
import { buildEvidence, trimEvidence, tokeniseTranscript, assertEvidenceVerbatim } from "./evidence.js";
import { describeAcoustics } from "./acoustic.js";
import { languageMeta } from "./language.js";
import {
  evidenceSufficiency, priorityDistribution, informationGaps,
  detectConflict, detectAnomaly, THETA_SAFE,
} from "./uncertainty.js";
import { assertNonDiagnostic, NON_DIAGNOSTIC_NOTICE, BEHAVIOURAL_FLAG_LIBRARY } from "./safeguard.js";
import { assessDegraded } from "./degraded.js";
import { computeTrajectory } from "./review.js";

/** Operational priority vocabulary (§5.1 enum, extended for TC-10's qualifier). */
export const PRIORITY = {
  LOW: "LOW",
  MODERATE: "MODERATE_PSYCHOSOCIAL_SUPPORT",
  HIGH: "HIGH_SAFETY_REVIEW",
  IMMEDIATE_DANGER: "CRITICAL_IMMEDIATE_DANGER",
  SELF_HARM: "CRITICAL_SELF_HARM_PATHWAY",
  HUMAN_REQUIRED: "HUMAN_ASSESSMENT_REQUIRED",
  VERIFICATION_REQUIRED: "ELEVATED_HUMAN_VERIFICATION_REQUIRED",
};

/** Uncertainty states (§5.1 enum). */
export const UNCERTAINTY = {
  NOMINAL: "NOMINAL",
  ABSTAIN: "ABSTAIN",
  CONFLICT: "CONFLICT",
  AMBIGUOUS: "AMBIGUOUS",
};

/**
 * Human-action catalogue. Every path terminates in a human decision.
 */
const ACTIONS = {
  ROUTINE: {
    action_code: "ROUTINE_ADMIN_FOLLOWUP",
    description: "No urgent action. Continue standard case handling; re-assess at next scheduled contact.",
    urgency: "ROUTINE", queue: "standard",
  },
  PSYCHOSOCIAL: {
    action_code: "PSYCHOSOCIAL_REFERRAL",
    description: "Offer psychosocial support referral and a scheduled follow-up. Confirm the complainant's support network and sleep/functional status.",
    urgency: "WITHIN_72_HOURS", queue: "support",
  },
  SAFETY_REVIEW: {
    action_code: "URGENT_SAFETY_PLANNING",
    description: "Urgent human safety review. Verify the threat evidence, assess immediate safety planning, and preserve contact records.",
    urgency: "WITHIN_4_HOURS", queue: "safety",
  },
  PROBING: {
    action_code: "TRAINED_INTAKE_PROBING",
    description:
      "Engage secondary human-led outreach using gentle, low-demand questioning. Do NOT close the ticket. Verify a safe callback number and attempt SMS callback if safe.",
    urgency: "PROMPT_HUMAN_TRIAGE", queue: "intake_gap",
  },
  VERIFICATION: {
    action_code: "COVERT_SAFETY_CHECK_PROTOCOL",
    description:
      "DO NOT confront the caller about anyone being present. Switch to binary questions ('If you cannot speak freely, say yes or press 1'). If the line drops, initiate welfare-check protocol.",
    urgency: "IMMEDIATE_DISCREET_INTERVENTION", queue: "verification",
  },
  RECONCILE: {
    action_code: "HUMAN_RECONCILIATION_REQUIRED",
    description:
      "Two inconsistent statements are on record. Re-interview to reconcile; treat any named-location threat as actionable now regardless of the conflict. Sahaara does not choose between the statements.",
    urgency: "WITHIN_4_HOURS", queue: "safety",
  },
  WELFARE: {
    action_code: "WELFARE_CHECKIN_AND_SUPPORT",
    description:
      "Supportive welfare follow-up and grievance escalation. Distress is elevated but immediate danger is not indicated — no safety escalation.",
    urgency: "WITHIN_72_HOURS", queue: "support",
  },
  LANG_REVIEW: {
    action_code: "QUALIFIED_LANGUAGE_REVIEW",
    description:
      "Route to a reviewer qualified in the detected language(s). Verify any gloss against the verbatim original before it informs any operational decision.",
    urgency: "STANDARD", queue: "language_review",
  },
  TRAJECTORY: {
    action_code: "LONGITUDINAL_REASSESSMENT",
    description:
      "Compare with the prior assessment, confirm the trajectory, and set the next reassessment point. Do not overwrite earlier assessments.",
    urgency: "STANDARD", queue: "followup",
  },
};

const pick = (k) => ({ ...ACTIONS[k] });

/**
 * Resolve the operational priority from dimension scores + safety state.
 *
 * @param {Object} p
 * @param {Object} p.layer0
 * @param {Object} p.dimensions
 * @param {boolean} p.abstain
 * @param {boolean} p.hasAnomaly
 * @param {boolean} p.hasConflict
 * @returns {string}
 */
function resolvePriority({ layer0, dimensions, abstain, hasAnomaly, hasConflict }) {
  // 1. Deterministic overrides always win — bypass normal weighting (CRIT-01).
  if (layer0.tripped) {
    return layer0.override_code === OVERRIDE.SO_02 ? PRIORITY.SELF_HARM : PRIORITY.IMMEDIATE_DANGER;
  }
  // 2. Abstention means no priority can honestly be assigned (CRIT-06).
  if (abstain) return PRIORITY.HUMAN_REQUIRED;
  // 3. Interference signal is an elevated verification state, not a verdict (CRIT-05).
  if (hasAnomaly) return PRIORITY.VERIFICATION_REQUIRED;

  const safety = dimensions.immediate_physical_safety.score;
  const distress = dimensions.psychological_distress.score;
  const vuln = dimensions.contextual_vulnerability.score;

  if (safety >= 0.7) return PRIORITY.HIGH;
  if (hasConflict && safety >= 0.45) return PRIORITY.HIGH;
  if (safety >= 0.45) return PRIORITY.HIGH;
  if (distress >= 0.72 || vuln >= 0.72) return PRIORITY.MODERATE;
  if (distress >= 0.3 || vuln >= 0.3 || hasConflict) return PRIORITY.MODERATE;
  return PRIORITY.LOW;
}

/**
 * Choose the recommended human action for a resolved (non-abstaining) case.
 */
function resolveAction({ layer0, dims, hasConflict, hasAnomaly, codeSwitched }) {
  if (layer0.tripped) return layer0.action;

  if (hasAnomaly) return { ...pick("VERIFICATION"), rationale: "Interference hypothesis requires discreet human verification before any operational consequence." };
  if (hasConflict) return { ...pick("RECONCILE"), rationale: "Contradictory safety statements on record; neither discarded." };

  const safety = dims.immediate_physical_safety.score;
  const distress = dims.psychological_distress.score;
  const vuln = dims.contextual_vulnerability.score;

  if (safety >= 0.7) return { ...pick("SAFETY_REVIEW"), rationale: `Immediate safety indicator ${safety.toFixed(2)} with verbatim evidence.` };
  if (safety >= 0.45) return { ...pick("SAFETY_REVIEW"), rationale: `Elevated safety indicator ${safety.toFixed(2)}.` };
  if (distress >= 0.7 || vuln >= 0.7) return { ...pick("PSYCHOSOCIAL"), rationale: `Distress ${distress.toFixed(2)}, vulnerability ${vuln.toFixed(2)}, no immediate danger signal.` };
  if (distress >= 0.4 || vuln >= 0.4) return { ...pick("WELFARE"), rationale: `Moderate distress ${distress.toFixed(2)} / vulnerability ${vuln.toFixed(2)} without danger indicators.` };

  const a = { ...pick("ROUTINE"), rationale: "No elevated indicator; protective evidence present." };
  if (codeSwitched) return { ...pick("LANG_REVIEW"), rationale: "Code-switched input — verify gloss against verbatim original." };
  return a;
}

/**
 * Run the full assessment.
 *
 * @param {Object} input
 * @param {string}   input.case_id
 * @param {string|Array} [input.verbatim_text]  Plain text, or turns array.
 * @param {Array}    [input.turns]              [{ timestamp, speaker, text }]
 * @param {Object}   [input.acoustic]           Acoustic descriptor.
 * @param {string[]} [input.language_hint]
 * @param {Object}   [input.context]            { prior_assessments, session_number }
 * @param {Object}   [input.flags]              { overrideBias } test hook.
 * @returns {Object} SahaaraAssessmentOutput
 */
export function assess(input = {}) {
  const {
    case_id = "UNKNOWN",
    session_number = 1,
    verbatim_text = null,
    turns = null,
    acoustic = null,
    language_hint = null,
    context = {},
    flags = {},
    degraded = false,
  } = input;

  // ── 0. Degraded mode (CRIT-12) ─────────────────────────────────────────
  // Checked first: while the model service is unreachable the platform must
  // produce NO assessment at all — not a low-confidence one, not a default.
  if (degraded || flags.degraded) {
    return assessDegraded({ ...input, degraded: undefined });
  }

  const notes = [];

  // ── 1. Ingestion: preserve verbatim, build utterance list ──────────────
  let utterances;
  if (Array.isArray(turns) && turns.length) {
    utterances = turns.map((t) => ({
      timestamp: t.timestamp || t.t || "00:00",
      speaker: t.speaker || "complainant",
      text: (t.text || "").trim(),
    })).filter((u) => u.text);
  } else {
    utterances = tokeniseTranscript(verbatim_text || "");
  }

  const sourceTexts = utterances.map((u) => u.text);
  const complainantText = utterances
    .filter((u) => !/interviewer|officer|questioner/i.test(u.speaker || ""))
    .map((u) => u.text)
    .join(" ");
  const fullText = sourceTexts.join(" ");

  const ac = describeAcoustics(acoustic || {});

  // ── 2. Layer 0: deterministic safety override ─────────────────────────
  const layer0 = runLayer0({
    text: complainantText || fullText,
    utterances,
    overrideBias: flags.overrideBias,
  });
  notes.push(...layer0.notes);

  // ── 3. Language metadata (§9) ──────────────────────────────────────────
  const primaryUtterance = utterances[0] || { text: "", timestamp: "00:00" };
  const lang = languageMeta(primaryUtterance.text, language_hint, primaryUtterance.timestamp);
  const codeSwitched = utterances.some((u) => languageMeta(u.text, language_hint, u.timestamp).code_switched);

  // ── 4. Evidence attribution (§5.1 evidence_attribution) ────────────────
  let evidence = buildEvidence(utterances, {
    dimensions: ["safety", "self_harm", "distress", "vulnerability", "support", "anomaly"],
    languageHint: language_hint,
  });
  // Verbatim integrity is a hard gate (CRIT-09).
  assertEvidenceVerbatim(evidence, sourceTexts);

  // ── 5. Uncertainty, conflict, anomaly ─────────────────────────────────
  const conflict = detectConflict(utterances);
  const anomaly = detectAnomaly(utterances, ac, context.prior_statements || []);
  const hasConflictEarly = conflict.detected;

  // ── 6. Multidimensional scoring ───────────────────────────────────────
  const dimensions = scoreAllDimensions(utterances, ac, evidence, {
    neutraliseProtective: hasConflictEarly,
  });

  // ── 7. Evidence sufficiency & abstention (§7.3) ───────────────────────
  // Ambiguity is measured against a distribution whose sharpness is set by
  // evidence confidence — sparse input stays near-uniform (high H → abstain),
  // well-evidenced input sharpens (low H → assess).
  //
  // λ is averaged only over dimensions that actually carry evidence. A case
  // with no vulnerability evidence is not "less sufficient" than one that has
  // it; the dimension simply has nothing to say, and that is not ambiguity.
  const evidenced = Object.values(dimensions).filter(
    (d) => d.contributions && d.contributions.some((c) => c.applied !== 0)
  );
  const lambda = evidenced.length
    ? Math.min(1, evidenced.reduce((s, d) => s + d.confidence, 0) / evidenced.length)
    : 0;
  const distribution = priorityDistribution({
    immediate_physical_safety: dimensions.immediate_physical_safety.score,
    psychological_distress: dimensions.psychological_distress.score,
    contextual_vulnerability: dimensions.contextual_vulnerability.score,
  }, lambda);
  const sufficiency = evidenceSufficiency({
    text: fullText,
    distribution,
    snrDb: ac.snrDb,
    acousticPresent: ac.present,
  });

  // Abstention is gated four ways. It requires ALL of:
  //   1. Es below θ_safe                          (the metric itself)
  //   2. no Layer-0 override                      (CRIT-01 outranks CRIT-06)
  //   3. no competing epistemic state             (conflict TC-13 / anomaly
  //      TC-10 are *information*, not absence of it)
  //   4. genuinely weak per-dimension confidence  (a sparse transcript can
  //      still carry convergent, time-anchored evidence — that is assessable
  //      with stated limitations, not a case for abstaining)
  const hasConflict = conflict.detected;
  const hasAnomaly = Boolean(anomaly) && !layer0.tripped;
  const abstain =
    sufficiency.Es < THETA_SAFE &&
    !layer0.tripped &&
    !hasConflict &&
    !hasAnomaly &&
    lambda < 0.40;

  // Conflict and abstention are distinct epistemic states. If we can see two
  // contradictory statements we are not "out of evidence" — we have too much
  // of the wrong shape. Report CONFLICT, do not abstain (CRIT-11).
  let uncertaintyState = UNCERTAINTY.NOMINAL;
  if (abstain) uncertaintyState = UNCERTAINTY.ABSTAIN;
  else if (hasConflict) uncertaintyState = UNCERTAINTY.CONFLICT;
  else if (hasAnomaly) uncertaintyState = UNCERTAINTY.AMBIGUOUS;
  else if (sufficiency.ambiguity > 0.92) uncertaintyState = UNCERTAINTY.AMBIGUOUS;

  const isAbstain = uncertaintyState === UNCERTAINTY.ABSTAIN;

  // ── 8. Priority & action resolution ───────────────────────────────────
  const operational_priority = resolvePriority({
    layer0, dimensions, abstain: isAbstain, hasAnomaly, hasConflict,
  });

  let recommended;
  if (layer0.tripped) {
    recommended = layer0.action;
  } else if (isAbstain) {
    recommended = pick("PROBING");
  } else {
    recommended = resolveAction({
      layer0, dims: dimensions,
      hasConflict, hasAnomaly, codeSwitched,
    });
  }

  // ── 9. Behavioural flags (never diagnoses) ────────────────────────────
  const behaviouralFlags = [];
  if (layer0.tripped) {
    if (layer0.override_code === OVERRIDE.SO_02) {
      behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.LETHAL_MEANS_PROXIMITY);
      behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.HOPELESSNESS_PERVASIVE);
    } else {
      behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.EXPLICIT_IMMINENT_DANGER);
    }
  }
  if (hasAnomaly) behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.EXTERNAL_INTERFERENCE_SIGNAL);
  if (hasConflict) behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.CONTRADICTORY_SAFETY_STATEMENTS);
  if (dimensions.immediate_physical_safety.score >= 0.7 && !layer0.tripped) {
    behaviouralFlags.push(BEHAVIOURAL_FLAG_LIBRARY.ESCALATING_CONTACT_PATTERN);
  }

  // ── 10. Abstention vs scored output ───────────────────────────────────
  const dimsOut = {};
  for (const def of DIMENSIONS) {
    const d = dimensions[def.key];
    if (isAbstain) {
      // CRIT-06: no forced classification. Scores are null, not 0 — a zero
      // would itself be a confident claim — and indicator confidence reads
      // UNKNOWN rather than a number, because a numeric confidence at this
      // evidence level is itself an over-claim.
      dimsOut[def.key] = {
        level: def.key === "psychological_distress" ? "UNKNOWN" : "INSUFFICIENT_EVIDENCE",
        score: null,
        confidence: "UNKNOWN",
        suppressed_reason: "ABSTAIN_INSUFFICIENT_EVIDENCE",
      };
    } else {
      dimsOut[def.key] = {
        level: d.level,
        score: d.score,
        confidence: d.confidence,
        evidence_ids: d.evidence_ids,
        // Quote-level provenance: every number above can be traced to the
        // words that produced it, including signals that were held in
        // abeyance rather than scored.
        contributions: d.contributions.map((c) => ({
          signal_id: c.signal_id,
          quote: c.quote,
          timestamp: c.timestamp,
          raw_weight: c.raw_weight,
          applied: c.applied,
          negated: c.negated,
          note: c.note,
        })),
        ...(d.audio ? { acoustic_contribution: d.audio } : {}),
      };
    }
  }

  const gaps = isAbstain ? informationGaps(utterances) : null;
  evidence = trimEvidence(evidence, 4);

  // ── 11. Assemble payload ──────────────────────────────────────────────
  const payload = {
    case_id,
    assessment_id: `AI-${case_id}-${session_number}`,
    session_number,
    timestamp: new Date().toISOString(),
    record_type: "AI_ASSESSMENT",
    operational_priority,

    multidimensional_assessment: dimsOut,

    safety_override: {
      active: layer0.tripped,
      trigger: layer0.tripped ? layer0.override_code : null,
      override_code: layer0.override_code,
      override_timestamp: layer0.override_timestamp,
      bypass_normal_weighting: layer0.bypass_normal_weighting,
      trigger_criteria: layer0.trigger_criteria,
      criteria_detail: layer0.criteria_detail.map((c) => ({
        code: c.code, label: c.label, evidence: c.quote, timestamp: c.timestamp,
      })),
      reference_note:
        "Layer 0 is deterministic and runs before probabilistic inference. It can force a priority upward; it never forces one downward.",
    },

    uncertainty_state: {
      state: uncertaintyState,
      abstention: isAbstain,
      conflicting_evidence: hasConflict,
      evidence_quality_score: sufficiency.Es,
      threshold: THETA_SAFE,
      abstention_reason: isAbstain ? "DATA_SPARSITY_AND_AMBIGUITY_THRESHOLD_EXCEEDED" : null,
      confidence_metric: sufficiency.Es,
      confidence_label: isAbstain ? "UNKNOWN" : confidenceBand(sufficiency.Es),
      // A contradiction is a reason to be less sure, stated explicitly rather
      // than left to be inferred from a slightly lower number.
      confidence_reduction: hasConflict
        ? {
            applied: true,
            reason: "CONTRADICTORY_EVIDENCE_ON_RECORD",
            note:
              "Confidence is reduced because mutually inconsistent safety statements are present. The reduction does not select between them.",
          }
        : { applied: false, reason: null, note: null },
      terms: sufficiency.terms,
      substantive_tokens: sufficiency.substantive,
      snr_normalised: sufficiency.snrNorm,
      ambiguity_entropy: sufficiency.ambiguity,
      priority_distribution: Object.fromEntries(
        ["LOW", "MODERATE", "HIGH", "CRITICAL"].map((k, i) => [k, Number(distribution[i].toFixed(3))])
      ),
    },

    evidence_attribution: evidence.map((e) => ({
      quote: e.quote,
      verbatim: e.verbatim,
      dimension: e.dimension,
      signal_id: e.signal_id,
      timestamp_offset: e.timestamp_offset,
      language: e.language,
      speaker: e.speaker,
      role: e.role,
      weight: e.weight,
      matched_pattern: e.matched_pattern,
      // Everything here is what a complainant SAID, not what has been proved.
      // The label travels with the quote wherever the quote is displayed.
      verification: "SELF_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
      affects_scoring: true,
    })),

    recommended_human_action: {
      ...(recommended || {}),
      human_decision_authority: "HUMAN",
      autonomous_action_taken: false,
      human_decision: null,
    },

    // ── Extension blocks (beyond the base schema, required by TCs) ───────
    language_metadata: {
      ...lang,
      code_switched_anywhere: codeSwitched,
      affected_timestamps: utterances
        .filter((u) => languageMeta(u.text, language_hint, u.timestamp).code_switched)
        .map((u) => u.timestamp),
    },

    acoustic_analysis: ac.present ? {
      metrics: {
        pitch_jitter_pct: ac.pitchJitterPct,
        speech_rate_wpm: ac.speechRateWpm,
        pause_ratio: ac.pauseRatio,
        hnr_db: ac.hnrDb,
        shimmer_pct: ac.shimmerPct,
        decibel_spl: ac.decibelSpl,
        snr_db: ac.snrDb,
        affect: ac.affect,
      },
      orthogonality: orthogonality(dimensions, ac),
      contribution_channel: "psychological_distress",
      excluded_from: ["immediate_physical_safety", "contextual_vulnerability"],
      exclusion_rule: "Speech distress is never treated as proof of danger, trauma, coercion or self-harm (§7 CRIT-03).",
    } : {
      metrics: null,
      note: "No acoustic stream supplied. Distress assessed from narrative content only; acoustic confidence is 0 rather than assumed calm.",
    },

    conflict_analysis: hasConflict ? { ...conflict } : { detected: false },
    anomaly_analysis: anomaly ? { ...anomaly } : null,

    information_gap_analysis: gaps
      ? {
          missing_critical_data: gaps.missing_critical_data,
          suggested_probes: gaps.probes,
          data_quality: sufficiency.Es,
        }
      : null,

    non_diagnostic: {
      diagnostic_labeling_prohibited: true,
      psychiatric_diagnoses_generated: [],
      behavioural_safety_flags: behaviouralFlags.map((f) => ({
        ...f,
        evidence: evidence.find((e) => matchesFlag(f, e))?.quote ?? evidence[0]?.quote ?? null,
      })),
      notice: NON_DIAGNOSTIC_NOTICE,
    },

    support_factors: supportFactors(evidence),

    human_review: {
      required: true,
      status: "PENDING_HUMAN_REVIEW",
      available_actions: ["CONFIRM", "MODIFY", "ESCALATE", "DISMISS"],
      final_decision_authority: "HUMAN",
    },

    limitations: buildLimitations({ sufficiency, isAbstain, conflict, anomaly, layer0, ac, codeSwitched }),
    processing_notes: notes,
  };

  // ── 12. Longitudinal trajectory (CRIT-10) ─────────────────────────────
  // The prior assessment is echoed back unchanged and a delta is appended
  // alongside it. Nothing in history is rewritten by a later session.
  const prior = context.prior_assessment || (context.prior_assessments || []).at(-1) || null;
  if (prior) {
    payload.prior_assessment = structuredClone(prior);
    payload.trajectory = computeTrajectory(payload, prior);
  }

  // ── 13. Non-diagnostic gate (CRIT-02) — throws on violation ───────────
  assertNonDiagnostic(payload);

  return payload;
}

/** Coarse label for evidence sufficiency, so confidence is never a bare % on an abstained record. */
function confidenceBand(es) {
  if (es >= 0.8) return "HIGH";
  if (es >= THETA_SAFE) return "MODERATE";
  if (es >= 0.5) return "LOW";
  return "VERY_LOW";
}

function matchesFlag(flag, evidenceItem) {
  const map = {
    LETHAL_MEANS_PROXIMITY: ["SH_MEANS", "SH_PREPARATION"],
    PREPARATORY_FAREWELL_BEHAVIOUR: ["SH_PREPARATION"],
    HOPELESSNESS_PERVASIVE: ["SH_INTENT", "DIST_HOPELESS"],
    EXPLICIT_IMMINENT_DANGER: ["THREAT_IMMINENT", "FORCED_ENTRY", "THREAT_DIRECT", "WEAPON_OR_MEANS"],
    ESCALATING_CONTACT_PATTERN: ["THREAT_SURVEILLANCE"],
    EXTERNAL_INTERFERENCE_SIGNAL: ["ANOM_DENIAL_REVERSAL", "ANOM_MARKED_AFFECT"],
    CONTRADICTORY_SAFETY_STATEMENTS: ["SAFE_EXPLICIT", "CONFLICT_RETRACTION"],
  };
  return (map[flag.flag] || []).includes(evidenceItem.signal_id);
}

/**
 * Content ≠ emotion / distress ≠ danger — stated explicitly on the panel.
 */
function orthogonality(dims, ac) {
  const distress = dims.psychological_distress.score;
  const safety = dims.immediate_physical_safety.score;
  const gap = safety - distress;

  let flag = "CONTENT_ALIGNS_WITH_SPEECH";
  let explanation = "Narrative content and vocal prosody point the same direction.";

  if (gap >= 0.3) {
    flag = "CONTENT_EXCEEDS_SPEECH";
    explanation =
      "Content/contextual safety evidence substantially exceeds speech-related distress. " +
      "Low vocal arousal does NOT reduce a safety signal supported by narrative evidence (CRIT-04).";
  } else if (gap <= -0.3) {
    flag = "SPEECH_EXCEEDS_CONTENT";
    explanation =
      "Speech-related distress substantially exceeds narrative safety evidence. " +
      "Elevated vocal distress is NOT treated as proof of danger (CRIT-03).";
  }

  return {
    flag,
    explanation,
    speech_distress: distress,
    content_safety: safety,
    gap: Number(gap.toFixed(3)),
    content_ne_emotion: gap >= 0.3,
    distress_ne_danger: gap <= -0.3,
    acoustic_affect: ac.affect,
  };
}

function buildLimitations({ sufficiency, isAbstain, conflict, anomaly, layer0, ac, codeSwitched }) {
  const out = [];

  if (isAbstain) {
    out.push(
      `Abstained: evidence sufficiency ${sufficiency.Es} is below the ${THETA_SAFE} threshold. ` +
      "Absence of reported danger is NOT evidence of safety. No indicator can be supported from this input."
    );
  }
  if (conflict.detected) {
    out.push(
      "Two statements on record cannot both hold. Sahaara does not choose between them. " +
      (conflict.note || "")
    );
  }
  if (anomaly) {
    out.push(anomaly.guardrail);
    out.push(`Benign explanations available: ${anomaly.benign_alternatives.join(" ")}`);
  }
  if (layer0.tripped) {
    out.push(
      "Layer 0 deterministic override is active. Composite scoring was bypassed. " +
      "An unverified detail within the evidence (if any) is marked as such and does not affect urgency."
    );
  }
  if (!ac.present) {
    out.push(
      "No acoustic stream supplied — prosodic features are absent rather than measured. " +
      "Distress confidence reflects narrative evidence only."
    );
  }
  if (codeSwitched) {
    out.push(
      "Code-switched input detected. Confidence is reduced pending reviewer confirmation of cross-lingual interpretation. " +
      "Gloss text is interpretation only and is not evidentiary."
    );
  }
  out.push(NON_DIAGNOSTIC_NOTICE);
  out.push("A human reviewer is the final decision-maker. No downstream action is taken autonomously.");
  return out;
}

export { pick as _actionPick };
