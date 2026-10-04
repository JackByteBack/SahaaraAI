/* ==========================================================================
   Sahaara AI — hand-rolled SVG charts (no chart library, no build step)
   ========================================================================== */

let uid = 0;
const nextId = () => `g${++uid}`;

/* ── Progress ring ─────────────────────────────────────────────────────── */

/**
 * @param {number} value 0..1
 * @param {number} size  pixel diameter
 */
export function ring(value, size = 190) {
  const id = nextId();
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  const offset = c * (1 - v);

  return `
  <svg class="ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   style="stop-color:var(--cyan)"/>
        <stop offset="55%"  style="stop-color:var(--c-safety)"/>
        <stop offset="100%" style="stop-color:var(--pink)"/>
      </linearGradient>
    </defs>
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-prog" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke="url(#${id})"
      stroke-dasharray="${c.toFixed(2)}"
      stroke-dashoffset="${c.toFixed(2)}"
      data-dash="${offset.toFixed(2)}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r - stroke / 2 - 8}"
      fill="none" style="stroke:var(--surface-hi)" stroke-width="1" stroke-dasharray="2 6"/>
  </svg>`;
}

/** Kick off the ring animation after mount (needs a frame for transition). */
export function playRings(root = document) {
  requestAnimationFrame(() => {
    root.querySelectorAll(".ring-prog[data-dash]").forEach((n) => {
      n.style.strokeDashoffset = n.dataset.dash;
    });
  });
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

/**
 * @param {Array<{t:number, degraded:boolean}>} samples
 * @param {{w?:number, h?:number}} opts
 */
export function sparkline(samples, { w = 420, h = 56 } = {}) {
  const id = nextId();
  if (!samples || samples.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle"
        style="fill:var(--faint);font:500 11px var(--mono)">awaiting samples…</text></svg>`;
  }

  const n = samples.length;
  const minT = samples[0].t;
  const maxT = samples[n - 1].t || minT + 1;
  const span = Math.max(1, maxT - minT);

  const x = (i) => (i / (n - 1)) * (w - 4) + 2;
  // Healthy sits low, degraded sits high — a step function reads as uptime.
  const y = (s) => (s.degraded ? h * 0.22 : h * 0.78);

  const pts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${w - 2},${h} L2,${h} Z`;

  const last = samples[n - 1];
  const lastX = x(n - 1);
  const lastY = y(last);

  // `var()` inside inline style follows the active theme with no re-render.
  const tone = last.degraded ? "var(--c-bad)" : "var(--c-ok)";

  return `
  <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style="stop-color:${tone};stop-opacity:.32"/>
        <stop offset="100%" style="stop-color:${tone};stop-opacity:0"/>
      </linearGradient>
    </defs>
    <line x1="2" y1="${h * 0.78}" x2="${w - 2}" y2="${h * 0.78}"
      style="stroke:var(--c-grid)" stroke-width="1" stroke-dasharray="3 5"/>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" style="stroke:${tone}"
      stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="${tone}"/>
  </svg>`;
}

/**
 * Sparkline wrapped in a live host. `app.js` repaints every `[data-spark]`
 * node on each health poll, so the trace keeps growing without a full
 * re-render (which would reset filters, focus and scroll position).
 *
 * @param {Array<{t:number, degraded:boolean}>} samples
 * @param {{w?:number, h?:number}} opts
 */
export function sparkHost(samples, opts) {
  return `<div class="spark-host" data-spark>${sparkline(samples, opts)}</div>`;
}

/* ── Trajectory slope chart ────────────────────────────────────────────── */

const SERIES_COLOR = {
  psychological_distress: "var(--c-distress)",
  immediate_physical_safety: "var(--c-safety)",
  contextual_vulnerability: "var(--c-vuln)",
};

const SERIES_LABEL = {
  psychological_distress: "Distress",
  immediate_physical_safety: "Safety",
  contextual_vulnerability: "Vulnerability",
};

/**
 * Two-point slope chart: prior session → current session, three dimensions.
 * Scores are risk-scaled, so a downward line is an improvement.
 *
 * @param {object} trajectory  assessment.trajectory  → {dimensions: {key: {from, to}}}
 */
export function slopeChart(trajectory, { w = 640, h = 210 } = {}) {
  const pad = { t: 22, r: 128, b: 34, l: 56 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const rows = Object.keys(SERIES_COLOR);

  const y = (v) => pad.t + ih - Math.max(0, Math.min(1, v)) * ih;
  const xPrev = pad.l;
  const xNow = pad.l + iw;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => `
      <line class="traj-grid-line" x1="${pad.l}" y1="${y(v)}" x2="${xNow}" y2="${y(v)}"/>
      <text class="traj-axis-text" x="${pad.l - 9}" y="${y(v) + 3.5}" text-anchor="end">${v.toFixed(2)}</text>`)
    .join("");

  const paths = rows.map((key) => {
    const d = trajectory?.dimensions?.[key];
    const a = d?.from;
    const b = d?.to;
    if (a === undefined || b === undefined || a === null || b === null) return "";
    const name = SERIES_LABEL[key];
    const color = SERIES_COLOR[key];
    const improved = b < a; // lower is better
    return `
      <g>
        <path class="traj-series" d="M${xPrev},${y(a)} L${xNow},${y(b)}"
          stroke="${color}" stroke-dasharray="${improved ? "none" : "7 4"}"/>
        <circle class="traj-pt" cx="${xPrev}" cy="${y(a)}" r="4.5" stroke="${color}"/>
        <circle class="traj-pt" cx="${xNow}" cy="${y(b)}" r="5.5" stroke="${color}"
          fill="${color}"/>
        <text class="traj-axis-text" x="${xPrev - 9}" y="${y(a) + 3.5}"
          text-anchor="end" style="fill:${color}">${a.toFixed(2)}</text>
        <text class="traj-axis-text" x="${xNow + 12}" y="${y(b) + 3.5}"
          style="fill:${color};font-weight:700">${b.toFixed(2)}</text>
        <text class="traj-axis-text" x="${xNow + 56}" y="${y(b) + 3.5}"
          style="fill:var(--faint)">${name}</text>
      </g>`;
  }).join("");

  return `
  <svg class="traj-chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="Risk score trajectory from prior session to current session">
    ${grid}
    <line class="traj-grid-line" x1="${xPrev}" y1="${pad.t - 6}" x2="${xPrev}" y2="${pad.t + ih}"
      style="stroke:var(--c-axis)" stroke-opacity=".45"/>
    <line class="traj-grid-line" x1="${xNow}" y1="${pad.t - 6}" x2="${xNow}" y2="${pad.t + ih}"
      style="stroke:var(--c-axis)" stroke-opacity=".45"/>
    <text class="traj-axis-text" x="${xPrev}" y="${h - 12}" text-anchor="middle"
      style="font-weight:700">SESSION N</text>
    <text class="traj-axis-text" x="${xNow}" y="${h - 12}" text-anchor="middle"
      style="font-weight:700">SESSION N+1</text>
    <text class="traj-axis-text" x="${pad.l - 40}" y="${pad.t - 8}"
      style="fill:var(--faint)">risk score (lower = better)</text>
    ${paths}
  </svg>`;
}

/* ── Distribution bar rows (HTML, not SVG) ─────────────────────────────── */

/** @param {Record<string, number>} dist e.g. {"HIGH_RISK": 0.71, "MODERATE_CONCERN": 0.21, ...} */
export function distRows(dist, toneFor) {
  const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="text-xs muted">No distribution reported.</p>`;
  return `<div class="dist">${entries.map(([k, v]) => `
    <div class="dist-row">
      <span class="dr-k">${k.replace(/_/g, " ").slice(0, 14)}</span>
      <span class="meter thin"><i class="meter-fill ${toneFor ? toneFor(k) : ""}" data-w="${(v * 100).toFixed(1)}"></i></span>
      <span class="dr-v">${(v * 100).toFixed(0)}%</span>
    </div>`).join("")}</div>`;
}
