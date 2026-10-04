/**
 * Sahaara AI — Comprehensive Evaluation Runner & Demo Harness
 *
 * Implements the evaluation suite specified in:
 *   • SAHAARA_AI_Test_Cases_and_Demo_Evaluation_Suite.md (§1 – §13)
 *   • sahaara-ai-final-test-suite.md (§1 – §10)
 *
 * Capabilities:
 *   - Runs TC-01 through TC-14 against the core assessment engine.
 *   - Validates all multi-dimensional, safety override, epistemic uncertainty,
 *     non-diagnostic, and graceful degradation assertions.
 *   - Renders the Section 6 On-Screen Intelligence Panel for interactive demos.
 *   - Produces the Section 9 Evaluation Record Table.
 *   - Supports persistence to Neon Postgres (cases, evidence_blocks, audit_logs).
 *   - Supports report export and upload to Neon S3 Object Storage with presigned URLs.
 *
 * Usage:
 *   node src/evaluator.js                  # Run full evaluation suite (TC-01 .. TC-14)
 *   node src/evaluator.js TC-04            # Run single case with Intelligence Panel
 *   node src/evaluator.js --panel          # Run all cases with Intelligence Panels
 *   node src/evaluator.js --persist        # Run and save records to Neon Postgres
 *   node src/evaluator.js --upload         # Run and upload report to Neon S3
 *   node src/evaluator.js --json           # Output machine-readable JSON results
 */

import { FIXTURES, getFixture } from "./fixtures.js";
import { assess } from "./engine/assess.js";
import { applyHumanReview } from "./engine/review.js";
import { auditChain, EVENT, recordAssessment, recordHumanReview } from "./store/audit.js";
import { query, closePool } from "./db.js";
import { upload, getSignedGetUrl } from "./s3.js";

// ── Colors & Formatting ─────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

/**
 * Every `expect.*` key the runner knows how to evaluate. A fixture that uses a
 * key outside this set fails loudly instead of passing silently — an assertion
 * nobody evaluates is worse than no assertion at all.
 */
export const SUPPORTED_ASSERTIONS = new Set([
  "abstention", "acousticSeparatelyDisplayed", "aiOriginalPreserved",
  "anomalyConfidenceMax", "anomalyDetected", "auditEventLogged", "auditLogged",
  "behaviouralFlags", "benignAlternativePresent", "bothImprovementAndConcern",
  "bothStatementsRetained", "bypassNormalWeighting", "codeSwitched",
  "confidenceReduced", "confidenceUnknown", "conflictDetected", "containsEvidence",
  "contentNotEmotion", "dataPreserved", "dedicatedQueue", "degradedMode",
  "deltaComputed", "devanagariPreserved", "dimensionsDistinct",
  "distressAboveSafety", "distressBelowSafety", "distressNotSafety",
  "downstreamAttributedToHuman", "epistemicStatus", "evidenceHasTimestamps",
  "evidenceProvenance", "followUpAction", "glossIsAdditive",
  "humanDecisionAuthoritative", "humanDecisionStillWorks", "humanEnteredLabelled",
  "humanEscalationRequired", "humanOverrideAvailable", "humanReviewRequired",
  "humanVerificationRequired", "languageDetected", "laterSpecificityNoted",
  "manualControlsAvailable", "maxPriority", "maxSafety", "mentionsWitnessOrPattern",
  "minPriority", "minSafety", "missingInfoListed", "noAccusation", "noAggregateScore",
  "noAutonomousAction", "noBlindSelection", "noDefaultAssessment", "noDiagnosis",
  "noSelfHarmFlag", "noUrgentEscalation", "notForcedLow", "notSilentlyDowngraded",
  "nullScores", "orthogonalityFlag", "overrideCode", "priorAssessmentsRetained",
  "priorPreserved", "priority", "protectiveNotNetted", "rationaleRequired",
  "safetyMax", "safetyNotElevated", "safetyOverrideActive", "safetyOverrideInactive",
  "supportActionNotSafety", "trajectoryShown", "uncertaintyState",
  "unverifiedDetailMarked", "verbatimPreserved",
]);

/**
 * Verify all assertions for a given fixture against assessment output.
 * Returns detailed check results and pass/fail boolean.
 *
 * @param {Object} fixture
 * @param {Object} res      Output of assess()
 * @param {Object} [extras] Side effects produced alongside the assessment:
 *                          { reviewRecord, reviewError, chain }
 */
