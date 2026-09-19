/**
 * Router — owns the sidebar, the active role and which view is on screen.
 *
 * Views register themselves with { id, render, mount?, refresh? }. The router
 * renders the sidebar from the navigation registry, swaps the view's markup
 * into #view-root, and calls the view's hooks. A view never shows or hides
 * another view.
 */
import { $, $$, mount } from "./dom.js";
import { state, currentUser } from "./store.js";
import { emit, TOPICS } from "./events.js";
import { roleChrome, ROLES } from "./navigation.js";
import { DESK_USERS } from "../domain/authority.js";
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
      ? `<div class="nav-label">${entry.section}</div>`
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
 * Switch between the broker desk and the cedant portal. The portal is an
 * optional, restricted module: switching role changes the navigation, the
 * chrome and the landing view together.
 */
export function setRole(role) {
  state.role = role;
  const isCedant = role === ROLES.CEDANT;
  const chrome = roleChrome[role];

  $("#role-broker").classList.toggle("active", !isCedant);
  $("#role-cedant").classList.toggle("active", isCedant);
  $("#nav-broker").hidden = isCedant;
  $("#nav-cedant").hidden = !isCedant;
  $("#cedant-flag-chip").hidden = !isCedant;
  // The cedant portal has one seat; only the broker desk has an acting seat.
  $("#seat-switch").hidden = isCedant;
  $("#avatar").textContent = isCedant ? chrome.avatar : currentUser().initials;
  $("#sidebar-foot").textContent = chrome.footer;

  emit(TOPICS.ROLE, role);
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

  $("#role-broker").addEventListener("click", () => setRole(ROLES.BROKER));
  $("#role-cedant").addEventListener("click", () => setRole(ROLES.CEDANT));

  const seatSelect = $("#seat-select");
  seatSelect.innerHTML = Object.entries(DESK_USERS)
    .map(([seat, u]) => `<option value="${seat}">${u.name} · ${u.title}</option>`)
    .join("");
  seatSelect.value = state.seat;
  seatSelect.addEventListener("change", (e) => setSeat(e.target.value));
}

/**
 * Change who is at the desk. Anything gated on authority — releasing a slip
 * above all — re-reads from here, so the active view is refreshed rather than
 * left showing the previous seat's options.
 */
export function setSeat(seat) {
  state.seat = seat;
  $("#seat-select").value = seat;
  if (state.role !== ROLES.CEDANT) $("#avatar").textContent = currentUser().initials;
  emit(TOPICS.SEAT, seat);
  refreshActiveView();
}
