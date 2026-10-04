/* ==========================================================================
   Sahaara AI — shared view fragments
   Every function returns an HTML string.
   ========================================================================== */

import { esc } from "../dom.js";
import { icon } from "../icons.js";
import {
  num, pct, clock, label, jsonDetails, levelClass, bandClass,
  priorityBadge, tone, confidenceLabel,
} from "../format.js";
import { distRows, slopeChart } from "../charts.js";

export const DIMS = [
  { key: "psychological_distress", label: "Psychological Distress", icon: "sparkles" },
  { key: "immediate_physical_safety", label: "Immediate Physical Safety", icon: "shield" },
  { key: "contextual_vulnerability", label: "Contextual Vulnerability", icon: "compass" },
];

export const PRIORITIES = [
  "CRITICAL_IMMEDIATE_DANGER",
  "CRITICAL_SELF_HARM_PATHWAY",
  "HIGH_SAFETY_REVIEW",
  "MODERATE_PSYCHOSOCIAL_SUPPORT",
  "LOW",
  "ELEVATED_HUMAN_VERIFICATION_REQUIRED",
  "HUMAN_ASSESSMENT_REQUIRED",
];

export const HUMAN_ACTIONS = ["CONFIRM", "MODIFY", "ESCALATE", "DISMISS"];

export const JUSTIFICATION_CATEGORIES = [
  "NEW_FACTS_EXTERNAL", "CASE_CONTEXT", "EVIDENCE_REASSESSED",
  "LANGUAGE_OR_CULTURE", "DUPLICATE_OR_RESOLVED", "OTHER",
];

export const DOWNSTREAM_ACTIONS = {
  CONFIRM: "PROCEED_PER_AI_RECOMMENDATION",
  MODIFY: "PROCEED_PER_HUMAN_DECISION",
  ESCALATE: "ESCALATE_TO_SUPERVISOR_ON_CALL",
  DISMISS: "CLOSE_WITH_HUMAN_RATIONALE",
};

/* ── Generic card shell ────────────────────────────────────────────────── */

export function card({ title, iconName, actions = "", body = "", foot = "", cls = "", id = "" }) {
  return `<section class="card ${cls}"${id ? ` id="${esc(id)}"` : ""}>
    ${title ? `<header class="card-head">
      <h3 class="card-title">${iconName ? icon(iconName, 14) : ""}${esc(title)}</h3>
      ${actions ? `<div class="card-actions">${actions}</div>` : ""}
    </header>` : ""}
    <div class="card-body">${body}</div>
    ${foot ? `<footer class="card-foot">${foot}</footer>` : ""}
  </section>`;
}

/* ── Dimension readouts ────────────────────────────────────────────────── */

export function dimCards(a) {
  const dims = a?.multidimensional_assessment || {};
  return `<div class="dim-grid" data-stagger>${DIMS.map((def, i) => {
    const d = dims[def.key] || {};
    const abstained = d.score === null || d.score === undefined;
    const contributions = d.contributions || [];
    const applied = contributions.filter((c) => c.applied).length;
    const cls = levelClass(d.level);

    return `<div class="dim-card" style="--i:${i}">
      <div class="dim-head">
        ${icon(def.icon, 15)}
        <span class="dim-name">${esc(def.label)}</span>
        <span class="dim-level ${cls}">${esc(d.level ?? "—")}</span>
      </div>
      ${abstained
        ? `<div class="meter"><span class="meter-fill ghost"></span></div>`
        : `<div class="meter"><i class="meter-fill risk" data-w="${(d.score * 100).toFixed(1)}"></i></div>`}
      <div class="dim-foot">
        <span>score <b class="${abstained ? "" : ""}" style="color:var(--text)">${abstained ? "ABSTAINED" : num(d.score, 3)}</b></span>
        <span>conf <b style="color:var(--text)">${esc(confidenceLabel(d.confidence))}</b></span>
        <span class="right">${abstained ? "no score emitted" : `${applied}/${contributions.length} signals`}</span>
      </div>
      ${abstained ? `<p class="text-xs muted" style="margin-top:7px">${esc(d.suppressed_reason || "insufficient evidence")} — score is null, not zero.</p>` : ""}
    </div>`;
  }).join("")}</div>`;
}

/* ── Epistemic state ───────────────────────────────────────────────────── */

