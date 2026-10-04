/* ==========================================================================
   Sahaara AI — Audit chain view
   ========================================================================== */

import { esc, qs, on, setHTML } from "../dom.js";
import { icon } from "../icons.js";
import { shortHash, stamp, clock, num, jsonDetails } from "../format.js";
import { card } from "./shared.js";

let caseFilter = "";
let eventFilter = "ALL";
let verifying = false;

/**
 * One-line summary for a chain node, written against the actual body shape
 * each producer writes (store/audit.js recordAssessment / recordHumanReview).
 *
 * Nulls are rendered as the literal `null` rather than silently blank — in a
 * tamper-evident log, "absent" and "explicitly null" must not look alike.
 */
function summary(e) {
  const b = e.body || {};
  const case_ = b.case_id ?? e.case_id ?? "—";
  const nul = (v) => (v === null ? "null" : v === undefined || v === "" ? "—" : esc(String(v)));

  switch (e.event_type) {
    case "AI_ASSESSMENT_CREATED":
      if (b.event === "TRAJECTORY_COMPUTED") {
        return `${esc(case_)} · session ${b.session_from ?? "?"} → ${b.session_to ?? "?"}` +
          ` · ${b.improvements?.length ?? 0} improvement(s), ${b.concerns?.length ?? 0} concern(s)` +
          ` · prior record retained: <b>${b.prior_assessment_retained ? "YES" : "NO"}</b>`;
      }
      return `${esc(case_)} · priority <b>${nul(b.operational_priority)}</b>` +
        ` · Es ${nul(b.evidence_quality_score)} · ${b.evidence_count ?? 0} evidence span(s)` +
        b.multidimensional_assessment?.psychological_distress?.score != null
          ? ` · distress ${num(b.multidimensional_assessment.psychological_distress.score, 3)}`
          : "";

    case "SAFETY_OVERRIDE_TRIGGERED":
      return `${esc(case_)} · <b>${nul(b.override_code)}</b> — Layer 0 forced the priority` +
        ` upward · bypass weighting: <b>${b.bypass_normal_weighting ? "YES" : "NO"}</b>` +
        ` · ${(b.trigger_criteria || []).length} criteria`;

    case "ABSTENTION_RECORDED":
      return `${esc(case_)} · Es ${nul(b.evidence_quality_score)} &lt; θ ${nul(b.threshold)}` +
        `${b.missing_critical_data?.length ? ` · missing: ${esc(b.missing_critical_data.join(", "))}` : ""}` +
        `${b.reason ? `<br><span class="faint">${esc(b.reason)}</span>` : ""}`;

    case "CONFLICT_RECORDED":
      return `${esc(case_)} · ${b.pair_count ?? 0} pair(s) · confidence ${nul(b.confidence)}` +
        ` · both statements retained, neither selected` +
        `${b.note ? `<br><span class="faint">${esc(b.note)}</span>` : ""}`;

    case "ANOMALY_SIGNAL_RECORDED":
      return `${esc(case_)} · ${nul(b.epistemic_status)} · confidence ${nul(b.confidence)}` +
        `${b.indicators?.length ? `<br><span class="faint">${esc(b.indicators.join(" · "))}</span>` : ""}`;

    case "HUMAN_REVIEW_RECORDED":
      return `${esc(case_)} · ${esc(b.human_action ?? "—")} → <b>${nul(b.human_decision)}</b>` +
        ` · reviewer ${esc(b.reviewer_id ?? "—")} (${esc(b.reviewer_role ?? "—")})` +
        ` · category ${esc(b.justification_category ?? "—")}` +
        ` · downstream ${esc(b.downstream_action ?? "—")}` +
        `<br><span class="faint">${esc(String(b.rationale ?? "").slice(0, 150))}` +
        `${(b.rationale ?? "").length > 150 ? "…" : ""}</span>`;

    case "HUMAN_OVERRIDE_APPLIED":
      return `${esc(case_)} · ${nul(b.from)} → <b>${nul(b.to)}</b>` +
        ` · reviewer ${esc(b.reviewer_id ?? "—")} (${esc(b.reviewer_role ?? "—")})` +
        ` · AI output retained: <b>${b.ai_output_retained ? "YES" : "NO"}</b>` +
        ` · attributed to ${esc(b.downstream_attributed_to ?? "HUMAN_REVIEWER")}`;

    case "HUMAN_ASSESSMENT_RECORDED":
      return `${esc(case_)} · manual intake recorded as HUMAN-ENTERED by ${esc(b.human_entry_by ?? "—")}`;

    case "FALLBACK_ACTIVATED":
      return `cause <b>${esc(b.cause ?? "—")}</b> · assessments become HUMAN_ASSESSMENT_MODE` +
        `${b.continued_by ? ` · continued by ${esc(b.continued_by)}` : ""}` +
        `${b.note ? `<br><span class="faint">${esc(b.note)}</span>` : ""}`;

    case "AI_SERVICE_STATE_CHANGED":
      return `operator requested <b>${esc(b.requested ?? "—")}</b> → ${esc(b.resulting_state ?? "—")}`;

    case "AI_PROCESSING_NOT_COMPLETED":
      return `${esc(case_)} · ${esc(b.reason ?? "—")}`;

    default:
      return Object.keys(b).length
        ? esc(JSON.stringify(b).slice(0, 180))
        : "—";
  }
}

