/**
 * Router — owns the sidebar, the active role and which view is on screen.
 *
 * Views register themselves with { id, render, mount?, refresh? }. The router
 * renders the sidebar from the navigation registry, swaps the view's markup
 * into #view-root, and calls the view's hooks. A view never shows or hides
 * another view.
 */
import { $, $$, mount } from "./dom.js";
import { state, currentUser, currentPortal } from "./store.js";
import { emit, TOPICS } from "./events.js";
import { roleChrome, ROLES } from "./navigation.js";
import { UNDERWRITING_YEAR, BASE_CURRENCY } from "./config.js";

const views = new Map();
let currentView = null;

/** Register a view module. Called once per view at boot. */
export function registerView(view) {
  views.set(view.id, view);
}

/** The view currently on screen, if any. */
export const activeView = () => currentView;

/** Render one role's navigation into its sidebar list. */
function renderNav(container, entries) {
  container.innerHTML = entries.map((entry) =>
    entry.section
      ? `<div class="nav-label">${typeof entry.section === "function" ? entry.section() : entry.section}</div>`
      : `<button class="nav-item" data-view="${entry.view}">${entry.icon}${entry.label}</button>`
  ).join("");
}

/** Swap to a view, rendering its markup and running its hooks. */
export function showView(id) {
  const view = views.get(id);
  if (!view) return;

  currentView = view;
  mount("#view-root", view.render());
  view.mount?.();
  view.refresh?.();

  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  emit(TOPICS.VIEW, id);
}

/** Re-run the active view's refresh hook — used when its data changes. */
export function refreshActiveView() {
  currentView?.refresh?.();
}

/**
 * Open the workspace the signed-in account belongs to.
 *
 * There is no role toggle any more: a broker cannot step into the cedant
 * portal, and a cedant sees only their own book. That is what the portal's own
 * banner has always claimed, and now the app enforces it.
 */
export function openWorkspace() {
  const user = currentUser();
  const portal = currentPortal();
  const isCedant = portal === ROLES.CEDANT;
  const chrome = roleChrome[portal];

  // The sidebar is built at boot, before anyone has signed in, so its headings
  // are re-rendered here now that we know who this is.
  renderNav($("#nav-broker"), roleChrome[ROLES.BROKER].nav);
  renderNav($("#nav-cedant"), roleChrome[ROLES.CEDANT].nav);

  $("#workspace-label").textContent = isCedant ? "Cedant Portal" : "Broker Desk";
  $("#nav-broker").hidden = isCedant;
  $("#nav-cedant").hidden = !isCedant;
  $("#cedant-flag-chip").hidden = !isCedant;

  $("#identity-name").textContent = user.name;
  $("#identity-title").textContent = user.title;
  $("#avatar").textContent = user.initials;
  $("#sidebar-foot").textContent = isCedant
    ? `${user.cedant} · read-only`
    : chrome.footer;

  emit(TOPICS.ROLE, portal);
  showView(chrome.landing);
}

/** Build the sidebar and topbar chrome, and wire navigation clicks. */
export function initShell() {
  renderNav($("#nav-broker"), roleChrome[ROLES.BROKER].nav);
  renderNav($("#nav-cedant"), roleChrome[ROLES.CEDANT].nav);

  $("#chip-uwy").textContent = `FY${UNDERWRITING_YEAR}`;
  $("#chip-ccy").textContent = `Base ccy ${BASE_CURRENCY}`;

  document.querySelector(".app").addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) showView(item.dataset.view);
  });

}

/** Wire sign-out once, at boot. */
export function onSignOut(handler) {
  $("#sign-out").addEventListener("click", handler);
}
