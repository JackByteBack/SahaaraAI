/**
 * Sahaara AI — Case, Evidence and Audit persistence (Neon Postgres).
 *
 * Tables (see schema notes in README):
 *   cases          — one row per assessment session
 *   evidence_blocks— verbatim quotes with attribution, linked by case_id
 *   audit_logs     — flattened append-only trail (mirrors the hash chain)
 *
 * Every write is a transaction so a case is never persisted without its
 * evidence, and evidence is never persisted without its case.
 */

import { randomUUID } from "node:crypto";
import { query, withTransaction as transaction } from "../db.js";
import { auditChain, canonical, hash } from "./audit.js";

/* ── Schema constraints (cases_status_check / audit_logs_actor_type_check) ──
 * The tables ship with CHECK constraints, so values are mapped onto them
 * rather than the schema being relaxed to fit the writer.                */
const ACTOR_TYPES = ["ai", "reviewer", "admin", "system"];

function statusForPriority(priority) {
  const p = String(priority || "");
  if (/^CRITICAL|HIGH_SAFETY/.test(p)) return "escalated";
  if (/HUMAN_ASSESSMENT_REQUIRED|ELEVATED/.test(p)) return "review";
  return "open";
}

function actorType(actor) {
  const a = String(actor || "SYSTEM").toUpperCase();
  const mapped = a === "HUMAN" ? "reviewer" : a === "OPERATOR" ? "admin" : a === "AI" ? "ai" : "system";
  return ACTOR_TYPES.includes(mapped) ? mapped : "system";
}

/* ── Cases ─────────────────────────────────────────────────────────── */

/**
 * Persist an assessment (or degraded assessment) plus its evidence blocks.
 *
 * @param {Object} assessment Output of assess() / assessDegraded().
 * @returns {Promise<{case_row: Object, evidence_count: number}>}
 */
