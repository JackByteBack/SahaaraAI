/**
 * Sahaara AI — Human Oversight & Longitudinal Intelligence
 *
 * Implements §7 CRIT-08 (human-in-the-loop override with mandatory rationale
 * and full audit retention) and §7 CRIT-10 (longitudinal trajectory tracking).
 *
 * Two invariants, both non-negotiable:
 *
 *   1. THE AI OUTPUT IS NEVER MUTATED. A human decision is recorded *beside*
 *      the machine's opinion, not over it. The superseded state stays fully
 *      retrievable and visibly demoted.
 *   2. PRIOR ASSESSMENTS ARE NEVER OVERWRITTEN. Each session appends; history
 *      is read-only. A later session can change a trajectory but cannot edit
 *      what an earlier one said.
 */

import { createHash } from "node:crypto";

/** The four review actions the reviewer may take (§6 / TC-11). */
export const HUMAN_ACTIONS = ["CONFIRM", "MODIFY", "ESCALATE", "DISMISS"];

/**
 * Structured justification categories. Free-text rationale is ALSO mandatory —
 * the category exists to make patterns auditable, never to replace the words.
 */
export const JUSTIFICATION_CATEGORIES = [
  "NEW_FACTS_EXTERNAL",      // evidence the AI could not see (FIR, protection order, witness)
  "CASE_CONTEXT",            // operational context outside the transcript
  "EVIDENCE_REASSESSED",     // reviewer weighed the same evidence differently
  "LANGUAGE_OR_CULTURE",     // cross-lingual/cultural reading changed the reading
  "DUPLICATE_OR_RESOLVED",   // matter already resolved elsewhere
  "OTHER",
];

/** Downstream actions attributable to the human reviewer. */
export const DOWNSTREAM_ACTIONS = {
  CONFIRM: "PROCEED_PER_AI_RECOMMENDATION",
  MODIFY: "PROCEED_PER_HUMAN_DECISION",
  ESCALATE: "ESCALATE_TO_SUPERVISOR_ON_CALL",
  DISMISS: "CLOSE_WITH_HUMAN_RATIONALE",
};

const REQUIRED_FIELDS = ["action", "badge_id", "role", "rationale", "justification_category"];

/**
 * Apply a human review decision to an AI assessment.
 *
 * @param {Object} aiAssessment   The AI output. Deep-frozen copy is embedded unchanged.
 * @param {Object} review
 * @param {string} review.action            CONFIRM | MODIFY | ESCALATE | DISMISS
 * @param {string} review.badge_id
 * @param {string} review.role
 * @param {string} review.rationale         Mandatory, non-empty, minimum 20 chars.
 * @param {string} review.justification_category
 * @param {string} [review.new_priority]    Required when action is MODIFY or ESCALATE.
 * @param {string} [review.downstream_action]
 * @param {Object|null} [previousHumanDecision] Prior review, if this is a second pass.
 * @returns {Object} A HUMAN_REVIEW_DECISION record.
 * @throws {Error} on any validation failure — an empty rationale never saves.
 */
