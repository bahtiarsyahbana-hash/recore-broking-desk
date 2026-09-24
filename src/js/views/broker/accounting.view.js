/**
 * Finance — billing the desk's premium, and the running technical accounts.
 *
 *   Billing Queue      draft and pending batches, and everything issued
 *   Invoices & Notes   what the cedant received: invoices, debit and credit notes
 *   Closing Slips      what each reinsurer received
 *   Tax Rules          the custom taxes and levies the desk has configured
 *   Technical Accounts the per-program account and the aged creditor position
 *
 * Documents raised by the earlier desk directly to reinsurers stay readable,
 * marked Legacy. Every write goes through billing.service.js.
 */
import { $, $$, mount, row, onAction } from "../../core/dom.js";
import { fmt, fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { agedCreditors } from "../../data/finance.data.js";
import { technicalAccount } from "../../domain/technical-account.js";
import { financeBadge, statusPill, subBadge, emptyState } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { openFormModal } from "../../ui/form-modal.js";
import { openBillingDetail } from "../../ui/billing-detail.js";
import {
  issuedDocuments, addTaxRule, updateTaxRule, removeTaxRule, addBrokerAccount, updateBrokerAccount, removeBrokerAccount,
} from "../../services/billing.service.js";
import {
  fromCents, TAX_BASES, TAX_BEARERS, TAX_APPLIES, TAX_JURISDICTION_OF, SOURCE_KINDS, ACCOUNT_PURPOSES,
  validateTaxRule, validateBrokerAccount,
} from "../../domain/billing.js";
import { SETTLEMENT_CURRENCIES } from "./registry-fields.js";
import { BROKING_FIRM } from "../../core/config.js";

const TABS = [["billing", "Billing Queue"], ["cedant", "Invoices & Notes"], ["slips", "Closing Slips"], ["accounts", "Bank Accounts"], ["tax", "Tax Rules"], ["tech", "Technical Accounts"]];
const BATCH_FILTERS = { open: ["Open", (b) => b.status === "Draft" || b.status === "Pending Approval"], issued: ["Issued", (b) => b.status === "Issued"], cancelled: ["Cancelled", (b) => b.status === "Cancelled"], all: ["All", () => true] };

let tab = "billing";
let batchFilter = "open";
let selectedId = null;
const pager = createPager(() => accountingView.refresh(), "finance");

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const money = (cents, ccy) => fmtFull(fromCents(cents), ccy);
const table = (heads, rows, empty) => rows.length
  ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${h.replace(/^#/, "")}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
  : emptyState(empty);

/* ---------- billing queue ---------- */

function billingTab() {
  const all = state.billing.batches;
  const shown = all.filter(BATCH_FILTERS[batchFilter][1]);
  const page = paginate(shown, pager.page);
  const seg = `<div class="seg" id="batch-filter">${Object.entries(BATCH_FILTERS).map(([k, [l, f]]) => `<button class="${k === batchFilter ? "active" : ""}" data-bf="${k}">${l}<span class="seg-badge">${all.filter(f).length}</span></button>`).join("")}</div>`;
  const rows = page.items.map((b) => `<tr class="reg-tr" data-action="open-batch" data-ref="${b.ref}" tabindex="0">
    <td><strong>${b.ref}</strong></td><td>${esc(SOURCE_KINDS[b.sourceKind])}<div class="muted" style="font-size:11px;">${esc(b.sourceLabel)}</div></td>
    <td>${esc(b.cedant)}</td><td>${financeBadge(b.cedantDocType)} ${subBadge(`${b.computed.slips.length} CS`)}</td>
    <td class="num">${money(b.computed.cedant.total, b.ccy)}</td><td>${b.dueDate || (b.sourceKind === "reversal" ? "—" : "<span class='muted'>Not set</span>")}</td>
    <td>${esc(b.preparedBy?.name)}</td><td>${statusPill(b.status)}</td></tr>`);
  return `<div class="toolbar">${seg}</div>
    ${table(["Batch", "Source", "Cedant", "Documents", "#Cedant total", "Due", "Prepared by", "Status"], rows,
      all.length ? "Nothing in this filter." : "No billing yet. Binding a placement, recording a placement endorsement, or moving a treaty technical account to Agreed prepares a draft here.")}
    ${paginationControls(page, { unit: "batches", name: "finance" })}`;
}

/* ---------- documents ---------- */

const legacyDocs = () => state.financeDocs.map((f) => ({ ...f, legacy: true }));

function cedantTab() {
  const issued = issuedDocuments().filter((d) => d.role === "Cedant");
  const legacy = legacyDocs();
  const page = paginate([...issued, ...legacy], pager.page);
  const rows = page.items.map((d) => d.legacy
    ? `<tr><td class="mono">${d.id}</td><td>${financeBadge(d.type)} ${subBadge("Legacy")}</td><td>${esc(d.program)}</td><td>${esc(d.counterparty)}</td><td class="num">${fmtFull(d.amount, d.ccy)}</td><td>${d.date}</td><td>—</td><td>—</td></tr>`
    : `<tr class="reg-tr" data-action="open-batch" data-ref="${d.batchRef}" tabindex="0"><td class="mono">${d.id}</td><td>${financeBadge(d.docType)}${d.batchStatus === "Cancelled" ? ` ${subBadge("Cancelled", "bad")}` : ""}</td><td>${esc(d.sourceLabel)}</td><td>${esc(d.counterparty)}</td><td class="num">${money(d.total, d.ccy)}</td><td>${d.issueDate}</td><td>${d.dueDate || "—"}</td><td>${statusPill(d.delivery)}</td></tr>`);
  return `<div class="panel-sub">What each cedant received. Legacy documents were raised by the earlier desk directly to reinsurers and are read-only.</div>
    ${table(["Doc #", "Type", "Source", "Counterparty", "#Amount", "Issued", "Due", "Delivery"], rows, "No documents issued yet.")}
    ${paginationControls(page, { unit: "documents", name: "finance" })}`;
}

function slipsTab() {
  const slips = issuedDocuments().filter((d) => d.docType === "Closing Slip");
  const page = paginate(slips, pager.page);
  const rows = page.items.map((d) => `<tr class="reg-tr" data-action="open-batch" data-ref="${d.batchRef}" tabindex="0"><td class="mono">${d.id}</td><td>${esc(d.counterparty)}</td><td>${Math.round(d.share * 10000) / 100}%</td><td>${esc(d.sourceLabel)}</td><td class="num">${money(d.total, d.ccy)}</td><td>${d.issueDate}</td><td>${statusPill(d.delivery)}${d.batchStatus === "Cancelled" ? ` ${subBadge("Cancelled", "bad")}` : ""}</td></tr>`);
  return `<div class="panel-sub">What each reinsurer is due: its share of premium, less commission, brokerage and any tax withheld.</div>
    ${table(["CS #", "Reinsurer", "Share", "Source", "#Net to reinsurer", "Issued", "Delivery"], rows, "No closing slips issued yet.")}
    ${paginationControls(page, { unit: "closing slips", name: "finance" })}`;
}

/* ---------- the broker's bank accounts ---------- */

function accountsTab() {
  const accounts = state.billing.brokerAccounts;
  const byCcy = [...new Set(accounts.map((a) => a.ccy))].sort();
  const coverage = byCcy.length ? byCcy.map((c) => {
    const ok = accounts.some((a) => a.ccy === c && a.active !== false && a.purpose !== "Remittance");
    return subBadge(`${c}${ok ? "" : " · no collection"}`, ok ? "good" : "warn");
  }).join(" ") : "";
  const rows = accounts.map((a) => `<tr class="${a.active === false ? "is-idle" : ""}">
    <td><strong>${esc(a.bankName)}</strong>${a.branch ? `<div class="muted" style="font-size:11px;">${esc(a.branch)}</div>` : ""}</td>
    <td>${esc(a.accountName)}</td>
    <td class="mono">${esc(a.accountNo) || "—"}${a.iban ? `<div class="muted" style="font-size:11px;">IBAN ${esc(a.iban)}</div>` : ""}</td>
    <td class="mono">${esc(a.swift) || "—"}</td><td>${esc(a.ccy)}</td><td>${esc(a.purpose)}</td>
    <td>${a.primary ? subBadge("Primary", "good") : ""}</td>
    <td>${statusPill(a.active === false ? "Draft" : "Active")}</td>
    <td class="wrow-actions"><button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="edit-account" data-id="${a.id}">Edit</button><button class="btn ghost line-remove" data-action="remove-account" data-id="${a.id}" title="Remove">✕</button></td></tr>`);
  return `<div class="toolbar" style="justify-content:space-between;">
      <div class="panel-sub" style="margin:0;">${esc(BROKING_FIRM)}'s own accounts. The primary collection account in a document's currency is printed on every invoice and debit note.</div>
      <button class="btn primary" data-action="add-account">${icons.plus}Add bank account</button></div>
    ${coverage ? `<div class="toolbar">${coverage}</div>` : ""}
    ${table(["Bank", "Account name", "Account no.", "SWIFT / BIC", "Ccy", "Purpose", "", "Status", ""], rows, "No bank accounts yet. Invoices issue without payment instructions until a collection account is added.")}`;
}

const accountFields = (a = {}) => [
  { name: "bankName", label: "Bank", type: "text", required: true, value: a.bankName || "", placeholder: "e.g. Bank Mandiri" },
  { name: "accountName", label: "Account name", type: "text", required: true, value: a.accountName || BROKING_FIRM, hint: "As the bank knows the holder." },
  { name: "accountNo", label: "Account number", type: "text", value: a.accountNo || "", half: true },
  { name: "ccy", label: "Currency", type: "select", options: SETTLEMENT_CURRENCIES, value: a.ccy || "USD", half: true },
  { name: "swift", label: "SWIFT / BIC", type: "text", value: a.swift || "", half: true, placeholder: "8 or 11 characters" },
  { name: "iban", label: "IBAN", type: "text", value: a.iban || "", half: true, placeholder: "Where applicable" },
  { name: "branch", label: "Branch", type: "text", value: a.branch || "", half: true },
  { name: "purpose", label: "Purpose", type: "select", options: ACCOUNT_PURPOSES, value: a.purpose || "Collection", half: true,
    hint: "Collection: cedants pay in. Remittance: reinsurers are paid from it." },
  { name: "primary", label: "Primary for this currency", type: "select", options: ["No", "Yes"], value: a.primary ? "Yes" : "No", half: true },
  { name: "active", label: "Active", type: "select", options: ["Yes", "No"], value: a.active === false ? "No" : "Yes", half: true },
  { name: "notes", label: "Notes", type: "textarea", rows: 2, value: a.notes || "", placeholder: "Intermediary bank, reference format, cut-off times" },
];

/* ---------- tax rules ---------- */

function taxTab() {
  const rules = state.billing.taxRules;
  const rows = rules.map((r) => `<tr><td><strong>${esc(r.name)}</strong>${r.notes ? `<div class="muted" style="font-size:11px;">${esc(r.notes)}</div>` : ""}</td>
    <td class="num">${r.rate}%</td><td>${esc(r.basis)}</td><td>${esc(r.bearer)}</td><td>${esc(r.appliesTo)}</td>
    <td>${r.country ? `${esc(r.country)} <span class="muted">(${esc(r.jurisdictionOf.toLowerCase())})</span>` : "Any"}</td>
    <td>${statusPill(r.active ? "Active" : "Draft")}</td>
    <td class="wrow-actions"><button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="edit-tax" data-id="${r.id}">Edit</button><button class="btn ghost line-remove" data-action="remove-tax" data-id="${r.id}" title="Remove">✕</button></td></tr>`);
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-sub" style="margin:0;">Taxes and levies are configured here, with your tax adviser. Nothing is preset. Rules apply to open drafts at once; issued documents never change.</div>
      <button class="btn primary" data-action="add-tax">${icons.plus}Add tax rule</button></div>
    ${table(["Name", "#Rate", "Basis", "Borne by", "Applies to", "Jurisdiction", "Status", ""], rows, "No tax rules configured.")}`;
}

const taxFields = (r = {}) => [
  { name: "name", label: "Name", type: "text", required: true, value: r.name || "", placeholder: "e.g. Withholding tax on premium ceded abroad" },
  { name: "rate", label: "Rate %", type: "number", required: true, value: r.rate ?? "", half: true, validate: (v) => (Number(v) >= 0 && Number(v) <= 100 ? null : "Rate must be between 0 and 100%.") },
  { name: "basis", label: "Basis", type: "select", options: TAX_BASES, value: r.basis || TAX_BASES[0], half: true },
  { name: "bearer", label: "Borne by", type: "select", options: TAX_BEARERS, value: r.bearer || "Cedant", half: true,
    hint: "Cedant: added to the cedant document. Reinsurer: withheld on the closing slip. Broker: recorded as the broker's cost." },
  { name: "appliesTo", label: "Applies to", type: "select", options: TAX_APPLIES, value: r.appliesTo || "Both", half: true },
  { name: "jurisdictionOf", label: "Jurisdiction follows", type: "select", options: TAX_JURISDICTION_OF, value: r.jurisdictionOf || TAX_JURISDICTION_OF[0], half: true },
  { name: "country", label: "Country", type: "text", value: r.country || "", half: true, placeholder: "Blank for any country" },
  { name: "active", label: "Active", type: "select", options: ["Yes", "No"], value: r.active === false ? "No" : "Yes", half: true },
  { name: "notes", label: "Notes", type: "textarea", rows: 2, value: r.notes || "", placeholder: "Legal reference, adviser confirmation" },
];

/* ---------- technical accounts (unchanged) ---------- */

function paintTechnicalAccount() {
  const p = state.programs.find((x) => x.id === selectedId) || state.programs[0];
  if (!p) return;
  const t = technicalAccount(p);
  mount("#acc-sub", `${p.type} · ${p.structure} · ${p.ccy}`);
  mount("#acc-out", row("Ceded / treaty premium", fmtFull(t.ceded, p.ccy)) + row("Ceding commission", "−" + fmtFull(t.cedingCommission, p.ccy)) + row("Brokerage", "−" + fmtFull(t.brokerage, p.ccy)) + row("Claims booked", "−" + fmtFull(t.claims, p.ccy)) + row("Net technical result", fmtFull(t.net, p.ccy)));
}

function techTab() {
  if (!state.programs.some((p) => p.id === selectedId)) selectedId = state.programs[0]?.id ?? null;
  const bucket = (v, tone) => (v ? (tone ? `<span class="pill ${tone}" style="padding:1px 7px;">${fmt(v)}</span>` : fmt(v)) : "—");
  return `<div class="field" style="max-width:360px;"><label>Select program</label>
      <select id="acc-select">${state.programs.map((p) => `<option value="${p.id}"${p.id === selectedId ? " selected" : ""}>${p.id} · ${esc(p.cedant)} · ${p.cls}</option>`).join("")}</select></div>
    <div class="cols-2">
      <div class="card"><div class="panel-title">Technical account</div><div class="panel-sub" id="acc-sub"></div><div class="calc-out" id="acc-out"></div></div>
      <div class="card"><div class="panel-title">Aged creditor position — reinsurers</div><div class="panel-sub">Balances due from the desk to its markets</div>
        <div class="table-wrap"><table><thead><tr><th>Market</th><th class="num">Current</th><th class="num">30d</th><th class="num">60d</th><th class="num">90d+</th></tr></thead>
        <tbody>${agedCreditors.map((a) => `<tr><td>${a.m}</td><td class="num">${fmt(a.cur)}</td><td class="num">${bucket(a.d30)}</td><td class="num">${bucket(a.d60, "warn")}</td><td class="num">${bucket(a.d90, "bad")}</td></tr>`).join("")}</tbody></table></div></div>
    </div>`;
}

const BODY = { billing: billingTab, cedant: cedantTab, slips: slipsTab, accounts: accountsTab, tax: taxTab, tech: techTab };

export const accountingView = {
  id: "accounting",

  render: () => `<section class="view">
    <div class="view-head"><div><h1>Finance</h1><p>Premium billing, closing slips and technical accounts.</p></div></div>
    <div class="tabs" id="fin-tabs">${TABS.map(([k, l]) => {
      const n = k === "billing" ? state.billing.batches.filter(BATCH_FILTERS.open[1]).length : 0;
      return `<div class="tab${k === tab ? " active" : ""}" data-t="${k}">${l}${n ? ` <span class="seg-badge">${n}</span>` : ""}</div>`;
    }).join("")}</div>
    <div id="fin-body"></div>
  </section>`,

  mount() {
    const root = $("#view-root");
    onAction("#view-root", {
      "open-batch": ({ ref }) => openBillingDetail(ref),
      "add-tax": () => openFormModal({ title: "Add tax rule", fields: taxFields(), submitLabel: "Add rule",
        validate: (v) => addTaxRuleDry(v), onSubmit: (v) => addTaxRule(v) }),
      "edit-tax": ({ id }) => { const r = state.billing.taxRules.find((x) => x.id === id); if (!r) return;
        openFormModal({ title: `Edit ${r.name}`, fields: taxFields(r), submitLabel: "Save", onSubmit: (v) => updateTaxRule(id, v) }); },
      "remove-tax": ({ id }) => removeTaxRule(id),
      "add-account": () => openFormModal({ title: "Add bank account", subtitle: `${BROKING_FIRM} · collection and remittance`, fields: accountFields(), submitLabel: "Add account",
        validate: (v) => validateBrokerAccount(v), onSubmit: (v) => addBrokerAccount(v) }),
      "edit-account": ({ id }) => { const a = state.billing.brokerAccounts.find((x) => x.id === id); if (!a) return;
        openFormModal({ title: `Edit ${a.bankName} · ${a.ccy}`, subtitle: "Issued documents keep the account they were issued with.", fields: accountFields(a), submitLabel: "Save",
          validate: (v) => validateBrokerAccount(v), onSubmit: (v) => updateBrokerAccount(id, v) }); },
      "remove-account": ({ id }) => removeBrokerAccount(id),
    });
    pager.wire("#view-root");
    $$("#fin-tabs .tab").forEach((t) => t.addEventListener("click", () => {
      tab = t.dataset.t; pager.reset();
      $$("#fin-tabs .tab").forEach((x) => x.classList.toggle("active", x === t));
      accountingView.refresh();
    }));
    root.addEventListener("click", (e) => { const b = e.target.closest("#batch-filter button"); if (b) { batchFilter = b.dataset.bf; pager.reset(); accountingView.refresh(); } });
    root.addEventListener("change", (e) => { if (e.target.id === "acc-select") { selectedId = e.target.value; paintTechnicalAccount(); } });
    root.addEventListener("keydown", (e) => {
      const t = e.target.closest?.("[data-action='open-batch'][tabindex]");
      if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openBillingDetail(t.dataset.ref); }
    });
  },

  refresh() {
    mount("#fin-body", BODY[tab]());
    if (tab === "tech") paintTechnicalAccount();
  },
};

/** Field-level check through the domain rules before the form closes. */
const addTaxRuleDry = (v) => validateTaxRule(v);

[TOPICS.PROGRAMS, TOPICS.FINANCE, TOPICS.BORDEREAUX, TOPICS.TREATY].forEach((topic) =>
  on(topic, () => { if (document.getElementById("fin-body")) accountingView.refresh(); }),
);