function toneFor(ev) {
  if (!ev) return "";
  if (ev.includes("OVERRIDE") || ev.includes("FALLBACK")) return "danger";
  if (ev.includes("HUMAN")) return "human";
  if (ev.includes("CONFLICT") || ev.includes("ANOMALY")) return "warn";
  return "";
}

export function render(ctx) {
  const a = ctx.state.audit;
  const entries = (a?.entries || []).filter((e) => {
    if (caseFilter && (e.case_id || "") !== caseFilter) return false;
    if (eventFilter !== "ALL" && e.event_type !== eventFilter) return false;
    return true;
  });

  const caseRefs = [...new Set((a?.entries || []).map((e) => e.case_id).filter(Boolean))].sort();
  const eventTypes = ["ALL", ...new Set((a?.entries || []).map((e) => e.event_type))];

  const v = a?.verification || {};
  const verifyCls = verifying ? "checking" : v.ok ? "ok" : "bad";
  const verifyText = verifying
    ? "recomputing chain…"
    : v.ok
      ? `chain intact · ${v.checked} entries verified`
      : `BROKEN at #${v.brokenAt} — ${v.reason}`;

  const chain = entries.length
    ? `<div class="chain" data-stagger>${entries.slice().reverse().map((e, i) => `
        <article class="chain-node ${toneFor(e.event_type)}" style="--i:${i}">
          <div class="row-wrap">
            <span class="chain-seq">#${String(e.seq).padStart(3, "0")}</span>
            <span class="badge ${badgeTone(e.event_type)}">${esc(e.event_type)}</span>
            <span class="badge badge-neutral">${esc(e.actor_type ?? "—")}</span>
            ${e.actor_id ? `<span class="badge badge-neutral">${esc(e.actor_id)}</span>` : ""}
            <span class="right mono text-xs faint">${stamp(e.timestamp_utc)}</span>
          </div>
          <div class="chain-body">${summary(e)}</div>
          <div class="hashline">
            <span>prev <span class="prev">${esc(shortHash(e.prev_hash))}</span></span>
            <span>→</span>
            <span>hash <b>${esc(shortHash(e.hash))}</b></span>
            <button class="copyable right cp-ico" data-copy="${esc(e.hash)}" title="Copy full hash"
              style="opacity:.6">${icon("copy", 12)}</button>
          </div>
          ${jsonDetails(e.body, "entry body")}
        </article>`).join("")}</div>`
    : `<div class="empty">
        <span class="e-icon">${icon("git", 22)}</span>
        <div class="e-title">${a?.entries?.length ? "No entries match these filters" : "The chain is empty"}</div>
        <div class="e-sub">${a?.entries?.length
          ? "Clear the case or event filter to see the full trail."
          : "Run a fixture — every assessment, override, abstention and human decision appends here."}</div>
        <button class="btn btn-primary" data-act="run-first">${icon("play", 14)} Run TC-01</button>
      </div>`;

  return {
    html: `
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Audit <span class="grad">chain</span></h1>
            <p class="page-sub">
              Append-only and tamper-evident: each entry commits to its predecessor with
              <code>SHA256(prev_hash ‖ canonical(entry))</code>. Altering any historical row
              breaks verification from that point onward. Entries are never edited or deleted.
            </p>
          </div>
          <div class="page-actions">
            <button class="btn btn-ghost" data-act="refresh">${icon("refresh", 14)} Refresh</button>
            <button class="btn btn-primary" data-act="verify" ${verifying ? "disabled" : ""}>
              ${verifying ? `<span class="spinner"></span> verifying` : `${icon("shield", 14)} Verify chain`}
            </button>
          </div>
        </div>

        <div class="audit-toolbar">
          <span class="verify-result ${verifyCls}">
            ${verifying ? `<span class="spinner"></span>` : icon(v.ok ? "checkCircle" : "octagon", 14)}
            ${esc(verifyText)}
          </span>

          <span class="head-hash">
            ${icon("git", 13)} head ${esc(shortHash(a?.head))}
            <button class="copyable" data-copy="${esc(a?.head || "")}" title="Copy head hash">
              ${icon("copy", 12)}<span class="cp-ico"></span>
            </button>
          </span>

          <span class="spacer"></span>

          <select class="select" id="audit-case" style="width:auto;min-width:210px">
            <option value="">All cases (${a?.entries?.length ?? 0})</option>
            ${caseRefs.map((r) => `<option value="${esc(r)}" ${caseFilter === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
          </select>

          <div class="row-wrap" style="gap:6px">
            ${eventTypes.slice(0, 9).map((t) => `
              <button class="chip" data-evtype="${esc(t)}" aria-pressed="${eventFilter === t}">${esc(truncate(t.replace(/_/g, " "), 26))}</button>`).join("")}
          </div>
        </div>

        ${card({
          title: `Entries — ${entries.length} shown`,
          iconName: "audit",
          actions: `<span class="badge ${v.ok ? "badge-good" : "badge-danger"}">${v.ok ? "VERIFIED" : "BROKEN"}</span>`,
          body: chain,
          foot: `Oldest first in the chain; rendered newest first. Generator: <code>sha256(prev_hash + "|" + canonical(record))</code> where <code>canonical()</code> is a recursively sorted-key JSON stringify.`,
        })}
      </div>`,

    wire(root) {
      on(root, "click", '[data-act="verify"]', async () => {
        verifying = true;
        ctx.rerender();
        await new Promise((r) => setTimeout(r, 340));
        await ctx.refreshAudit();
        verifying = false;
        ctx.rerender();
        const v = ctx.state.audit?.verification;
        ctx.toast({
          type: v?.ok ? "ok" : "err",
          title: v?.ok ? "Chain verified" : "Chain broken",
          body: v?.ok ? `${v.checked} entries recomputed with no mismatch.` : `Broke at #${v.brokenAt}: ${v.reason}`,
        });
      });

      on(root, "click", '[data-act="refresh"]', () => ctx.refreshAudit());
      on(root, "click", '[data-act="run-first"]', () => ctx.runFixture("TC-01"));

      on(root, "change", "#audit-case", (e, sel) => { caseFilter = sel.value; ctx.rerender(); });

      on(root, "click", "[data-evtype]", (e, btn) => {
        eventFilter = btn.dataset.evtype;
        ctx.rerender();
      });

      on(root, "click", "[data-copy]", async (e, btn) => {
        const ok = await ctx.copy(btn.dataset.copy);
        if (ok) {
          btn.classList.add("copied");
          ctx.toast({ type: "ok", title: "Hash copied" });
          setTimeout(() => btn.classList.remove("copied"), 1400);
        }
      });
    },
  };
}

/** Trim on a word boundary so chips never read `…TRIGGE`. */
function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 12 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function badgeTone(ev = "") {
  if (ev.includes("OVERRIDE") || ev.includes("FALLBACK")) return "badge-danger";
  if (ev.includes("HUMAN")) return "badge-good";
  if (ev.includes("CONFLICT") || ev.includes("ANOMALY")) return "badge-warn";
  if (ev.includes("SERVICE")) return "badge-violet";
  if (ev.includes("ABSTENTION")) return "badge-violet";
  // Routine, non-status events stay monochrome.
  return "badge-neutral";
}
