/* ==========================================================================
   Sahaara AI — Service / degradation lab view
   ========================================================================== */

import { esc, qs, on } from "../dom.js";
import { icon } from "../icons.js";
import { sparkHost } from "../charts.js";
import { clock, duration, shortHash } from "../format.js";
import { card } from "./shared.js";

const INVARIANTS = [
  ["D1", "The platform stays usable and renders a manual path — never a dead form."],
  ["D2", "Every byte already entered is preserved: transcript, attachments, partial fields, prior assessments."],
  ["D3", "AI-dependent features are labelled UNAVAILABLE by name, not left silently blank."],
  ["D4", "No default assessment is emitted — a silent LOW is worse than no score."],
  ["D5", "Anything the human produces is labelled HUMAN-ENTERED, never relabelled as AI output."],
  ["D6", "The outage itself is written to the append-only audit trail; historical AI assessments are not invalidated."],
  ["D7", "On recovery, human-entered values are never overwritten automatically."],
];

export function render(ctx) {
  const h = ctx.state.health;
  const svc = h?.model_service || {};
  const offline = svc.state === "OFFLINE" || !!svc.fallback_active;
  const transitions = (svc.recent_transitions || []).slice().reverse();

  const lastResult = ["TC-14"].map((id) => ctx.state.results.get(id)).find(Boolean);

  return {
    html: `
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Service <span class="grad">degradation lab</span></h1>
            <p class="page-sub">
              The kill switch below drives the real circuit breaker. Flip it and the next
              assessment returns <code>HUMAN_ASSESSMENT_MODE</code> with
              <code>operational_priority: null</code> — the UI degrades with it.
            </p>
          </div>
          <div class="page-actions">
            <button class="btn btn-ghost" data-act="refresh">${icon("refresh", 14)} Poll now</button>
            <button class="btn btn-ghost" data-act="run-tc14">${icon("play", 14)} Run TC-14</button>
          </div>
        </div>

        <section class="service-hero ${offline ? "offline" : ""}">
          <div class="svc-orb ${offline ? "offline" : ""}">${icon(offline ? "wifiOff" : "zap", 34)}</div>

          <div>
            <div class="verdict-kicker">model service</div>
            <div class="verdict-prio ${offline ? "red" : "green"}" style="font-size:clamp(1.3rem,2.2vw,1.8rem)">
              ${esc(svc.state || "—")}
            </div>
            <div class="kvs" style="margin-top:9px">
              <span class="kv">circuit <b>${esc(svc.circuit || "—")}</b></span>
              <span class="kv">cause <b>${esc(svc.cause ?? "none")}</b></span>
              <span class="kv">failures <b>${svc.consecutive_failures ?? 0}</b></span>
              <span class="kv">poll <b>${svc.poll_interval_ms ?? "—"}ms</b></span>
              <span class="kv">probe <b>${svc.probe_interval_ms ?? "—"}ms</b></span>
              <span class="kv">opened <b>${svc.opened_at ? clock(svc.opened_at) : "—"}</b></span>
            </div>
            ${svc.forced_offline ? `
              <div class="row-wrap" style="margin-top:12px">
                <span class="badge badge-danger">operator hold</span>
                <span class="text-xs muted">The kill switch pins the circuit open — the health poller keeps probing but will not auto-recover until you restore it.</span>
              </div>` : ""}
          </div>

          <label class="switch" style="justify-self:end">
            <input type="checkbox" id="outage-toggle" ${offline ? "checked" : ""} />
            <span class="track"></span>
            <span class="sw-label">${offline ? "Outage simulated" : "Service healthy"}</span>
          </label>
        </section>

        <div class="grid cols-2" style="margin-bottom:var(--sp-4);align-items:start">
          ${card({
            title: "Uptime samples",
            iconName: "service",
            actions: `<span class="badge ${offline ? "badge-danger" : "badge-good"}">${offline ? "DEGRADED" : "HEALTHY"}</span>`,
            body: `
              ${sparkHost(ctx.state.healthHistory)}
              <p class="text-xs muted" style="margin-top:9px">
                Sampled every ${svc.poll_interval_ms ?? "—"}ms from the health endpoint.
                High line = fallback active, low line = healthy.
              </p>`,
            foot: `last check ${svc.last_checked_at ? clock(svc.last_checked_at) : "—"}`,
          })}

          ${card({
            title: "Circuit transitions",
            iconName: "git",
            body: `<div class="timeline">
              ${transitions.length ? transitions.map((t) => `
                <div class="tl-item ${/OFFLINE|OPEN/.test(t.to || "") ? "bad" : "good"}">
                  <span class="tl-dot"></span>
                  <div>
                    <div class="row">
                      <b class="mono text-xs">${esc(t.from ?? "")} → ${esc(t.to ?? "")}</b>
                      <span class="right mono text-xs faint">${t.at ? clock(t.at) : ""}</span>
                    </div>
                    <div class="text-xs muted">${esc(t.cause || "—")} · circuit ${esc(t.circuit || "—")} · ${t.consecutive_failures ?? 0} failures</div>
                  </div>
                </div>`).join("")
                : `<p class="text-xs muted">No transitions yet — flip the switch above.</p>`}
            </div>`,
            foot: `history capped at 100 entries · served via <code>aiService.snapshot().recent_transitions</code> (last 5)`,
          })}
        </div>

        <div class="grid cols-2">
          ${card({
            title: "Degradation invariants",
            iconName: "shield",
            body: `<div class="invariants">${INVARIANTS.map(([id, text]) => `
              <div class="inv-row">
                <span class="inv-id">${id}</span>
                <span>${esc(text)}</span>
              </div>`).join("")}</div>`,
            foot: "TC-14 proves D1 · D4 · D5 · D6 · D7 end to end.",
          })}

          ${card({
            title: "Last TC-14 run",
            iconName: "flag",
            body: lastResult?.assessment ? `
              <div class="row-wrap" style="margin-bottom:11px">
                <span class="badge badge-violet">${esc(lastResult.assessment.record_type)}</span>
                <span class="badge badge-danger">priority ${lastResult.assessment.operational_priority === null ? "null" : esc(lastResult.assessment.operational_priority)}</span>
                <span class="badge badge-neutral">chain ${ctx.state.audit?.length ?? 0}</span>
              </div>
              <div class="banner info">
                <span class="b-icon">${icon("info", 16)}</span>
                <div>${esc(lastResult.assessment.degraded_mode?.banner || "HUMAN ASSESSMENT MODE")}</div>
              </div>
              <div class="kvs" style="margin-top:12px">
                <span class="kv">features unavailable <b>${(lastResult.assessment.ai_dependent_features || []).length}</b></span>
                <span class="kv">manual controls <b>${(lastResult.assessment.manual_controls?.controls || []).length}</b></span>
                <span class="kv">runs <b>${lastResult.runs ?? 1}</b></span>
              </div>`
              : `<div class="empty" style="padding:32px 14px">
                  <span class="e-icon">${icon("play", 20)}</span>
                  <div class="e-title">TC-14 has not run in this browser</div>
                  <div class="e-sub">Flip the switch to OFFLINE, then run TC-14 to see Human Assessment Mode.</div>
                </div>`,
          })}
        </div>
      </div>`,

    wire(root) {
      const toggle = qs("#outage-toggle", root);
      if (toggle) {
        toggle.addEventListener("change", async () => {
          const want = toggle.checked ? "OFFLINE" : "HEALTHY";
          toggle.disabled = true;
          try {
            await ctx.setService(want);
            ctx.toast({
              type: want === "OFFLINE" ? "err" : "ok",
              title: want === "OFFLINE" ? "Outage simulated" : "Service restored",
              body: want === "OFFLINE"
                ? "Next assessment returns HUMAN_ASSESSMENT_MODE with operational_priority: null."
                : "Circuit is closing — assessments resume.",
            });
          } catch (ex) {
            toggle.checked = !toggle.checked;
            ctx.toast({ type: "err", title: "Could not change service state", body: ex.message });
          } finally {
            toggle.disabled = false;
          }
        });
      }

      on(root, "click", '[data-act="refresh"]', () => ctx.refreshHealth());
      on(root, "click", '[data-act="run-tc14"]', () => ctx.runFixture("TC-14"));
    },
  };
}
