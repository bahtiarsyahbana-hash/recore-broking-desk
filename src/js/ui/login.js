/**
 * Sign-in screen.
 *
 * ⚠ A prototype gate, not security. Every password is printed on this screen
 * on purpose: the point is to let anyone demonstrate each role, not to keep
 * anyone out. The banner says so, so nobody mistakes it for the real thing.
 *
 * Which portal opens, and what authority applies, both follow from who signs
 * in — there is no role or seat switcher once you are inside.
 */
import { brandMark } from "./brand.js";
import { $, $$, mount, onAction } from "../core/dom.js";
import { authenticate } from "../domain/session.js";
import { brokerUsers, cedantUsers } from "../data/users.data.js";
import { icons } from "./icons.js";

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One demo account. Clicking it fills the form, so nobody has to retype. */
const accountRow = (u) => `<button type="button" class="acct" data-action="fill"
    data-username="${esc(u.username)}" data-password="${esc(u.password)}">
    <span class="acct-avatar">${esc(u.initials)}</span>
    <span class="acct-main">
      <span class="acct-name">${esc(u.name)}</span>
      <span class="acct-title">${esc(u.title)}</span>
      <span class="acct-summary">${esc(u.summary)}</span>
    </span>
    <span class="acct-creds">
      <span class="acct-cred"><em>user</em><code>${esc(u.username)}</code></span>
      <span class="acct-cred"><em>pass</em><code>${esc(u.password)}</code></span>
    </span>
  </button>`;

const accountGroup = (heading, blurb, users) => `<div class="acct-group">
  <div class="acct-group-head">
    <span class="acct-group-title">${heading}</span>
    <span class="acct-group-blurb">${blurb}</span>
  </div>
  ${users.map(accountRow).join("")}
</div>`;

function screen(error) {
  return `<div class="login">
    <div class="login-panel">
      <div class="login-brand">
        <div class="mark">${brandMark("bm-login-")}</div>
        <div>
          <div class="name">Recordes</div>
          <div class="sub">Reinsurance Broking Desk</div>
        </div>
      </div>

      <h1 class="login-title">Sign in</h1>
      <p class="login-sub">Your account decides which workspace opens and what you are authorised to release.</p>

      <form id="login-form" novalidate>
        <div class="field${error ? " has-error" : ""}">
          <label for="login-username">Username</label>
          <input type="text" id="login-username" name="username" autocomplete="username"
            autocapitalize="none" spellcheck="false" placeholder="e.g. vroy">
        </div>
        <div class="field${error ? " has-error" : ""}">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" autocomplete="current-password"
            placeholder="Password">
          ${error ? `<div class="field-error" role="alert">${esc(error)}</div>` : ""}
        </div>
        <button class="btn primary login-submit" type="submit">Sign in</button>
      </form>
    </div>

    <div class="login-accounts">
      <div class="banner warn login-warning">${icons.info}
        <span><strong>Prototype sign-in — not security.</strong> These accounts live in the
        browser and every password is printed below so each role can be demonstrated.
        Nothing here protects any real data.</span>
      </div>
      ${accountGroup("Broker desk", "The full placement, accounting and claims workspace.", brokerUsers())}
      ${accountGroup("Cedant portal", "A restricted, read-only view of one cedant's own book.", cedantUsers())}
    </div>
  </div>`;
}

/**
 * Render the sign-in screen.
 * @param {HTMLElement|string} target
 * @param {(user: object) => void} onSignedIn
 */
export function renderLogin(target, onSignedIn) {
  let error = null;

  function paint() {
    mount(target, screen(error));
    wire();
  }

  function submit(e) {
    e?.preventDefault();
    const result = authenticate($("#login-username").value, $("#login-password").value);
    if (!result.ok) {
      error = result.reason;
      const typed = $("#login-username").value;
      paint();
      // Keep the username, clear the password, focus where the fix belongs.
      $("#login-username").value = typed;
      $("#login-password").focus();
      return;
    }
    onSignedIn(result.user);
  }

  function wire() {
    $("#login-form").addEventListener("submit", submit);

    onAction(target, {
      fill: ({ username, password }) => {
        $("#login-username").value = username;
        $("#login-password").value = password;
        error = null;
        $$(".field.has-error").forEach((f) => f.classList.remove("has-error"));
        $(".field-error")?.remove();
        $(".login-submit").focus();
      },
    });

    $("#login-username").focus();
  }

  paint();
}