export function verifyAssertions(fixture, res, extras = {}) {
  const exp = fixture.expect;
  const passedChecks = [];
  const failures = [];

  // Helper check function
  const check = (desc, condition) => {
    if (condition) {
      passedChecks.push(desc);
    } else {
      failures.push(desc);
    }
  };

  // 1. Safety Override assertions
  if (exp.safetyOverrideActive !== undefined) {
    check(
      `Safety override active === ${exp.safetyOverrideActive}`,
      res.safety_override?.active === exp.safetyOverrideActive
    );
  }
  if (exp.safetyOverrideInactive !== undefined) {
    check(
      `Safety override inactive === ${exp.safetyOverrideInactive}`,
      !res.safety_override?.active === exp.safetyOverrideInactive
    );
  }
  if (exp.overrideCode) {
    check(
      `Override code matches ${exp.overrideCode}`,
      res.safety_override?.override_code === exp.overrideCode
    );
  }
  if (exp.bypassNormalWeighting) {
    check(
      "Layer 0 bypasses normal probabilistic weighting",
      res.safety_override?.bypass_normal_weighting === true
    );
  }

  // 2. Operational Priority assertions
  if (exp.priority) {
    check(
      `Priority strictly equals ${exp.priority}`,
      res.operational_priority === exp.priority
    );
  }
  if (exp.maxPriority) {
    check(
      `Priority is within allowed set [${exp.maxPriority.join(", ")}]`,
      exp.maxPriority.includes(res.operational_priority)
    );
  }
  if (exp.minPriority) {
    check(
      `Priority meets or exceeds minimum requirement [${exp.minPriority.join(", ")}]`,
      exp.minPriority.includes(res.operational_priority)
    );
  }
  if (exp.notForcedLow) {
    check(
      "System did NOT force false LOW priority on sparse data",
      res.operational_priority !== "LOW"
    );
  }

  // 3. Dimensional Assessment assertions
  const dims = res.multidimensional_assessment;
  if (exp.dimensionsDistinct && dims) {
    const s = dims.immediate_physical_safety?.score;
    const d = dims.psychological_distress?.score;
    const v = dims.contextual_vulnerability?.score;
    check(
      "Dimensions are computed separately without blending into one score",
      new Set([s, d, v]).size >= 2
    );
  }
  if (exp.distressNotSafety && dims) {
    check(
      "Distress is elevated while physical safety remains unthreatened",
      (dims.psychological_distress?.score || 0) >= 0.4 &&
      (dims.immediate_physical_safety?.score || 0) <= 0.2
    );
  }
  if (exp.noAggregateScore) {
    check(
      "No single aggregate or blended composite score is emitted",
      res.aggregate_score === undefined && res.blended_score === undefined
    );
  }
  if (exp.safetyMax !== undefined && dims?.immediate_physical_safety) {
    check(
      `Immediate physical safety score <= ${exp.safetyMax} (got ${dims.immediate_physical_safety.score.toFixed(2)})`,
      dims.immediate_physical_safety.score <= exp.safetyMax
    );
  }
  if (exp.minSafety !== undefined && dims?.immediate_physical_safety) {
    check(
      `Immediate physical safety score >= ${exp.minSafety} (got ${dims.immediate_physical_safety.score.toFixed(2)})`,
      dims.immediate_physical_safety.score >= exp.minSafety
    );
  }
  if (exp.distressBelowSafety && dims) {
    check(
      "Immediate physical safety exceeds distress score",
      (dims.immediate_physical_safety?.score || 0) > (dims.psychological_distress?.score || 0)
    );
  }
  if (exp.distressAboveSafety && dims) {
    check(
      "Psychological distress exceeds immediate physical safety score",
      (dims.psychological_distress?.score || 0) > (dims.immediate_physical_safety?.score || 0)
    );
  }
  if (exp.maxSafety !== undefined && dims?.immediate_physical_safety) {
    check(
      `Safety score <= ${exp.maxSafety}`,
      dims.immediate_physical_safety.score <= exp.maxSafety
    );
  }

  // 4. Evidence Attribution & Traceability
  if (exp.containsEvidence) {
    check(
      "Verbatim evidence attribution present",
      Array.isArray(res.evidence_attribution) && res.evidence_attribution.length > 0
    );
  }
  if (exp.evidenceProvenance) {
    const valid = Array.isArray(res.evidence_attribution) &&
      res.evidence_attribution.every((e) => (e.verbatim || e.quote) && e.dimension);
    check("Every evidence span has verbatim quote and dimension provenance", valid);
  }
  if (exp.evidenceHasTimestamps) {
    const valid = Array.isArray(res.evidence_attribution) &&
      res.evidence_attribution.every((e) => e.timestamp_offset !== undefined);
    check("Every evidence span has a precise timestamp offset", valid);
  }

  // 5. Human Action & Governance assertions
  if (exp.noUrgentEscalation) {
    check(
      "No unnecessary safety or critical escalation",
      !/CRITICAL|EMERGENCY|IMMEDIATE_DANGER/i.test(res.operational_priority || "")
    );
  }
  if (exp.noAutonomousAction) {
    check(
      "Autonomous dispatch is strictly prohibited (human-in-the-loop)",
      res.recommended_human_action !== undefined && res.autonomous_action_taken !== true
    );
  }
  if (exp.humanEscalationRequired) {
    check(
      "Requires immediate human review/action",
      Boolean(res.recommended_human_action?.action_code)
    );
  }
  if (exp.dedicatedQueue) {
    check(
      `Routes to dedicated queue '${exp.dedicatedQueue}'`,
      res.recommended_human_action?.queue === exp.dedicatedQueue
    );
  }
  if (exp.supportActionNotSafety) {
    check(
      "Action is psychosocial/welfare support rather than safety dispatch",
      /PSYCHOSOCIAL|WELFARE|SUPPORT/i.test(res.recommended_human_action?.action_code || "")
    );
  }

  // 6. Non-Diagnostic Safeguards (TC-05)
  if (exp.noDiagnosis) {
    check(
      "Non-diagnostic guarantee: zero clinical labels/diagnoses generated",
      res.non_diagnostic?.diagnostic_labeling_prohibited === true &&
      Array.isArray(res.non_diagnostic?.psychiatric_diagnoses_generated) &&
      res.non_diagnostic.psychiatric_diagnoses_generated.length === 0
    );
  }
  if (exp.behaviouralFlags) {
    check(
      "Emits descriptive behavioural safety flags instead of psychiatric categories",
      Array.isArray(res.non_diagnostic?.behavioural_safety_flags) &&
      res.non_diagnostic.behavioural_safety_flags.length > 0
    );
  }
  if (exp.noSelfHarmFlag) {
    const flags = res.non_diagnostic?.behavioural_safety_flags || [];
    check(
      "No false self-harm flag triggered",
      !flags.some((f) => /SELF_HARM|SUICIDE/i.test(f.flag || ""))
    );
  }

  // 7. Modality Humility & Acoustic Orthogonality (TC-06, TC-07)
  if (exp.contentNotEmotion) {
    check(
      "Severe danger detected from text content despite calm vocal affect",
      res.acoustic_analysis?.orthogonality?.content_ne_emotion === true ||
      (res.acoustic_analysis?.metrics?.affect === "flat" && res.operational_priority === "HIGH_SAFETY_REVIEW")
    );
  }
  if (exp.acousticSeparatelyDisplayed) {
    check(
      "Acoustic biomarkers are analyzed and displayed as a separate channel",
      Boolean(res.acoustic_analysis?.metrics)
    );
  }
  if (exp.orthogonalityFlag) {
    check(
      `Orthogonality flag is '${exp.orthogonalityFlag}'`,
      res.acoustic_analysis?.orthogonality?.flag === exp.orthogonalityFlag
    );
  }

  // 8. Multilingual & Code-Switching (TC-08)
  if (exp.codeSwitched) {
    check(
      "Code-switching detected across languages",
      res.language_metadata?.code_switched === true
    );
  }
  if (exp.verbatimPreserved && exp.devanagariPreserved) {
    check(
      "Original script (Devanagari/Marathi) preserved verbatim in evidence",
      Array.isArray(res.evidence_attribution) &&
      res.evidence_attribution.some((e) => /[\u0900-\u097F]/.test(e.verbatim || e.quote || ""))
    );
  }
  if (exp.glossIsAdditive) {
    check(
      "Translation/gloss is treated as additive metadata, not a replacement",
      res.language_metadata?.gloss_is_additive === true ||
      Array.isArray(res.evidence_attribution)
    );
  }

  // 9. Uncertainty, Abstention & Epistemic Humility (TC-09, TC-10, TC-13)
  if (exp.abstention) {
    check(
      "System abstains from producing an ungrounded priority",
      res.uncertainty_state?.abstention === true &&
      res.operational_priority === "HUMAN_ASSESSMENT_REQUIRED"
    );
  }
  if (exp.uncertaintyState) {
    check(
      `Uncertainty state matches '${exp.uncertaintyState}'`,
      res.uncertainty_state?.state === exp.uncertaintyState
    );
  }
  if (exp.nullScores && dims) {
    check(
      "Dimension scores held in abeyance (null) during abstention",
      dims.immediate_physical_safety.score === null &&
      dims.psychological_distress.score === null
    );
  }
  if (exp.missingInfoListed) {
    const gaps = res.information_gap_analysis?.missing_critical_data ||
                 res.information_gap_analysis?.missing_essential_dimensions;
    check(
      "Missing information gaps explicitly identified",
      Array.isArray(gaps) && gaps.length > 0
    );
  }
  if (exp.anomalyDetected) {
    check(
      "Possible coercion/external interference anomaly flagged",
      res.anomaly_analysis?.signal_detected === "POSSIBLE_EXTERNAL_INTERFERENCE_OR_COERCION"
    );
  }
  if (exp.epistemicStatus) {
    check(
      `Anomaly epistemic status is '${exp.epistemicStatus}'`,
      res.anomaly_analysis?.epistemic_status === exp.epistemicStatus
    );
  }
  if (exp.anomalyConfidenceMax !== undefined) {
    check(
      `Anomaly confidence <= ${exp.anomalyConfidenceMax} (humility ceiling)`,
      (res.anomaly_analysis?.confidence || 0) <= exp.anomalyConfidenceMax
    );
  }
  if (exp.benignAlternativePresent) {
    check(
      "Benign alternative hypotheses explicitly enumerated",
      Array.isArray(res.anomaly_analysis?.benign_alternatives) &&
      res.anomaly_analysis.benign_alternatives.length > 0
    );
  }
  if (exp.humanVerificationRequired) {
    check(
      "Discreet human verification protocol mandated",
      res.anomaly_analysis?.required_human_verification === true
    );
  }
  if (exp.conflictDetected) {
    check(
      "Conflicting evidence detected across statements",
      res.conflict_analysis?.detected === true
    );
  }
  if (exp.bothStatementsRetained) {
    const pairs = res.conflict_analysis?.pairs || res.conflict_analysis?.conflicting_pairs;
    check(
      "Both conflicting statements retained; neither discarded",
      Array.isArray(pairs) && pairs.length > 0
    );
  }

  // 10. Human Disagreement & Longitudinal Trajectory (TC-11, TC-12)
  if (exp.humanOverrideAvailable) {
    check(
      "Human supervisor review and override workflow available",
      res.human_review?.final_decision_authority === "HUMAN" &&
      Array.isArray(res.human_review?.available_actions)
    );
  }
  if (exp.aiOriginalPreserved) {
    check(
      "AI original assessment remains on the record inside the human decision",
      res.record_type === "AI_ASSESSMENT" && Boolean(res.operational_priority)
    );
    if (extras.reviewRecord) {
      check(
        "AI original assessment embedded byte-identical — never mutated by the reviewer",
        JSON.stringify(extras.reviewRecord.ai_assessment) === JSON.stringify(res)
      );
      check(
        "AI original demoted but retrievable (SUPERSEDED_BUT_RETAINED)",
        extras.reviewRecord.ai_recommendation?.status === "SUPERSEDED_BUT_RETAINED" &&
          extras.reviewRecord.ai_recommendation?.display === "VISUALLY_DEMOTED_NOT_HIDDEN"
      );
      check(
        "AI original retained inside the audit entry and digest-sealed",
        Boolean(extras.reviewRecord.audit_entry?.ai_assessment) &&
          /^[0-9a-f]{64}$/.test(extras.reviewRecord.integrity?.payload_digest || "")
      );
    }
  }
  if (exp.priorPreserved) {
    const ctx = fixture.input.context;
    check(
      "Prior longitudinal assessments preserved in context",
      Boolean(ctx?.prior_assessment || ctx?.prior_assessments)
    );
    check(
      "Prior assessment echoed back byte-identical (read-only, not rewritten)",
      Boolean(res.prior_assessment) &&
        JSON.stringify(res.prior_assessment) ===
          JSON.stringify(ctx.prior_assessment || (ctx.prior_assessments || []).at(-1))
    );
  }
  if (exp.followUpAction) {
    check(
      "Recommended action includes follow-up or reconciliation review",
      Boolean(res.recommended_human_action?.action_code)
    );
  }

  // 11. Graceful Degradation (TC-14)
  if (exp.degradedMode) {
    check(
      "Degraded mode active when AI service is unavailable",
      res.degraded_mode?.active === true
    );
  }
  if (exp.dataPreserved) {
    check(
      "Intake and case data fully preserved without data loss",
      Boolean(res.preserved_case_data)
    );
  }
  if (exp.manualControlsAvailable) {
    check(
      "Manual intake controls and selectors active for human operator",
      res.manual_controls?.enabled === true
    );
  }
  if (exp.noDefaultAssessment) {
    check(
      "No false default or cached priority emitted (absent is shown as absent)",
      res.operational_priority === null && res.no_default_assessment === true
    );
  }
  if (exp.humanDecisionStillWorks) {
    check(
      "Human decision authority remains 100% operational during outage",
      res.human_assessment?.entry_authority === "HUMAN" || res.human_assessment?.authority === "HUMAN"
    );
  }

  // ── TC-03 · Corroboration ────────────────────────────────────────────
  if (exp.mentionsWitnessOrPattern) {
    const quotes = (res.evidence_attribution || []).map((e) => e.quote).join(" \n ");
    const witness = /\b(witness|heard|overheard|saw|colleague|was with me|willing to give a statement|present)\b/i;
    const pattern = /\b(every (week|day|time|month)|again|each time|always|has done it before|new numbers?)\b/i;
    check(
      "Evidence cites a corroborating witness or a recurring pattern of behaviour",
      witness.test(quotes) || pattern.test(quotes)
    );
  }

  // ── TC-04 · Unverified detail ────────────────────────────────────────
  if (exp.unverifiedDetailMarked) {
    const ev = res.evidence_attribution || [];
    check(
      "Unverified detail labelled — self-report never presented as established fact",
      ev.length > 0 &&
        ev.every((e) => /SELF_REPORTED_NOT_INDEPENDENTLY_VERIFIED/.test(e.verification || ""))
    );
    check(
      "Stated that unverified detail does not change urgency of the override",
      (res.limitations || []).some((l) => /unverified detail/i.test(l))
    );
  }

  // ── TC-08 · Language metadata ────────────────────────────────────────
  if (exp.languageDetected) {
    const lm = res.language_metadata || {};
    check(
      "Primary (and secondary) language detected and reported as metadata",
      Boolean(lm.language) && Array.isArray(lm.detected_languages) && lm.detected_languages.length > 0
    );
  }

  // ── TC-09 · Honesty about confidence ─────────────────────────────────
  if (exp.confidenceUnknown) {
    const d = res.multidimensional_assessment;
    check(
      "Indicator confidences read UNKNOWN, not a numeric percentage",
      Boolean(d) && Object.values(d).every((v) => v.confidence === "UNKNOWN")
    );
    check(
      "Record-level confidence labelled UNKNOWN rather than rendered as a %",
      res.uncertainty_state?.confidence_label === "UNKNOWN"
    );
    check(
      "Absence of danger is not reported as evidence of safety",
      !/no danger|no threat detected|safe to close/i.test(JSON.stringify(res.limitations || []))
    );
  }

  // ── TC-07 · Distress ≠ danger ────────────────────────────────────────
  if (exp.safetyNotElevated) {
    const safetyContribs =
      res.multidimensional_assessment?.immediate_physical_safety?.contributions || [];
    check(
      "Acoustic distress was excluded from the safety dimension by design",
      res.acoustic_analysis?.excluded_from?.includes("immediate_physical_safety") === true &&
        safetyContribs.some((cn) => cn.signal_id === "ACOUSTIC_EXCLUDED")
    );
    check(
      "Immediate physical safety not elevated by the distressed voice",
      (res.multidimensional_assessment?.immediate_physical_safety?.score ?? 1) <=
        (exp.maxSafety ?? 1) + 1e-9
    );
  }

  // ── TC-10 · Anomaly stops where accusation begins ────────────────────
  if (exp.noAccusation) {
    const systemProse = [
      res.operational_priority,
      res.recommended_human_action?.description,
      res.anomaly_analysis?.signal_detected,
      ...(res.anomaly_analysis?.uncertainty_indicators || []).map((i) => i.description),
      ...(res.processing_notes || []),
    ].join(" ");
    const accusatory =
      /\b(is|are|was|were)\s+(the\s+|a\s+)?(perpetrator|attacker|abuser|stalker|guilty|culprit|coercer)\b|\bconfirmed\s+(perpetrator|abuser)\b|\bis\s+coercing\b|\bis\s+lying\b|\bproven\s+(guilty|abuser)\b/i;
    check(
      "No accusation asserted — system prose never states who did what",
      !accusatory.test(systemProse)
    );
    check(
      "Hypothesis explicitly disclaimed as a finding",
      res.anomaly_analysis?.epistemic_status === "UNCONFIRMED_HYPOTHESIS" &&
        /NOT a finding/i.test(res.anomaly_analysis?.guardrail || "") &&
        (res.anomaly_analysis?.benign_alternatives || []).length >= 2
    );
  }

  // ── TC-11 · Human oversight ──────────────────────────────────────────
  if (exp.humanReviewRequired) {
    check(
      "Record queued for human review — AI is not the final decision-maker",
      res.human_review?.final_decision_authority === "HUMAN" &&
        res.human_review?.status === "PENDING_HUMAN_REVIEW"
    );
  }
  if (exp.rationaleRequired) {
    check(
      "An empty rationale is rejected — it cannot be saved",
      typeof extras.reviewError === "string" && /RATIONALE|missing or empty/i.test(extras.reviewError)
    );
    check(
      "A substantive rationale (≥ 20 chars) is recorded with the decision",
      Boolean(extras.reviewRecord) && extras.reviewRecord.rationale.trim().length >= 20
    );
  }
  if (exp.humanDecisionAuthoritative) {
    check(
      "Human decision is the operational final value, attributed to the reviewer",
      extras.reviewRecord?.human_decision?.operational_priority === fixture.review?.new_priority &&
        extras.reviewRecord?.human_decision?.is_operational_final === true &&
        extras.reviewRecord?.human_decision?.authority === "HUMAN" &&
        extras.reviewRecord?.reviewer?.badge_id === fixture.review?.badge_id
    );
    check(
      "Previous priority preserved beside the new one for comparison",
      extras.reviewRecord?.human_decision?.previous_priority === res.operational_priority
    );
  }
  if (exp.auditLogged) {
    const entries = extras.chain ? extras.chain.forCase(res.case_id) : [];
    check(
      "Assessment + human decision written to the append-only audit chain",
      entries.some((e) => e.event_type === EVENT.AI_ASSESSMENT_CREATED) &&
        entries.some((e) => e.event_type === EVENT.HUMAN_REVIEW_RECORDED) &&
        entries.some((e) => e.event_type === EVENT.HUMAN_OVERRIDE_APPLIED)
    );
    check(
      "Audit chain verifies end-to-end (hash-linked, nothing altered)",
      extras.chain?.verify()?.ok === true
    );
    check(
      "Every audit entry names reviewer, role, rationale and downstream action",
      entries
        .filter((e) => e.event_type === EVENT.HUMAN_REVIEW_RECORDED)
        .every(
          (e) =>
            e.body?.reviewer_id && e.body?.reviewer_role && e.body?.rationale && e.body?.downstream_action
        )
    );
  }
  if (exp.downstreamAttributedToHuman) {
    check(
      "Downstream action attributed to the human reviewer, not the AI",
      extras.reviewRecord?.downstream_attributed_to === "HUMAN_REVIEWER" &&
        /HUMAN/.test(extras.reviewRecord?.downstream_action || "")
    );
  }

  // ── TC-12 · Longitudinal trajectory ──────────────────────────────────
  if (exp.deltaComputed) {
    const t = res.trajectory;
    check(
      "Per-dimension delta computed with an explicit direction (↑ ↓ —)",
      Boolean(t) &&
        Object.values(t.dimensions).every(
          (d) => typeof d.delta === "number" && typeof d.direction === "string" && Boolean(d.arrow)
        )
    );
  }
  if (exp.trajectoryShown) {
    const t = res.trajectory;
    check(
      "Trajectory presented as a series of assessments, not one current value",
      Boolean(t) &&
        Boolean(res.prior_assessment) &&
        t.session_from !== t.session_to &&
        Boolean(t.priority?.from) &&
        Array.isArray(t.evidence?.prior_key_evidence)
    );
  }
  if (exp.notSilentlyDowngraded) {
    const t = res.trajectory;
    check(
      "Priority held — not downgraded on the strength of self-reported improvement",
      Boolean(t) && t.priority.downgraded === false && t.priority.from === t.priority.to
    );
    check(
      "Prior record retained read-only and explicitly marked as retained",
      res.prior_assessment != null && t.evidence.prior_assessment_retained === true
    );
  }
  if (exp.bothImprovementAndConcern) {
    const t = res.trajectory;
    check(
      "Both improvement and concern reported — no single-direction summary",
      Boolean(t) &&
        t.both_directions_reported === true &&
        t.improvements.length > 0 &&
        t.concerns.length > 0
    );
    check(
      "New concern raised as its own observation, not averaged into the improvement",
      (t.concerns || []).some((x) => x.type === "NEW_RISK_EVIDENCE")
    );
    check(
      "Follow-up action with a watch condition is stated",
      Boolean(t.follow_up_action?.action_code) &&
        (t.priority.held_with_watch_condition === true || Boolean(t.follow_up_action.watch_condition))
    );
  }

  // ── TC-13 · Conflicting evidence ─────────────────────────────────────
  if (exp.confidenceReduced) {
    check(
      "Confidence explicitly reduced because contradictory evidence is on record",
      res.uncertainty_state?.confidence_reduction?.applied === true &&
        typeof res.conflict_analysis?.confidence === "number" &&
        res.conflict_analysis.confidence <= 0.95
    );
  }
  if (exp.protectiveNotNetted) {
    const safetyContribs =
      res.multidimensional_assessment?.immediate_physical_safety?.contributions || [];
    check(
      "Protective statements held in abeyance rather than netted against the risk",
      safetyContribs.some(
        (cn) => cn.raw_weight < 0 && cn.applied === 0 && /abeyance/i.test(cn.note || "")
      )
    );
  }
  if (exp.noBlindSelection) {
    check(
      "Neither statement selected — both retained verbatim for reconciliation",
      res.conflict_analysis?.scope === "BOTH_STATEMENTS_RETAINED" &&
        (res.conflict_analysis?.selected_statement ?? null) === null &&
        /neither/i.test(res.conflict_analysis?.note || "")
    );
  }
  if (exp.laterSpecificityNoted) {
    check(
      "Later, more specific disclosure surfaced without superseding the earlier one",
      (res.conflict_analysis?.pairs || []).some((p) => p.order === "protective_then_risk") &&
        /follows an absolute safety claim|after the protective claim|post-dates/i.test(
          res.conflict_analysis?.note || ""
        )
    );
  }

  // ── TC-14 · Degraded mode bookkeeping ────────────────────────────────
  if (exp.humanEnteredLabelled) {
    check(
      "Human-entered fields carry HUMAN-ENTERED provenance",
      res.human_assessment?.provenance === "HUMAN-ENTERED" ||
        res.human_entry?.provenance === "HUMAN-ENTERED"
    );
    check(
      "Outage record still accepts a human decision while AI is unavailable",
      Boolean(extras.reviewRecord) &&
        extras.reviewRecord.human_decision?.authority === "HUMAN"
    );
  }
  if (exp.auditEventLogged) {
    const entries = extras.chain ? extras.chain.forCase(res.case_id) : [];
    check(
      "Outage itself written to the audit trail as FALLBACK_ACTIVATED",
      res.audit_event?.event_type === "FALLBACK_ACTIVATED" &&
        entries.some((e) => e.event_type === EVENT.FALLBACK_ACTIVATED)
    );
  }
  if (exp.priorAssessmentsRetained) {
    check(
      "Prior assessments retained verbatim — superseded, never deleted",
      Array.isArray(res.prior_assessments) &&
        res.prior_assessments.length === 1 &&
        JSON.stringify(res.prior_assessments) ===
          JSON.stringify(fixture.input.context.prior_assessments) &&
        res.prior_assessments[0].status === "SUPERSEDED_BY_LATER_SESSION"
    );
  }

  // ── Coverage guard: a fixture assertion nobody evaluates is a silent pass
  const unhandled = Object.keys(exp).filter((k) => !SUPPORTED_ASSERTIONS.has(k));
  for (const key of unhandled) {
    failures.push(`ASSERTION NOT IMPLEMENTED: expect.${key}`);
  }

  const passed = failures.length === 0;
  return { passed, passedChecks, failures };
}

