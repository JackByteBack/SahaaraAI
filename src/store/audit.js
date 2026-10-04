/**
 * Sahaara AI — Append-Only, Tamper-Evident Audit Log
 *
 * §7 CRIT-08 and Appendix B: every assessment, override, abstention, human
 * decision and degradation event is written to an append-only chain.
 *
 * Each entry commits to its predecessor:
 *
 *     entry[n].hash = SHA256( entry[n-1].hash ‖ canonical(entry.body) )
 *
 * so altering or removing any historical entry breaks verification from that
 * point onward. Entries are never updated or deleted — corrections are made by
 * appending a superseding entry.
 */

import { createHash } from "node:crypto";

/** The event vocabulary written to the chain. */
export const EVENT = {
  AI_ASSESSMENT_CREATED: "AI_ASSESSMENT_CREATED",
  SAFETY_OVERRIDE_TRIGGERED: "SAFETY_OVERRIDE_TRIGGERED",
  ABSTENTION_RECORDED: "ABSTENTION_RECORDED",
  CONFLICT_RECORDED: "CONFLICT_RECORDED",
  ANOMALY_SIGNAL_RECORDED: "ANOMALY_SIGNAL_RECORDED",
  HUMAN_REVIEW_RECORDED: "HUMAN_REVIEW_RECORDED",
  HUMAN_OVERRIDE_APPLIED: "HUMAN_OVERRIDE_APPLIED",
  FALLBACK_ACTIVATED: "FALLBACK_ACTIVATED",
  HUMAN_ASSESSMENT_RECORDED: "HUMAN_ASSESSMENT_RECORDED",
  AI_SERVICE_STATE_CHANGED: "AI_SERVICE_STATE_CHANGED",
};

const GENESIS = "0".repeat(64);

/** Deterministic JSON so digests reproduce across processes. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function hash(payload) {
  return createHash("sha256").update(String(payload)).digest("hex");
}

/**
 * In-memory append-only chain. One instance per process by default; tests and
 * concurrent deployments may create isolated chains.
 */
export class AuditChain {
  constructor() {
    /** @type {Array<Object>} */
    this.entries = [];
    this.head = GENESIS;
  }

  get length() {
    return this.entries.length;
  }

  /**
   * Append an event.
   *
   * @param {string} eventType  One of EVENT.
   * @param {Object} body       Event payload (assessment, review, outage, …).
   * @param {Object} [meta]     { case_id, actor_type, actor_id }
   * @returns {Object} The stored entry.
   */
  append(eventType, body = {}, meta = {}) {
    if (!Object.values(EVENT).includes(eventType)) {
      throw new Error(`Unknown audit event type: ${eventType}. Allowed: ${Object.values(EVENT).join(", ")}`);
    }
    const seq = this.entries.length;
    const timestamp = new Date().toISOString();
    const record = {
      seq,
      event_type: eventType,
      case_id: meta.case_id ?? body.case_id ?? null,
      actor_type: meta.actor_type ?? (eventType.startsWith("HUMAN") ? "HUMAN" : "SYSTEM"),
      actor_id: meta.actor_id ?? null,
      timestamp_utc: timestamp,
      body,
    };
    const hashInput = `${this.head}|${canonical(record)}`;
    const entry = { ...record, prev_hash: this.head, hash: hash(hashInput) };
    this.entries.push(entry);
    this.head = entry.hash;
    return entry;
  }

  /**
   * Recompute the whole chain and report the first break, if any.
   *
   * @returns {{ok:boolean, checked:number, brokenAt:number|null, reason:string|null}}
   */
  verify() {
    let prev = GENESIS;
    for (const e of this.entries) {
      const { prev_hash: entryPrev, hash: entryHash, ...record } = e;
      const recomputed = hash(`${prev}|${canonical(record)}`);
      if (entryPrev !== prev) {
        return { ok: false, checked: this.entries.length, brokenAt: e.seq, reason: "prev_hash does not match predecessor" };
      }
      if (entryHash !== recomputed) {
        return { ok: false, checked: this.entries.length, brokenAt: e.seq, reason: "content hash mismatch — entry altered" };
      }
      prev = entryHash;
    }
    return { ok: true, checked: this.entries.length, brokenAt: null, reason: null };
  }

  /** Entries for one case, oldest first. */
  forCase(caseId) {
    return this.entries.filter((e) => e.case_id === caseId);
  }

  toJSON() {
    return { head: this.head, length: this.entries.length, entries: this.entries };
  }
}

/** Process-wide chain used by the API and evaluator. */
export const auditChain = new AuditChain();

/**
 * Convenience: derive an assessment event from a payload and append it.
 * Emits one entry per notable property so a reviewer can read the trail
 * without opening the full payload.
 *
 * @param {Object} assessment  Output of assess().
 * @param {AuditChain} [chain]
 * @returns {Object[]} Appended entries.
 */
