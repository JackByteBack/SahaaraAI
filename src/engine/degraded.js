/**
 * Sahaara AI — Human Assessment Mode (graceful degradation, TC-14 / CRIT-12)
 *
 * §10.1: "AI assists the workflow but is not a single point of failure."
 *
 * When the model service is unreachable the platform must:
 *   • stay usable and render a manual path, never a dead form;
 *   • preserve every byte already entered (transcript, attachments, partial
 *     fields, prior assessments);
 *   • label AI-dependent features as UNAVAILABLE rather than leaving them blank;
 *   • emit NO default assessment — a silent LOW is worse than no score;
 *   • label anything the human produces as HUMAN-ENTERED, never as AI output;
 *   • write an audit event for the outage itself;
 *   • never overwrite human-entered values on later recovery.
 */

/** Human Assessment Mode banner text (verbatim, TC-14 pass assertion). */
export const DEGRADED_BANNER = "AI ASSESSMENT UNAVAILABLE — HUMAN ASSESSMENT MODE ACTIVE";

/** The subsystems that genuinely depend on the model service. */
export const AI_DEPENDENT_FEATURES = [
  { feature: "multidimensional_scoring", status: "UNAVAILABLE", fallback: "manual_select" },
  { feature: "operational_priority_recommendation", status: "UNAVAILABLE", fallback: "manual_select" },
  { feature: "evidence_autolinking", status: "UNAVAILABLE", fallback: "manual_timestamp_citation" },
  { feature: "safety_override_auto_triage", status: "UNAVAILABLE", fallback: "manual_set_or_clear_with_rationale" },
  { feature: "code_switching_gloss", status: "UNAVAILABLE", fallback: "route_to_qualified_reviewer" },
  { feature: "conflict_and_anomaly_detection", status: "UNAVAILABLE", fallback: "manual_flag" },
];

/** Manual controls that replace the AI path. */
export const MANUAL_CONTROLS = [
  { field: "psychological_distress", control: "select", options: ["LOW", "MODERATE", "HIGH", "ACUTE", "UNKNOWN"] },
  { field: "immediate_physical_safety", control: "select", options: ["SAFE", "LOW", "HIGH_RISK", "EXTREME_LETHALITY_RISK", "UNDETERMINED"] },
  { field: "contextual_vulnerability", control: "select", options: ["LOW", "MODERATE", "HIGH", "SEVERE", "UNDETERMINED"] },
  { field: "evidence_quality", control: "select", options: ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] },
  { field: "review_priority", control: "select", options: [
    "LOW", "MODERATE_PSYCHOSOCIAL_SUPPORT", "HIGH_SAFETY_REVIEW",
    "CRITICAL_IMMEDIATE_DANGER", "CRITICAL_SELF_HARM_PATHWAY", "HUMAN_ASSESSMENT_REQUIRED",
  ] },
  { field: "safety_override", control: "toggle_with_rationale" },
  { field: "evidence", control: "free_text_with_timestamp_citation" },
];

/**
 * Build the degraded-mode assessment envelope.
 *
 * Nothing that would normally be scored is scored. The envelope exists so the
 * reviewer can keep working, not to imitate an AI result.
 *
 * @param {Object} input
 * @param {string} input.case_id
 * @param {string} [input.banner]
 * @param {Object} [input.context]  { prior_assessments, transcript, partial_fields }
 * @param {string} [input.cause]
 * @param {string} [input.continued_by]
 * @returns {Object}
 */
