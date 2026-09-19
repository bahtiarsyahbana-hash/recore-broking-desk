/**
 * Recordes Reinsurance Broking Desk — application bootstrap.
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
import { $ } from "./core/dom.js";
import { state } from "./core/store.js";
import { initShell, registerView, openWorkspace, onSignOut } from "./core/router.js";
import { initModalHost } from "./ui/modal.js";
import { renderLogin } from "./ui/login.js";
import { allViews } from "./views/index.js";

/** Swap between the sign-in screen and the application shell. */
function show(screen) {
  $("#login-root").hidden = screen !== "login";
  $("#app-root").hidden = screen !== "app";
}

function signIn(user) {
  state.session = user;
  $("#login-root").innerHTML = "";
  show("app");
  openWorkspace();
}

function signOut() {
  state.session = null;
  show("login");
  renderLogin("#login-root", signIn);
}

function boot() {
  initModalHost();
  initShell();
  allViews.forEach(registerView);
  onSignOut(signOut);

  // Nothing of the desk is rendered until an account is chosen.
  show("login");
  renderLogin("#login-root", signIn);
}

boot();
