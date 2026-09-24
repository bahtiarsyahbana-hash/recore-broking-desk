/**
 * Sidebar collapse — clicking the brand mark toggles the sidebar between its
 * full width and an icon rail. The choice is a per-viewer convenience, kept in
 * localStorage; the app renders correctly without it.
 *
 * Presentation only: no state in core/store.js changes.
 */
import { $ } from "../core/dom.js";

const KEY = "recordes.sidebar.collapsed";

const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const write = (collapsed) => { try { localStorage.setItem(KEY, collapsed ? "1" : "0"); } catch { /* private mode */ } };

function apply(collapsed) {
  const app = $("#app-root");
  const toggle = $("#brand-toggle");
  if (!app || !toggle) return;
  app.classList.toggle("sidebar-collapsed", collapsed);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

/** Wire the brand mark once, at boot, and restore the last choice. */
export function initSidebarToggle() {
  const toggle = $("#brand-toggle");
  if (!toggle) return;
  apply(read());
  toggle.addEventListener("click", () => {
    const collapsed = !$("#app-root").classList.contains("sidebar-collapsed");
    apply(collapsed);
    write(collapsed);
  });
}
