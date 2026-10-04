/* ==========================================================================
   Sahaara AI — command palette (⌘K / Ctrl-K)
   ========================================================================== */

import { esc } from "./dom.js";
import { icon } from "./icons.js";

let commands = [];
let active = 0;
let filtered = [];
let open = false;

const el = () => document.getElementById("palette");
const scrim = () => document.getElementById("palette-scrim");

/** @param {Array<{id:string, group:string, label:string, hint?:string, icon?:string, run:Function}>} list */
export function setCommands(list) {
  commands = list;
  if (open) render();
}

export function isPaletteOpen() {
  return open;
}

function render() {
  const root = el();
  if (!root) return;
  const q = (root.querySelector("input")?.value || "").trim().toLowerCase();

  filtered = commands.filter((c) =>
    !q ||
    c.label.toLowerCase().includes(q) ||
    (c.hint || "").toLowerCase().includes(q) ||
    c.group.toLowerCase().includes(q)
  );
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);

  let html = `
    <div class="palette-input">
      ${icon("search", 18)}
      <input type="text" placeholder="Run a case, jump to a view, toggle the outage…"
        aria-label="Command palette search" autocomplete="off" spellcheck="false" />
      <span class="badge badge-neutral">ESC</span>
    </div>
    <div class="palette-list" role="listbox">`;

  if (!filtered.length) {
    html += `<div class="palette-empty">No command matches “${esc(q)}”.</div>`;
  } else {
    let group = null;
    filtered.forEach((c, i) => {
      if (c.group !== group) {
        group = c.group;
        html += `<div class="palette-group">${esc(group)}</div>`;
      }
      html += `<button class="palette-item${i === active ? " active" : ""}"
          role="option" aria-selected="${i === active}" data-i="${i}">
        ${icon(c.icon || "chevron", 16)}
        <span>${esc(c.label)}</span>
        ${c.hint ? `<span class="pi-sub">${esc(c.hint)}</span>` : ""}
      </button>`;
    });
  }

  html += `</div>
    <div class="palette-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span><kbd>↵</kbd> run</span>
      <span><kbd>esc</kbd> close</span>
      <span class="right">${filtered.length} command${filtered.length === 1 ? "" : "s"}</span>
    </div>`;

  root.innerHTML = html;

  const input = root.querySelector("input");
  input.value = q;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener("input", () => { active = 0; render(); });

  root.querySelectorAll(".palette-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = filtered[Number(btn.dataset.i)];
      close();
      cmd?.run();
    });
  });
}

export function openPalette() {
  const root = el();
  const sc = scrim();
  if (!root || !sc) return;
  open = true;
  active = 0;
  root.hidden = false;
  sc.hidden = false;
  render();
}

export function closePalette() {
  const root = el();
  const sc = scrim();
  if (!root || !sc) return;
  open = false;
  root.hidden = true;
  sc.hidden = true;
}

/** Global keyboard handling — returns true when the event was consumed. */
export function paletteKeys(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    open ? closePalette() : openPalette();
    return true;
  }
  if (!open) return false;

  if (e.key === "Escape") { e.preventDefault(); closePalette(); return true; }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    active = Math.min(filtered.length - 1, active + 1);
    render();
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    active = Math.max(0, active - 1);
    render();
    return true;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const cmd = filtered[active];
    closePalette();
    cmd?.run();
    return true;
  }
  return true;
}

export function bindPaletteChrome() {
  scrim()?.addEventListener("click", closePalette);
}