export function recordAssessment(assessment, chain = auditChain) {
  const out = [];
  const meta = { case_id: assessment.case_id, actor_type: "SYSTEM" };

  if (assessment.record_type === "HUMAN_ASSESSMENT_MODE") {
    out.push(chain.append(EVENT.FALLBACK_ACTIVATED, assessment.audit_event, meta));
    return out;
  }

  out.push(chain.append(EVENT.AI_ASSESSMENT_CREATED, {
    assessment_id: assessment.assessment_id,
    case_id: assessment.case_id,
    operational_priority: assessment.operational_priority,
    multidimensional_assessment: assessment.multidimensional_assessment,
    evidence_quality_score: assessment.uncertainty_state?.evidence_quality_score ?? null,
    evidence_count: assessment.evidence_attribution?.length ?? 0,
  }, meta));

  if (assessment.safety_override?.active) {
    out.push(chain.append(EVENT.SAFETY_OVERRIDE_TRIGGERED, {
      case_id: assessment.case_id,
      assessment_id: assessment.assessment_id,
      override_code: assessment.safety_override.override_code,
      trigger_criteria: assessment.safety_override.trigger_criteria,
      override_timestamp: assessment.safety_override.override_timestamp,
      bypass_normal_weighting: assessment.safety_override.bypass_normal_weighting,
    }, meta));
  }

  if (assessment.uncertainty_state?.abstention) {
    out.push(chain.append(EVENT.ABSTENTION_RECORDED, {
      case_id: assessment.case_id,
      assessment_id: assessment.assessment_id,
      evidence_quality_score: assessment.uncertainty_state.evidence_quality_score,
      threshold: assessment.uncertainty_state.threshold,
      reason: assessment.uncertainty_state.abstention_reason,
      missing_critical_data: assessment.information_gap_analysis?.missing_critical_data ?? [],
    }, meta));
  }

  if (assessment.conflict_analysis?.detected) {
    out.push(chain.append(EVENT.CONFLICT_RECORDED, {
      case_id: assessment.case_id,
      assessment_id: assessment.assessment_id,
      pair_count: assessment.conflict_analysis.pairs.length,
      confidence: assessment.conflict_analysis.confidence,
      note: assessment.conflict_analysis.note,
    }, meta));
  }

  if (assessment.anomaly_analysis) {
    out.push(chain.append(EVENT.ANOMALY_SIGNAL_RECORDED, {
      case_id: assessment.case_id,
      assessment_id: assessment.assessment_id,
      epistemic_status: assessment.anomaly_analysis.epistemic_status,
      confidence: assessment.anomaly_analysis.confidence,
      indicators: assessment.anomaly_analysis.uncertainty_indicators.map((i) => i.type),
      guardrail: assessment.anomaly_analysis.guardrail,
    }, meta));
  }

  if (assessment.trajectory) {
    out.push(chain.append(EVENT.AI_ASSESSMENT_CREATED, {
      case_id: assessment.case_id,
      assessment_id: assessment.assessment_id,
      event: "TRAJECTORY_COMPUTED",
      session_from: assessment.trajectory.session_from,
      session_to: assessment.trajectory.session_to,
      improvements: assessment.trajectory.improvements,
      concerns: assessment.trajectory.concerns,
      prior_assessment_retained: true,
    }, meta));
  }

  return out;
}

/**
 * Convenience: append a human review decision, marking an override when the
 * human's value differs from the machine's.
 *
 * @param {Object} reviewRecord Output of applyHumanReview().
 * @param {AuditChain} [chain]
 */
export function recordHumanReview(reviewRecord, chain = auditChain) {
  const meta = {
    case_id: reviewRecord.case_id,
    actor_type: "HUMAN",
    actor_id: reviewRecord.reviewer.badge_id,
  };
  const entries = [];
  entries.push(chain.append(EVENT.HUMAN_REVIEW_RECORDED, reviewRecord.audit_entry, meta));
  if (reviewRecord.human_decision.changed) {
    entries.push(chain.append(EVENT.HUMAN_OVERRIDE_APPLIED, {
      case_id: reviewRecord.case_id,
      assessment_id: reviewRecord.assessment_id,
      from: reviewRecord.human_decision.previous_priority,
      to: reviewRecord.human_decision.operational_priority,
      reviewer_id: reviewRecord.reviewer.badge_id,
      reviewer_role: reviewRecord.reviewer.role,
      rationale: reviewRecord.rationale,
      downstream_action: reviewRecord.downstream_action,
      downstream_attributed_to: reviewRecord.downstream_attributed_to,
      ai_output_retained: true,
    }, meta));
  }
  return entries;
}
