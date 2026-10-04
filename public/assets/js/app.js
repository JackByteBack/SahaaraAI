/* ==========================================================================
   Sahaara AI — application shell
   Boots the store, the router, the top bar / rail / status bar, the health
   poller and the command palette, then hands a context object to each view.
   ========================================================================== */

import { qs, qsa, on, setHTML, esc, copyText, mount } from "./dom.js";
import { icon } from "./icons.js";
import { api, ApiError } from "./api.js";
import { toast } from "./toasts.js";
import {
  getState, setRoute, setHealth, setFixtures, setResult, setAudit,
  setSuite, markBooted, loadResults, loadRoute, subscribe, stats, getResult,
} from "./store.js";
import { openPalette, closePalette, paletteKeys, setCommands, bindPaletteChrome } from "./palette.js";
import { shortHash, clock, ago } from "./format.js";
import { sparkline } from "./charts.js";

import * as overview from "./views/overview.js";
import * as cases from "./views/cases.js";
import * as audit from "./views/audit.js";
import * as service from "./views/service.js";

const VIEWS = {
  overview: { module: overview, label: "Overview", icon: "overview" },
  cases: { module: cases, label: "Case workspace", icon: "cases" },
  audit: { module: audit, label: "Audit chain", icon: "audit" },
  service: { module: service, label: "Degradation lab", icon: "service" },
};

const state = getState();

/* ── Theme ─────────────────────────────────────────────────────────────── */

const THEME_KEY = "sahaara.theme";

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(next) {
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  render();
  toast({
    type: "info",
    title: next === "dark" ? "Dark theme" : "Light theme",
    body: next === "dark"
      ? "Vercel dark console palette — #0a0a0a canvas."
      : "Geist light — #171717 ink on a #fafafa canvas.",
  });
}

/* ── Router ────────────────────────────────────────────────────────────── */

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [view, param] = raw.split("/");
  const key = VIEWS[view] ? view : "overview";
  return { view: key, param: param ? decodeURIComponent(param) : null };
}