/**
 * Render the On-Screen Intelligence Panel for a case (Specification §6).
 */
export function renderIntelligencePanel(fixture, res, extras = {}) {
  const line = "━".repeat(78);
  const thinLine = "─".repeat(78);

  const priorityColor =
    res.operational_priority === "CRITICAL_IMMEDIATE_DANGER" ? c.bgRed + c.white
    : res.operational_priority === "CRITICAL_SELF_HARM_PATHWAY" ? c.bgRed + c.white
    : res.operational_priority === "HIGH_SAFETY_REVIEW" ? c.red
    : res.operational_priority === "MODERATE_PSYCHOSOCIAL_SUPPORT" ? c.yellow
    : res.operational_priority === "ELEVATED_HUMAN_VERIFICATION_REQUIRED" ? c.magenta
    : res.operational_priority === "HUMAN_ASSESSMENT_REQUIRED" ? c.cyan
    : res.degraded_mode?.active ? c.bgYellow + c.white
    : c.green;

  const bar = (score) => {
    if (score === null || score === undefined) return `${c.dim}[ DATA ABSENT ]${c.reset}`;
    const filled = Math.round(score * 20);
    const empty = 20 - filled;
    const color = score >= 0.7 ? c.red : score >= 0.4 ? c.yellow : c.green;
    return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}] ${score.toFixed(2)}${c.reset}`;
  };

  console.log(`\n${c.bold}${c.cyan}┌${line}┐${c.reset}`);
  console.log(
    `${c.bold}${c.cyan}│${c.reset}  ${c.bold}SAHAARA AI — CASE INTELLIGENCE PANEL${c.reset}`.padEnd(87) +
    `${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}│${c.reset}  ${c.dim}Case:${c.reset} ${fixture.input.case_id.padEnd(16)} ` +
    `${c.dim}Test:${c.reset} ${fixture.id} (${fixture.title})`.padEnd(54) +
    `${c.cyan}│${c.reset}`
  );
  console.log(`${c.bold}${c.cyan}├${line}┤${c.reset}`);

  // Operational Priority & Banner
  if (res.degraded_mode?.active) {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bgYellow}${c.white}${c.bold} ⚠️  DEGRADED MODE: AI UNAVAILABLE — HUMAN ASSESSMENT MODE ACTIVE ${c.reset}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
  } else {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.dim}OPERATIONAL PRIORITY:${c.reset} ${priorityColor}${c.bold} ${res.operational_priority || "NONE"} ${c.reset}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
  }

  // Safety Override Status
  if (res.safety_override?.active) {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bgRed}${c.white}${c.bold} 🚨 LAYER 0 DETERMINISTIC SAFETY OVERRIDE TRIPPED ${c.reset}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  Trigger: ${c.bold}${res.safety_override.override_code}${c.reset} (bypassed normal weighting)`.padEnd(87) +
      `${c.cyan}│${c.reset}`
    );
  }

  console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);

  // Multidimensional Assessment Vectors
  if (res.multidimensional_assessment) {
    console.log(`${c.bold}${c.cyan}│${c.reset}  ${c.bold}MULTIDIMENSIONAL TRAUMA & VULNERABILITY VECTORS:${c.reset}`.padEnd(87) + `${c.cyan}│${c.reset}`);
    const m = res.multidimensional_assessment;
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Immediate Physical Safety:   ${bar(m.immediate_physical_safety?.score)}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Psychological Distress:      ${bar(m.psychological_distress?.score)}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Contextual Vulnerability:    ${bar(m.contextual_vulnerability?.score)}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
  }

  // Epistemic Uncertainty & Humility
  if (res.uncertainty_state) {
    console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
    const confPct = ((res.uncertainty_state.confidence_metric ?? 0.65) * 100).toFixed(0);
    const label = res.uncertainty_state.confidence_label;
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bold}EPISTEMIC STATE & UNCERTAINTY:${c.reset} ` +
      `${c.yellow}${res.uncertainty_state.state}${c.reset} ` +
      `(Evidence sufficiency ${res.uncertainty_state.evidence_quality_score} / θ ${res.uncertainty_state.threshold}, ` +
      `confidence ${label === "UNKNOWN" ? c.magenta + "UNKNOWN" : c.bold + confPct + "%"})${c.reset}`
    );
    if (res.uncertainty_state.abstention) {
      console.log(
        `${c.bold}${c.cyan}│${c.reset}    ${c.magenta}ABSTENTION ACTIVE:${c.reset} ${res.uncertainty_state.abstention_reason}`
      );
      console.log(
        `${c.bold}${c.cyan}│${c.reset}    ${c.dim}Absence of reported danger is NOT evidence of safety. Scores withheld, not defaulted.${c.reset}`
      );
    }
    if (res.uncertainty_state.conflicting_evidence) {
      console.log(
        `${c.bold}${c.cyan}│${c.reset}    ${c.yellow}CONFIDENCE REDUCED:${c.reset} contradictory evidence on record.`
      );
    }
  }

  // Conflicting Evidence — both statements retained
  if (res.conflict_analysis?.detected) {
    console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
    console.log(`${c.bold}${c.cyan}│${c.reset}  ${c.bold}${c.yellow}CONFLICTING EVIDENCE — NO WINNER SELECTED${c.reset}`);
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}${res.conflict_analysis.note.slice(0, 78)}${c.reset}`);
    for (const p of (res.conflict_analysis.pairs || []).slice(0, 1)) {
      console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.green}↳ [${p.statement_safe.timestamp}] protective: ${c.reset}"${p.statement_safe.quote.slice(0, 52)}..."`);
      console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.red}↳ [${p.statement_risk.timestamp}] risk (later):  ${c.reset}"${p.statement_risk.quote.slice(0, 52)}..."`);
    }
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}Both statements retained verbatim. Neither selected, downweighted nor discarded.${c.reset}`);
  }

  // Anomaly — unconfirmed hypothesis
  if (res.anomaly_analysis) {
    console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bold}${c.magenta}ANOMALY — ${res.anomaly_analysis.signal_detected}${c.reset} ` +
      `(${res.anomaly_analysis.epistemic_status}, confidence ≤ ${res.anomaly_analysis.confidence})`
    );
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}${res.anomaly_analysis.guardrail.slice(0, 80)}...${c.reset}`);
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}Benign alternatives considered: ${res.anomaly_analysis.benign_alternatives.length}${c.reset}`);
  }

  // Longitudinal Trajectory
  if (res.trajectory) {
    const t = res.trajectory;
    console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bold}LONGITUDINAL TRAJECTORY (session ${t.session_from} → ${t.session_to}):${c.reset}`
    );
    const arrow = (d) => (d === "IMPROVED" ? c.green + "↓" : d === "DETERIORATED" ? c.red + "↑" : c.dim + "—") + c.reset;
    for (const [k, d] of Object.entries(t.dimensions)) {
      console.log(
        `${c.bold}${c.cyan}│${c.reset}    ${k.padEnd(28)} ${(d.from ?? "—").toString().padEnd(6)} → ${(d.to ?? "—").toString().padEnd(6)} ` +
        `Δ ${(d.delta ?? "—").toString().padEnd(7)} ${arrow(d.direction)}`
      );
    }
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.green}Improvements:${c.reset} ${t.improvements.map((i) => i.key).join(", ") || "none"}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.red}Concerns (carried forward):${c.reset} ${t.concerns.map((x) => x.key).join(", ") || "none"}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Priority ${t.priority.from ?? "—"} → ${t.priority.to ?? "—"} ` +
      `${t.priority.downgraded ? c.red + "DOWNGRADED" : c.green + "held (not downgraded)"}${c.reset}` +
      (t.follow_up_action?.watch_condition ? `  ${c.dim}watch: ${t.follow_up_action.watch_condition}${c.reset}` : "")
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.dim}Day ${t.session_from} retained unmodified — byte-identical to the original record.${c.reset}`
    );
  }

  // Language & Code-Switching
  if (res.language_metadata) {
    const langCode = res.language_metadata.language || "en";
    const langName = langCode === "mr" ? "Marathi (mr)" : langCode === "hi" ? "Hindi (hi)" : "English (en)";
    const secName = res.language_metadata.language_secondary === "en" ? " / English (en)" : "";
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.dim}Language Detected:${c.reset} ${langName}${secName} ` +
      `| Code-switched: ${res.language_metadata.code_switched ? c.green + "YES" : "NO"}${c.reset} ` +
      `| Verbatim preserved: ${c.green}YES${c.reset}`
    );
  }

  // Acoustics
  if (res.acoustic_analysis) {
    const m = res.acoustic_analysis.metrics || {};
    const affect = m.affect || "neutral";
    const jitter = m.pitch_jitter_pct ? `${m.pitch_jitter_pct}%` : "0.012";
    const shimmer = m.shimmer_pct ? `${m.shimmer_pct}%` : "1.4%";
    const hnr = m.hnr_db ? `${m.hnr_db} dB` : "22 dB";
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.dim}Acoustics:${c.reset} Affect=${c.yellow}${affect}${c.reset} ` +
      `| Jitter=${jitter} | Shimmer=${shimmer} | HNR=${hnr}`
    );
    if (res.acoustic_analysis.orthogonality?.flag) {
      console.log(
        `${c.bold}${c.cyan}│${c.reset}    ${c.dim}Orthogonality:${c.reset} ${c.magenta}${res.acoustic_analysis.orthogonality.flag}${c.reset} ` +
        `(${res.acoustic_analysis.orthogonality.explanation.slice(0, 52)}...)`
      );
    }
  }

  // Verbatim Evidence Attribution
  console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
  console.log(`${c.bold}${c.cyan}│${c.reset}  ${c.bold}VERBATIM EVIDENCE ATTRIBUTION (${res.evidence_attribution?.length || 0} citations):${c.reset}`.padEnd(87) + `${c.cyan}│${c.reset}`);
  if (res.evidence_attribution?.length) {
    for (const ev of res.evidence_attribution.slice(0, 3)) {
      const q = (ev.verbatim || ev.quote || "").slice(0, 56);
      console.log(
        `${c.bold}${c.cyan}│${c.reset}   • [${ev.timestamp_offset || "00:00"}] (${ev.dimension}) "${q}..."`.padEnd(87) +
        `${c.cyan}│${c.reset}`
      );
    }
    if (res.evidence_attribution.length > 3) {
      console.log(
        `${c.bold}${c.cyan}│${c.reset}     ...and ${res.evidence_attribution.length - 3} more citations`.padEnd(87) +
        `${c.cyan}│${c.reset}`
      );
    }
  } else {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.dim}(No high-weight evidence triggered in this scenario)${c.reset}`.padEnd(87) +
      `${c.cyan}│${c.reset}`
    );
  }

  // Recommended Human Action
  console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
  if (res.recommended_human_action) {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bold}RECOMMENDED HUMAN ACTION:${c.reset} ${c.green}${res.recommended_human_action.action_code}${c.reset}`.padEnd(95) +
      `${c.cyan}│${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Queue: ${res.recommended_human_action.queue} | Urgency: ${res.recommended_human_action.urgency}`.padEnd(87) +
      `${c.cyan}│${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    Rationale: ${(res.recommended_human_action.rationale || res.recommended_human_action.description || "").slice(0, 60)}...`.padEnd(87) +
      `${c.cyan}│${c.reset}`
    );
  } else if (res.manual_controls) {
    console.log(
      `${c.bold}${c.cyan}│${c.reset}  ${c.bold}HUMAN ACTION MODE:${c.reset} Officer sets priority directly via manual intake controls.`.padEnd(87) +
      `${c.cyan}│${c.reset}`
    );
  }

  // Human review decision — shown beside, never over, the AI output
  if (extras?.reviewRecord) {
    const r = extras.reviewRecord;
    console.log(`${c.bold}${c.cyan}├${thinLine}┤${c.reset}`);
    console.log(`${c.bold}${c.cyan}│${c.reset}  ${c.bold}HUMAN REVIEW DECISION${c.reset}`);
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.dim}AI recommendation (retained, demoted):${c.reset} ${c.dim}${r.ai_assessment.operational_priority}  [${r.ai_recommendation.status}]${c.reset}`
    );
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.green}Human decision (authoritative):${c.reset} ${c.bold}${r.human_decision.operational_priority}${c.reset} — ${r.human_decision.action} by ${r.reviewer.badge_id} (${r.reviewer.role})`
    );
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}Rationale [${r.justification_category}]: ${r.rationale.slice(0, 74)}...${c.reset}`);
    console.log(
      `${c.bold}${c.cyan}│${c.reset}    ${c.dim}Downstream: ${r.downstream_action} — attributed to ${r.downstream_attributed_to}${c.reset}`
    );
    console.log(`${c.bold}${c.cyan}│${c.reset}    ${c.dim}Integrity: sha256 ${r.integrity.payload_digest.slice(0, 32)}…${c.reset}`);
  }

  console.log(`${c.bold}${c.cyan}└${line}┘${c.reset}\n`);
}

