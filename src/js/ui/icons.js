/**
 * Inline SVG icon set. Stroke-only, 24×24, inheriting currentColor so icons
 * take the colour of whatever they sit in.
 */
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${paths}</svg>`;

export const icons = {
  dashboard: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  placements: svg('<path d="M6 3.5h9l3.5 3.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h4"/>'),
  treaty: svg('<path d="M4 8 12 4l8 4-8 4-8-4Z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>'),
  bordereaux: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8.5 9.5V20"/>'),
  claims: svg('<path d="M12 3.5 4.5 6.5v5.4c0 4.5 3.1 7.3 7.5 8.6 4.4-1.3 7.5-4.1 7.5-8.6V6.5L12 3.5Z"/><path d="M12 8.5v4M12 15.2h.01"/>'),
  accounting: svg('<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M8 8h8M8 11.5h8M8 15h5"/>'),
  reports: svg('<path d="M4.5 20V10M12 20V4.5M19.5 20v-7"/>'),
  registry: svg('<circle cx="12" cy="8" r="3.2"/><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/>'),
  // Registry categories — one per counterparty page.
  cedant: svg('<path d="M4.5 20.5V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14.5"/><path d="M13.5 10.5h5a1 1 0 0 1 1 1v9"/><path d="M3 20.5h18M7.5 8.5h2M7.5 12h2M7.5 15.5h2M16 14h1M16 17.5h1"/>'),
  reinsurance: svg('<path d="M12 3.5 4.5 6.5v5.4c0 4.5 3.1 7.3 7.5 8.6 4.4-1.3 7.5-4.1 7.5-8.6V6.5L12 3.5Z"/><path d="M9 12.2l2.1 2.1L15.2 10"/>'),
  syndicate: svg('<path d="M12 3.5v4M8.5 7.5h7"/><path d="M12 7.5 5 10.5M12 7.5l7 3"/><path d="M5 10.5c0 2 1.1 3.2 2.5 3.2S10 12.5 10 10.5M14 10.5c0 2 1.1 3.2 2.5 3.2S19 12.5 19 10.5"/><path d="M12 7.5v11M8 20.5h8"/>'),
  brokers: svg('<circle cx="8" cy="8.5" r="2.8"/><circle cx="16" cy="8.5" r="2.8"/><path d="M2.5 19c0-2.8 2.5-4.8 5.5-4.8s5.5 2 5.5 4.8M14 14.4c2.8.2 5 2.1 5 4.6"/>'),
  others: svg('<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>'),
  folder: svg('<path d="M3.5 7.5h6l1.6 2h9.4v10.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7.5Z"/>'),
  plusCircle: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>'),
  upload: svg('<path d="M12 15.5V4.5M8 8.5 12 4.5 16 8.5"/><path d="M4.5 15.5v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3"/>'),
  statement: svg('<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3L15.5 9.5"/>'),
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
};