function writeHash(route) {
  const h = `#/${route.view}${route.param ? `/${encodeURIComponent(route.param)}` : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

function go(view, param = null) {
  const route = { view: VIEWS[view] ? view : "overview", param };
  writeHash(route);
  setRoute(route);
  render();
}

window.addEventListener("hashchange", () => {
  const r = parseHash();
  if (r.view !== state.route.view || r.param !== state.route.param) {
    setRoute(r, { persist: false });
    render();
  }
});

/* ── Rendering ─────────────────────────────────────────────────────────── */

function currentView() {
  return VIEWS[state.route.view] || VIEWS.overview;
}

let lastRenderKey = null;

function render() {
  const view = currentView();
  document.title = `${view.label} · Sahaara AI`;

  const body = state.health?.model_service;
  const critical = body?.fallback_active ? "degraded" : "none";
  document.body.dataset.alert = critical;

  renderRail();
  renderTopbar();
  renderStatusbar();

  const main = qs("#main");
  const key = `${state.route.view}/${state.route.param ?? ""}`;
  const sameView = key === lastRenderKey;
  const keepScroll = sameView ? main.scrollTop : 0;

  try {
    mount(main, view.module.render(ctx));
  } catch (err) {
    console.error("[view]", err);
    setHTML(main, `<div class="page"><div class="banner crit">
      <span class="b-icon">${icon("octagon", 18)}</span>
      <div><span class="b-title">Render error</span><pre style="white-space:pre-wrap">${esc(err.stack || err.message)}</pre></div>
    </div></div>`);
  }

  if (sameView) main.scrollTop = keepScroll;
  lastRenderKey = key;
}

function renderRail() {
  const s = stats();
  const rail = qs("#rail");
  setHTML(rail, `
    <div class="rail-label">Console</div>
    ${Object.entries(VIEWS).map(([key, v]) => `
      <button class="rail-item" data-nav="${key}" aria-current="${state.route.view === key ? "page" : "false"}">
        ${icon(v.icon, 17)}
        <span class="rail-text">${esc(v.label)}</span>
        ${key === "cases" ? `<span class="rail-count">${s.done}/${s.total}</span>` : ""}
        ${key === "audit" && s.auditEntries ? `<span class="rail-count">${s.auditEntries}</span>` : ""}
      </button>`).join("")}

    <div class="rail-foot">
      <div class="rail-note">
        Synthetic fixtures only. Never substitute live case data.<br><br>
        Non-diagnostic: this console never emits a psychiatric label.
      </div>
      <button class="rail-item" data-nav="palette">
        ${icon("keyboard", 17)}<span class="rail-text">Command palette</span>
        <span class="rail-count">⌘K</span>
      </button>
    </div>`);
}

/** Bound once — the rail / topbar elements persist across renders. */
function bindShell() {
  on(qs("#rail"), "click", "[data-nav]", (e, btn) => {
    if (btn.dataset.nav === "palette") return openPalette();
    go(btn.dataset.nav);
  });

  const bar = qs("#topbar");
  on(bar, "click", '[data-top="palette"]', () => openPalette());
  on(bar, "click", '[data-top="run"]', () => runAll());
  on(bar, "click", '[data-top="theme"]', () => toggleTheme());
}

function renderTopbar() {
  const view = currentView();
  const svc = state.health?.model_service || {};
  const degraded = !!svc.fallback_active;
  const running = state.suite.running;

  const bar = qs("#topbar");
  setHTML(bar, `
    <div class="brand">
      <span class="brand-mark">
        <svg width="17" height="17" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M7 22V10l9 7 9-7v12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span>
        <span class="brand-name">Sahaara<em>AI</em></span><br>
        <span class="brand-sub">case intelligence console</span>
      </span>
    </div>

    <span class="topbar-sep"></span>

    <nav class="crumbs" aria-label="Breadcrumb">
      <span>${esc(view.label)}</span>
      ${state.route.param ? `<span class="slash">/</span><b>${esc(state.route.param)}</b>` : ""}
    </nav>

    <div class="topbar-actions">
      <span class="pill ${degraded ? "bad" : "ok"}" title="Model service state">
        <span class="dot ${degraded ? "dot-danger" : "dot-good"}"></span>
        ${esc(svc.state || "…")}
      </span>

      <button class="btn btn-ghost btn-sm" data-top="palette" title="Command palette (⌘K)">
        ${icon("search", 14)} <span class="muted">Search</span>
        <kbd style="font:inherit;font-size:10px;opacity:.7;margin-left:4px">⌘K</kbd>
      </button>

      <button class="btn btn-ghost btn-icon btn-sm" data-top="theme"
        title="Toggle theme (current: ${currentTheme()})"
        aria-label="Switch to ${currentTheme() === "dark" ? "light" : "dark"} theme">
        ${icon(currentTheme() === "dark" ? "sun" : "moon", 15)}
      </button>

      <button class="btn btn-primary btn-sm" data-top="run"
        aria-label="Run the full 14-case suite" title="Run the full 14-case suite" ${running ? "disabled" : ""}>
        ${running
          ? `<span class="spinner"></span><span class="topbar-run-label">${state.suite.done}/${state.suite.total}</span>`
          : `${icon("play", 13)}<span class="topbar-run-label">Run suite</span>`}
      </button>
    </div>`);
}

function renderStatusbar() {
  const s = stats();
  const h = state.health;
  const svc = h?.model_service || {};
  const bar = qs("#statusbar");
  setHTML(bar, `
    <span class="sb-item">${icon("terminal", 11)} api <b>${h ? "connected" : "…"}</b></span>
    <span class="sb-sep"></span>
    <span class="sb-item">${icon("database", 11)} db <b style="color:${h?.database?.ok ? "var(--good)" : "var(--danger)"}">${h?.database?.ok ? `${h.database.tables} tables` : "offline"}</b></span>
    <span class="sb-sep sb-hide"></span>
    <span class="sb-item sb-hide">${icon("audit", 11)} chain <b>${s.auditEntries}</b> · head <b>${shortHash(state.audit?.head)}</b></span>
    <span class="sb-sep sb-hide"></span>
    <span class="sb-item sb-hide">${icon("checkCircle", 11)} suite <b>${s.passed}/${s.total}</b></span>

    <span class="sb-right">
      <span class="sb-item sb-hide">${icon("cpu", 11)} <b>${esc(svc.state || "…")}</b></span>
      <span class="sb-item sb-hide">${svc.last_checked_at ? ago(svc.last_checked_at) : "—"}</span>
      <span class="sb-item"><kbd>⌘K</kbd> commands</span>
    </span>`);
}

/**
 * Patch the live readouts in place — sparklines, audit feed — instead of
 * re-rendering the whole view. Keeps the trace growing and the feed honest
 * without collapsing open <details>, dropping focus or moving scroll.
 */
function refreshLive() {
  document.querySelectorAll("[data-spark]").forEach((host) => {
    host.innerHTML = sparkline(getState().healthHistory);
  });
  if (state.route.view === "overview") {
    const feed = document.querySelector("[data-feed]");
    if (feed) feed.innerHTML = overview.feedBody(state.audit);
  }
}

/* ── Data loading ──────────────────────────────────────────────────────── */

async function refreshHealth() {
  try {
    setHealth(await api.health());
  } catch (err) {
    console.warn("[health]", err.message);
  }
}

async function refreshFixtures() {
  try {
    setFixtures(await api.fixtures());
  } catch (err) {
    toast({ type: "err", title: "Fixture catalogue unavailable", body: err.message });
  }
}

async function refreshAudit() {
  try {
    setAudit(await api.audit());
  } catch (err) {
    console.warn("[audit]", err.message);
  }
}

/* ── Actions ───────────────────────────────────────────────────────────── */

async function runFixture(id) {
  const prev = getResult(id);
  if (prev.status === "running") return;
  setResult(id, { status: "running", error: null });
  render();

  const t0 = performance.now();
  try {
    const res = await api.runFixture(id);
    setResult(id, {
      status: "done",
      ms: performance.now() - t0,
      assessment: res.assessment,
      review: res.review,
      rejected_blank_rationale: res.rejected_blank_rationale,
      fixture: res.fixture,
      runs: (prev.runs || 0) + 1,
      error: null,
    });
    toast({
      type: "ok",
      title: `${id} complete`,
      body: `${res.assessment.operational_priority ?? res.assessment.record_type} · ${Math.round(performance.now() - t0)}ms`,
    });
  } catch (err) {
    setResult(id, { status: "error", error: err.message });
    toast({ type: "err", title: `${id} failed`, body: err.message });
  }

  await refreshAudit();
  render();
}

async function runAll() {
  if (state.suite.running) return;
  const ids = state.fixtures.map((f) => f.id);
  if (!ids.length) await refreshFixtures();

  const list = state.fixtures.map((f) => f.id);
  setSuite({ running: true, done: 0, total: list.length });
  render();

  for (const id of list) {
    await runFixtureSilently(id);
    setSuite({ done: state.suite.done + 1 });
    render();
  }

  setSuite({ running: false });
  await refreshAudit();
  render();

  const s = stats();
  toast({
    type: s.failing ? "err" : "ok",
    title: s.failing ? `${s.failing} case(s) failing` : "All 14 cases passing",
    body: `${s.done} executed · ${s.auditEntries} audit entries`,
  });
}

async function runFixtureSilently(id) {
  const t0 = performance.now();
  try {
    const res = await api.runFixture(id);
    setResult(id, {
      status: "done",
      ms: performance.now() - t0,
      assessment: res.assessment,
      review: res.review,
      rejected_blank_rationale: res.rejected_blank_rationale,
      fixture: res.fixture,
      runs: (getResult(id).runs || 0) + 1,
      error: null,
    });
  } catch (err) {
    setResult(id, { status: "error", error: err.message });
  }
}

async function submitReview(fixtureId, payload) {
  const r = getResult(fixtureId);
  if (!r.assessment) throw new ApiError("Run the case before reviewing it.", 400, null);

  try {
    const res = await api.review(r.assessment, payload);
    setResult(fixtureId, { review: res.review });
    await refreshAudit();
    toast({
      type: "ok",
      title: "Human decision recorded",
      body: `${payload.action} → ${res.review.human_decision?.operational_priority} · attributed to HUMAN_REVIEWER`,
    });
    render();
    return res;
  } catch (err) {
    if (err.status === 422) {
      toast({ type: "err", title: "Review rejected", body: err.message });
    } else {
      toast({ type: "err", title: "Review failed", body: err.message });
    }
    throw err;
  }
}

async function setService(next) {
  await api.service(next);
  await refreshHealth();
  await refreshAudit();
  render();
}

/* ── Context handed to every view ──────────────────────────────────────── */

const ctx = {
  get state() { return state; },
  go,
  render,
  rerender: render,
  runFixture,
  runAll,
  submitReview,
  setService,
  refreshHealth,
  refreshAudit,
  openPalette,
  toast,
  copy: copyText,
};

/* ── Command palette ───────────────────────────────────────────────────── */

function buildCommands() {
  const cmds = [
    { group: "Navigate", label: "Go to Overview", hint: "G O", icon: "overview", run: () => go("overview") },
    { group: "Navigate", label: "Go to Case workspace", hint: "G C", icon: "cases", run: () => go("cases") },
    { group: "Navigate", label: "Go to Audit chain", hint: "G A", icon: "audit", run: () => go("audit") },
    { group: "Navigate", label: "Go to Degradation lab", hint: "G D", icon: "service", run: () => go("service") },
    { group: "Run", label: "Run the full 14-case suite", hint: "⌘↵", icon: "play", run: () => runAll() },
    { group: "Run", label: "Verify audit chain", icon: "shield", run: async () => { await refreshAudit(); const v = state.audit?.verification; toast({ type: v?.ok ? "ok" : "err", title: v?.ok ? "Chain verified" : "Chain broken", body: v?.ok ? `${v.checked} entries recomputed.` : v.reason }); } },
    { group: "Service", label: "Simulate model-service outage", icon: "wifiOff", run: () => setService("OFFLINE") },
    { group: "Service", label: "Restore model service", icon: "zap", run: () => setService("HEALTHY") },
    { group: "Service", label: "Refresh health", icon: "refresh", run: () => refreshHealth() },
    { group: "Appearance", label: "Toggle light / dark theme", hint: "THEME", icon: "sun", run: () => toggleTheme() },
    { group: "Appearance", label: "Use the dark console theme", hint: "#0a0a0a", icon: "moon", run: () => { applyTheme("dark"); render(); } },
    { group: "Appearance", label: "Use the light Geist theme", hint: "#fafafa", icon: "sun", run: () => { applyTheme("light"); render(); } },
  ];

  for (const f of state.fixtures) {
    cmds.push({
      group: "Cases",
      label: `Run ${f.id} — ${f.title}`,
      hint: (f.criteria || []).join(" "),
      icon: "play",
      run: () => { go("cases", f.id); runFixture(f.id); },
    });
    cmds.push({
      group: "Cases",
      label: `Open ${f.id} — ${f.title}`,
      hint: f.category,
      icon: "chevron",
      run: () => go("cases", f.id),
    });
  }

  setCommands(cmds);
}

/* ── Global keyboard ───────────────────────────────────────────────────── */

let gPending = false;

function bindKeys() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";

    if (paletteKeys(e)) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runAll();
      return;
    }

    if (typing) return;

    if (e.key === "Escape") closePalette();

    if (e.key.toLowerCase() === "g") {
      gPending = true;
      setTimeout(() => { gPending = false; }, 900);
      return;
    }
    if (gPending) {
      const map = { o: "overview", c: "cases", a: "audit", d: "service" };
      const next = map[e.key.toLowerCase()];
      gPending = false;
      if (next) { e.preventDefault(); go(next); }
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      go("cases");
      setTimeout(() => qs("#case-search")?.focus(), 60);
    }
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

async function boot() {
  bindPaletteChrome();
  bindShell();
  bindKeys();

  loadResults();

  const fromHash = parseHash();
  const saved = loadRoute();
  const route = (location.hash && fromHash.view) ? fromHash : (saved || { view: "overview", param: null });
  if (!location.hash) writeHash(route);
  setRoute(route, { persist: false });

  // Render immediately so the shell is up even if the API is slow.
  render();

  await Promise.all([refreshFixtures(), refreshHealth(), refreshAudit()]);
  buildCommands();
  markBooted();
  render();

  // Health poller → status bar, sparkline, degradation banner.
  setInterval(async () => {
    const wasDegraded = !!state.health?.model_service?.fallback_active;
    await refreshHealth();
    const nowDegraded = !!state.health?.model_service?.fallback_active;
    if (wasDegraded !== nowDegraded) {
      toast({
        type: nowDegraded ? "err" : "ok",
        title: nowDegraded ? "Model service degraded" : "Model service restored",
        body: nowDegraded
          ? "New assessments will return HUMAN_ASSESSMENT_MODE."
          : "Normal scoring resumes; prior human decisions are untouched.",
      });
      render();
    } else {
      renderTopbar();
      renderStatusbar();
      refreshLive();
    }
  }, 3000);

  // Audit tail refresh — cheap, keeps the overview feed honest.
  setInterval(async () => {
    await refreshAudit();
    refreshLive();
  }, 12000);
}

subscribe((s, keys) => {
  if (keys.includes("suite") && s.suite.running) return; // handled by runAll
});

boot().catch((err) => {
  console.error("[boot]", err);
  toast({ type: "err", title: "Boot failed", body: err.message });
});
