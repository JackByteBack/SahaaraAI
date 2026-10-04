/* ==========================================================================
   Sahaara AI — Overview view
   ========================================================================== */

import { esc, qs, qsa, on } from "../dom.js";
import { icon } from "../icons.js";
import { ring, playRings, sparkHost } from "../charts.js";
import { stats, getResult } from "../store.js";
import { ago, clock, shortHash, num } from "../format.js";
import { card } from "./shared.js";

export function render(ctx) {
  const { state } = ctx;
  const s = stats();
  const h = state.health;
  const svc = h?.model_service || {};
  const degraded = !!svc.fallback_active;
  const db = h?.database || {};
  const audit = state.audit;

  const progress = s.total ? s.done / s.total : 0;
  const allPassed = s.total > 0 && s.done === s.total && s.failing === 0;

  /* ── Hero ─────────────────────────────────────────────────────────── */
  const hero = `
  <section class="hero anim-rise">
    <div>
      <div class="row-wrap" style="gap:8px;margin-bottom:14px">
        <span class="badge ${allPassed ? "badge-good" : s.done ? "badge-accent" : "badge-neutral"}">
          ${allPassed ? "all cases passing" : s.done ? `${s.done}/${s.total} executed` : "suite not run"}
        </span>
        <span class="badge ${degraded ? "badge-danger" : "badge-good"}">
          ${degraded ? "degraded · human mode" : "model service healthy"}
        </span>
        <span class="badge badge-violet">non-diagnostic</span>
      </div>

      <h1><span style="color:var(--text-2)">Case intelligence,</span> human-ruled.</h1>
      <p class="hero-sub">
        Sahaara AI scores trauma and safety signal across five dimensions, states its own
        uncertainty, abstains when evidence is thin, and hands every decision to a named
        human reviewer. This console runs the fourteen-case evaluation suite end to end.
      </p>

      <div class="hero-meta">
        <span class="chip chip-static">${icon("shield", 13)} Layer 0 override runs first</span>
        <span class="chip chip-static">${icon("quote", 13)} quote-level provenance</span>
        <span class="chip chip-static">${icon("git", 13)} append-only hash chain</span>
        <span class="chip chip-static">${icon("book", 13)} Marathi · English · code-switched</span>
      </div>

      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" data-act="run-all" ${state.suite.running ? "disabled" : ""}>
          ${state.suite.running ? `<span class="spinner"></span> running ${state.suite.done}/${state.suite.total}`
            : `${icon("play", 15)} Run full suite`}
        </button>
        <button class="btn btn-ghost btn-lg" data-act="go-cases">${icon("cases", 15)} Open case workspace</button>
        <button class="btn btn-ghost btn-lg" data-act="open-palette">${icon("keyboard", 15)} Command palette</button>
      </div>
    </div>

    <div class="ring-wrap">
      ${ring(progress, 200)}
      <div class="ring-center">
        <span class="ring-big" style="color:${allPassed ? "var(--good)" : "var(--text)"}">${s.done}<span style="font-size:1.1rem;color:var(--faint)">/${s.total}</span></span>
        <span class="ring-cap">${allPassed ? "all green" : "executed"}</span>
      </div>
    </div>
  </section>`;

  /* ── Stat tiles ───────────────────────────────────────────────────── */
  const tiles = `
  <div class="grid cols-4" data-stagger style="margin-bottom:var(--sp-5)">
    <div class="stat" style="--i:0">
      <div class="stat-label">${icon("checkCircle", 13)} Cases passing</div>
      <div class="stat-value" style="color:${allPassed ? "var(--good)" : "var(--text)"}">${s.passed}<small>/${s.total}</small></div>
      <div class="stat-meta">${s.failing ? `${s.failing} failing` : s.done ? "no failures recorded" : "run the suite to populate"}</div>
    </div>

    <div class="stat" style="--i:1">
      <div class="stat-label">${icon("audit", 13)} Audit entries</div>
      <div class="stat-value" style="color:var(--text)">${audit?.length ?? 0}</div>
      <div class="stat-meta">
        ${audit?.verification?.ok
          ? `<span class="good">chain verified · ${audit.verification.checked} checked</span>`
          : audit ? `<span class="danger">chain broken at #${audit.verification?.brokenAt}</span>` : "not loaded"}
      </div>
    </div>

    <div class="stat" style="--i:2">
      <div class="stat-label">${icon("cpu", 13)} Model service</div>
      <div class="stat-value" style="font-size:var(--fs-xl);color:${degraded ? "var(--danger)" : "var(--good)"}">${esc(svc.state || "—")}</div>
      <div class="stat-meta">circuit <b>${esc(svc.circuit || "—")}</b> · ${svc.consecutive_failures ?? 0} failures</div>
    </div>

    <div class="stat" style="--i:3">
      <div class="stat-label">${icon("database", 13)} Postgres</div>
      <div class="stat-value" style="font-size:var(--fs-xl);color:${db.ok ? "var(--text)" : "var(--danger)"}">
        ${db.ok ? `${db.tables ?? "—"}` : "OFFLINE"}
      </div>
      <div class="stat-meta">${db.ok ? "public tables reachable" : esc(db.error || "unreachable")}</div>
    </div>
  </div>`;

  /* ── Service health + activity ────────────────────────────────────── */
  const transitions = (svc.recent_transitions || []).slice().reverse();

  const healthCard = card({
    title: "Service health",
    iconName: "service",
    actions: `<span class="badge ${degraded ? "badge-danger" : "badge-good"}">${degraded ? "DEGRADED" : "HEALTHY"}</span>`,
    body: `
      ${sparkHost(state.healthHistory)}
      <div class="kvs" style="margin-top:12px">
        <span class="kv">state <b>${esc(svc.state || "—")}</b></span>
        <span class="kv">circuit <b>${esc(svc.circuit || "—")}</b></span>
        <span class="kv">poll <b>${svc.poll_interval_ms ?? "—"}ms</b></span>
        <span class="kv">probe <b>${svc.probe_interval_ms ?? "—"}ms</b></span>
        <span class="kv">checked <b>${svc.last_checked_at ? clock(svc.last_checked_at) : "—"}</b></span>
      </div>
      <div class="timeline" style="margin-top:14px">
        ${transitions.length ? transitions.map((t) => `
          <div class="tl-item ${t.to === "OFFLINE" || t.to === "OPEN" ? "bad" : "good"}">
            <span class="tl-dot"></span>
            <div class="row">
              <b class="mono">${esc(t.from ?? "")} → ${esc(t.to ?? "")}</b>
              <span class="right faint text-xs">${t.at ? clock(t.at) : ""} · ${esc(t.reason || t.cause || "")}</span>
            </div>
          </div>`).join("")
          : `<p class="text-xs muted">No state transitions recorded yet. Trigger an outage from the Service view.</p>`}
      </div>`,
    foot: degraded
      ? `<span class="warn">Degradation active — assessments return HUMAN_ASSESSMENT_MODE with <code>operational_priority: null</code>. Nothing is guessed.</span>`
      : "Circuit breaker closed. Polling every " + (svc.poll_interval_ms ?? "—") + "ms.",
  });

  const feedCard = card({
    title: "Recent audit activity",
    iconName: "audit",
    actions: `<button class="btn btn-ghost btn-sm" data-act="go-audit">Open chain ${icon("chevron", 12)}</button>`,
    body: `<div data-feed>${feedBody(audit)}</div>`,
    foot: audit?.head
      ? `head <b class="mono accent">${esc(shortHash(audit.head))}</b>`
      : "head —",
  });

  /* ── CRIT matrix ──────────────────────────────────────────────────── */
  const critMap = new Map();
  for (const f of state.fixtures) {
    for (const c of f.criteria || []) {
      if (!critMap.has(c)) critMap.set(c, []);
      critMap.get(c).push(f.id);
    }
  }
  const critCells = [...critMap.entries()].sort().map(([crit, ids]) => {
    const statuses = ids.map((id) => getResult(id).status);
    const ok = statuses.every((s2) => s2 === "done");
    return `<button class="crit-cell" data-goto-case="${esc(ids[0])}">
      <span class="crit-id">${esc(crit)}</span>
      <span>
        <span class="crit-text">${esc(CRIT_TEXT[crit] || "Evaluation criterion proven by this case.")}</span>
        <span class="crit-proves">${ok ? `<span class="good">✓</span>` : "·"} ${ids.join(", ")}</span>
      </span>
    </button>`;
  }).join("");

  const critCard = card({
    title: "Criteria coverage",
    iconName: "flag",
    actions: `<span class="badge badge-neutral">${critMap.size} criteria</span>`,
    body: `<div class="crit-grid">${critCells || `<p class="text-xs muted">Fixture catalogue not loaded.</p>`}</div>`,
    foot: "Click a criterion to jump to the case that proves it.",
  });

  return {
    html: `
      <div class="page">
        ${hero}
        ${tiles}
        <div class="grid cols-2" style="margin-bottom:var(--sp-4)">
          ${healthCard}
          ${feedCard}
        </div>
        ${critCard}
      </div>`,
    wire(root) {
      playRings(root);

      on(root, "click", '[data-act="run-all"]', () => ctx.runAll());
      on(root, "click", '[data-act="go-cases"]', () => ctx.go("cases"));
      on(root, "click", '[data-act="go-audit"]', () => ctx.go("audit"));
      on(root, "click", '[data-act="open-palette"]', () => ctx.openPalette());
      on(root, "click", "[data-goto-case]", (e, btn) => ctx.go("cases", btn.dataset.gotoCase));
    },
  };
}

/**
 * Markup for the overview's "Recent audit activity" body. Exported so the
 * shell can repaint just this node on the 12 s audit poll without a full
 * view re-render (which would collapse open details and reset scroll).
 *
 * @param {object|null} audit  GET /api/audit payload
 */
export function feedBody(audit) {
  const tail = (audit?.entries || []).slice(-8).reverse();
  if (!tail.length) {
    return `<div class="empty" style="padding:26px 12px">
        <span class="e-icon">${icon("git", 20)}</span>
        <div class="e-title">Chain is empty</div>
        <div class="e-sub">Run a case to write the first tamper-evident entry.</div>
      </div>`;
  }
  return `<div class="feed">${tail.map((e) => `
      <div class="feed-row">
        <span class="mono text-xs" style="color:var(--faint)">#${String(e.seq).padStart(3, "0")}</span>
        <div class="row-wrap">
          <span class="badge ${eventTone(e.event_type)}" style="font-size:9px">${esc(e.event_type)}</span>
          <span class="muted text-xs">${esc(e.case_id || "—")}</span>
        </div>
        <span class="fr-time">${ago(e.timestamp_utc)}</span>
      </div>`).join("")}</div>`;
}

function eventTone(ev) {
  if (!ev) return "badge-neutral";
  if (ev.includes("OVERRIDE") || ev.includes("FALLBACK")) return "badge-danger";
  if (ev.includes("HUMAN")) return "badge-good";
  if (ev.includes("CONFLICT") || ev.includes("ANOMALY")) return "badge-warn";
  if (ev.includes("SERVICE")) return "badge-violet";
  // Routine events (AI_ASSESSMENT_CREATED, TRAJECTORY_COMPUTED, …) carry no
  // verdict of their own — grey keeps colour reserved for actual status.
  return "badge-neutral";
}

/** One-line summaries for the criteria grid (CRIT-01 … CRIT-12). */
const CRIT_TEXT = {
  "CRIT-01": "Emotional language alone never inflates the safety score.",
  "CRIT-02": "No psychiatric diagnosis is ever generated.",
  "CRIT-03": "Speech distress is never proof of danger or coercion.",
  "CRIT-04": "A lethal-imminent signal forces an override upward, never downward.",
  "CRIT-05": "Self-harm pathway detection raises CRITICAL without waiting on scoring.",
  "CRIT-06": "Thin evidence produces an explicit abstention, not a forced label.",
  "CRIT-07": "High distress with no danger signal does not become a safety escalation.",
  "CRIT-08": "Every decision lands in an append-only, hash-chained audit log.",
  "CRIT-09": "Code-switched Marathi/English is handled without losing verbatim text.",
  "CRIT-10": "Longitudinal change is reported; prior assessments are never rewritten.",
  "CRIT-11": "Human review can override in both directions with a mandatory rationale.",
  "CRIT-12": "Degraded service returns HUMAN_ASSESSMENT_MODE instead of a guess.",
};