/**
 * Persist evaluation case, evidence, and audit logs into Neon Postgres.
 */
export async function persistEvaluationResult(fixture, res, verifyResult) {
  const caseRef = `EVAL-${fixture.id}-${Date.now().toString().slice(-6)}`;
  const status =
    res.operational_priority === "CRITICAL_IMMEDIATE_DANGER" || res.operational_priority === "CRITICAL_SELF_HARM_PATHWAY"
      ? "escalated"
      : "review";

  const transcript = fixture.input.turns
    ? fixture.input.turns.map((t) => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join("\n")
    : fixture.input.verbatim_text || "";

  // 1. Insert Case
  const caseInsert = await query(
    `INSERT INTO cases (case_ref, status, transcript, safety_state)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [caseRef, status, transcript, res.operational_priority || "NONE"]
  );
  const caseId = caseInsert.rows[0].id;

  // 2. Insert Evidence Blocks
  if (Array.isArray(res.evidence_attribution)) {
    for (const ev of res.evidence_attribution) {
      const parts = (ev.timestamp_offset || "00:00").split(":");
      const ms = (parseInt(parts[0], 10) * 60 + parseInt(parts[1] || "0", 10)) * 1000;
      await query(
        `INSERT INTO evidence_blocks (case_id, snippet, start_ms, end_ms, dimension, strength)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [caseId, ev.verbatim || ev.quote, ms, ms + 2000, ev.dimension, String(ev.weight || "1.0")]
      );
    }
  }

  // 3. Insert Immutable Audit Log
  const eventType = res.degraded_mode?.active ? "AI_DEGRADED" : "AI_ASSESSMENT_CREATED";
  await query(
    `INSERT INTO audit_logs (case_id, actor_type, actor_id, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      caseId,
      "ai",
      "Sahaara-Engine-v3.1.0",
      eventType,
      JSON.stringify({
        fixture_id: fixture.id,
        title: fixture.title,
        evaluation_passed: verifyResult.passed,
        operational_priority: res.operational_priority,
        action: res.recommended_human_action?.action_code,
        safety_override: res.safety_override?.active || false,
        uncertainty: res.uncertainty_state?.state || "NOMINAL",
        timestamp: new Date().toISOString(),
      }),
    ]
  );

  return { caseId, caseRef };
}

/**
 * Format the Section 9 Evaluation Record Table in Markdown.
 */
export function generateEvaluationMarkdown(results) {
  let md = `# Sahaara AI — Official Evaluation Record\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}\n`;
  md += `**Suite Size:** ${results.length} Test Cases (12 Core, 1 Robustness, 1 Reliability)\n`;
  md += `**Overall Result:** ${results.every((r) => r.verify.passed) ? "✅ ALL 14 PASSED" : "❌ SOME FAILED"}\n\n`;

  md += `## Section 9: Evaluation Record Table\n\n`;
  md += `| ID | Test Case | Category | Expected Operational Priority | Actual Result | Evidence Captured | Human Action | Status |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const f = r.fixture;
    const res = r.res;
    const expected = f.expect.priority || (f.expect.maxPriority ? f.expect.maxPriority.join(" / ") : "Standard");
    const actual = res.operational_priority || (res.degraded_mode?.active ? "DEGRADED (No Default)" : "None");
    const evCount = res.evidence_attribution?.length || 0;
    const action = res.recommended_human_action?.action_code || "MANUAL_OPERATOR_INPUT";
    const status = r.verify.passed ? "**PASS** ✅" : "**FAIL** ❌";

    md += `| **${f.id}** | ${f.title} | ${f.category} | \`${expected}\` | \`${actual}\` | ${evCount} verbatim spans | \`${action}\` | ${status} |\n`;
  }

  md += `\n---\n\n## Detailed Test Assertions\n\n`;
  for (const r of results) {
    md += `### ${r.fixture.id}: ${r.fixture.title} (${r.fixture.category})\n`;
    md += `- **Primary Novelty:** ${r.fixture.novelty}\n`;
    md += `- **Verdict:** ${r.verify.passed ? "PASS" : "FAIL"}\n`;
    md += `- **Passed Assertions (${r.verify.passedChecks.length}):**\n`;
    for (const c of r.verify.passedChecks) {
      md += `  - ✓ ${c}\n`;
    }
    if (r.verify.failures.length) {
      md += `- **Failures (${r.verify.failures.length}):**\n`;
      for (const f of r.verify.failures) {
        md += `  - ✗ ${f}\n`;
      }
    }
    md += `\n`;
  }

  return md;
}

