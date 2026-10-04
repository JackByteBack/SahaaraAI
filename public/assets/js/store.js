/* ==========================================================================
   Sahaara AI — tiny observable store
   ========================================================================== */

const LS_RESULTS = "sahaara.results.v1";
const LS_ROUTE = "sahaara.route.v1";

/** Run state for each fixture: idle | running | done | error */
const state = {
  route: { view: "overview", param: null },

  health: null,
  healthHistory: [],       // [{t, degraded, latencyHint}] — polled client-side
  fixtures: [],            // catalogue from GET /api/fixtures
  results: new Map(),      // id → { status, ms, assessment, review, rejected, error }
  audit: null,             // last GET /api/audit payload
  cases: null,             // last GET /api/cases payload
  suite: { running: false, done: 0, total: 0 },
  booted: false,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(keys = []) {
  for (const fn of listeners) {
    try { fn(state, keys); } catch (err) { console.error("[store] listener failed", err); }
  }
}

/* ── Persistence ───────────────────────────────────────────────────────── */

function loadResults() {
  try {
    const raw = localStorage.getItem(LS_RESULTS);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const [id, r] of Object.entries(obj)) {
      if (r && r.status === "done") state.results.set(id, r);
    }
  } catch { /* corrupt storage is not fatal */ }
}

function saveResults() {
  try {
    const obj = {};
    for (const [id, r] of state.results) {
      if (r.status === "done") obj[id] = r;
    }
    localStorage.setItem(LS_RESULTS, JSON.stringify(obj));
  } catch { /* quota — results simply won't survive a reload */ }
}

function loadRoute() {
  try {
    const raw = localStorage.getItem(LS_ROUTE);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

/* ── Mutations ─────────────────────────────────────────────────────────── */

export function setRoute(route, { persist = true } = {}) {
  state.route = route;
  if (persist) {
    try { localStorage.setItem(LS_ROUTE, JSON.stringify(route)); } catch { /* ignore */ }
  }
  emit(["route"]);
}

export function setHealth(health) {
  const prevDegraded = state.health
    ? state.health.model_service?.fallback_active
    : null;
  state.health = health;
  if (health) {
    const degraded = !!health.model_service?.fallback_active;
    state.healthHistory.push({ t: Date.now(), degraded });
    if (state.healthHistory.length > 90) state.healthHistory.shift();
    if (prevDegraded !== null && prevDegraded !== degraded) emit(["health", "degraded-flip"]);
  }
  emit(["health"]);
}

export function setFixtures(list) {
  state.fixtures = list;
  emit(["fixtures"]);
}

export function setResult(id, patch) {
  const prev = state.results.get(id) || { status: "idle" };
  const next = { ...prev, ...patch };
  state.results.set(id, next);
  if (next.status === "done") saveResults();
  emit(["results", id]);
  return next;
}

export function clearResult(id) {
  state.results.delete(id);
  saveResults();
  emit(["results", id]);
}

export function setAudit(audit) {
  state.audit = audit;
  emit(["audit"]);
}

export function setCases(cases) {
  state.cases = cases;
  emit(["cases"]);
}

export function setSuite(patch) {
  state.suite = { ...state.suite, ...patch };
  emit(["suite"]);
}

export function markBooted() {
  state.booted = true;
  emit(["booted"]);
}

/* ── Derived helpers ───────────────────────────────────────────────────── */

export function getResult(id) {
  return state.results.get(id) || { status: "idle" };
}

export function stats() {
  const fixtures = state.fixtures;
  const done = fixtures.filter((f) => state.results.get(f.id)?.status === "done");
  const failing = done.filter((f) => {
    const r = state.results.get(f.id);
    return r.checksTotal !== undefined && r.checksPassed !== r.checksTotal;
  });
  return {
    total: fixtures.length,
    done: done.length,
    passed: done.length - failing.length,
    failing: failing.length,
    auditEntries: state.audit?.length ?? state.audit?.entries?.length ?? 0,
  };
}

export { loadResults, loadRoute };