export function epistemicCard(a) {
  const u = a?.uncertainty_state || {};
  const es = u.evidence_quality_score ?? 0;
  const theta = u.threshold ?? 0.65;
  const zoneSafe = theta * 100;

  const terms = u.terms || {};
  const note = u.confidence_reduction?.applied
    ? `<div class="banner info" style="margin-top:12px">
         <span class="b-icon">${icon("info", 16)}</span>
         <div><span class="b-title">Confidence reduced</span>${esc(u.confidence_reduction.note || "")}</div>
       </div>`
    : "";

  const STATE_TONE = {
    NOMINAL: "badge-good",
    CONFLICT: "badge-magenta",
    ABSTAIN: "badge-danger",
    AMBIGUOUS: "badge-violet",
  };

  const body = `
    <div class="row-wrap" style="margin-bottom:12px">
      <span class="badge ${STATE_TONE[u.state] || "badge-violet"}">${esc(u.state || "—")}</span>
      <span class="badge badge-neutral">confidence ${esc(u.confidence_label ?? "—")}</span>
      ${u.abstention && u.state !== "ABSTAIN" ? `<span class="badge badge-danger">ABSTAINED</span>` : ""}
      ${u.conflicting_evidence && u.state !== "CONFLICT" ? `<span class="badge badge-magenta">CONFLICT</span>` : ""}
      ${es < theta && u.state !== "ABSTAIN" ? `<span class="badge badge-warn">Es &lt; θ</span>` : ""}
    </div>

    <div class="gauge">
      <div class="gauge-bar">
        <span class="gauge-zone safe" style="left:0;width:${zoneSafe}%"></span>
        <span class="gauge-zone risk" style="left:${zoneSafe}%;right:0"></span>
        <span class="gauge-theta" style="left:${zoneSafe}%"></span>
        <span class="gauge-marker" data-v="${num(es, 3)}" style="left:${(es * 100).toFixed(1)}%"></span>
      </div>
    </div>
    <div class="meter-scale" style="margin-top:19px">
      <span>Es 0.0 — insufficient</span>
      <span>evidence sufficiency vs θ_safe</span>
      <span>1.0 sufficient</span>
    </div>

    <div class="kvs" style="margin-top:14px">
      <span class="kv">substantive <b>${num(terms.substantive, 3)}</b></span>
      <span class="kv">snr <b>${num(terms.snr, 3)}</b></span>
      <span class="kv">uncertainty <b>${num(terms.uncertainty, 3)}</b></span>
      <span class="kv">entropy <b>${num(u.ambiguity_entropy, 3)}</b></span>
      <span class="kv">tokens <b>${u.substantive_tokens ?? "—"}</b></span>
    </div>

    <h4 style="margin-top:18px;color:var(--muted);font-size:var(--fs-3xs);letter-spacing:.14em;text-transform:uppercase">
      Priority distribution</h4>
    <div style="margin-top:9px">${distRows(u.priority_distribution, distTone)}</div>

    ${u.abstention_reason
      ? `<p class="text-xs" style="margin-top:12px;color:var(--violet)">${icon("info", 13)} ${esc(u.abstention_reason)}</p>`
      : ""}
    ${note}`;

  return card({ title: "Epistemic state", iconName: "layers", body });
}

function distTone(k) {
  if (k === "CRITICAL") return "warn";
  if (k === "HIGH") return "warn";
  if (k === "LOW") return "good";
  return "";
}

/* ── Recommended human action ──────────────────────────────────────────── */

export function actionCard(a) {
  const r = a?.recommended_human_action || {};
  const body = `
    <div class="row-wrap" style="gap:9px">
      <span class="badge badge-accent">${esc(r.action_code || "—")}</span>
      <span class="badge ${r.urgency?.includes("IMMEDIATE") ? "badge-danger" : r.urgency?.includes("4_HOURS") || r.urgency?.includes("PROMPT") ? "badge-warn" : "badge-neutral"}">${esc(r.urgency || "—")}</span>
      <span class="badge badge-neutral">queue ${esc(r.queue || "—")}</span>
    </div>
    <p style="margin-top:12px;font-size:var(--fs-xs);line-height:1.65;color:var(--text-2)">${esc(r.description || "")}</p>
    ${r.rationale ? `<p class="text-xs muted" style="margin-top:9px"><b>Why:</b> ${esc(r.rationale)}</p>` : ""}
    <div class="row-wrap" style="margin-top:14px">
      <span class="badge ${r.autonomous_action_taken ? "badge-danger" : "badge-good"}">
        ${r.autonomous_action_taken ? "AUTONOMOUS ACTION TAKEN" : "NO AUTONOMOUS ACTION"}
      </span>
      <span class="badge badge-violet">authority ${esc(r.human_decision_authority || "HUMAN")}</span>
    </div>
    ${r.human_decision ? `<p class="text-xs good" style="margin-top:9px">Human decision on record: ${esc(JSON.stringify(r.human_decision))}</p>` : ""}`;

  return card({ title: "Recommended human action", iconName: "flag", body });
}