export function assessDegraded(input = {}) {
  const {
    case_id = "UNKNOWN",
    session_number = 1,
    turns = null,
    verbatim_text = null,
    cause = "model_service_unavailable",
    continued_by = null,
    context = {},
    banner = DEGRADED_BANNER,
  } = input;

  const timestamp = new Date().toISOString();
  const transcript = Array.isArray(turns)
    ? turns.map((t) => ({ timestamp: t.timestamp || t.t || "00:00", speaker: t.speaker || "complainant", text: t.text || "" }))
    : verbatim_text
      ? String(verbatim_text)
      : null;

  const prior = context.prior_assessments || (context.prior_assessment ? [context.prior_assessment] : []);

  return {
    case_id,
    session_number,
    timestamp,
    record_type: "HUMAN_ASSESSMENT_MODE",

    degraded_mode: {
      active: true,
      banner,
      banner_timestamp: timestamp,
      cause,
      retry_state: "RETRYING_WITH_BACKOFF",
      circuit_state: "OPEN",
      who_continued: continued_by,
      human_decision_authority: "HUMAN",
    },

    // ── What the reviewer entered before the outage — never lost ────────
    preserved_case_data: {
      transcript,
      transcript_turns: Array.isArray(turns) ? turns.length : null,
      partial_fields: context.partial_fields ?? null,
      attachments: context.attachments ?? null,
      notice: "All previously entered data is retained. Nothing is cleared on save during an outage.",
    },

    // ── Prior AI assessments stay readable and unchanged ────────────────
    prior_assessments: prior,

    // ── AI-dependent features are named, not silently blank ─────────────
    ai_dependent_features: AI_DEPENDENT_FEATURES,

    // ── Manual path ─────────────────────────────────────────────────────
    manual_controls: { enabled: true, controls: MANUAL_CONTROLS },
    multidimensional_assessment: null,
    operational_priority: null,
    no_default_assessment: true,
    no_default_assessment_reason:
      "The AI is down. Emitting a default score would misrepresent an absent assessment as a present one.",

    human_assessment: {
      provenance: "HUMAN-ENTERED",
      status: "AWAITING_HUMAN_INPUT",
      entry_authority: "HUMAN",
      recorded_by: continued_by,
      recorded_at: null,
      values: {},
    },

    audit_event: {
      event_type: "FALLBACK_ACTIVATED",
      failure_state: "AI_DEGRADED",
      cause,
      timestamp,
      case_id,
      continued_by: continued_by || null,
      note: "Outage itself is written to the audit trail; historical AI assessments are not invalidated.",
    },

    recovery: {
      prompt: "Service restored. Review and reconcile human-entered values before applying any AI output.",
      automatic_overwrite: false,
      rule: "Human-entered values are never silently replaced by an AI backfill.",
    },

    limitations: [
      "No AI assessment was produced. Any indicator shown from this point forward is HUMAN-ENTERED.",
      "A human reviewer is the final decision-maker.",
    ],
  };
}

/**
 * Record a human entry against a degraded envelope. The value is stamped with
 * provenance so it can never later be presented as machine output.
 *
 * @param {Object} degraded Envelope from assessDegraded().
 * @param {Object} values   { field: value }
 * @param {string} reviewer Badge / account id.
 * @param {string} role     Reviewer role.
 * @returns {Object} New envelope (input is not mutated).
 */
export function recordHumanEntry(degraded, values = {}, reviewer = null, role = null) {
  if (!degraded || degraded.record_type !== "HUMAN_ASSESSMENT_MODE") {
    throw new Error("recordHumanEntry requires a HUMAN_ASSESSMENT_MODE envelope.");
  }
  const now = new Date().toISOString();
  return {
    ...degraded,
    human_assessment: {
      ...degraded.human_assessment,
      status: "HUMAN_ASSESSMENT_COMPLETE",
      recorded_by: reviewer,
      recorded_role: role,
      recorded_at: now,
      provenance: "HUMAN-ENTERED",
      values: { ...values },
    },
    audit_event: {
      ...degraded.audit_event,
      event_type: "HUMAN_ASSESSMENT_RECORDED",
      human_entry_at: now,
      human_entry_by: reviewer,
    },
    recovery: { ...degraded.recovery, prompt: "Service restored. Review and reconcile human-entered values before applying any AI output." },
  };
}