export function applyHumanReview(aiAssessment, review = {}, previousHumanDecision = null) {
  if (!aiAssessment || !aiAssessment.case_id) {
    throw new Error("applyHumanReview requires an AI assessment with a case_id.");
  }

  const missing = REQUIRED_FIELDS.filter(
    (k) => !review[k] || (typeof review[k] === "string" && !review[k].trim())
  );
  if (missing.length) {
    throw new Error(`RATIONALE_REQUIRED: missing or empty — ${missing.join(", ")}`);
  }

  const action = String(review.action).toUpperCase();
  if (!HUMAN_ACTIONS.includes(action)) {
    throw new Error(`INVALID_ACTION: '${action}'. Allowed: ${HUMAN_ACTIONS.join(", ")}`);
  }
  if (!JUSTIFICATION_CATEGORIES.includes(review.justification_category)) {
    throw new Error(
      `INVALID_JUSTIFICATION_CATEGORY: '${review.justification_category}'. Allowed: ${JUSTIFICATION_CATEGORIES.join(", ")}`
    );
  }
  const rationale = review.rationale.trim();
  if (rationale.length < 20) {
    throw new Error(
      `RATIONALE_TOO_SHORT: ${rationale.length} characters. A rationale must state the reasoning, not just assert a conclusion (minimum 20).`
    );
  }
  if ((action === "MODIFY" || action === "ESCALATE") && !review.new_priority) {
    throw new Error(`new_priority is required when action is ${action}.`);
  }

  const timestamp = new Date().toISOString();
  const humanPriority =
    action === "MODIFY" ? review.new_priority
    : action === "ESCALATE" ? (review.new_priority || aiAssessment.operational_priority)
    : action === "CONFIRM" ? aiAssessment.operational_priority
    : "DISMISSED_BY_HUMAN";

  // Deep snapshot: the AI's opinion, byte-identical, always retrievable.
  const aiSnapshot = structuredClone(aiAssessment);

  const record = {
    record_type: "HUMAN_REVIEW_DECISION",
    assessment_id: aiSnapshot.assessment_id ?? `AI-${aiSnapshot.case_id}-${aiSnapshot.session_number ?? 1}`,
    case_id: aiSnapshot.case_id,
    session_number: aiSnapshot.session_number ?? 1,
    timestamp_utc: timestamp,

    // ── The machine's opinion, retained and demoted (never hidden) ──────
    ai_assessment: aiSnapshot,
    ai_recommendation: {
      operational_priority: aiSnapshot.operational_priority,
      confidence_metric: aiSnapshot.uncertainty_state?.evidence_quality_score ?? null,
      status: "SUPERSEDED_BUT_RETAINED",
      display: "VISUALLY_DEMOTED_NOT_HIDDEN",
    },

    // ── The human's decision, authoritative ─────────────────────────────
    human_decision: {
      operational_priority: humanPriority,
      action,
      previous_priority: aiSnapshot.operational_priority,
      changed: humanPriority !== aiSnapshot.operational_priority,
      authority: "HUMAN",
      is_operational_final: true,
    },

    reviewer: { badge_id: review.badge_id, role: review.role },
    rationale,
    justification_category: review.justification_category,
    downstream_action: review.downstream_action || DOWNSTREAM_ACTIONS[action],
    downstream_attributed_to: "HUMAN_REVIEWER",

    previous_human_decision: previousHumanDecision,

    human_review: {
      required: true,
      status: "HUMAN_DECISION_RECORDED",
      available_actions: HUMAN_ACTIONS,
      final_decision_authority: "HUMAN",
      human_decision: humanPriority,
    },
  };

  // ── Tamper-evident audit entry (§Appendix B) ──────────────────────────
  record.audit_entry = {
    assessment_id: record.assessment_id,
    case_id: record.case_id,
    ai_assessment: aiSnapshot,
    human_decision: humanPriority,
    human_action: action,
    reviewer_id: review.badge_id,
    reviewer_role: review.role,
    rationale,
    justification_category: review.justification_category,
    timestamp_utc: timestamp,
    downstream_action: record.downstream_action,
    previous_human_decision: previousHumanDecision
      ? {
          human_decision: previousHumanDecision.human_decision?.operational_priority ?? null,
          reviewer_id: previousHumanDecision.reviewer?.badge_id ?? null,
          timestamp_utc: previousHumanDecision.timestamp_utc ?? null,
        }
      : null,
  };

  record.integrity = {
    algorithm: "sha256",
    payload_digest: sha256(stableStringify(record.audit_entry)),
    notice:
      "The AI assessment inside this record is unmodified. Editing it invalidates the digest.",
  };

  return record;
}

/**
 * CRIT-10 — compute the longitudinal delta between sessions.
 *
 * Both directions are reported: an improvement and a concern may coexist, and
 * neither is allowed to erase the other (TC-12).
 *
 * @param {Object} current  New assessment payload.
 * @param {Object} prior    Prior assessment (read-only).
 * @returns {Object|null}
 */