export async function saveCase(assessment) {
  const caseId = assessment.case_id || randomUUID();
  const priority = assessment.review_priority || assessment.operational_priority || null;
  const status = statusForPriority(priority);
  const safetyState = priority
    ? `${priority}${assessment.safety_override?.active ? " · " + assessment.safety_override.override_code : ""}`
    : assessment.record_type === "HUMAN_ASSESSMENT_MODE"
      ? "HUMAN_ASSESSMENT_MODE"
      : "UNDETERMINED";

  return transaction(async (c) => {
    const existing = await c.query("SELECT id FROM cases WHERE case_ref = $1", [caseId]);

    let caseRow;
    if (existing.rows.length) {
      const r = await c.query(
        `UPDATE cases SET status = $2, safety_state = $3, transcript = $4 WHERE case_ref = $1
         RETURNING *`,
        [caseId, status, safetyState, assessment.raw_transcript ?? null]
      );
      caseRow = r.rows[0];
    } else {
      const r = await c.query(
        `INSERT INTO cases (id, case_ref, status, transcript, safety_state, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [randomUUID(), caseId, status, assessment.raw_transcript ?? null, safetyState]
      );
      caseRow = r.rows[0];
    }

    const evidence = Array.isArray(assessment.evidence_attribution)
      ? assessment.evidence_attribution
      : [];

    for (const e of evidence) {
      await c.query(
        `INSERT INTO evidence_blocks (id, case_id, snippet, start_ms, end_ms, dimension, strength, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [
          randomUUID(),
          caseRow.id,
          e.quote ?? e.verbatim ?? "",
          e.start_ms ?? null,
          e.end_ms ?? null,
          e.dimension ?? null,
          e.strength ?? (e.weight != null ? String(e.weight) : null),
        ]
      );
    }

    await c.query(
      `INSERT INTO audit_logs (id, case_id, actor_type, actor_id, action, details, created_at)
       VALUES ($1, $2, 'system', 'assess', $3, $4, now())`,
      [
        randomUUID(),
        caseRow.id,
        `ASSESSMENT_${assessment.record_type || "AI"}`,
        JSON.stringify({
          operational_priority: assessment.operational_priority,
          multidimensional_assessment: assessment.multidimensional_assessment ?? null,
          uncertainty_state: assessment.uncertainty_state ?? null,
          evidence_count: evidence.length,
        }),
      ]
    );

    return { case_row: caseRow, evidence_count: evidence.length };
  });
}

/**
 * Persist a HUMAN_REVIEW_DECISION beside (never over) the AI assessment.
 *
 * @param {Object} reviewRecord Output of applyHumanReview().
 */
export async function saveReview(reviewRecord) {
  const caseRow = (
    await query("SELECT id FROM cases WHERE case_ref = $1", [reviewRecord.case_id])
  ).rows[0];

  const details = {
    assessment_id: reviewRecord.assessment_id,
    ai_priority: reviewRecord.ai_assessment.operational_priority,
    human_priority: reviewRecord.human_decision.operational_priority,
    human_action: reviewRecord.human_decision.action,
    changed: reviewRecord.human_decision.changed,
    rationale: reviewRecord.rationale,
    justification_category: reviewRecord.justification_category,
    reviewer: reviewRecord.reviewer,
    downstream_action: reviewRecord.downstream_action,
    integrity_digest: reviewRecord.integrity.payload_digest,
    ai_output_retained: true,
  };

  const r = await query(
    `INSERT INTO audit_logs (id, case_id, actor_type, actor_id, action, details, created_at)
     VALUES ($1, $2, 'reviewer', $3, $4, $5, now())
     RETURNING *`,
    [
      randomUUID(),
      caseRow?.id ?? null,
      reviewRecord.reviewer.badge_id,
      reviewRecord.human_decision.changed ? "HUMAN_OVERRIDE_APPLIED" : "HUMAN_REVIEW_RECORDED",
      JSON.stringify(details),
    ]
  );

  if (caseRow) {
    await query("UPDATE cases SET status = $2 WHERE id = $1", [
      caseRow.id,
      reviewRecord.human_decision.action === "DISMISS"
        ? "closed"
        : reviewRecord.human_decision.action === "ESCALATE"
          ? "escalated"
          : "review",
    ]);
  }

  return r.rows[0];
}

/** Persist a fallback / degradation event. */
export async function saveFallbackEvent(event, caseRef = null) {
  const caseId = caseRef
    ? (await query("SELECT id FROM cases WHERE case_ref = $1", [caseRef])).rows[0]?.id ?? null
    : null;

  return (
    await query(
      `INSERT INTO audit_logs (id, case_id, actor_type, actor_id, action, details, created_at)
       VALUES ($1, $2, 'system', 'ai_service', $3, $4, now())
       RETURNING *`,
      [randomUUID(), caseId, event.action, JSON.stringify(event.details ?? event)]
    )
  ).rows[0];
}

/* ── Reads ─────────────────────────────────────────────────────────── */

export async function listCases(limit = 50) {
  const r = await query(
    `SELECT id, case_ref, status, safety_state, created_at
       FROM cases ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function getCase(caseRef) {
  const c = (await query("SELECT * FROM cases WHERE case_ref = $1 OR id::text = $1", [caseRef]))
    .rows[0];
  if (!c) return null;

  const evidence = await query(
    `SELECT snippet, start_ms, end_ms, dimension, strength, created_at
       FROM evidence_blocks WHERE case_id = $1 ORDER BY start_ms NULLS LAST`,
    [c.id]
  );
  const audit = await query(
    `SELECT actor_type, actor_id, action, details, created_at
       FROM audit_logs WHERE case_id = $1 ORDER BY created_at ASC`,
    [c.id]
  );

  return { ...c, evidence_blocks: evidence.rows, audit_logs: audit.rows };
}

export async function listAuditLogs(limit = 200) {
  const r = await query(
    `SELECT a.actor_type, a.actor_id, a.action, a.details, a.created_at, c.case_ref
       FROM audit_logs a LEFT JOIN cases c ON c.id = a.case_id
      ORDER BY a.created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/* ── In-process chain ⇄ database ───────────────────────────────────── */

/** Highest chain sequence already mirrored into `audit_logs`. */
let syncedThrough = 0;

/**
 * Mirror the in-memory hash chain into `audit_logs` for the entries not yet
 * written. Each entry's own hash and predecessor hash are stored inside
 * `details._chain`, so a later reader can re-verify ordering against the
 * source of truth instead of trusting insertion order.
 *
 * @param {number|null} [fromSeq] Start index; defaults to whatever is unsynced.
 * @returns {Promise<string[]>} Row ids written.
 */
export async function syncAuditChain(fromSeq = null) {
  const start = fromSeq ?? syncedThrough;
  const written = [];
  for (const e of auditChain.entries.slice(start)) {
    const caseId = e.case_id
      ? (await query("SELECT id FROM cases WHERE case_ref = $1", [e.case_id])).rows[0]?.id ?? null
      : null;
    const row = (
      await query(
        `INSERT INTO audit_logs (id, case_id, actor_type, actor_id, action, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          randomUUID(),
          caseId,
          actorType(e.actor_type),
          e.actor_id,
          e.event_type,
          JSON.stringify({ ...e.body, _chain: { seq: e.seq, hash: e.hash, prev_hash: e.prev_hash } }),
          e.timestamp_utc,
        ]
      )
    ).rows[0];
    written.push(row.id);
    syncedThrough = e.seq + 1;
  }
  return written;
}

/** Integrity helper: recompute a chain digest for any arbitrary body. */
export function chainDigest(prevHash, body) {
  return hash(`${prevHash}|${canonical(body)}`);
}
