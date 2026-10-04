/* ==========================================================================
   Sahaara AI — toast notifications
   ========================================================================== */

import { esc } from "./dom.js";
import { icon } from "./icons.js";

const ICONS = { ok: "checkCircle", err: "octagon", info: "info" };
const TIMEOUTS = { ok: 3800, err: 7000, info: 4600 };

/**
 * @param {{type?: "ok"|"err"|"info", title: string, body?: string, timeout?: number}} opts
 */
export function toast({ type = "info", title, body = "", timeout } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;

  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `
    <span class="t-icon">${icon(ICONS[type] || "info", 17)}</span>
    <div class="t-body">
      <div class="t-title">${esc(title)}</div>
      ${body ? `<div>${esc(body)}</div>` : ""}
    </div>
    <button class="t-close" aria-label="Dismiss">${icon("x", 14)}</button>`;

  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.add("out");
    setTimeout(() => node.remove(), 240);
  };

  node.querySelector(".t-close").addEventListener("click", dismiss);
  host.appendChild(node);

  const t = timeout ?? TIMEOUTS[type] ?? 4200;
  setTimeout(dismiss, t);

  // Cap the stack so a loop of failures can't bury the UI.
  while (host.children.length > 4) host.firstElementChild.remove();
}