export function computeTrajectory(current, prior) {
  if (!prior || !current) return null;

  const dims = current.multidimensional_assessment || {};
  const keys = ["psychological_distress", "immediate_physical_safety", "contextual_vulnerability"];
  const out = {
    session_from: prior.session_number ?? null,
    session_to: current.session_number ?? null,
    dimensions: {},
    evidence: {},
    priority: {},
    summary: [],
  };

  const improvements = [];
  const dimensionConcerns = [];

  for (const k of keys) {
    const from = prior[k]?.score ?? null;
    const to = dims[k]?.score ?? null;
    if (from === null || from === undefined || to === null || to === undefined) {
      out.dimensions[k] = { from: from ?? null, to: to ?? null, delta: null, direction: "NOT_COMPARABLE" };
      continue;
    }
    const delta = Number((to - from).toFixed(3));
    // All three dimensions are RISK-scaled: a higher number means more
    // distress / more immediate physical danger / more vulnerability.
    // Improvement is therefore always a negative delta.
    const direction = delta < -0.02 ? "IMPROVED" : delta > 0.02 ? "DETERIORATED" : "STABLE";
    out.dimensions[k] = {
      from, to, delta, direction,
      arrow: direction === "IMPROVED" ? "↓" : direction === "DETERIORATED" ? "↑" : "—",
      from_level: prior[k]?.level ?? null,
      to_level: dims[k]?.level ?? null,
    };
    if (direction === "IMPROVED") improvements.push(k);
    if (direction === "DETERIORATED") dimensionConcerns.push(k);
  }

  /* ── Evidence-level trajectory ────────────────────────────────────────
   * Dimensions alone are not enough: a session can improve on every scale
   * and still surface something new that a reviewer must see. The prior
   * record's key evidence is re-read against this session's quotes, and any
   * risk observation with no counterpart in the prior record is raised as a
   * NEW concern rather than being averaged away by the improvements.        */
  const items = (current.evidence_attribution || []).map((e) => ({
    quote: e.quote,
    timestamp: e.timestamp_offset ?? null,
    dimension: e.dimension,
    signal_id: e.signal_id,
    role: e.role,
    weight: e.weight,
  }));

  const priorKeys = Array.isArray(prior.key_evidence) ? [...prior.key_evidence] : [];
  const priorThemes = new Set(priorKeys.map((k) => priorEvidenceTheme(k)?.id).filter(Boolean));

  out.evidence = {
    prior_assessment_retained: true,
    prior_key_evidence: priorKeys,
    prior_evidence_status: priorKeys.map((k) => priorEvidenceStatus(k, items)),
    observed_this_session: items,
    protective_evidence: items.filter((e) => e.role === "protective" || e.weight < 0),
    new_risk_evidence: [],
    new_this_session: [],
  };

  for (const e of items) {
    const isRisk = (e.role ?? "incriminating") !== "protective" && e.weight > 0;
    if (!isRisk) continue;
    // Theme is read from the matched signal first (precise), falling back to
    // the quote text when the signal carries no theme of its own.
    const theme = priorEvidenceTheme(e.signal_id) ?? priorEvidenceTheme(e.quote);
    const themeId = theme?.id ?? null;
    if (themeId && priorThemes.has(themeId)) continue;
    out.evidence.new_risk_evidence.push({
      quote: e.quote,
      timestamp: e.timestamp,
      signal_id: e.signal_id,
      dimension: e.dimension,
      why_new: themeId
        ? `Signal theme "${themeId}" does not appear in the prior record's key evidence.`
        : "No matching theme in the prior record's key evidence.",
    });
  }

  const resolved = out.evidence.prior_evidence_status.filter((s) => s.status === "RESOLVED");
  const ongoing = out.evidence.prior_evidence_status.filter(
    (s) => s.status === "ONGOING" || s.status === "IMPROVED_BUT_EPISODIC"
  );
  const newRisk = out.evidence.new_risk_evidence;

  /* ── Priority: never silently downgraded ───────────────────────────── */
  const fromPriority = prior.operational_priority ?? prior.review_priority ?? null;
  const toPriority = current.operational_priority ?? null;
  const rank = (p) => (p == null ? null : PRIORITY_RANK[p] ?? 2);
  const fromRank = rank(fromPriority);
  const toRank = rank(toPriority);
  const downgraded = fromRank != null && toRank != null && toRank < fromRank;

  out.priority = {
    from: fromPriority,
    to: toPriority,
    changed: fromPriority !== toPriority,
    downgraded,
    downgrade_blocked:
      downgraded && newRisk.length > 0
        ? "NEW_RISK_EVIDENCE_PRESENT — a self-reported improvement alone does not justify a downgrade."
        : null,
    held_with_watch_condition: !downgraded && newRisk.length > 0,
    note: "Trajectory is reported; the earlier assessment is retained and is not rewritten.",
  };

  out.follow_up_action = {
    action_code: newRisk.length > 0 ? "CONTINUE_FOLLOWUP_WITH_WATCH_CONDITION" : "CONTINUE_FOLLOWUP",
    watch_condition:
      newRisk.length > 0
        ? `RE-ESCALATE_ON_ANY_REPEAT_OF: ${[...new Set(newRisk.map((r) => r.signal_id))].join(", ")}`
        : null,
    reassess_at: "NEXT_SCHEDULED_CONTACT",
    human_decision_authority: "HUMAN",
    autonomous_action_taken: false,
  };

  out.improvements = [
    ...improvements.map((k) => ({ type: "DIMENSION", key: k })),
    ...resolved.map((s) => ({ type: "PRIOR_EVIDENCE_RESOLVED", key: s.key })),
  ];
  out.concerns = [
    ...dimensionConcerns.map((k) => ({ type: "DIMENSION", key: k })),
    ...newRisk.map((r) => ({ type: "NEW_RISK_EVIDENCE", key: r.signal_id, quote: r.quote, timestamp: r.timestamp })),
    ...ongoing.map((s) => ({ type: "PRIOR_EVIDENCE_ONGOING", key: s.key })),
  ];
  out.both_directions_reported = out.improvements.length > 0 && out.concerns.length > 0;

  out.summary.push(
    out.improvements.length
      ? `Improvement on: ${out.improvements.map((i) => i.key).join(", ")}.`
      : "No dimension or prior key evidence improved since the prior session.",
    out.concerns.length
      ? `Ongoing or new concern on: ${out.concerns.map((c) => c.key).join(", ")} — reported alongside the improvement, never netted against it.`
      : "No dimension deteriorated and no new risk evidence was observed since the prior session."
  );

  return out;
}

