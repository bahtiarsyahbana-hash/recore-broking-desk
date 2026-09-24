/**
 * Brand mark — the five-blade swirl, drawn as inline SVG so it inherits the
 * text colour wherever it sits. Each blade is a crescent (one circle less an
 * offset circle) masked by its neighbour's outline, which is what leaves the
 * spiral gaps between blades.
 *
 * `prefix` keeps the mask ids unique when the mark appears more than once on
 * a page.
 *
 * Standalone files live in src/assets/brand/: recordes-mark.svg (currentColor),
 * recordes-mark-navy.svg (favicon, light backgrounds) and
 * recordes-mark-white.svg (dark backgrounds). They are the same geometry as
 * this inline copy — keep them in step if the mark changes.
 */
export const brandMark = (prefix = "bm-") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-56 -56 112 112" role="img" aria-label="Recordes"><defs><mask id="bm-login-0"><rect x="-56" y="-56" width="112" height="112" fill="#fff"/><path d="M45.65,26.26 A42,42 0 1 1 -3.97,-30.82 A38,38 0 0 0 45.65,26.26 Z" fill="#000" stroke="#000" stroke-width="5.5" stroke-linejoin="round"/></mask><mask id="bm-login-1"><rect x="-56" y="-56" width="112" height="112" fill="#fff"/><path d="M-10.87,51.53 A42,42 0 1 1 28.09,-13.30 A38,38 0 0 0 -10.87,51.53 Z" fill="#000" stroke="#000" stroke-width="5.5" stroke-linejoin="round"/></mask><mask id="bm-login-2"><rect x="-56" y="-56" width="112" height="112" fill="#fff"/><path d="M-52.37,5.59 A42,42 0 1 1 21.32,22.60 A38,38 0 0 0 -52.37,5.59 Z" fill="#000" stroke="#000" stroke-width="5.5" stroke-linejoin="round"/></mask><mask id="bm-login-3"><rect x="-56" y="-56" width="112" height="112" fill="#fff"/><path d="M-21.50,-48.08 A42,42 0 1 1 -14.91,27.27 A38,38 0 0 0 -21.50,-48.08 Z" fill="#000" stroke="#000" stroke-width="5.5" stroke-linejoin="round"/></mask><mask id="bm-login-4"><rect x="-56" y="-56" width="112" height="112" fill="#fff"/><path d="M39.08,-35.30 A42,42 0 1 1 -30.54,-5.75 A38,38 0 0 0 39.08,-35.30 Z" fill="#000" stroke="#000" stroke-width="5.5" stroke-linejoin="round"/></mask></defs><g fill="currentColor"><path d="M39.08,-35.30 A42,42 0 1 1 -30.54,-5.75 A38,38 0 0 0 39.08,-35.30 Z" mask="url(#bm-login-0)"/><path d="M45.65,26.26 A42,42 0 1 1 -3.97,-30.82 A38,38 0 0 0 45.65,26.26 Z" mask="url(#bm-login-1)"/><path d="M-10.87,51.53 A42,42 0 1 1 28.09,-13.30 A38,38 0 0 0 -10.87,51.53 Z" mask="url(#bm-login-2)"/><path d="M-52.37,5.59 A42,42 0 1 1 21.32,22.60 A38,38 0 0 0 -52.37,5.59 Z" mask="url(#bm-login-3)"/><path d="M-21.50,-48.08 A42,42 0 1 1 -14.91,27.27 A38,38 0 0 0 -21.50,-48.08 Z" mask="url(#bm-login-4)"/></g></svg>`.replaceAll("bm-login-", prefix);
