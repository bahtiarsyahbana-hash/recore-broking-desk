/**
 * Pagination for the app's lists and tables.
 *
 * Two pure functions plus a tiny state holder, so every list paginates the
 * same way: a registry of 418 cedants and a claims table of four behave
 * identically in code, and the controls simply do not render when everything
 * already fits on one page.
 */
import { onAction } from "../core/dom.js";

export const PER_PAGE = 10;

/**
 * Slice a list to one page, clamping the page into range so a filter that
 * shrinks the list cannot strand the reader on a page that no longer exists.
 *
 * @returns {{items:any[], page:number, pages:number, total:number, from:number, to:number}}
 */
export function paginate(items, page = 1, perPage = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const start = (current - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    page: current,
    pages,
    total: items.length,
    from: items.length ? start + 1 : 0,
    to: Math.min(start + perPage, items.length),
  };
}

/**
 * Which page numbers to offer: always the first and last, the current and its
 * neighbours, and an ellipsis across whatever is skipped. Forty-two pages of
 * cedants must not become forty-two buttons.
 */
export function pageWindow(current, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const around = [current - 1, current, current + 1].filter((n) => n > 1 && n < pages);
  const out = [1, ...around, pages];
  const withGaps = [];
  out.forEach((n, i) => {
    if (i && n - out[i - 1] > 1) withGaps.push("…");
    withGaps.push(n);
  });
  return withGaps;
}

/**
 * Controls for a paginated result. Returns "" when there is nothing to page
 * through, so a four-row table stays clean.
 *
 * `name` scopes the controls to one pager. A view with two paginated lists —
 * Reports has the accumulation table and the cedant loss table — would
 * otherwise have both respond to either set of buttons.
 *
 * @param {object} result from paginate()
 * @param {{unit?: string, name?: string}} [options]
 */
export function paginationControls(result, { unit = "items", name = "default" } = {}) {
  if (result.pages <= 1) return "";

  const attrs = (n, extra = "") =>
    `data-action="page" data-pager="${name}" data-page="${n}"${extra}`;
  const button = (n) => n === "…"
    ? `<span class="page-gap">…</span>`
    : `<button class="page-btn${n === result.page ? " is-current" : ""}" ${
        attrs(n, n === result.page ? ' aria-current="page"' : "")}>${n}</button>`;

  return `<nav class="pager" aria-label="Pagination">
    <span class="pager-summary">${result.from}–${result.to} of ${result.total} ${unit}</span>
    <span class="pager-controls">
      <button class="page-btn" ${attrs(result.page - 1)}${
        result.page === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>
      ${pageWindow(result.page, result.pages).map(button).join("")}
      <button class="page-btn" ${attrs(result.page + 1)}${
        result.page === result.pages ? " disabled" : ""} aria-label="Next page">›</button>
    </span>
  </nav>`;
}

/**
 * Page state for one list. Views keep one of these and call `go` from their
 * delegated click handler.
 */
export function createPager(onChange, name = "default") {
  let page = 1;
  return {
    name,
    get page() { return page; },
    /** Back to the first page — used whenever a filter changes the list. */
    reset() { page = 1; },
    go(next) { page = Math.max(1, Number(next) || 1); onChange(); },
    /** Wire the page buttons inside `root`, ignoring any other pager's. */
    wire(root) {
      onAction(root, {
        page: (data) => { if ((data.pager || "default") === name) this.go(data.page); },
      });
    },
  };
}