/** Operational priority ordering, lowest to highest. */
const PRIORITY_RANK = {
  HUMAN_ASSESSMENT_REQUIRED: 0,
  DISMISSED_BY_HUMAN: 0,
  LOW: 1,
  MODERATE_PSYCHOSOCIAL_SUPPORT: 2,
  ELEVATED_HUMAN_VERIFICATION_REQUIRED: 3,
  HIGH_SAFETY_REVIEW: 4,
  CRITICAL_SELF_HARM_PATHWAY: 5,
  CRITICAL_IMMEDIATE_DANGER: 5,
};

/** Thematic buckets used to re-read last session's key evidence. */
const PRIOR_THEMES = [
  { id: "sleep", markers: /sleep|insomnia|awake|rest|nap/i },
  { id: "affect", markers: /cry|cries|crying|weep|hopeless|depress|humiliat|break(ing)? down/i },
  { id: "occupational", markers: /\bwork\b|boss|job|warn|employ|school|college/i },
  { id: "support", markers: /counsel|support|family|brother|sister|friend|network|colleague/i },
  { id: "contact", markers: /contact|call|message|follow|visit|arriv|gate|waiting|sighting/i },
  { id: "threat", markers: /threat|harass|abuse|violence|stalking|weapon|kill/i },
];

function priorEvidenceTheme(text) {
  const s = String(text ?? "");
  return PRIOR_THEMES.find((t) => t.markers.test(s)) ?? null;
}

/**
 * Re-read one piece of prior key evidence against this session's evidence.
 * Absence of evidence is reported as NO_CURRENT_EVIDENCE — never as resolved,
 * because "I didn't mention it" is not the same as "it stopped".
 */
function priorEvidenceStatus(key, items) {
  const theme = priorEvidenceTheme(key);
  if (!theme) return { key, theme: null, status: "NO_CURRENT_EVIDENCE" };

  const related = items.filter(
    (e) => theme.markers.test(e.quote || "") || theme.markers.test(e.signal_id || "")
  );
  if (!related.length) return { key, theme: theme.id, status: "NO_CURRENT_EVIDENCE", quotes: [] };

  const protective = related.some((e) => e.role === "protective" || e.weight < 0);
  const risk = related.some((e) => e.role !== "protective" && e.weight > 0);
  const status = protective && risk ? "IMPROVED_BUT_EPISODIC" : protective ? "RESOLVED" : "ONGOING";

  return {
    key,
    theme: theme.id,
    status,
    quotes: related.map((e) => ({ quote: e.quote, timestamp: e.timestamp, signal_id: e.signal_id })),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Deterministic JSON so digests are reproducible across processes. */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}
