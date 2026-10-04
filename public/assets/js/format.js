/* ==========================================================================
   Sahaara AI — formatters and colour mapping
   ========================================================================== */

import { esc } from "./dom.js";

/** 0.6831 → "68.3%" ; null → "—" */
export function pct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Raw score with fixed precision; null-safe. */
export function num(n, digits = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

/** Verbose UTC timestamp → local HH:MM:SS. */
export function clock(iso, { seconds = true } = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

/** Relative time for feeds. */
export function ago(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Full local timestamp for tooltips/audit rows. */
export function stamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

/** 0xabcdef… → first/last slices for hash display. */
export function shortHash(h, head = 10, tail = 6) {
  if (!h) return "—";
  if (h === "GENESIS") return "GENESIS";
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function duration(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/* ── Semantic colour mapping ──────────────────────────────────────────── */

/** §5.1 operational priority vocabulary (+ TC-10's qualifier). */
export const PRIORITIES = [
  "CRITICAL_IMMEDIATE_DANGER",
  "CRITICAL_SELF_HARM_PATHWAY",
  "HIGH_SAFETY_REVIEW",
  "MODERATE_PSYCHOSOCIAL_SUPPORT",
  "LOW",
  "ELEVATED_HUMAN_VERIFICATION_REQUIRED",
  "HUMAN_ASSESSMENT_REQUIRED",
];

const PRIORITY_TONE = {
  CRITICAL_IMMEDIATE_DANGER: "red",
  CRITICAL_SELF_HARM_PATHWAY: "red",
  HIGH_SAFETY_REVIEW: "amber",
  MODERATE_PSYCHOSOCIAL_SUPPORT: "cyan",
  LOW: "green",
  ELEVATED_HUMAN_VERIFICATION_REQUIRED: "violet",
  HUMAN_ASSESSMENT_REQUIRED: "violet",
  DISMISSED_BY_HUMAN: "violet",
  null: "violet",
};

/** Class suffix for `.verdict-prio` / `.badge`. */
export function tone(priority) {
  return PRIORITY_TONE[priority] || (priority === null ? "violet" : "cyan");
}

/** badge colour class for an operational priority. */
export function priorityBadge(priority) {
  switch (PRIORITY_TONE[priority]) {
    case "red": return "badge-danger";
    case "amber": return "badge-warn";
    case "green": return "badge-good";
    case "violet": return "badge-violet";
    default: return "badge-accent";
  }
}

/** Colour class for a dimension level / band. */
export function levelClass(level) {
  switch (level) {
    case "CRITICAL": case "HIGH": case "HIGH_RISK": case "EXTREME_LETHALITY_RISK": return "hi";
    case "MODERATE": case "ELEVATED": case "LOW": return level === "LOW" ? "lo" : "mid";
    case "SAFE": case "NONE": return "lo";
    case "UNKNOWN": case "INSUFFICIENT_EVIDENCE": case "NOT_APPLICABLE": case "UNDETERMINED": return "unk";
    default: return "";
  }
}

/** Colour class for a safety band (dimension level for safety). */
export function bandClass(band) {
  if (band === "EXTREME_LETHALITY_RISK" || band === "HIGH_RISK" || band === "CRITICAL" || band === "HIGH") return "danger";
  if (band === "LOW" || band === "MODERATE") return "warn";
  if (band === "SAFE" || band === "NONE") return "good";
  return "muted";
}

/** Human-facing label for a confidence code. */
export function confidenceLabel(c) {
  if (!c) return "—";
  return String(c).replace(/_/g, " ");
}

/** Is this priority an override / crisis state? */
export function isCritical(priority) {
  return typeof priority === "string" && priority.startsWith("CRITICAL_");
}

/** Safe inner-HTML escape of a transcript turn. */
export function quote(text, lang) {
  const langAttr = lang && lang !== "en" ? ` lang="${esc(lang)}"` : "";
  return `<span${langAttr}>${esc(text)}</span>`;
}

/** Pretty-print an object as JSON inside a <details> block. */
export function jsonDetails(obj, label = "Raw JSON", open = false) {
  return `<details class="json"${open ? " open" : ""}>
    <summary>${esc(label)}</summary>
    <pre>${esc(JSON.stringify(obj, null, 2))}</pre>
  </details>`;
}

/** Kebab/constant case → "Readable Label". */
export function label(s) {
  if (!s) return "—";
  return String(s)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
