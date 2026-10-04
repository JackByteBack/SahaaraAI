/* ==========================================================================
   Sahaara AI — Case workspace view
   ========================================================================== */

import { esc, qs, qsa, on, debounce, playMeters } from "../dom.js";
import { icon } from "../icons.js";
import { getResult, stats } from "../store.js";
import {
  num, clock, duration, tone, priorityBadge, label, jsonDetails, confidenceLabel,
} from "../format.js";
import {
  DIMS, PRIORITIES, HUMAN_ACTIONS, JUSTIFICATION_CATEGORIES, DOWNSTREAM_ACTIONS,
  card, dimCards, epistemicCard, actionCard, overrideBanner, abstainBanner,
  conflictCard, anomalyCard, evidencePanel, gapCard, metaCard, trajectoryPanel,
  limitationsCard, decisionBlock, degradedPanel,
} from "./shared.js";

let activeTab = "evidence";
let evFilter = "all";
let search = "";
let categoryFilter = "ALL";

/* ── Left rail ─────────────────────────────────────────────────────────── */

function railHtml(ctx) {
  const { state } = ctx;
  const all = state.fixtures || [];
  const cats = ["ALL", ...new Set(all.map((f) => f.category))];
  const q = search.trim().toLowerCase();

  const list = all.filter((f) => {
    if (categoryFilter !== "ALL" && f.category !== categoryFilter) return false;
    if (!q) return true;
    return (f.id + " " + f.title + " " + f.novelty + " " + (f.criteria || []).join(" "))
      .toLowerCase().includes(q);
  });

  const items = list.map((f) => {
    const r = getResult(f.id);
    const cls = r.status === "running" ? "run" : r.status === "done" ? "pass" : "";
    const prio = r.assessment?.operational_priority;
    return `<button class="case-item" data-case="${esc(f.id)}"
        aria-current="${state.route.param === f.id}">
      <span class="ci-id">${esc(f.id)}</span>
      <span>
        <span class="ci-title">${esc(f.title)}</span>
        <span class="ci-sub">${esc(f.novelty)}</span>
        <span class="ci-badges">
          ${(f.criteria || []).slice(0, 3).map((c) => `<span class="tag accent">${esc(c)}</span>`).join("")}
          ${prio ? `<span class="tag ${prio.startsWith("CRITICAL") ? "risk" : prio === "LOW" ? "prot" : ""}">${esc(prio)}</span>` : ""}
        </span>
      </span>
      <span class="ci-state ${cls}" title="${esc(r.status)}"></span>
    </button>`;
  }).join("");

  return `
    <div class="case-search">
      ${icon("search", 15)}
      <input class="input" id="case-search" type="search" placeholder="Search cases, criteria…"
        value="${esc(search)}" aria-label="Search fixtures" />
    </div>
    <div class="case-filters">
      ${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${categoryFilter === c}">${esc(c)}</button>`).join("")}
    </div>
    <div class="case-list" data-stagger>
      ${items || `<div class="empty" style="padding:30px 12px">
        <span class="e-icon">${icon("search", 20)}</span>
        <div class="e-title">No case matches</div>
        <div class="e-sub">Clear the filter to see all fourteen fixtures.</div></div>`}
    </div>
    <div class="rail-note text-xs">${list.length} of ${all.length} fixtures shown</div>`;
}

/* ── Verdict ───────────────────────────────────────────────────────────── */

function verdictHtml(ctx, f, r) {
  const a = r.assessment;
  const running = r.status === "running";
  const idle = r.status === "idle" || r.status === "error";

  if (!a) {
    return `<section class="verdict ${running ? "degraded" : ""}">
      <div class="verdict-top">
        <div>
          <div class="verdict-kicker">${esc(f.id)} · ${esc(f.category)}</div>
          <div class="verdict-prio ${running ? "cyan" : "violet"}">${running ? "Running…" : "Not yet executed"}</div>
          <div class="verdict-novelty">${esc(f.novelty)}</div>
        </div>
        <div class="verdict-side">
          <button class="btn btn-primary" data-act="run" ${running ? "disabled" : ""}>
            ${running ? `<span class="spinner"></span> assessing` : `${icon("play", 15)} Run case`}
          </button>
          <span class="mono text-xs faint">${esc(f.criteria?.join(" · ") || "")}</span>
        </div>
      </div>
      ${r.error ? `<div class="banner crit" style="margin-top:15px">
        <span class="b-icon">${icon("octagon", 17)}</span>
        <div><span class="b-title">Run failed</span>${esc(r.error)}</div></div>` : ""}
    </section>`;
  }

  const u = a.uncertainty_state || {};
  const cls = [
    a.safety_override?.active ? "critical" : "",
    a.record_type === "HUMAN_ASSESSMENT_MODE" ? "degraded" : "",
    u.abstention ? "abstained" : "",
    u.conflicting_evidence ? "conflict" : "",
  ].filter(Boolean).join(" ");

  const prioText = a.record_type === "HUMAN_ASSESSMENT_MODE"
    ? "HUMAN ASSESSMENT MODE"
    : (a.operational_priority || "—");

  const prioTone = a.record_type === "HUMAN_ASSESSMENT_MODE" ? "violet" : tone(a.operational_priority);

  return `<section class="verdict ${cls}">
    <div class="verdict-top">
      <div>
        <div class="verdict-kicker">${esc(f.id)} · ${esc(f.category)} · ${esc(a.case_id)}</div>
        <div class="verdict-prio ${prioTone}">${esc(prioText)}</div>
        <div class="verdict-novelty">${esc(f.novelty)}</div>
      </div>
      <div class="verdict-side">
        <div class="row-wrap" style="justify-content:flex-end">
          <span class="badge ${priorityBadge(a.operational_priority)}">${esc(a.record_type)}</span>
          <span class="badge badge-neutral">${esc(u.state || "—")}</span>
          <span class="badge badge-neutral">conf ${esc(confidenceLabel(u.confidence_label))}</span>
        </div>
        <button class="btn ${idle ? "btn-primary" : "btn-ghost"}" data-act="run" ${running ? "disabled" : ""}>
          ${running ? `<span class="spinner"></span> assessing` : `${icon("refresh", 14)} Re-run`}
        </button>
        <span class="mono text-xs faint">${r.ms ? duration(r.ms) : ""} · ${esc(a.assessment_id || "")}</span>
      </div>
    </div>
  </section>`;
}

/* ── Review form ───────────────────────────────────────────────────────── */

function reviewForm(f, r) {
  const a = r.assessment;
  if (!a) {
    return card({
      title: "Human review", iconName: "user",
      body: `<div class="empty" style="padding:34px 16px">
        <span class="e-icon">${icon("user", 22)}</span>
        <div class="e-title">Run the case first</div>
        <div class="e-sub">The review form acts on the AI output; without a run there is nothing to confirm, modify, escalate or dismiss.</div>
      </div>`,
    });
  }

  const existing = r.review ? decisionBlock(r.review) : "";
  const rejected = r.rejected_blank_rationale;
  const degraded = a.record_type === "HUMAN_ASSESSMENT_MODE";
  const defaultAction = degraded ? "MODIFY" : "CONFIRM";
  const defaultCategory = degraded ? "CASE_CONTEXT" : "EVIDENCE_REASSESSED";

  return `
    ${existing ? `<div class="card" style="margin-bottom:var(--sp-4)"><div class="card-body">${existing}</div></div>` : ""}

    ${degraded ? `
    <div class="banner warn" style="margin-bottom:var(--sp-4)">
      <span class="b-icon">${icon("wifiOff", 17)}</span>
      <div>
        <span class="b-title">Human assessment mode</span>
        The AI produced no score, so there is nothing to confirm. Select
        <b>MODIFY</b> and enter the priority yourself — it will be labelled
        <b>HUMAN-ENTERED</b> and attributed to you, never to the AI.
      </div>
    </div>` : ""}

    <div class="banner info" style="margin-bottom:var(--sp-4)">
      <span class="b-icon">${icon("info", 17)}</span>
      <div>
        <span class="b-title">Rationale is mandatory</span>
        Empty or shorter-than-20-character rationales are rejected by the API with
        <code>422 REVIEW_REJECTED</code>. The AI output is never mutated — it is retained and demoted.
        ${rejected ? `<br><span class="warn">Last blank attempt: ${esc(rejected)}</span>` : ""}
      </div>
    </div>

    <section class="card" id="review-form">
      <header class="card-head">
        <h3 class="card-title">${icon("user", 14)} Submit a human decision</h3>
        <div class="card-actions"><span class="badge badge-good">authority HUMAN</span></div>
      </header>
      <div class="card-body">
        <div class="field-grid">
          <label class="field">
            <span class="field-label">Badge ID <span class="req">*</span></span>
            <input class="input" name="badge_id" value="SD-014" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">Role <span class="req">*</span></span>
            <select class="select" name="role">
              <option value="intake_officer">intake_officer</option>
              <option value="safeguarding_lead">safeguarding_lead</option>
              <option value="supervisor">supervisor</option>
              <option value="caseworker">caseworker</option>
            </select>
          </label>
        </div>

        <div class="field-grid">
          <label class="field">
            <span class="field-label">Action <span class="req">*</span></span>
            <select class="select" name="action" id="rv-action">
              ${HUMAN_ACTIONS.map((act) => `<option value="${act}" ${act === defaultAction ? "selected" : ""}>${act}</option>`).join("")}
            </select>
          </label>
          <label class="field" id="rv-priority-field" style="${degraded ? "" : "display:none"}">
            <span class="field-label">New priority <span class="req">*</span></span>
            <select class="select" name="new_priority">
              <option value="">— select —</option>
              ${PRIORITIES.map((p) => `<option value="${p}">${p}</option>`).join("")}
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field-label">Justification category <span class="req">*</span></span>
          <select class="select" name="justification_category">
            ${JUSTIFICATION_CATEGORIES.map((c) => `<option value="${c}" ${c === defaultCategory ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </label>

        <label class="field">
          <span class="field-label">Rationale <span class="req">*</span></span>
          <textarea class="textarea" name="rationale" id="rv-rationale"
            placeholder="${degraded
              ? "State what you weighed and why this priority is correct for the transcript in front of you. Minimum 20 characters."
              : "State the reasoning — what you weighed, what the AI could not see, and why this priority is correct. Minimum 20 characters."}"></textarea>
          <span class="counter" id="rv-counter">
            <span class="bar"><i></i></span>
            <span class="rv-count">0 / 20 min</span>
          </span>
        </label>

        <div class="row-wrap" style="margin-top:6px">
          <button class="btn btn-good btn-lg" data-act="submit-review">${icon("save", 15)} Record human decision</button>
          <span class="text-xs faint">Downstream action will be attributed to <b>HUMAN_REVIEWER</b>.</span>
        </div>

        <div class="form-error hidden" id="rv-error"></div>
      </div>
      <footer class="card-foot">
        Allowed actions: ${HUMAN_ACTIONS.join(" · ")} — downstream
        ${Object.entries(DOWNSTREAM_ACTIONS).map(([k, v]) => `<code>${k}→${v}</code>`).join(" ")}
      </footer>
    </section>`;
}

/* ── Main render ───────────────────────────────────────────────────────── */

export function render(ctx) {
  const { state } = ctx;
  const fixtures = state.fixtures || [];
  const selected = state.route.param || fixtures[0]?.id || null;
  const f = fixtures.find((x) => x.id === selected) || fixtures[0];
  const r = f ? getResult(f.id) : { status: "idle" };
  const a = r.assessment;

  const s = stats();

  const main = f ? (() => {
    const tabs = [
      ["evidence", "Evidence & gaps", "quote", a ? (a.evidence_attribution?.length || 0) : 0],
      ["meta", "Language & audio", "book", 0],
      ["trajectory", "Trajectory", "trending", a?.trajectory ? 1 : 0],
      ["review", "Human review", "user", r.review ? 1 : 0],
      ["raw", "Raw payload", "terminal", 0],
    ];

    const panes = {
      evidence: `<div class="grid cols-2">
          <div class="span-2">${evidencePanel(a, evFilter)}</div>
          ${gapCard(a)}
          ${limitationsCard(a)}
        </div>`,
      meta: metaCard(a) || "",
      trajectory: trajectoryPanel(a),
      review: reviewForm(f, r),
      raw: `
        <div class="grid cols-2">
          ${card({ title: "Assessment payload", iconName: "terminal", body: a ? jsonDetails(a, "assessment.json", true) : `<p class="text-xs muted">Not run.</p>` })}
          ${card({
            title: "Review record", iconName: "terminal",
            body: r.review
              ? `${jsonDetails(r.review, "review.json", true)}
                 ${r.rejected_blank_rationale ? `<p class="text-xs warn" style="margin-top:10px">Blank-rationale probe: ${esc(r.rejected_blank_rationale)}</p>` : ""}`
              : `<p class="text-xs muted">No review recorded yet.${r.rejected_blank_rationale ? ` Blank-rationale probe: ${esc(r.rejected_blank_rationale)}` : ""}</p>`,
          })}
        </div>`,
    };

    return `
      <div class="case-layout">
        <aside class="case-rail">${railHtml(ctx)}</aside>

        <div class="case-main">
          <div class="run-strip">
            <span class="badge ${r.status === "done" ? "badge-good" : r.status === "running" ? "badge-accent" : r.status === "error" ? "badge-danger" : "badge-neutral"}">
              ${esc(r.status || "idle")}
            </span>
            <span>${esc(f.criteria?.join(" · ") || "")}</span>
            <span class="spacer"></span>
            <span class="mono">${s.done}/${s.total} suite</span>
            <span class="progress-bar"><i style="width:${s.total ? (s.done / s.total) * 100 : 0}%"></i></span>
          </div>

          ${verdictHtml(ctx, f, r)}

          ${a ? overrideBanner(a) : ""}
          ${a ? abstainBanner(a) : ""}
          ${a ? conflictCard(a) : ""}
          ${a ? anomalyCard(a) : ""}

          ${a?.record_type === "HUMAN_ASSESSMENT_MODE" ? degradedPanel(a) : `
          <div class="grid cols-2">
            <div>${card({ title: "Dimension scores", iconName: "layers", body: a ? dimCards(a) : placeholder(3) })}</div>
            <div>${a ? epistemicCard(a) : placeholder(5)}</div>
            <div class="span-2">${a ? actionCard(a) : placeholder(2)}</div>
          </div>`}

          <div class="tabs" role="tablist">
            ${tabs.map(([id, lbl, ic, n]) => `
              <button class="tab" role="tab" data-tab="${id}" aria-selected="${activeTab === id}">
                ${icon(ic, 14)} ${esc(lbl)} ${n ? `<span class="tab-n">${n}</span>` : ""}
              </button>`).join("")}
          </div>

          <div id="tab-pane" role="tabpanel">${panes[activeTab] || ""}</div>
        </div>
      </div>`;
  })() : `<div class="empty"><span class="e-icon">${icon("cases", 22)}</span>
      <div class="e-title">No fixtures loaded</div>
      <div class="e-sub">Start the API with <code>npm start</code>.</div></div>`;

  return {
    html: `
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Case <span class="grad">workspace</span></h1>
            <p class="page-sub">Fourteen synthetic fixtures across five dimensions. Every number below traces back to a quoted span.</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-ghost" data-act="run-all" ${state.suite.running ? "disabled" : ""}>
              ${state.suite.running ? `<span class="spinner"></span> ${state.suite.done}/${state.suite.total}` : `${icon("play", 14)} Run suite`}
            </button>
          </div>
        </div>
        ${main}
      </div>`,
    wire(root) {
      playMeters(root);

      on(root, "click", "[data-case]", (e, btn) => ctx.go("cases", btn.dataset.case));
      on(root, "click", '[data-act="run"]', () => ctx.runFixture(f.id));
      on(root, "click", '[data-act="run-all"]', () => ctx.runAll());

      on(root, "click", "[data-cat]", (e, btn) => {
        categoryFilter = btn.dataset.cat;
        rerender(ctx);
      });

      const searchEl = qs("#case-search", root);
      if (searchEl) {
        searchEl.addEventListener("input", debounce(() => {
          search = searchEl.value;
          rerender(ctx);
          const again = qs("#case-search");
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 180));
      }

      const repaintPane = () => {
        const pane = qs("#tab-pane", root);
        if (!pane) return;
        pane.innerHTML = paneHtml(ctx);
        playMeters(pane);
      };

      on(root, "click", "[data-tab]", (e, btn) => {
        activeTab = btn.dataset.tab;
        qsa("[data-tab]", root).forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === activeTab)));
        repaintPane();
      });

      on(root, "click", "[data-ev-filter]", (e, btn) => {
        evFilter = btn.dataset.evFilter;
        repaintPane();
      });

      wirePane(ctx, root, repaintPane);
    },
  };

  function paneHtml(c) {
    const fx = (c.state.fixtures || []).find((x) => x.id === (c.state.route.param || c.state.fixtures?.[0]?.id));
    const rr = fx ? getResult(fx.id) : { status: "idle" };
    const assessment = rr.assessment;
    const panes = {
      evidence: `<div class="grid cols-2">
          <div class="span-2">${evidencePanel(assessment, evFilter)}</div>
          ${gapCard(assessment)}
          ${limitationsCard(assessment)}
        </div>`,
      meta: metaCard(assessment) || "",
      trajectory: trajectoryPanel(assessment),
      review: reviewForm(fx, rr),
      raw: `
        <div class="grid cols-2">
          ${card({ title: "Assessment payload", iconName: "terminal", body: assessment ? jsonDetails(assessment, "assessment.json", true) : `<p class="text-xs muted">Not run.</p>` })}
          ${card({
            title: "Review record", iconName: "terminal",
            body: rr.review
              ? `${jsonDetails(rr.review, "review.json", true)}
                 ${rr.rejected_blank_rationale ? `<p class="text-xs warn" style="margin-top:10px">Blank-rationale probe: ${esc(rr.rejected_blank_rationale)}</p>` : ""}`
              : `<p class="text-xs muted">No review recorded yet.${rr.rejected_blank_rationale ? ` Blank-rationale probe: ${esc(rr.rejected_blank_rationale)}` : ""}</p>`,
          })}
        </div>`,
    };
    return panes[activeTab] || "";
  }
}

