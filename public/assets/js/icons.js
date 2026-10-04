/* ============================================================================
   Sahaara AI — icon set (24×24, 1.7 stroke, inherits currentColor)
   ========================================================================== */

const P = {
  overview: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M12 13l4.2-3.4"/><path d="M4 13v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/><circle cx="12" cy="13" r="1.6"/>',
  cases: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 14h6"/><path d="M8 17h4"/>',
  audit: '<path d="M12 3.5v17"/><circle cx="12" cy="7" r="2.4"/><circle cx="12" cy="16.6" r="2.4"/><path d="M6.5 12h-2"/><path d="M19.5 12h-2"/>',
  service: '<path d="M3 12h3.5l2-5 3.5 11 2.5-7 1.8 4H21"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5 20 20"/>',
  play: '<path d="M8 5.5 18 12 8 18.5z" stroke-linejoin="round"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.7 4.5"/><path d="M20 5v6h-6"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.6 2.6 4.8-5.4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  alert: '<path d="M12 4.5 21 19.5H3z" stroke-linejoin="round"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  octagon: '<path d="M8.4 3.5h7.2l5 5v7l-5 5H8.4l-5-5v-7z" stroke-linejoin="round"/><path d="M12 8.5v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  chevron: '<path d="m9.5 5.5 7 6.5-7 6.5"/>',
  arrowRight: '<path d="M4.5 12h15"/><path d="m14 6.5 5.5 5.5L14 17.5"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7.5 10 2.5 2.2-2.5 2.2"/><path d="M13 15h4"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
  database: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" stroke-linejoin="round"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 3h9A1.5 1.5 0 0 1 15.5 4.5V5"/>',
  quote: '<path d="M9 6.5C6.5 8 5.5 10 5.5 13v4.5h5V13H8c0-2 .5-3.4 2.2-4.4z" stroke-linejoin="round"/><path d="M18 6.5c-2.5 1.5-3.5 3.5-3.5 6.5v4.5h5V13H17c0-2 .5-3.4 2.2-4.4z" stroke-linejoin="round"/>',
  git: '<circle cx="7" cy="6" r="2.4"/><circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="9" r="2.4"/><path d="M7 8.4v7.2"/><path d="M9 9h4.2a3.8 3.8 0 0 1 3.8 3.8v.4"/>',
  wifiOff: '<path d="M3 4.5 21 20"/><path d="M5 10.5a13 13 0 0 1 4-2.4"/><path d="M8.5 14a8 8 0 0 1 2.3-1.3"/><path d="M19 10.5a13 13 0 0 0-4.6-2.6"/><path d="M12 18h.01"/>',
  sparkles: '<path d="M12 4.5 13.6 9l4.4 1.6L13.6 12 12 16.5 10.4 12 6 10.6 10.4 9z" stroke-linejoin="round"/><path d="M18.5 4.5v3M17 6h3"/><path d="M5.5 16v2.5M4.5 17.5h2"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19v14H6.5a2 2 0 0 0-2 2z" stroke-linejoin="round"/><path d="M4.5 17.5v-12"/><path d="M8 7.5h7"/>',
  sliders: '<path d="M4 7h10M18 7h2"/><path d="M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 2v-7.4z" stroke-linejoin="round"/>',
  zap: '<path d="M13.5 3 5 13.5h6L10.5 21 19 10.5h-6z" stroke-linejoin="round"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>',
  layers: '<path d="m12 3.5 8.5 4.6-8.5 4.6L3.5 8.1z" stroke-linejoin="round"/><path d="m4 12.5 8 4.3 8-4.3"/><path d="m4 16.5 8 4.3 8-4.3"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.4 1.4"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.4-1.4"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  trending: '<path d="M3.5 16.5 9 11l4 3.5 7.5-7.5"/><path d="M15 7h5.5v5.5"/>',
  flag: '<path d="M5.5 21V4.5"/><path d="M5.5 5.5h11l-1.8 3.5 1.8 3.5h-11" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8"/>',
  save: '<path d="M5 4.5h11l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" stroke-linejoin="round"/><path d="M8.5 4.5v5h7"/><rect x="8.5" y="13" width="7" height="6" rx="1"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5H8l1.5 3h5l1.5-3h4.5v4A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" stroke-linejoin="round"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15 9-1.7 4.3L9 15l1.7-4.3z" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.7 4.7l1.7 1.7M17.6 17.6l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.7 19.3l1.7-1.7M17.6 6.4l1.7-1.7"/>',
  moon: '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" stroke-linejoin="round"/>',
};

/**
 * @param {keyof typeof P} name
 * @param {number} size
 */
export function icon(name, size = 16) {
  const d = P[name] || P.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    aria-hidden="true" focusable="false">${d}</svg>`;
}

export const iconNames = Object.keys(P);