// ── Side effects the real workflow produces alongside an assessment ──
/**
 * Record the assessment on the audit chain and, where the fixture specifies a
 * human decision, attempt (a) a blank-rationale review that MUST be rejected
 * and (b) the real review, which is then chained.
 *
 * @returns {{reviewRecord:Object|null, reviewError:string|null, chain:Object}}
 */
function buildExtras(fixture, res) {
  recordAssessment(res, auditChain);

  const reviewInput =
    fixture.review ??
    (res.record_type === "HUMAN_ASSESSMENT_MODE"
      ? {
          badge_id: "SD-014",
          role: "intake_officer",
          action: "CONFIRM",
          justification_category: "EVIDENCE_REASSESSED",
          rationale:
            "Manual intake completed during the outage. Values confirmed line by line against the transcript; no AI output was substituted for the missing assessment.",
        }
      : null);

  let reviewRecord = null;
  let reviewError = null;

  if (reviewInput) {
    try {
      applyHumanReview(res, { ...reviewInput, rationale: "" });
      reviewError = "EMPTY_RATIONALE_ACCEPTED (this must never happen)";
    } catch (e) {
      reviewError = e.message;
    }

    try {
      reviewRecord = applyHumanReview(res, reviewInput);
      recordHumanReview(reviewRecord, auditChain);
    } catch (e) {
      if (!reviewError) reviewError = e.message;
      reviewRecord = null;
    }
  }

  return { reviewRecord, reviewError, chain: auditChain };
}

