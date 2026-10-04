/* ============================================================================
   Sahaara AI — DOM helpers
   Views return HTML strings; events are wired by delegation or by the view's
   own `wire()` hook. No virtual DOM, no framework.
   ========================================================================== */

/** Escape text for safe interpolation into HTML. */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** Escape for attribute values (already covered by esc, kept for clarity). */
export const attr = esc;

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Event delegation: `on(root, 'click', '[data-act]', handler)`. */
export function on(root, event, selector, handler) {
  const wrapper = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, wrapper);
  return () => root.removeEventListener(event, wrapper);
}

/** Replace a node's content. */
export function setHTML(node, html) {
  if (!node) return;
  node.innerHTML = html;
}

/**
 * Render a view into a container.
 *
 * The view is wrapped in a fresh `.view-root` element each time so that
 * delegated listeners bound by `wire()` die with their element instead of
 * stacking up across re-renders.
 */
export function mount(container, { html, wire }) {
  container.innerHTML = "";
  const root = document.createElement("div");
  root.className = "view-root";
  root.innerHTML = html;
  container.appendChild(root);
  container.scrollTop = 0;
  if (typeof wire === "function") wire(root);
}

/** Debounce (used by the case search box). */
export function debounce(fn, ms = 140) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Animate a number from `from` to `to` inside `node`.
 * Honours prefers-reduced-motion by snapping.
 */
export function countTo(node, from, to, { duration = 800, decimals = 0, suffix = "" } = {}) {
  if (!node) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || from === to) {
    node.textContent = to.toFixed(decimals) + suffix;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = (from + (to - from) * eased).toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Trigger a `width` transition on any `.meter-fill` the view just created. */
export function playMeters(root) {
  requestAnimationFrame(() => {
    qsa("[data-w]", root).forEach((n) => {
      const w = Number(n.dataset.w);
      n.style.width = `${Math.max(0, Math.min(100, w))}%`;
    });
  });
}

/** Copy text to the clipboard with a graceful fallback. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** `<template>`-free HTML tag that just joins strings with escaping helpers. */
export const raw = (strings, ...values) =>
  strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");

/** Build a small SVG namespace node (used nowhere yet, kept for charts). */
export function svgEl(tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