function wirePane(ctx, root, repaint) {
  /* ── Live rationale counter ───────────────────────────────────────── */
  const updateCounter = () => {
    const ta = qs("#rv-rationale", root);
    const counter = qs("#rv-counter", root);
    if (!ta || !counter) return;
    const n = ta.value.trim().length;
    counter.classList.toggle("ok", n >= 20);
    const c = qs(".rv-count", counter);
    if (c) c.textContent = `${n} / 20 min`;
    const bar = qs(".bar i", counter);
    if (bar) bar.style.width = `${Math.min(100, (n / 60) * 100)}%`;
    ta.setAttribute("aria-invalid", String(n > 0 && n < 20));
  };

  on(root, "input", "#rv-rationale", updateCounter);

  /* ── new_priority only exists for MODIFY / ESCALATE ───────────────── */
  const syncPriorityField = () => {
    const sel = qs("#rv-action", root);
    const field = qs("#rv-priority-field", root);
    if (!sel || !field) return;
    const needs = sel.value === "MODIFY" || sel.value === "ESCALATE";
    field.style.display = needs ? "" : "none";
  };
  on(root, "change", "#rv-action", syncPriorityField);

  /* ── Submit ───────────────────────────────────────────────────────── */
  on(root, "click", '[data-act="submit-review"]', async (e, btn) => {
    const form = qs("#review-form", root);
    const err = qs("#rv-error", root);
    if (!form || !err) return;

    const get = (n) => qs(`[name="${n}"]`, form)?.value?.trim() ?? "";
    const rationale = get("rationale");
    const action = get("action");

    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove("hidden");
      qs("#rv-rationale", form)?.setAttribute("aria-invalid", "true");
    };

    if (rationale.length < 20) {
      return fail(
        `RATIONALE_TOO_SHORT: ${rationale.length} characters. ` +
        `A rationale must state the reasoning, not just assert a conclusion (minimum 20).`
      );
    }
    if ((action === "MODIFY" || action === "ESCALATE") && !get("new_priority")) {
      return fail(`new_priority is required when action is ${action}.`);
    }
    err.classList.add("hidden");

    btn.classList.add("loading");
    try {
      const id = ctx.state.route.param || ctx.state.fixtures?.[0]?.id;
      await ctx.submitReview(id, {
        action,
        badge_id: get("badge_id"),
        role: get("role"),
        rationale,
        justification_category: get("justification_category"),
        ...(action === "MODIFY" || action === "ESCALATE" ? { new_priority: get("new_priority") } : {}),
      });
      activeTab = "review";
      repaint();
      // Re-wire the freshly rendered pane's counter state.
      updateCounter();
      syncPriorityField();
    } catch (ex) {
      btn.classList.remove("loading");
      fail(ex.message);
    }
  });
}

function placeholder(lines) {
  return `<div>${Array.from({ length: lines })
    .map((_, i) => `<div class="skel skel-line" style="width:${90 - i * 12}%"></div>`)
    .join("")}</div>`;
}

function rerender(ctx) {
  ctx.rerender();
}