/* ── Override / Layer-0 banner ─────────────────────────────────────────── */

export function overrideBanner(a) {
  const o = a?.safety_override;
  if (!o?.active) return "";
  return `<div class="banner crit">
    <span class="b-icon">${icon("octagon", 18)}</span>
    <div>
      <span class="b-title">Layer 0 safety override — ${esc(o.override_code || "TRIPPED")}</span>
      <div>${esc(o.trigger || "")} · bypass normal weighting: <b>${o.bypass_normal_weighting ? "YES" : "NO"}</b>
      · fired at ${esc(o.override_timestamp || "—")}</div>
      ${(o.criteria_detail || []).map((c) => `
        <div style="margin-top:7px;padding-left:11px;border-left:2px solid var(--danger)">
          <b>${esc(c.code)}</b> — ${esc(c.label)} <span class="mono faint">${esc(c.timestamp || "")}</span><br>
          <span style="color:var(--on-danger)">“${esc(c.evidence || "")}”</span>
        </div>`).join("")}
      <p class="text-xs" style="margin-top:9px;opacity:.8">${esc(o.reference_note || "")}</p>
    </div>
  </div>`;
}

/* ── Abstention banner ─────────────────────────────────────────────────── */

export function abstainBanner(a) {
  const u = a?.uncertainty_state;
  if (!u?.abstention) return "";
  const gaps = a?.information_gap_analysis;
  return `<div class="banner" style="background:var(--wash-violet);border-color:var(--violet);color:var(--on-violet)">
    <span class="b-icon" style="color:var(--violet)">${icon("alert", 18)}</span>
    <div>
      <span class="b-title">Abstained — insufficient evidence to classify</span>
      <div>Es ${num(u.evidence_quality_score, 3)} &lt; θ_safe ${num(u.threshold, 2)}${gaps?.missing_critical_data?.length
        ? ` · missing: ${gaps.missing_critical_data.map(esc).join(", ")}`
        : ""}</div>
      <div class="text-xs" style="margin-top:6px;opacity:.9">Scores are <b>null</b>, not zero. No level was forced.</div>
    </div>
  </div>`;
}

/* ── Conflict ──────────────────────────────────────────────────────────── */

export function conflictCard(a) {
  const c = a?.conflict_analysis;
  if (!c?.detected) return "";
  const pair = (c.pairs || [])[0] || {};
  return card({
    title: "Conflicting evidence — both statements retained",
    iconName: "git",
    cls: "glow-danger",
    body: `
      <div class="pair">
        <div class="duel-box human" style="border-color:var(--good)">
          <div class="duel-tag">${icon("shield", 13)} Protective claim · ${esc(pair.statement_safe?.timestamp || "")}</div>
          <div class="ev-quote">“${esc(pair.statement_safe?.quote || "")}”</div>
          <div class="ev-foot"><span class="tag prot">${esc(pair.statement_safe?.signal_id || "")}</span></div>
        </div>
        <div class="pair-vs">THEN</div>
        <div class="duel-box" style="border-color:var(--danger)">
          <div class="duel-tag" style="color:var(--danger)">${icon("alert", 13)} Risk statement · ${esc(pair.statement_risk?.timestamp || "")}</div>
          <div class="ev-quote">“${esc(pair.statement_risk?.quote || "")}”</div>
          <div class="ev-foot">
            <span class="tag risk">${esc(pair.statement_risk?.signal_id || "")}</span>
            <span class="tag">gap ${esc(pair.gap ?? "—")}</span>
          </div>
        </div>
      </div>
      <div class="banner warn" style="margin-top:14px">
        <span class="b-icon">${icon("alert", 16)}</span>
        <div>
          <span class="b-title">${esc(c.state)} · confidence ${num(c.confidence, 2)}</span>
          ${esc(c.note || "")}<br>
          <b>Selected statement: NONE</b> — scope ${esc(c.scope)}.
        </div>
      </div>`,
  });
}

/* ── Anomaly ───────────────────────────────────────────────────────────── */

