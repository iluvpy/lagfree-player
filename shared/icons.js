/* Inline icon set — no external assets, no icon font. */

const stroke = (body, sw = 1.8) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const filled = (body) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${body}</svg>`;

const logo = `
<svg class="logo-svg" viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <linearGradient id="lf-logo-grad" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6875f5"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#lf-logo-grad)"/>
  <rect x="1.75" y="1.75" width="44.5" height="44.5" rx="12.4" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
  <path d="M19.4 14.9v18.2L35 24z" fill="#fff"/>
  <circle cx="36.6" cy="36.6" r="5.4" fill="#1e1f22"/>
  <circle cx="36.6" cy="36.6" r="3.7" fill="#23a55a"/>
</svg>`;

export const ICONS = {
  logo,
  play: filled('<path d="M8 5.6v12.8a1 1 0 0 0 1.52.86l10.6-6.4a1 1 0 0 0 0-1.72L9.52 4.74A1 1 0 0 0 8 5.6z"/>'),
  pause: filled('<rect x="6.2" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.6" y="4.5" width="4.2" height="15" rx="1.2"/>'),
  'skip-back': filled('<path d="M11.5 19.1 3.4 12l8.1-7.1v14.2z"/><rect x="18.6" y="4.9" width="2.4" height="14.2" rx="1.2"/>'),
  'skip-forward': filled('<path d="M12.5 4.9 20.6 12l-8.1 7.1V4.9z"/><rect x="3" y="4.9" width="2.4" height="14.2" rx="1.2"/>'),
  volume: stroke('<path d="M11 5 6.5 8.8H3.4v6.4h3.1L11 19V5z"/><path d="M15 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M17.9 5.7a8.9 8.9 0 0 1 0 12.6"/>'),
  mute: stroke('<path d="M11 5 6.5 8.8H3.4v6.4h3.1L11 19V5z"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  maximize: stroke('<path d="M8.5 3.5h-5v5M15.5 3.5h5v5M20.5 15.5v5h-5M3.5 15.5v5h5"/>'),
  minimize: stroke('<path d="M3.5 8.5h5v-5M20.5 8.5h-5v-5M20.5 15.5h-5v5M3.5 15.5h5v5"/>'),
  settings: stroke('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 1 1 0 4h-.09c-.61.24-1 .84-1 1.51z"/>'),
  monitor: stroke('<rect x="2.5" y="3.8" width="19" height="13" rx="2.6"/><path d="M8 21h8M12 16.8V21"/><path d="m10 7.6 4.4 2.6-4.4 2.6z" fill="currentColor" stroke="none"/>'),
  queue: stroke('<path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h6"/><path d="M20.5 8.5v11l-4.5-2.8"/><circle cx="17.7" cy="7.5" r="2.3"/>'),
  history: stroke('<path d="M3.2 12a8.8 8.8 0 1 0 3-6.6"/><path d="M3.2 4.2v5h5"/><path d="M12 7.2v5.1l3.2 1.9"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  x: stroke('<path d="m6 6 12 12M18 6 6 18"/>'),
  trash: stroke('<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7L18.5 7"/><path d="M10 11v6M14 11v6"/>'),
  external: stroke('<path d="M14.5 4.5h5v5"/><path d="m19 5-7.4 7.4"/><path d="M18.5 14v4.6a1.9 1.9 0 0 1-1.9 1.9H5.4a1.9 1.9 0 0 1-1.9-1.9V7.4a1.9 1.9 0 0 1 1.9-1.9H10"/>'),
  copy: stroke('<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  check: stroke('<path d="m4.5 12.5 4.6 4.6L19.5 6.7"/>'),
  'chevron-down': stroke('<path d="m6 9 6 6 6-6"/>'),
  'chevron-right': stroke('<path d="m9 6 6 6-6 6"/>'),
  'arrow-right': stroke('<path d="M4.5 12h15M13.5 6l6 6-6 6"/>'),
  'arrow-up': stroke('<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>'),
  search: stroke('<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.2 4.2"/>'),
  link: stroke('<path d="M10.2 13.8a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M13.8 10.2a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.6-1.6"/>'),
  zap: filled('<path d="M13.3 2.2 4.6 13.1c-.5.6 0 1.5.8 1.5h5l-1.4 7.2c-.1.8.9 1.2 1.4.6l8.8-11.2c.5-.6 0-1.5-.8-1.5h-5.1l1.5-6.9c.2-.8-.9-1.3-1.5-.6z"/>'),
  shield: stroke('<path d="M12 2.8 4.6 5.9v5.4c0 4.6 3.2 8.4 7.4 9.9 4.2-1.5 7.4-5.3 7.4-9.9V5.9L12 2.8z"/><path d="m9 11.8 2.2 2.2L15.4 9.5"/>'),
  activity: stroke('<path d="M2.8 12h4l2.4-6.2 4.1 12.4 2.5-6.2h5.4"/>'),
  keyboard: stroke('<rect x="2.4" y="6" width="19.2" height="12" rx="2.4"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M8 13.5h8"/>'),
  help: stroke('<circle cx="12" cy="12" r="9.2"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.4"/><path d="M12 17.4h.01"/>'),
  refresh: stroke('<path d="M20.2 11a8.4 8.4 0 0 0-14.6-4.4L3.4 8.8"/><path d="M3.4 4.4v4.4h4.4"/><path d="M3.8 13a8.4 8.4 0 0 0 14.6 4.4l2.2-2.2"/><path d="M20.6 19.6v-4.4h-4.4"/>'),
  sparkles: stroke('<path d="m12 3 1.7 4.6L18.3 9.3l-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/><path d="M5 15l.6 1.6 1.6.6-1.6.6L5 19.4l-.6-1.6-1.6-.6 1.6-.6L5 15z"/>'),
  cpu: stroke('<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="2.2"/><rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1"/><path d="M9 2.8v3.4M15 2.8v3.4M9 17.8v3.4M15 17.8v3.4M2.8 9h3.4M2.8 15h3.4M17.8 9h3.4M17.8 15h3.4"/>'),
  info: stroke('<circle cx="12" cy="12" r="9.2"/><path d="M12 11v6M12 7.4h.01"/>'),
  clock: stroke('<circle cx="12" cy="12" r="9.2"/><path d="M12 7v5.4l3.5 2"/>'),
  film: stroke('<rect x="2.8" y="4.5" width="18.4" height="15" rx="2.4"/><path d="M7.5 4.5v15M16.5 4.5v15M2.8 9.5h4.7M16.5 9.5h4.7M2.8 14.5h4.7M16.5 14.5h4.7"/>'),
  gauge: stroke('<path d="M4.2 18.2a9 9 0 1 1 15.6 0"/><path d="m12 14 4.3-4.6"/><circle cx="12" cy="14.6" r="1.6" fill="currentColor" stroke="none"/>'),
  more: filled('<circle cx="5.2" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.8" cy="12" r="1.8"/>'),
  grip: filled('<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>'),
  'volume-low': stroke('<path d="M11 5 6.5 8.8H3.4v6.4h3.1L11 19V5z"/><path d="M14.8 9.4a3.7 3.7 0 0 1 0 5.2"/>'),
  'play-small': filled('<path d="M8 5.5v13l11-6.5z"/>'),
  'wifi': stroke('<path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 12a10.5 10.5 0 0 1 13 0M8.6 15.4a5.8 5.8 0 0 1 6.8 0M12 19h.01"/>'),
  'battery': stroke('<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M22 10.5v3"/><rect x="5" y="10" width="6" height="4" rx="1" fill="currentColor" stroke="none"/>'),
  'layers': stroke('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>'),
  'alert': stroke('<path d="M12 3.5 2.8 20h18.4L12 3.5z"/><path d="M12 9v5M12 17h.01"/>'),
};

export function icon(name) {
  return ICONS[name] || ICONS.info;
}

export function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.getAttribute("data-icon");
    if (ICONS[name]) node.innerHTML = ICONS[name];
  });
}

export function setIcon(node, name) {
  if (node && ICONS[name]) node.innerHTML = ICONS[name];
}
