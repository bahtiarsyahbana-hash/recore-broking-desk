/**
 * Treaty Engine — administration of treaty agreements negotiated and bound
 * outside Recordes. The agreement is the master record; premium bordereaux,
 * claims bordereaux, individual cessions, technical accounts and settlements
 * each reference one. Nothing here passes through Placement.
 *
 * Six workstream tabs. Agreements offer Table, List and Cards, with the
 * choice remembered for the browser session, and filters shared by all three.
 */
import { $, $$, mount, onAction } from "../../core/dom.js";
import { fmt, fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { TODAY } from "../../core/config.js";
import { statusPill, typeBadge, subBadge, emptyState } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { openTreatyWizard } from "../../ui/treaty-wizard.js";
import { openAgreementDetail } from "../../ui/treaty-detail.js";
import { openRemittanceDetail } from "../../ui/remittance-detail.js";
import { remittancesForAgreement } from "../../services/payments.service.js";
import { fromCents } from "../../domain/billing.js";
import {
  TREATY_TYPES, AGREEMENT_STATUSES, filterAgreements, expiryIndicator, panelTotal, structureSummary, accountNet, requiresDeclarations,
} from "../../domain/treaty.js";

const WORKSTREAMS = [
  ["agreements", "Agreements"], ["premium", "Premium Bordereaux"], ["claims", "Claims Bordereaux"],
  ["cessions", "Individual Cessions"], ["accounts", "Technical Accounts"], ["settlements", "Settlements"],
];
const VIEWS = { table: "Table", list: "List", cards: "Cards" };
const VIEW_KEY = "recordes.treaty.view";
const remembered = () => { try { return sessionStorage.getItem(VIEW_KEY) || "table"; } catch { return "table"; } };
const remember = (v) => { try { sessionStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

let workstream = "agreements";
let view = VIEWS[remembered()] ? remembered() : "table";
let filters = { q: "", cedant: "all", cls: "all", period: "all", status: "all", type: "all", reinsurer: "all", ccy: "all" };
let agreementFilter = "all";
const pager = createPager(() => treatyView.refresh(), "treaty");

const A = () => state.treaty.agreements;
const byId = (id) => A().find((a) => a.id === id);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const distinct = (fn) => [...new Set(A().flatMap(fn).filter(Boolean))].sort();

/* ---------- agreements ---------- */

const opt = (list, selected, all) => `<option value="all"${selected === "all" ? " selected" : ""}>${all}</option>` + list.map((v) => `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(v)}</option>`).join("");

function filterBar() {
  const years = distinct((a) => { const from = +(a.inception || "").slice(0, 4); const to = +(a.expiry || "").slice(0, 4); return from && to ? Array.from({ length: to - from + 1 }, (_, i) => String(from + i)) : []; });
  return `<div class="tfilters" id="tfilters">
    <input type="search" data-f="q" value="${esc(filters.q)}" placeholder="Search agreements" aria-label="Search agreements">
    <select data-f="cedant" aria-label="Cedant">${opt(distinct((a) => a.cedant), filters.cedant, "All cedants")}</select>
    <select data-f="cls" aria-label="Class of business">${opt(distinct((a) => a.cls), filters.cls, "All classes")}</select>
    <select data-f="period" aria-label="Contract period">${opt(years, filters.period, "Any period")}</select>
    <select data-f="status" aria-label="Status">${opt(AGREEMENT_STATUSES, filters.status, "All statuses")}</select>
    <select data-f="type" aria-label="Treaty type">${opt(TREATY_TYPES, filters.type, "All treaty types")}</select>
    <select data-f="reinsurer" aria-label="Reinsurer">${opt(distinct((a) => a.panel.map((p) => p.reinsurer)), filters.reinsurer, "All reinsurers")}</select>
    <select data-f="ccy" aria-label="Currency">${opt(distinct((a) => a.ccy), filters.ccy, "All currencies")}</select>
    ${Object.entries(filters).some(([k, v]) => (k === "q" ? v : v !== "all")) ? `<button class="btn ghost reset" data-action="reset-filters">Clear filters</button>` : ""}
  </div>`;
}

const expiryTag = (a) => { const i = expiryIndicator(a, TODAY); return a.status === "Closed" ? "" : subBadge(i.label, i.tone); };
const panelNote = (a) => `${a.panel.length} reinsurer${a.panel.length === 1 ? "" : "s"} · ${panelTotal(a.panel).toFixed(0)}%`;

const tableRow = (a) => `<tr>
  <td><strong>${a.id}</strong><div class="muted" style="font-size:11px;">${esc(a.name)}</div></td>
  <td>${esc(a.cedant)}</td><td>${esc(a.cls || "—")}</td><td>${typeBadge(a.type)}</td>
  <td>${structureSummary(a, (n) => fmt(n, a.ccy))}</td>
  <td>${a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "—"}<div style="margin-top:3px;">${expiryTag(a)}</div></td>
  <td>${a.ccy}</td><td>${panelNote(a)}</td><td>${statusPill(a.status)}</td>
  <td><button class="btn ghost" style="padding:5px 10px;" data-action="open-agreement" data-id="${a.id}">Open →</button></td></tr>`;

const listRow = (a) => `<div class="lrow" data-action="open-agreement" data-id="${a.id}" role="button" tabindex="0">
  <div class="lrow-main"><div><strong>${a.id}</strong> · ${esc(a.name)} ${typeBadge(a.type)}</div>
    <div class="lrow-meta">${esc(a.cedant)} · ${esc(a.cls || "—")} · ${structureSummary(a, (n) => fmt(n, a.ccy))} · ${panelNote(a)}</div></div>
  <div class="lrow-side"><div class="mono">${a.ccy} · ${a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "period not set"}</div><div>${statusPill(a.status)} ${expiryTag(a)}</div></div></div>`;

const card = (a) => `<article class="tcard" data-action="open-agreement" data-id="${a.id}" role="button" tabindex="0" aria-label="Open ${a.id}">
  <div class="tcard-top"><strong>${a.id}</strong>${typeBadge(a.type)}</div>
  <div class="tcard-title">${esc(a.name)}</div>
  <div class="tcard-meta">${esc(a.cedant)} · ${esc(a.cls || "—")}</div>
  <div class="tcard-meta mono">${structureSummary(a, (n) => fmt(n, a.ccy))}</div>
  <div class="tcard-meta">${a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "Period not set"} · ${a.ccy} · ${panelNote(a)}</div>
  <div class="tcard-foot">${statusPill(a.status)}${expiryTag(a)}</div></article>`;

function agreementsBody() {
  const shown = filterAgreements(A(), filters);
  const page = paginate(shown, pager.page);
  const empty = emptyState(A().length ? "No agreements match these filters." : "No treaty agreements registered yet.");
  let body;
  if (view === "table") body = `<div class="table-wrap"><table><thead><tr><th>Agreement</th><th>Cedant</th><th>Class</th><th>Type</th><th>Structure</th><th>Contract period</th><th>Ccy</th><th>Panel</th><th>Status</th><th></th></tr></thead><tbody>${page.items.map(tableRow).join("") || `<tr><td colspan="10">${empty}</td></tr>`}</tbody></table></div>`;
  else if (view === "list") body = `<div class="lrows">${page.items.map(listRow).join("") || empty}</div>`;
  else body = page.items.length ? `<div class="tcards">${page.items.map(card).join("")}</div>` : empty;
  return `<div class="toolbar" style="justify-content:space-between;">
      <div class="seg" id="treaty-view" role="tablist" aria-label="View">${Object.entries(VIEWS).map(([k, l]) => `<button class="${k === view ? "active" : ""}" data-v="${k}" role="tab" aria-selected="${k === view}">${l}</button>`).join("")}</div>
      <span class="chip">${shown.length} of ${A().length} agreements</span></div>
    ${filterBar()}${body}${paginationControls(page, { unit: "agreements", name: "treaty" })}`;
}

/* ---------- workstreams ---------- */

const agreementCell = (id) => { const a = byId(id); return `<button class="btn ghost" style="padding:3px 8px;" data-action="open-agreement" data-id="${id}" data-tab="__WS__">${id}</button>${a ? `<div class="muted" style="font-size:11px;">${esc(a.cedant)}</div>` : ""}`; };

function workstreamBody() {
  const t = state.treaty;
  const scope = (list) => list.filter((r) => agreementFilter === "all" || r.agreementId === agreementFilter);
  const selector = (eligible = A()) => `<div class="toolbar" style="justify-content:space-between;">
    <select id="treaty-agreement-filter" aria-label="Agreement">${opt(eligible.map((a) => a.id), agreementFilter, "All agreements")}</select>
    ${agreementFilter !== "all" ? `<button class="btn primary" data-action="open-agreement" data-id="${agreementFilter}" data-tab="__WS__">Open ${agreementFilter} →</button>` : `<span class="chip">Open an agreement to record a new entry</span>`}</div>`;
  const tbl = (heads, rows, empty) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${h.replace(/^#/, "")}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : emptyState(empty);
  switch (workstream) {
    case "premium": return selector() + tbl(["Reference", "Agreement", "Period", "Cedant", "#Gross premium", "#Ceded premium", "#Commission", "Ccy", "Received", "Due", "Status"],
      scope(t.premiumBordereaux).map((b) => `<tr><td><strong>${b.ref}</strong></td><td>${agreementCell(b.agreementId).replace("__WS__", "bordereaux")}</td><td>${esc(b.period)}</td><td>${esc(byId(b.agreementId)?.cedant)}</td><td class="num">${fmtFull(b.grossPremium, b.ccy)}</td><td class="num">${fmtFull(b.cededPremium, b.ccy)}</td><td class="num">${fmtFull(b.commission || 0, b.ccy)}</td><td>${b.ccy}</td><td>${b.receivedDate || "—"}</td><td>${b.dueDate || "—"}</td><td>${statusPill(b.status)}</td></tr>`), "No premium bordereaux.");
    case "claims": return selector() + tbl(["Reference", "Agreement", "Period", "#Claims", "#Paid", "#Outstanding", "#Incurred", "#Recoverable", "Ccy", "Status"],
      scope(t.claimsBordereaux).map((b) => `<tr><td><strong>${b.ref}</strong></td><td>${agreementCell(b.agreementId).replace("__WS__", "claims")}</td><td>${esc(b.period)}</td><td class="num">${b.claimCount}</td><td class="num">${fmtFull(b.paid, b.ccy)}</td><td class="num">${fmtFull(b.outstanding, b.ccy)}</td><td class="num">${fmtFull((b.paid || 0) + (b.outstanding || 0), b.ccy)}</td><td class="num">${fmtFull(b.recoverable || 0, b.ccy)}</td><td>${b.ccy}</td><td>${statusPill(b.status)}</td></tr>`), "No claims bordereaux.");
    case "cessions": {
      const eligible = A().filter(requiresDeclarations);
      return `<div class="banner neutral">${icons.info}Individual cessions apply only to agreements configured to require declarations — ${eligible.length ? eligible.map((a) => a.id).join(", ") : "none at present"}.</div>`
        + selector(eligible) + tbl(["Reference", "Agreement", "Insured / risk", "Class", "#Sum insured", "#Cedant retention", "#Ceded", "Effective", "Status"],
          scope(t.cessions).map((c) => { const a = byId(c.agreementId); return `<tr><td><strong>${c.ref}</strong></td><td>${agreementCell(c.agreementId).replace("__WS__", "cessions")}</td><td>${esc(c.insured)}</td><td>${esc(c.cls)}</td><td class="num">${fmtFull(c.sumInsured, a?.ccy)}</td><td class="num">${fmtFull(c.retention, a?.ccy)}</td><td class="num">${fmtFull(c.ceded, a?.ccy)}</td><td>${c.effectiveDate}</td><td>${statusPill(c.status)}</td></tr>`; }), "No individual cessions declared.");
    }
    case "accounts": return selector() + tbl(["Reference", "Agreement", "Period", "#Premium", "#Commission", "#Claims", "#Tax", "#Net balance", "Ccy", "Status"],
      scope(t.technicalAccounts).map((x) => `<tr><td><strong>${x.ref}</strong></td><td>${agreementCell(x.agreementId).replace("__WS__", "accounts")}</td><td>${esc(x.period)}</td><td class="num">${fmtFull(x.premium, x.ccy)}</td><td class="num">${fmtFull(x.commission, x.ccy)}</td><td class="num">${fmtFull(x.claims, x.ccy)}</td><td class="num">${fmtFull(x.tax, x.ccy)}</td><td class="num"><strong>${fmtFull(accountNet(x), x.ccy)}</strong></td><td>${x.ccy}</td><td>${statusPill(x.status)}</td></tr>`), "No technical accounts.");
    case "settlements": {
      const rems = A().flatMap((a) => remittancesForAgreement(a.id)).filter((m) => agreementFilter === "all" || m.agreementId === agreementFilter);
      const manual = scope(t.settlements).map((s) => `<tr><td><strong>${s.ref}</strong></td><td>${agreementCell(s.agreementId).replace("__WS__", "settlements")}</td><td>${esc(s.accountRef) || "—"}</td><td>${esc(s.counterparty)}</td><td class="num">${fmtFull(s.amount, s.ccy)}</td><td>${s.ccy}</td><td>${s.dueDate}</td><td>${statusPill(s.paymentStatus)}</td></tr>`);
      const finance = rems.map((m) => `<tr class="reg-tr" data-action="open-remittance" data-ref="${m.ref}"><td><strong>${m.ref}</strong> ${subBadge("Finance")}</td><td>${agreementCell(m.agreementId).replace("__WS__", "settlements")}</td><td>${esc(m.closingSlipId)}</td><td>${esc(m.reinsurer)}</td><td class="num">${fmtFull(fromCents(m.cents), m.ccy)}</td><td>${m.ccy}</td><td>${m.paidDate || "—"}</td><td>${statusPill(m.status)}</td></tr>`);
      return selector() + tbl(["Reference", "Agreement", "Account / slip", "Counterparty", "#Amount", "Ccy", "Due / paid", "Status"], [...finance, ...manual], "No settlements.");
    }
    default: return "";
  }
}

/* ---------- view ---------- */

export const treatyView = {
  id: "treaty",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Treaty Engine</h1>
        <p>Treaty agreements bound outside Recordes.</p></div>
      <button class="btn primary" data-action="register">${icons.plus}Register Treaty Agreement</button>
    </div>
    <div class="tabs" id="treaty-tabs">${WORKSTREAMS.map(([k, l]) => `<div class="tab${k === workstream ? " active" : ""}" data-w="${k}" role="tab">${l}</div>`).join("")}</div>
    <div id="treaty-body"></div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "register": () => openTreatyWizard((id) => openAgreementDetail(id)),
      "open-agreement": ({ id, tab }) => openAgreementDetail(id, tab || "overview"),
      "open-remittance": ({ ref }) => openRemittanceDetail(ref),
      "reset-filters": () => { filters = { q: "", cedant: "all", cls: "all", period: "all", status: "all", type: "all", reinsurer: "all", ccy: "all" }; pager.reset(); treatyView.refresh(); },
    });
    pager.wire("#view-root");
    $$("#treaty-tabs .tab").forEach((t) => t.addEventListener("click", () => { workstream = t.dataset.w; $$("#treaty-tabs .tab").forEach((x) => x.classList.toggle("active", x === t)); pager.reset(); treatyView.refresh(); }));
    const root = $("#view-root");
    root.addEventListener("click", (e) => {
      const v = e.target.closest("#treaty-view button"); if (v) { view = v.dataset.v; remember(view); treatyView.refresh(); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset.f === "q") { filters.q = e.target.value; pager.reset(); mountAgreementsOnly(); }
    });
    root.addEventListener("change", (e) => {
      if (e.target.dataset.f && e.target.dataset.f !== "q") { filters[e.target.dataset.f] = e.target.value; pager.reset(); treatyView.refresh(); }
      if (e.target.id === "treaty-agreement-filter") { agreementFilter = e.target.value; treatyView.refresh(); }
    });
    root.addEventListener("keydown", (e) => {
      const t = e.target.closest?.("[data-action='open-agreement'][tabindex]");
      if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openAgreementDetail(t.dataset.id); }
    });
  },

  refresh() { mount("#treaty-body", workstream === "agreements" ? agreementsBody() : workstreamBody()); },
};

/** Keep the search box focused: repaint everything below the filters only. */
function mountAgreementsOnly() {
  const body = $("#treaty-body"); if (!body) return;
  const html = agreementsBody();
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const filtersEl = body.querySelector("#tfilters");
  [...body.children].forEach((c) => { if (c !== filtersEl && !c.classList.contains("toolbar")) c.remove(); });
  [...tmp.children].forEach((c) => { if (c.id !== "tfilters" && !c.classList.contains("toolbar")) body.appendChild(c); });
  const chip = body.querySelector(".toolbar .chip"); const fresh = tmp.querySelector(".toolbar .chip"); if (chip && fresh) chip.textContent = fresh.textContent;
}

on(TOPICS.TREATY, () => { if (document.getElementById("treaty-body")) treatyView.refresh(); });