export function anomalyCard(a) {
  const n = a?.anomaly_analysis;
  if (!n) return "";
  return card({
    title: "Anomaly signal",
    iconName: "eye",
    cls: "glow-warn",
    body: `
      <div class="row-wrap" style="margin-bottom:11px">
        <span class="badge badge-warn">${esc(n.signal_detected)}</span>
        <span class="badge badge-neutral">${esc(n.epistemic_status)}</span>
        <span class="badge badge-neutral">confidence ${num(n.confidence, 2)}</span>
      </div>
      <ul style="list-style:none;padding:0;margin:0;display:grid;gap:7px">
        ${(n.uncertainty_indicators || []).map((s) => `
          <li style="padding:9px 11px;border-radius:8px;background:var(--inset);border:var(--hairline)">
            <b class="mono text-xs accent">${esc(s.type)}</b>
            <div class="text-xs" style="color:var(--text-2);margin-top:3px">${esc(s.description)}</div>
            <div class="mono faint text-xs">${esc(s.timestamp || "")}</div>
          </li>`).join("")}
      </ul>
      ${(n.benign_alternatives || []).length ? `
        <h4 style="margin-top:14px;font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)">Benign alternatives considered</h4>
        <ul class="text-xs" style="color:var(--muted);margin-top:6px">${n.benign_alternatives.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${n.guardrail ? `<div class="banner info" style="margin-top:13px"><span class="b-icon">${icon("info", 16)}</span>
        <div><span class="b-title">Guardrail</span>${esc(n.guardrail)}</div></div>` : ""}`,
  });
}

/* ── Evidence ──────────────────────────────────────────────────────────── */

const ROLE_TAG = {
  incriminating: '<span class="tag risk">risk</span>',
  protective: '<span class="tag prot">protective</span>',
  negated: '<span class="tag">negated</span>',
};

export function evidencePanel(a, filter = "all") {
  const items = a?.evidence_attribution || [];
  const filtered = items.filter((e) => {
    if (filter === "risk") return e.role === "incriminating";
    if (filter === "protective") return e.role === "protective";
    if (filter === "negated") return e.role === "negated";
    if (filter === "mixed") return e.language && e.language !== "en";
    return true;
  });

  const counts = {
    all: items.length,
    risk: items.filter((e) => e.role === "incriminating").length,
    protective: items.filter((e) => e.role === "protective").length,
    negated: items.filter((e) => e.role === "negated").length,
    mixed: items.filter((e) => e.language && e.language !== "en").length,
  };

  const chips = [
    ["all", "All"], ["risk", "Risk"], ["protective", "Protective"],
    ["negated", "Negated"], ["mixed", "Non-English"],
  ].map(([k, lbl]) =>
    `<button class="chip" data-ev-filter="${k}" aria-pressed="${filter === k}">${lbl} <span class="mono">${counts[k]}</span></button>`
  ).join("");

  const list = filtered.length ? `<div class="ev-list" data-stagger>${filtered.map((e, i) => `
    <article class="ev ${e.role === "protective" ? "prot" : e.role === "negated" ? "neutral" : "risk"}" style="--i:${i}">
      <div class="ev-meta">
        <span class="ts">${esc(e.timestamp_offset || "—")}</span>
        <span>${esc(e.speaker || "—")} · ${esc(e.role || "—")}</span>
        <span>w ${num(e.weight, 2)}</span>
        <span>${esc(e.dimension || "")}</span>
        <span class="right">${esc(e.signal_id || "")}</span>
      </div>
      <div class="ev-quote"${e.language && e.language !== "en" ? ` lang="${esc(e.language)}"` : ""}>“${esc(e.quote)}”</div>
      <div class="ev-foot">
        ${ROLE_TAG[e.role] || ""}
        ${e.language && e.language !== "en" ? `<span class="tag mr">${esc(e.language)}</span>` : ""}
        ${e.matched_pattern ? `<span class="tag accent">${esc(String(e.matched_pattern).slice(0, 42))}</span>` : ""}
        <span class="unver" title="Self-reported and not independently verified">
          ${icon("alert", 11)} SELF-REPORTED · NOT INDEPENDENTLY VERIFIED
        </span>
      </div>
    </article>`).join("")}</div>`
    : `<div class="empty">
        <span class="e-icon">${icon("inbox", 22)}</span>
        <div class="e-title">No evidence spans match this filter</div>
        <div class="e-sub">The record contains ${counts.all} span${counts.all === 1 ? "" : "s"} in total.</div>
      </div>`;

  return card({
    title: "Evidence attribution — quote-level provenance",
    iconName: "quote",
    actions: `<span class="badge badge-neutral">${items.length} spans</span>`,
    body: `<div class="row-wrap" style="margin-bottom:13px">${chips}</div>${list}`,
    foot: "Every span is verbatim from the transcript and carries a SELF_REPORTED_NOT_INDEPENDENTLY_VERIFIED label wherever it is rendered.",
    id: "evidence-card",
  });
}

/* ── Information gaps ──────────────────────────────────────────────────── */

export function gapCard(a) {
  const g = a?.information_gap_analysis;
  if (!g) return card({
    title: "Information gaps", iconName: "search",
    body: `<p class="text-xs muted">No critical gap detected — evidence met θ_safe.</p>`,
  });
  return card({
    title: "Information gaps", iconName: "search",
    body: `
      <h4 style="font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--danger)">Missing critical data</h4>
      <ul class="text-xs" style="margin-top:7px;color:var(--text-2)">${(g.missing_critical_data || []).map((m) => `<li>${esc(m)}</li>`).join("") || "<li class='muted'>none</li>"}</ul>
      <h4 style="margin-top:15px;font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)">Suggested human probes</h4>
      <ul class="text-xs" style="margin-top:7px;color:var(--text-2)">${(g.suggested_probes || []).map((p) => `<li>${esc(p)}</li>`).join("") || "<li class='muted'>none</li>"}</ul>
      <div class="kvs" style="margin-top:13px"><span class="kv">data_quality <b>${num(g.data_quality, 3)}</b></span></div>`,
  });
}

/* ── Language / acoustic meta ──────────────────────────────────────────── */

export function metaCard(a) {
  const l = a?.language_metadata || {};
  const ac = a?.acoustic_analysis || {};

  const langBody = `
    <div class="deflist">
      <div class="dl-row"><dt>detected</dt><dd>${esc(l.detected_language ?? l.primary_language ?? "—")}</dd></div>
      <div class="dl-row"><dt>hint</dt><dd>${esc(l.hint ?? l.language_hint ?? "—")}</dd></div>
      <div class="dl-row"><dt>code-switched</dt><dd>${l.code_switched_anywhere
        ? `<span class="badge badge-magenta">YES</span> at ${(l.affected_timestamps || []).map(esc).join(", ")}`
        : `<span class="badge badge-neutral">NO</span>`}</dd></div>
      <div class="dl-row"><dt>script</dt><dd class="mono">${esc(l.script ?? l.dominant_script ?? "—")}</dd></div>
    </div>`;

  const acBody = ac.metrics ? `
    <div class="kvs">
      <span class="kv">jitter <b>${num(ac.metrics.pitch_jitter_pct, 2)}%</b></span>
      <span class="kv">rate <b>${num(ac.metrics.speech_rate_wpm, 0)} wpm</b></span>
      <span class="kv">pause <b>${num(ac.metrics.pause_ratio, 2)}</b></span>
      <span class="kv">hnr <b>${num(ac.metrics.hnr_db, 2)} dB</b></span>
      <span class="kv">shimmer <b>${num(ac.metrics.shimmer_pct, 2)}%</b></span>
      <span class="kv">spl <b>${num(ac.metrics.decibel_spl, 1)}</b></span>
      <span class="kv">snr <b>${num(ac.metrics.snr_db, 1)} dB</b></span>
      <span class="kv">affect <b>${esc(ac.metrics.affect)}</b></span>
    </div>
    ${ac.orthogonality ? `<div class="banner info" style="margin-top:13px">
      <span class="b-icon">${icon("info", 16)}</span>
      <div><span class="b-title">${esc(ac.orthogonality.flag ?? "orthogonality")}</span>
      ${esc(ac.orthogonality.explanation || "")}</div></div>` : ""}
    <div class="kvs" style="margin-top:11px">
      <span class="kv">feeds <b>${esc(ac.contribution_channel)}</b></span>
      <span class="kv">excluded from <b>${(ac.excluded_from || []).join(", ")}</b></span>
    </div>
    <p class="text-xs warn" style="margin-top:9px">${esc(ac.exclusion_rule || "")}</p>`
    : `<p class="text-xs muted">${esc(ac.note || "No acoustic stream supplied.")}</p>`;

  return `<div class="grid cols-2">
    ${card({ title: "Language metadata", iconName: "book", body: langBody })}
    ${card({ title: "Acoustic analysis", iconName: "service", body: acBody })}
  </div>`;
}

/* ── Trajectory ────────────────────────────────────────────────────────── */

export function trajectoryPanel(a) {
  const t = a?.trajectory;
  if (!t) {
    return card({
      title: "Longitudinal trajectory", iconName: "trending",
      body: `<div class="empty" style="padding:30px 16px">
        <span class="e-icon">${icon("trending", 22)}</span>
        <div class="e-title">First session on record</div>
        <div class="e-sub">No prior assessment was supplied, so no delta is computed and nothing is compared.</div>
      </div>`,
    });
  }

  const dimRows = Object.entries(t.dimensions || {}).map(([k, d]) => {
    const arrow = d.arrow || (d.direction === "IMPROVED" ? "↓" : d.direction === "DETERIORATED" ? "↑" : "—");
    const colour = d.direction === "IMPROVED" ? "good" : d.direction === "DETERIORATED" ? "danger" : "muted";
    return `<tr>
      <td>${esc(SERIES_NAME[k] || k)}</td>
      <td class="num">${d.from === null || d.from === undefined ? "—" : num(d.from, 3)}</td>
      <td class="num">${d.to === null || d.to === undefined ? "—" : num(d.to, 3)}</td>
      <td class="num ${colour}">${d.delta === null || d.delta === undefined ? "—" : `${d.delta > 0 ? "+" : ""}${num(d.delta, 3)}`}</td>
      <td class="${colour}"><b>${arrow} ${esc(d.direction)}</b></td>
    </tr>`;
  }).join("");

  const imp = t.improvements || [];
  const con = t.concerns || [];

  const bucket = (title, items, cls, iconId) => `
    <div class="traj-bucket ${cls}">
      <h4>${icon(iconId, 12)} ${esc(title)} · ${items.length}</h4>
      <ul>${items.length ? items.map((i) => `
        <li><span class="lbl">${esc(i.type)}</span><span>${esc(i.key)}</span></li>`).join("")
        : `<li class="muted">none reported</li>`}</ul>
    </div>`;

  const newRisk = t.evidence?.new_risk_evidence || [];

  return card({
    title: "Longitudinal trajectory — session N → N+1",
    iconName: "trending",
    actions: `<span class="badge ${t.priority?.changed ? "badge-warn" : "badge-good"}">
      ${t.priority?.changed ? "PRIORITY CHANGED" : "PRIORITY HELD"}</span>`,
    body: `
      ${slopeChart(t)}
      <div class="traj-legend">
        <span><i style="background:var(--c-distress)"></i>distress</span>
        <span><i style="background:var(--c-safety)"></i>immediate safety</span>
        <span><i style="background:var(--c-vuln)"></i>vulnerability</span>
        <span class="faint">solid = improvement · dashed = deterioration</span>
      </div>

      <div class="table-wrap" style="margin-top:16px">
        <table class="tbl">
          <thead><tr><th>Dimension</th><th>Session N</th><th>N+1</th><th>Δ</th><th>Direction</th></tr></thead>
          <tbody>${dimRows}</tbody>
        </table>
      </div>

      <div class="traj-split" style="margin-top:16px">
        ${bucket("Improvements reported", imp, "up", "check")}
        ${bucket("Concerns reported", con, "down", "alert")}
      </div>

      <div class="deflist" style="margin-top:16px">
        <div class="dl-row"><dt>priority</dt>
          <dd>
            <span class="badge ${priorityBadge(t.priority?.from)}" style="text-decoration:line-through;opacity:.6">${esc(t.priority?.from ?? "—")}</span>
            ${icon("arrowRight", 13)}
            <span class="badge ${priorityBadge(t.priority?.to)}">${esc(t.priority?.to ?? "—")}</span>
            ${t.priority?.downgraded ? `<span class="badge badge-warn" style="margin-left:8px">DOWNGRADE CONSIDERED</span>` : ""}
          </dd></div>
        ${t.priority?.downgrade_blocked ? `<div class="dl-row"><dt>downgrade blocked</dt><dd class="warn">${esc(t.priority.downgrade_blocked)}</dd></div>` : ""}
        ${t.follow_up_action?.watch_condition ? `<div class="dl-row"><dt>watch condition</dt><dd class="mono text-xs accent">${esc(t.follow_up_action.watch_condition)}</dd></div>` : ""}
        <div class="dl-row"><dt>prior record</dt><dd>${esc(t.evidence?.prior_assessment_retained ? "RETAINED — not rewritten" : "—")} · ${t.evidence?.prior_key_evidence?.length ?? 0} key evidence item(s) re-read</dd></div>
        <div class="dl-row"><dt>authority</dt><dd>${esc(t.follow_up_action?.human_decision_authority ?? "HUMAN")} · autonomous action: <b>${t.follow_up_action?.autonomous_action_taken ? "YES" : "NO"}</b></dd></div>
      </div>

      ${newRisk.length ? `
        <h4 style="margin-top:16px;font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--danger)">
          New risk evidence this session — not averaged away by the improvements</h4>
        <div class="ev-list" style="margin-top:8px">${newRisk.map((e) => `
          <article class="ev risk">
            <div class="ev-meta"><span class="ts">${esc(e.timestamp || "—")}</span><span class="right">${esc(e.signal_id || "")}</span></div>
            <div class="ev-quote">“${esc(e.quote)}”</div>
            <div class="ev-foot"><span class="tag risk">new</span><span class="text-xs muted">${esc(e.why_new || "")}</span></div>
          </article>`).join("")}</div>` : ""}`,
    foot: esc(t.priority?.note || ""),
  });
}

const SERIES_NAME = {
  psychological_distress: "Psychological distress",
  immediate_physical_safety: "Immediate physical safety",
  contextual_vulnerability: "Contextual vulnerability",
};

/* ── Limitations + non-diagnostic ──────────────────────────────────────── */

export function limitationsCard(a) {
  const nd = a?.non_diagnostic || {};
  const lim = a?.limitations || [];
  const flags = nd.behavioural_safety_flags || [];

  const body = `
    <div class="banner info" style="margin-bottom:13px">
      <span class="b-icon">${icon("shield", 16)}</span>
      <div><span class="b-title">Non-diagnostic</span>${esc(nd.notice || "")}
      Psychiatric diagnoses generated: <b>${(nd.psychiatric_diagnoses_generated || []).length || "0"}</b></div>
    </div>

    ${flags.length ? `
      <h4 style="font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--warn)">Behavioural safety flags</h4>
      <div class="ev-list" style="margin-top:8px">${flags.map((f) => `
        <article class="ev" style="border-left-color:var(--warn)">
          <div class="ev-meta"><span class="right">${esc(f.flag || f.code || "")}</span></div>
          ${f.label ? `<div class="text-xs" style="color:var(--text-2)">${esc(f.label)}</div>` : ""}
          ${f.description ? `<div class="text-xs muted" style="margin-top:3px">${esc(f.description)}</div>` : ""}
          ${f.evidence ? `<div class="ev-quote text-xs" style="margin-top:6px">“${esc(f.evidence)}”</div>` : ""}
          <div class="ev-foot"><span class="unver">${icon("alert", 11)} SELF-REPORTED · NOT VERIFIED</span></div>
        </article>`).join("")}</div>` : ""}

    <h4 style="margin-top:15px;font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)">Stated limitations</h4>
    <ul class="text-xs" style="margin-top:7px;color:var(--text-2)">${lim.map((l) => `<li>${esc(l)}</li>`).join("") || "<li class='muted'>none</li>"}</ul>

    ${a?.support_factors?.length ? `
      <h4 style="margin-top:15px;font-size:var(--fs-3xs);letter-spacing:.12em;text-transform:uppercase;color:var(--good)">Support factors</h4>
      <div class="row-wrap" style="margin-top:7px">${a.support_factors.map((s) => `<span class="chip chip-static">${esc(typeof s === "string" ? s : s.label || s.factor)}</span>`).join("")}</div>` : ""}`;

  return card({ title: "Limitations & safeguards", iconName: "shield", body });
}

/* ── Human review display ──────────────────────────────────────────────── */

export function decisionBlock(review) {
  if (!review) return "";
  const hd = review.human_decision || {};
  const ai = review.ai_recommendation || {};

  return `<div class="decision">
    <div class="duel">
      <div class="duel-box ai">
        <div class="duel-tag">${icon("cpu", 13)} AI assessment · retained</div>
        <div class="duel-value">${esc(ai.operational_priority ?? "—")}</div>
        <p class="text-xs faint" style="margin-top:7px">${esc(ai.status ?? "")} · ${esc(ai.display ?? "")}
        · confidence ${num(ai.confidence_metric, 3)}</p>
      </div>
      <div class="duel-arrow">${icon("arrowRight", 22)}</div>
      <div class="duel-box human">
        <div class="duel-tag">${icon("user", 13)} Human decision · authoritative</div>
        <div class="duel-value">${esc(hd.operational_priority ?? "—")}</div>
        <p class="text-xs" style="margin-top:7px">action <b>${esc(hd.action ?? "")}</b>
        · authority <b>${esc(hd.authority ?? "HUMAN")}</b>
        · final <b>${hd.is_operational_final ? "YES" : "NO"}</b></p>
      </div>
    </div>

    <div class="d-quote">${esc(review.rationale || "")}</div>

    <div class="row-wrap">
      <span class="badge badge-neutral">${esc(review.justification_category || "—")}</span>
      <span class="badge badge-accent">${esc(review.downstream_action || "—")}</span>
      <span class="badge badge-neutral">attributed to ${esc(review.downstream_attributed_to || "HUMAN_REVIEWER")}</span>
      <span class="badge badge-neutral">${esc(review.reviewer?.badge_id || "—")} · ${esc(review.reviewer?.role || "—")}</span>
    </div>

    <div class="kvs" style="margin-top:12px">
      <span class="kv">recorded <b>${clock(review.timestamp_utc)}</b></span>
      <span class="kv">digest <b class="accent">${esc((review.integrity?.payload_digest || "").slice(0, 16))}…</b></span>
      <span class="kv">changed <b>${hd.changed ? "YES" : "NO"}</b></span>
    </div>

    ${review.previous_human_decision ? `
      <div class="banner warn" style="margin-top:13px"><span class="b-icon">${icon("info", 16)}</span>
      <div><span class="b-title">Supersedes a prior human decision</span>
      Prior: ${esc(review.previous_human_decision.human_decision?.operational_priority ?? "—")} — retained in the audit chain, not overwritten.</div></div>` : ""}
  </div>`;
}

/* ── Degraded mode (Human Assessment Mode) ─────────────────────────────── */

export function degradedPanel(a) {
  const d = a?.degraded_mode;
  if (!d) return "";
  const feats = a.ai_dependent_features || [];
  const mc = a.manual_controls?.controls || [];
  const rec = a.recovery || {};

  return `
    <div class="banner crit" style="margin-bottom:var(--sp-4)">
      <span class="b-icon">${icon("wifiOff", 19)}</span>
      <div>
        <span class="b-title">${esc(d.banner)}</span>
        cause <b>${esc(d.cause)}</b> · retry ${esc(d.retry_state)} · circuit ${esc(d.circuit_state)}
        · authority <b>${esc(d.human_decision_authority)}</b>
        ${d.who_continued ? ` · continued by ${esc(d.who_continued)}` : ""}
      </div>
    </div>

    <div class="grid cols-2">
      ${card({
        title: "Preserved case data",
        iconName: "save",
        body: `
          <p class="text-xs" style="color:var(--text-2)">
            ${a.preserved_case_data?.transcript_turns ?? "—"} transcript turn(s) retained,
            partial fields: <b>${a.preserved_case_data?.partial_fields ? "present" : "none"}</b>,
            attachments: <b>${a.preserved_case_data?.attachments ? "present" : "none"}</b>.
          </p>
          <div class="banner good" style="margin-top:11px">
            <span class="b-icon">${icon("checkCircle", 16)}</span>
            <div>${esc(a.preserved_case_data?.notice || "")}</div>
          </div>`,
      })}

      ${card({
        title: "No default assessment",
        iconName: "octagon",
        cls: "glow-danger",
        body: `
          <div class="row-wrap" style="margin-bottom:10px">
            <span class="badge badge-danger">operational_priority: null</span>
            <span class="badge badge-danger">no_default_assessment: true</span>
          </div>
          <p class="text-xs" style="color:var(--text-2)">${esc(a.no_default_assessment_reason || "")}</p>`,
      })}

      ${card({
        title: "AI-dependent features",
        iconName: "cpu",
        body: `<div class="invariants">${feats.map((f) => `
          <div class="inv-row">
            <span class="inv-id" style="color:var(--danger);border-color:var(--danger);background:var(--wash-danger)">${esc(f.status)}</span>
            <span><b class="mono text-xs">${esc(f.feature)}</b><br>
            <span class="muted">manual path: ${esc(f.fallback)}</span></span>
          </div>`).join("") || `<p class="text-xs muted">n/a</p>`}</div>`,
      })}

      ${card({
        title: "Manual controls",
        iconName: "sliders",
        body: `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>Field</th><th>Control</th><th>Options</th></tr></thead>
          <tbody>${mc.map((c) => `<tr>
            <td class="num">${esc(c.field)}</td>
            <td><span class="badge badge-neutral">${esc(c.control)}</span></td>
            <td class="muted">${(c.options || []).map(esc).join(" · ") || "—"}</td>
          </tr>`).join("")}</tbody>
        </table></div>`,
      })}
    </div>

    ${a.human_assessment ? `
      <div class="decision" style="margin-top:var(--sp-4)">
        <div class="row-wrap">
          <span class="badge badge-good">${esc(a.human_assessment.provenance)}</span>
          <span class="badge badge-neutral">${esc(a.human_assessment.status)}</span>
          <span class="badge badge-violet">authority ${esc(a.human_assessment.entry_authority)}</span>
        </div>
        <p class="text-xs muted" style="margin-top:9px">Values entered here are human-entered and never relabelled as AI output.</p>
      </div>` : ""}

    ${rec.prompt ? `
      <div class="banner info" style="margin-top:var(--sp-4)">
        <span class="b-icon">${icon("refresh", 16)}</span>
        <div><span class="b-title">On recovery</span>${esc(rec.prompt)}
        Automatic overwrite: <b>${rec.automatic_overwrite ? "YES" : "NO"}</b></div>
      </div>` : ""}`;
}

export { jsonDetails, esc, icon };
