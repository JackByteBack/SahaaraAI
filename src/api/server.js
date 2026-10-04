/**
 * Sahaara AI — REST API + static console.
 *
 * Endpoints
 *   GET  /api/health            service, DB and audit-chain health
 *   POST /api/assess            run an assessment (degrades automatically)
 *   POST /api/review            record a human decision beside the AI output
 *   GET  /api/fixtures          list the TC-01 … TC-14 demo fixtures
 *   POST /api/fixtures/:id      run one fixture end-to-end
 *   GET  /api/cases             persisted cases
 *   GET  /api/cases/:ref        one case with evidence + audit trail
 *   GET  /api/audit             in-process hash chain + verification result
 *   POST /api/service           demo kill switch: { state: HEALTHY | OFFLINE }
 *
 * Degradation: `aiService` is polled on the §10.1 cadence. When it opens, the
 * assess route transparently returns a HUMAN_ASSESSMENT_MODE record rather
 * than a fabricated priority — the client shows the amber banner and the
 * manual controls, and the outage is written to the audit chain.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assess } from "../engine/assess.js";
import { applyHumanReview } from "../engine/review.js";
import { auditChain, recordAssessment, recordHumanReview, EVENT } from "../store/audit.js";
import { aiService, STATE } from "../services/aiService.js";
import { FIXTURES, getFixture } from "../fixtures.js";
import { pool, query } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Best-effort: persistence must never take the API down. */
const persist = async (fn, label) => {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[persist:${label}] skipped — ${err.message}`);
    return null;
  }
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readJson(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("REQUEST_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

/* ── Route handlers ────────────────────────────────────────────────── */

async function handleHealth(req, res) {
  let db = { ok: false, error: null, tables: null };
  try {
    const r = await query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
    );
    db = { ok: true, error: null, tables: r.rows[0].n };
  } catch (err) {
    db.error = err.message;
  }

  send(res, 200, {
    api: "ok",
    model_service: aiService.snapshot(),
    database: db,
    audit: { entries: auditChain.length, head: auditChain.head, ...auditChain.verify() },
    timestamp: new Date().toISOString(),
  });
}

async function handleAssess(req, res) {
  const body = await readJson(req);
  const input = body.input ?? body;
  if (!input.turns || !Array.isArray(input.turns) || !input.turns.length) {
    return send(res, 400, { error: "BAD_REQUEST", detail: "input.turns must be a non-empty array" });
  }

  const degraded = aiService.shouldDegrade || input.degraded === true;
  const payload = assess({ ...input, degraded });

  recordAssessment(payload, auditChain);
  await persist(
    () => import("../store/cases.js").then((m) => m.saveCase(payload)),
    "assess"
  );

  send(res, degraded ? 200 : 200, {
    degraded_mode_active: degraded,
    service: aiService.snapshot(),
    assessment: payload,
  });
}

async function handleReview(req, res) {
  const body = await readJson(req);
  const { assessment, review, previous_human_decision } = body;
  if (!assessment || !review) {
    return send(res, 400, { error: "BAD_REQUEST", detail: "assessment and review are required" });
  }

  let record;
  try {
    record = applyHumanReview(assessment, review, previous_human_decision ?? null);
  } catch (err) {
    // A rejected rationale is a validation result, not a server fault.
    return send(res, 422, { error: "REVIEW_REJECTED", detail: err.message });
  }

  recordHumanReview(record, auditChain);
  await persist(() => import("../store/cases.js").then((m) => m.saveReview(record)), "review");

  send(res, 200, { review: record, audit: auditChain.verify() });
}

async function handleFixtures(req, res, id) {
  if (!id) {
    return send(
      res,
      200,
      FIXTURES.map((f) => ({
        id: f.id,
        title: f.title,
        category: f.category,
        novelty: f.novelty,
        criteria: f.criteria,
        severity: f.severity ?? null,
      }))
    );
  }

  const fixture = getFixture(id.toUpperCase());
  // Fixture runs must honour the same degradation gate as /api/assess —
  // otherwise TC-14 would "pass" only through the manual-assess route —
  // while a fixture that declares its own degraded input keeps that flag.
  const degraded = aiService.shouldDegrade || fixture.input?.degraded === true;
  const assessment = assess({ ...fixture.input, degraded });
  recordAssessment(assessment, auditChain);

  let review = null;
  let reviewError = null;
  const reviewInput =
    fixture.review ??
    (assessment.record_type === "HUMAN_ASSESSMENT_MODE"
      ? {
          badge_id: "SD-014",
          role: "intake_officer",
          action: "CONFIRM",
          justification_category: "EVIDENCE_REASSESSED",
          rationale:
            "Manual intake completed during the outage. Values confirmed line by line against the transcript; no AI output was substituted.",
        }
      : null);

  if (reviewInput) {
    try {
      applyHumanReview(assessment, { ...reviewInput, rationale: "" });
      reviewError = "EMPTY_RATIONALE_ACCEPTED (this must never happen)";
    } catch (e) {
      reviewError = e.message;
    }
    try {
      review = applyHumanReview(assessment, reviewInput);
      recordHumanReview(review, auditChain);
    } catch (e) {
      reviewError = reviewError ?? e.message;
    }
  }

  send(res, 200, { fixture, assessment, review, rejected_blank_rationale: reviewError });
}

async function handleCases(req, res, ref) {
  const { listCases, getCase } = await import("../store/cases.js");
  if (!ref) return send(res, 200, await listCases());
  const record = await getCase(ref);
  return record ? send(res, 200, record) : send(res, 404, { error: "NOT_FOUND", case_ref: ref });
}

async function handleAudit(req, res, caseRef) {
  send(res, 200, {
    length: auditChain.length,
    head: auditChain.head,
    verification: auditChain.verify(),
    entries: caseRef ? auditChain.forCase(caseRef) : auditChain.entries,
  });
}

async function handleService(req, res) {
  const { state } = await readJson(req);
  let next;
  if (state === "OFFLINE") next = aiService.simulateOutage("model_service_unavailable");
  else if (state === "HEALTHY") next = aiService.simulateRecovery();
  else return send(res, 400, { error: "BAD_REQUEST", detail: "state must be HEALTHY or OFFLINE" });

  auditChain.append(EVENT.AI_SERVICE_STATE_CHANGED, { requested: state, resulting_state: next }, {
    case_id: null,
    actor_type: "OPERATOR",
  });
  send(res, 200, { requested: state, ...aiService.snapshot() });
}

/* ── Static files ──────────────────────────────────────────────────── */

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "FORBIDDEN" });

  try {
    const data = await readFile(abs);
    res.writeHead(200, {
      "content-type": MIME[path.extname(abs)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    send(res, 404, { error: "NOT_FOUND", path: rel });
  }
}

/* ── Server ────────────────────────────────────────────────────────── */

const routes = [
  { re: /^\/api\/health$/, methods: ["GET"], handle: handleHealth },
  { re: /^\/api\/assess$/, methods: ["POST"], handle: handleAssess },
  { re: /^\/api\/review$/, methods: ["POST"], handle: handleReview },
  { re: /^\/api\/fixtures$/, methods: ["GET"], handle: (q, s) => handleFixtures(q, s, null) },
  { re: /^\/api\/fixtures\/([^/]+)$/, methods: ["POST"], handle: (q, s, m1) => handleFixtures(q, s, m1) },
  { re: /^\/api\/cases$/, methods: ["GET"], handle: (q, s) => handleCases(q, s, null) },
  { re: /^\/api\/cases\/([^/]+)$/, methods: ["GET"], handle: (q, s, m1) => handleCases(q, s, m1) },
  { re: /^\/api\/audit$/, methods: ["GET"], handle: (q, s) => handleAudit(q, s, null) },
  { re: /^\/api\/audit\/([^/]+)$/, methods: ["GET"], handle: (q, s, m1) => handleAudit(q, s, m1) },
  { re: /^\/api\/service$/, methods: ["POST"], handle: handleService },
];

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathName = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }

    try {
      if (pathName.startsWith("/api/")) {
        res.setHeader("access-control-allow-origin", "*");
        const route = routes.find((r) => r.re.test(pathName));
        if (!route) return send(res, 404, { error: "NOT_FOUND", path: pathName });
        if (!route.methods.includes(req.method)) {
          return send(res, 405, { error: "METHOD_NOT_ALLOWED", allow: route.methods });
        }
        const m = pathName.match(route.re);
        return await route.handle(req, res, ...m.slice(1));
      }
      if (req.method !== "GET") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
      return await serveStatic(req, res, pathName);
    } catch (err) {
      const clientFault = err.message === "INVALID_JSON" || err.message === "REQUEST_TOO_LARGE";
      send(res, clientFault ? 400 : 500, {
        error: clientFault ? err.message : "INTERNAL_ERROR",
        detail: err.message,
      });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4000);
  const server = createServer();

  // §10.1 — the model service is polled continuously, not on demand.
  aiService.start(() => (aiService.state === STATE.OFFLINE ? false : true));

  server.listen(port, () => {
    console.log(`Sahaara AI console  →  http://localhost:${port}`);
    console.log(`API health         →  http://localhost:${port}/api/health`);
    console.log(`Audit chain        →  http://localhost:${port}/api/audit`);
  });

  const shutdown = async () => {
    aiService.stop();
    server.close();
    try {
      await pool.end();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