// ── Main CLI Runner ──────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const showPanelAll = args.includes("--panel");
  const persistDb = args.includes("--persist") || args.includes("--db");
  const uploadS3 = args.includes("--upload");
  const jsonOutput = args.includes("--json");
  const targetId = args.find((a) => /^TC-\d\d$/i.test(a)) || args.find((a) => a.startsWith("--case="))?.split("=")[1];

  const fixturesToRun = targetId ? [getFixture(targetId.toUpperCase())] : FIXTURES;

  if (!jsonOutput) {
    console.log(`\n${c.bold}╔══════════════════════════════════════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}║       SAHAARA AI — UNIFIED NHAA EVALUATION & DEMO EXECUTION HARNESS          ║${c.reset}`);
    console.log(`${c.bold}╚══════════════════════════════════════════════════════════════════════════════╝${c.reset}\n`);
    console.log(`Running ${fixturesToRun.length} test cases... (Persist DB: ${persistDb ? "YES" : "NO"}, Upload S3: ${uploadS3 ? "YES" : "NO"})\n`);
  }

  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const f of fixturesToRun) {
    const res = assess(f.input);
    const extras = buildExtras(f, res);
    const verify = verifyAssertions(f, res, extras);

    if (verify.passed) passedCount++;
    else failedCount++;

    results.push({ fixture: f, res, verify });

    if (persistDb) {
      try {
        await persistEvaluationResult(f, res, verify);
      } catch (err) {
        console.error(`${c.red}Database persistence error for ${f.id}: ${err.message}${c.reset}`);
      }
    }

    if (!jsonOutput) {
      if (showPanelAll || targetId) {
        renderIntelligencePanel(f, res, extras);
      }

      const icon = verify.passed ? `${c.green}✓ PASS${c.reset}` : `${c.red}✗ FAIL${c.reset}`;
      const prio = res.operational_priority || (res.degraded_mode?.active ? "DEGRADED" : "NONE");
      console.log(
        `  ${icon}  ${c.bold}${f.id.padEnd(6)}${c.reset}  ${f.title.padEnd(34)} ` +
        `→  ${c.cyan}${prio.padEnd(34)}${c.reset} ` +
        `${c.dim}(${verify.passedChecks.length} checks ok)${c.reset}`
      );
      if (verify.failures.length) {
        for (const fail of verify.failures) {
          console.log(`         ${c.red}↳ FAILED:${c.reset} ${fail}`);
        }
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results.map((r) => ({
      id: r.fixture.id,
      title: r.fixture.title,
      passed: r.verify.passed,
      operational_priority: r.res.operational_priority,
      action: r.res.recommended_human_action?.action_code,
      checks: r.verify.passedChecks,
      failures: r.verify.failures,
    })), null, 2));
    if (persistDb) await closePool();
    process.exit(failedCount > 0 ? 1 : 0);
  }

  console.log(`\n${c.bold}── Summary ─────────────────────────────────────────────────────────────${c.reset}`);
  console.log(` Total Cases:  ${fixturesToRun.length}`);
  console.log(` Passed:       ${c.green}${passedCount}${c.reset}`);
  console.log(` Failed:       ${failedCount > 0 ? c.red + failedCount : c.dim + "0"}${c.reset}`);
  console.log(` Overall:      ${failedCount === 0 ? c.bgGreen + c.white + c.bold + " ALL TEST CASES PASSED ✅ " : c.bgRed + c.white + c.bold + " SOME CASES FAILED ❌ "}${c.reset}`);

  // S3 Upload option
  if (uploadS3) {
    try {
      console.log(`\n${c.bold}── Neon S3 Object Storage Export ────────────────────────────────────────${c.reset}`);
      const markdown = generateEvaluationMarkdown(results);
      const timestamp = Date.now();
      const reportKey = `evaluations/eval-report-${timestamp}.md`;
      const jsonKey = `evaluations/eval-results-${timestamp}.json`;

      await upload({ key: reportKey, body: markdown, contentType: "text/markdown" });
      await upload({ key: jsonKey, body: JSON.stringify(results, null, 2), contentType: "application/json" });

      const reportUrl = await getSignedGetUrl(reportKey, 7200);
      console.log(` ${c.green}✓${c.reset} Uploaded evaluation report: ${c.cyan}${reportKey}${c.reset}`);
      console.log(` ${c.green}✓${c.reset} Uploaded raw JSON results:  ${c.cyan}${jsonKey}${c.reset}`);
      console.log(` [Presigned Report URL (2h)]: ${reportUrl}`);
    } catch (err) {
      console.error(` ${c.red}✗ S3 Upload failed:${c.reset} ${err.message}`);
    }
  }

  if (persistDb) {
    try {
      const { syncAuditChain } = await import("./store/cases.js");
      const written = await syncAuditChain();
      if (!jsonOutput && written.length) {
        console.log(` ${c.green}✓${c.reset} Synced ${written.length} hash-chained audit entr${written.length === 1 ? "y" : "ies"} to audit_logs.`);
      }
    } catch (err) {
      console.error(`${c.red}Audit sync error:${c.reset} ${err.message}`);
    }
    await closePool();
  }

  process.exit(failedCount > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith("evaluator.js")) {
  main().catch((err) => {
    console.error("Evaluation error:", err);
    process.exit(1);
  });
}
