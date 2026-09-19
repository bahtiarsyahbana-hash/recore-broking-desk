/**
 * ReCore Broking Desk — application bootstrap.
 *
 * Wiring order matters: the modal host and shell chrome must exist before any
 * view renders, and views must be registered before a role is selected.
 *
 * Architecture, in one line each:
 *   core/     shell services — config, state, events, routing, DOM helpers
 *   data/     seed fixtures, the shape of the domain
 *   domain/   pure reinsurance maths and the placement state machine
 *   services/ the only writers to state; they publish what changed
 *   ui/       shared presentational pieces — badges, charts, overlays
 *   views/    one screen each: render markup, mount handlers, refresh on events
 */
import { initShell, registerView, setRole } from "./core/router.js";
import { initModalHost } from "./ui/modal.js";
import { ROLES } from "./core/navigation.js";
import { allViews } from "./views/index.js";

function boot() {
  initModalHost();
  initShell();
  allViews.forEach(registerView);
  setRole(ROLES.BROKER);
}

boot();
