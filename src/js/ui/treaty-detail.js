/**
 * Agreement drawer — one treaty agreement as the master record for
 * everything administered under it. Ten tabs: Overview, Structure, Panel,
 * Bordereaux (premium), Cessions, Claims (claims bordereaux), Accounts,
 * Settlements, Documents, Audit Trail.
 *
 * Reads state and paints; every write goes through treaty.service.js and is
 * recorded on the agreement's audit trail.
 */
import { $, onAction } from "../core/dom.js";
import { agreementById } from "../core/store.js";
import { fmt, fmtFull } from "../core/format.js";
import { TODAY, todayISO } from "../core/config.js";
import { statusPill, subBadge, typeBadge, emptyState } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import { renderCalculator, mountCalculator } from "./treaty-calculators.js";
import { openTreatyWizard } from "./treaty-wizard.js";
import { openBillingDetail } from "./billing-detail.js";
import { batchesForSource } from "../services/billing.service.js";
import { remittancesForAgreement } from "../services/payments.service.js";
import { openRemittanceDetail } from "./remittance-detail.js";
import { fromCents } from "../domain/billing.js";
import {
  AGREEMENT_TRANSITIONS, BORDEREAU_STATUSES, CESSION_STATUSES, ACCOUNT_STATUSES, SETTLEMENT_STATUSES, TREATY_CURRENCIES,
  activationChecklist, canActivate, expiryIndicator, nextTreatyAction, requiresDeclarations, acceptsTransactions,
  panelTotal, panelComplete, layerLabel, accountNet, structureSummary, layerRates,
} from "../domain/treaty.js";
import {
  activateAgreement, setAgreementStatus, addAgreementDocument, addEndorsement, DOCUMENT_TYPES,
  addPremiumBordereau, addClaimsBordereau, addCession, addTechnicalAccount, addSettlement, setRecordStatus, recordsFor, validateWorkstreamRecord,
} from "../services/treaty.service.js";

/** This drawer's own element. Listeners bound here die with it, so they never fire for another drawer. */
const drawerRoot = () => document.querySelector("#modal-root > .modal-backdrop");

export const DETAIL_TABS = [
  ["overview", "Overview"], ["structure", "Structure"], ["panel", "Panel"], ["bordereaux", "Bordereaux"], ["cessions", "Cessions"],
  ["claims", "Claims"], ["accounts", "Accounts"], ["settlements", "Settlements"], ["documents", "Documents"], ["audit", "Audit Trail"],
];

let openId = null; let tab = "overview";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const notSet = "<span class='muted'>Not set</span>";
const money = (n, ccy) => (n == null || n === "" ? notSet : fmtFull(n, ccy));
const row = (label, value) => `<div class="confirm-row"><span>${label}</span><span>${value == null || value === "" ? notSet : value}</span></div>`;
const tile = (label, value, sub = "") => `<div class="ovw"><div class="ovw-label">${label}</div><div class="ovw-value">${value}</div>${sub ? `<div class="ovw-sub">${sub}</div>` : ""}</div>`;
const table = (heads, rows, empty) => rows.length
  ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${h.replace(/^#/, "")}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
  : emptyState(empty);

/** A one-step status mover for a workstream row. Explicit; nothing moves itself. */
const mover = (collection, ref, current, options, a) => acceptsTransactions(a)
  ? `<span class="wrow-actions"><select data-move="${collection}" data-ref="${esc(ref)}" aria-label="Move ${esc(ref)}">${options.map((o) => `<option${o === current ? " selected" : ""}>${o}</option>`).join("")}</select></span>` : "";

/* ---------- tabs ---------- */

function overview(a, recs) {
  const ind = expiryIndicator(a, TODAY);
  const next = nextTreatyAction(a, { today: TODAY, records: recs });
  const r = a.reporting || {};
  const checks = a.status === "Draft Setup" ? activationChecklist(a) : [];
  const moves = AGREEMENT_TRANSITIONS[a.status] || [];
  return `<div class="next-action${next.action === "edit" ? " blocked" : ""}"><div class="next-action-body">
      <div class="next-action-kicker">${a.status === "Draft Setup" ? "Setup" : "Do this next"}</div>
      <h4>${esc(next.title)}</h4><p>${esc(next.detail)}</p>
      <div class="next-action-actions">
        ${next.action === "edit" ? `<button class="btn primary" data-action="continue-setup">Continue setup</button>` : ""}
        ${next.action === "activate" ? `<button class="btn primary" data-action="activate">Activate Agreement</button>` : ""}
        ${next.action === "mark-expiring" ? `<button class="btn primary" data-action="set-status" data-status="Expiring">Mark Expiring</button>` : ""}
        ${next.action?.startsWith("tab:") ? `<button class="btn primary" data-action="go-tab" data-tab="${next.action.slice(4)}">${esc(next.actionLabel)}</button>` : ""}
        ${moves.filter((m) => m !== "Active" || a.status !== "Draft Setup").map((m) => `<button class="btn next-action-secondary" data-action="set-status" data-status="${m}">${m === "Active" ? "Return to Active" : m === "Closed" ? "Close agreement" : `Move to ${m}`}</button>`).join("")}
      </div></div></div>
    <div class="ovw-grid" style="margin-top:16px;">
      ${tile("Agreement", esc(a.id), esc(a.name))}
      ${tile("Cedant", esc(a.cedant), esc(a.cls || ""))}
      ${tile("Treaty type", typeBadge(a.type), a.source)}
      ${tile("Status", statusPill(a.status), a.activatedAt ? `Active since ${a.activatedAt}` : "Not yet activated")}
      ${tile("Contract period", a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "Not set", a.originalInception ? `Original inception ${a.originalInception}` : "")}
      ${tile("Expiry", subBadge(ind.label, ind.tone), a.expiry || "")}
      ${tile("Currency", a.ccy, r.settlementCcy && r.settlementCcy !== a.ccy ? `Settles in ${r.settlementCcy}` : "")}
      ${tile("Panel", `${a.panel.length} reinsurer${a.panel.length === 1 ? "" : "s"} · ${panelTotal(a.panel).toFixed(0)}%`, a.panel.find((p) => p.role === "Lead")?.reinsurer ? `Lead ${esc(a.panel.find((p) => p.role === "Lead").reinsurer)}` : "No lead named")}
    </div>
    <div class="cols-2">
      <div><div class="panel-title" style="font-size:12.5px;">Reporting schedule</div>
        ${row("Premium bordereaux", r.premiumBdxFrequency)}${row("Claims bordereaux", r.claimsBdxFrequency)}${row("Accounting", r.accountingFrequency)}
        ${row("Reporting deadline", r.reportingDeadlineDays != null ? `${r.reportingDeadlineDays} days after period end` : null)}${row("Payment warranty", r.paymentWarrantyDays ? `${r.paymentWarrantyDays} days` : null)}
        ${row("Individual declarations", requiresDeclarations(a) ? "Required" : "Not required")}${row("Cash-call threshold", r.cashCallThreshold != null ? fmtFull(r.cashCallThreshold, a.ccy) : null)}</div>
      <div><div class="panel-title" style="font-size:12.5px;">Activity</div>
        ${row("Premium bordereaux", recs.premiumBordereaux.length)}${row("Claims bordereaux", recs.claimsBordereaux.length)}${row("Individual cessions", requiresDeclarations(a) ? recs.cessions.length : "n/a")}
        ${row("Technical accounts", recs.technicalAccounts.length)}${row("Settlements", `${recs.settlements.length} · ${recs.settlements.filter((s) => s.paymentStatus !== "Paid").length} open`)}
        ${checks.length ? `<div class="panel-title" style="font-size:12.5px; margin-top:14px;">Before activation</div><ul class="checklist">${checks.map((c) => `<li class="check-item ${c.state}"><span class="check-glyph">${c.state === "done" ? "✓" : c.state === "blocking" ? "!" : "○"}</span><span class="check-text"><span class="check-label">${c.label}</span><span class="check-detail">${esc(c.detail)}</span></span></li>`).join("")}</ul>` : ""}
      </div></div>`;
}

function structure(a) {
  const s = a.structure || {}; const f = (n) => (n == null ? null : fmtFull(n, a.ccy));
  let rows = "";
  switch (a.type) {
    case "Quota Share": rows = row("Cession", s.cessionPct != null ? `${s.cessionPct}%` : null) + row("Cedant retention", s.retentionPct != null ? `${s.retentionPct}%` : null) + row("Commission", s.commissionPct != null ? `${s.commissionPct}%` : null) + row("Premium basis", s.premiumBasis); break;
    case "Surplus": rows = row("Cedant retention (one line)", f(s.retention)) + row("Number of lines", s.lines) + row("Treaty capacity", f(s.capacity)) + row("Commission", s.commissionPct != null ? `${s.commissionPct}%` : null) + row("Premium basis", s.premiumBasis); break;
    case "Stop Loss": rows = row("Attachment ratio", s.attachmentRatio != null ? `${s.attachmentRatio}% loss ratio` : null) + row("Limit ratio", s.limitRatio != null ? `${s.limitRatio}% loss ratio` : null) + row("Subject premium", f(s.subjectPremium)) + row("Loss-ratio basis", s.lossRatioBasis); break;
    default: rows = layerRates(s.layers || []).map((l, i) => row(`Layer ${i + 1}`, `${layerLabel(s.layers[i], (n) => fmt(n, a.ccy))} · ${s.layers[i].reinstatements ?? "—"} reinstatement${s.layers[i].reinstatements === 1 ? "" : "s"}${l.premium != null ? ` · ${fmtFull(l.premium, a.ccy)} · ROL ${l.rol.toFixed(2)}%` : ""}`)).join("")
      + (a.type === "Catastrophe XoL" ? row("Event definition", esc(s.eventDefinition)) : "") + row("Premium basis", s.premiumBasis);
  }
  return `<div class="cols-2"><div><div class="panel-title" style="font-size:12.5px;">Terms · ${structureSummary(a, (n) => fmt(n, a.ccy))}</div>${rows}
      ${a.status === "Draft Setup" ? `<button class="btn" style="margin-top:12px;" data-action="continue-setup">Edit structure in setup</button>` : `<div class="hint" style="margin-top:10px;">Terms of an activated agreement change by endorsement (Documents tab), not by edit.</div>`}</div>
    <div>${renderCalculator(a)}</div></div>`;
}

function panel(a) {
  const total = panelTotal(a.panel);
  return `<div class="confirm-progress"><div class="confirm-bar"><span style="width:${Math.min(100, total)}%"></span></div><div class="confirm-count">Signed ${total.toFixed(2)}%${panelComplete(a.panel) ? " — fully signed" : ` — ${(100 - total).toFixed(2)}% unplaced`}</div></div>
    ${table(["Reinsurer", "Role", "#Signed share", "#Brokerage", "Market reference"], a.panel.map((p) => `<tr><td><strong>${esc(p.reinsurer)}</strong></td><td>${subBadge(p.role, p.role === "Lead" ? "info" : "neutral")}</td><td class="num">${p.share}%</td><td class="num">${p.brokeragePct != null ? `${p.brokeragePct}%` : "—"}</td><td>${esc(p.marketRef) || "—"}</td></tr>`), "No reinsurers on the panel.")}
    ${a.status === "Draft Setup" ? `<button class="btn" style="margin-top:12px;" data-action="continue-setup">Edit panel in setup</button>` : ""}`;
}

function premiumBdx(a, recs) {
  const add = acceptsTransactions(a) ? `<button class="btn primary" style="padding:5px 10px;" data-action="add-premium-bdx">+ Record premium bordereau</button>` : "";
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Premium bordereaux · ${a.reporting?.premiumBdxFrequency || "frequency not set"}</div>${add}</div>
    ${table(["Reference", "Period", "#Gross premium", "#Ceded premium", "#Commission", "Received", "Due", "Status"], recs.premiumBordereaux.map((b) => `<tr><td><strong>${b.ref}</strong></td><td>${esc(b.period)}</td><td class="num">${fmtFull(b.grossPremium, b.ccy)}</td><td class="num">${fmtFull(b.cededPremium, b.ccy)}</td><td class="num">${money(b.commission, b.ccy)}</td><td>${b.receivedDate || "—"}</td><td>${b.dueDate || "—"}</td><td>${statusPill(b.status)}${mover("premiumBordereaux", b.ref, b.status, BORDEREAU_STATUSES, a)}</td></tr>`), "No premium bordereaux received for this agreement.")}`;
}

function claimsBdx(a, recs) {
  const add = acceptsTransactions(a) ? `<button class="btn primary" style="padding:5px 10px;" data-action="add-claims-bdx">+ Record claims bordereau</button>` : "";
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Claims bordereaux · ${a.reporting?.claimsBdxFrequency || "frequency not set"}</div>${add}</div>
    ${table(["Reference", "Period", "#Claims", "#Paid", "#Outstanding", "#Incurred", "#Recoverable", "Status"], recs.claimsBordereaux.map((b) => `<tr><td><strong>${b.ref}</strong></td><td>${esc(b.period)}</td><td class="num">${b.claimCount}</td><td class="num">${fmtFull(b.paid, b.ccy)}</td><td class="num">${fmtFull(b.outstanding, b.ccy)}</td><td class="num">${fmtFull((b.paid || 0) + (b.outstanding || 0), b.ccy)}</td><td class="num">${money(b.recoverable, b.ccy)}</td><td>${statusPill(b.status)}${mover("claimsBordereaux", b.ref, b.status, BORDEREAU_STATUSES, a)}</td></tr>`), "No claims bordereaux received for this agreement.")}`;
}

function cessions(a, recs) {
  if (!requiresDeclarations(a)) return `<div class="banner neutral">${icons.info}This agreement does not require individual declarations. Cessions are reported through the bordereaux.</div>`;
  const add = acceptsTransactions(a) ? `<button class="btn primary" style="padding:5px 10px;" data-action="add-cession">+ Record cession</button>` : "";
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Individual cessions / declarations</div>${add}</div>
    ${table(["Reference", "Insured / risk", "Class", "#Sum insured", "#Retention", "#Ceded", "Effective", "Status"], recs.cessions.map((c) => `<tr><td><strong>${c.ref}</strong></td><td>${esc(c.insured)}</td><td>${esc(c.cls)}</td><td class="num">${fmtFull(c.sumInsured, a.ccy)}</td><td class="num">${fmtFull(c.retention, a.ccy)}</td><td class="num">${fmtFull(c.ceded, a.ccy)}</td><td>${c.effectiveDate}</td><td>${statusPill(c.status)}${mover("cessions", c.ref, c.status, CESSION_STATUSES, a)}</td></tr>`), "No cessions declared under this agreement.")}`;
}

/** The billing batch drafted for a technical account, if any. */
function billingCell(t) {
  const b = batchesForSource("treaty", t.ref).find((x) => x.status !== "Cancelled") || batchesForSource("treaty", t.ref)[0];
  return b ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="open-billing" data-ref="${b.ref}">${b.ref} · ${b.status}</button>` : '<span class="muted">—</span>';
}

function accounts(a, recs) {
  const add = acceptsTransactions(a) ? `<button class="btn primary" style="padding:5px 10px;" data-action="add-account">+ Draft technical account</button>` : "";
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Technical accounts · ${a.reporting?.accountingFrequency || "frequency not set"}</div>${add}</div>
    ${table(["Reference", "Period", "#Premium", "#Commission", "#Claims", "#Tax", "#Net balance", "Status", "Billing"], recs.technicalAccounts.map((t) => `<tr><td><strong>${t.ref}</strong></td><td>${esc(t.period)}</td><td class="num">${fmtFull(t.premium, t.ccy)}</td><td class="num">${fmtFull(t.commission, t.ccy)}</td><td class="num">${fmtFull(t.claims, t.ccy)}</td><td class="num">${fmtFull(t.tax, t.ccy)}</td><td class="num"><strong>${fmtFull(accountNet(t), t.ccy)}</strong></td><td>${statusPill(t.status)}${mover("technicalAccounts", t.ref, t.status, ACCOUNT_STATUSES, a)}</td><td>${billingCell(t)}</td></tr>`), "No technical accounts for this agreement.")}
    <div class="hint" style="margin-top:4px;">Moving an account to Agreed drafts its billing in Finance: an invoice or credit note to the cedant and a closing slip per reinsurer, due ${a.reporting?.paymentWarrantyDays ? `${a.reporting.paymentWarrantyDays} days` : "after the payment warranty (not set on this agreement)"} from the agreed date.</div>
    <div class="hint" style="margin-top:8px;">Net balance = premium − commission − claims − tax. Positive is due to reinsurers; negative is due to the cedant.</div>`;
}

function settlements(a, recs) {
  const add = acceptsTransactions(a) ? `<button class="btn primary" style="padding:5px 10px;" data-action="add-settlement">+ Raise manual settlement</button>` : "";
  const rems = remittancesForAgreement(a.id);
  const finance = rems.length ? `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">Remittances from Finance</div>
    ${table(["Remittance", "Technical account", "Reinsurer", "#Amount", "Paid", "Status"], rems.map((m) => `<tr class="reg-tr" data-action="open-remittance" data-ref="${m.ref}"><td><strong>${m.ref}</strong></td><td>${esc(m.sourceLabel.split(" technical account ")[1]?.split(" ·")[0] || "—")}</td><td>${esc(m.reinsurer)}</td><td class="num">${fmtFull(fromCents(m.cents), m.ccy)}</td><td>${m.paidDate || "—"}</td><td>${statusPill(m.status)}</td></tr>`), "")}
    <div class="hint" style="margin-top:4px;">Drafted when the cedant pays a Finance invoice for this agreement, and approved and paid in Finance.</div>` : "";
  return `<div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Manual settlements</div>${add}</div>
    ${table(["Reference", "Technical account", "Counterparty", "#Amount", "Due", "Payment status"], recs.settlements.map((s) => `<tr><td><strong>${s.ref}</strong></td><td>${esc(s.accountRef) || "—"}</td><td>${esc(s.counterparty)}</td><td class="num">${fmtFull(s.amount, s.ccy)}</td><td>${s.dueDate}</td><td>${statusPill(s.paymentStatus)}${mover("settlements", s.ref, s.paymentStatus, SETTLEMENT_STATUSES, a)}</td></tr>`), "No manual settlements.")}
    <div class="hint" style="margin-top:4px;">Technical accounts billed through Finance take no manual settlement.</div>
    ${finance}`;
}

function documents(a) {
  const docs = (a.documents || []).map((d) => `<div class="doc-row"><span><span class="d-name">${esc(d.name)}</span><br><span class="d-meta">${esc(d.type)}${d.version ? ` v${d.version}` : ""} · from ${esc(d.from)} · ${d.date}</span></span></div>`).join("");
  const ends = (a.endorsements || []).map((e) => `<div class="confirm-row"><span><strong>${esc(e.ref)}</strong> · ${esc(e.summary)}</span><span class="prov-who">effective ${e.effective || e.date}</span></div>`).join("");
  const open = a.status !== "Closed";
  return `<div class="cols-2"><div>
      <div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Documents</div>${open ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="add-document">+ File document</button>` : ""}</div>
      ${docs || emptyState("No documents filed.")}</div>
    <div><div class="toolbar" style="justify-content:space-between;"><div class="panel-title" style="font-size:12.5px; margin:0;">Endorsements</div>${open ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="add-endorsement">+ Record endorsement</button>` : ""}</div>
      ${ends || emptyState("No endorsements recorded.")}</div></div>`;
}

const auditTrail = (a) => (a.audit || []).slice().reverse().map((h) => `<div class="hist-row"><span class="hist-when">${h.at}</span><span class="hist-what"><strong>${esc(h.action)}</strong>${h.notes ? ` — ${esc(h.notes)}` : ""}<span class="hist-who">${esc(h.actor)}</span></span></div>`).join("") || emptyState("No audit entries.");

const TAB_BODY = { overview, structure, panel, bordereaux: premiumBdx, cessions, claims: claimsBdx, accounts, settlements, documents, audit: auditTrail };

function counts(a, recs) {
  return { bordereaux: recs.premiumBordereaux.length, cessions: requiresDeclarations(a) ? recs.cessions.length : null, claims: recs.claimsBordereaux.length, accounts: recs.technicalAccounts.length, settlements: recs.settlements.length, documents: (a.documents?.length || 0) + (a.endorsements?.length || 0), audit: a.audit?.length || 0 };
}

function shell(a) {
  const recs = recordsFor(a.id);
  const n = counts(a, recs);
  return `<div class="modal-backdrop"><div class="modal" style="max-width:920px;">
    <div class="modal-head"><div>
      <div class="panel-title" style="margin:0;">${esc(a.id)} · ${esc(a.name)} ${statusPill(a.status)}</div>
      <div class="panel-sub" style="margin:2px 0 0;">${esc(a.cedant)} · ${typeBadge(a.type)} · ${a.ccy} · ${a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "period not set"}</div></div>
      <button class="close-x" data-action="close-modal" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="dtabs" role="tablist">${DETAIL_TABS.filter(([k]) => k !== "cessions" || requiresDeclarations(a)).map(([k, label]) => `<button class="dtab${k === tab ? " active" : ""}" role="tab" data-action="tab" data-tab="${k}" aria-selected="${k === tab}">${label}${n[k] != null ? `<span class="kcol-count">${n[k]}</span>` : ""}</button>`).join("")}</div>
      <div id="tdetail-body">${(TAB_BODY[tab] || overview)(a, recs)}</div>
    </div></div></div>`;
}

/* ---------- forms ---------- */

const agreementCcy = () => agreementById(openId)?.ccy || "USD";
const numField = (name, label, extra = {}) => ({ name, label, type: "number", ...extra });

/** A workstream form: validated through the service's rules before it writes. */
function recordForm(title, collection, fields, write) {
  openFormModal({
    title: `${title} — ${openId}`, fields, submitLabel: "Record",
    validate: (v) => validateWorkstreamRecord(collection, { ...v, agreementId: openId }),
    onSubmit: (v) => { write({ ...v, agreementId: openId }); reopen(); },
  });
}

function wire() {
  onAction(drawerRoot(), {
    "tab": ({ tab: t }) => { tab = t; repaint(); },
    "open-billing": ({ ref }) => { closeModal(); openBillingDetail(ref); },
    "open-remittance": ({ ref }) => { const back = openId; const t = tab; closeModal(); openRemittanceDetail(ref, () => openAgreementDetail(back, t)); },
    "go-tab": ({ tab: t }) => { tab = t; repaint(); },
    "continue-setup": () => { const id = openId; closeModal(); openTreatyWizard((aid) => openAgreementDetail(aid, "overview"), { agreementId: id }); },
    "activate": () => { activateAgreement(openId); repaint(); },
    "set-status": ({ status }) => openFormModal({
      title: `Move ${openId} to ${status}`, fields: [{ name: "notes", label: "Notes", type: "textarea", rows: 3, required: status === "Closed" }], submitLabel: `Confirm ${status}`,
      onSubmit: ({ notes }) => { setAgreementStatus(openId, status, notes); reopen(); },
    }),
    "add-premium-bdx": () => recordForm("Record premium bordereau", "premiumBordereaux", [
      { name: "period", label: "Reporting period", type: "text", required: true, placeholder: "e.g. Q3 2026", half: true },
      { name: "receivedDate", label: "Received date", type: "date", value: todayISO(), half: true },
      numField("grossPremium", `Gross premium (${agreementCcy()})`, { required: true, half: true }), numField("cededPremium", `Ceded premium (${agreementCcy()})`, { required: true, half: true }),
      numField("commission", `Commission (${agreementCcy()})`, { half: true }), { name: "dueDate", label: "Due date", type: "date", half: true },
    ], addPremiumBordereau),
    "add-claims-bdx": () => recordForm("Record claims bordereau", "claimsBordereaux", [
      { name: "period", label: "Reporting period", type: "text", required: true, placeholder: "e.g. Q3 2026", half: true },
      { name: "receivedDate", label: "Received date", type: "date", value: todayISO(), half: true },
      numField("claimCount", "Claim count", { required: true, half: true }), numField("paid", `Paid (${agreementCcy()})`, { required: true, half: true }),
      numField("outstanding", `Outstanding (${agreementCcy()})`, { required: true, half: true }), numField("recoverable", `Reinsurance recoverable (${agreementCcy()})`, { half: true }),
      { name: "dueDate", label: "Due date", type: "date", half: true },
    ], addClaimsBordereau),
    "add-cession": () => recordForm("Record individual cession", "cessions", [
      { name: "insured", label: "Insured / risk", type: "text", required: true },
      { name: "cls", label: "Class", type: "text", value: agreementById(openId)?.cls || "", half: true }, { name: "effectiveDate", label: "Effective date", type: "date", value: todayISO(), required: true, half: true },
      numField("sumInsured", `Sum insured / exposure (${agreementCcy()})`, { required: true, half: true }), numField("retention", `Cedant retention (${agreementCcy()})`, { required: true, half: true }),
      numField("ceded", `Ceded amount (${agreementCcy()})`, { required: true, half: true }),
    ], addCession),
    "add-account": () => recordForm("Draft technical account", "technicalAccounts", [
      { name: "period", label: "Accounting period", type: "text", required: true, placeholder: "e.g. Q3 2026" },
      numField("premium", `Premium (${agreementCcy()})`, { half: true }), numField("commission", `Commission (${agreementCcy()})`, { half: true }),
      numField("claims", `Claims (${agreementCcy()})`, { half: true }), numField("tax", `Tax (${agreementCcy()})`, { half: true }),
    ], addTechnicalAccount),
    "add-settlement": () => recordForm("Raise settlement", "settlements", [
      { name: "accountRef", label: "Technical account", type: "select", options: ["", ...recordsFor(openId).technicalAccounts.filter((t) => !batchesForSource("treaty", t.ref).some((b) => b.status !== "Cancelled")).map((t) => t.ref)], half: true },
      { name: "counterparty", label: "Counterparty", type: "select", options: [...(agreementById(openId)?.panel || []).map((p) => p.reinsurer), agreementById(openId)?.cedant], required: true, half: true },
      numField("amount", `Amount (${agreementCcy()}) — negative when due to the cedant`, { required: true, half: true }), { name: "dueDate", label: "Due date", type: "date", required: true, half: true },
    ], addSettlement),
    "add-document": () => openFormModal({
      title: `File document — ${openId}`, fields: [
        { name: "name", label: "Name", type: "text", required: true }, { name: "type", label: "Type", type: "select", options: DOCUMENT_TYPES, value: "Correspondence", half: true },
        { name: "from", label: "From", type: "text", value: "Broker", half: true }, { name: "date", label: "Date", type: "date", value: todayISO(), half: true }, numField("version", "Version", { value: 1, half: true }),
      ], submitLabel: "File", onSubmit: (v) => { addAgreementDocument(openId, v); reopen(); },
    }),
    "add-endorsement": () => openFormModal({
      title: `Record endorsement — ${openId}`, fields: [
        { name: "ref", label: "Reference", type: "text", placeholder: "e.g. E2", half: true }, { name: "effective", label: "Effective date", type: "date", value: todayISO(), half: true },
        { name: "summary", label: "What changed", type: "textarea", rows: 3, required: true },
      ], submitLabel: "Record", onSubmit: (v) => { addEndorsement(openId, v); reopen(); },
    }),
  });
  drawerRoot()?.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-move]");
    if (sel) { setRecordStatus(sel.dataset.move, sel.dataset.ref, sel.value); repaint(); }
  });
  if (tab === "structure") mountCalculator(agreementById(openId));
}

function repaint() { const a = agreementById(openId); if (!a) return closeModal(); updateModal(shell(a), { onMount: wire }); }
function reopen() { const a = agreementById(openId); if (a) openModal(shell(a), { onMount: wire, onDismiss: () => { openId = null; } }); }

/** Open an agreement on a tab. */
export function openAgreementDetail(id, startTab = "overview") {
  const a = agreementById(id);
  if (!a) return;
  openId = id; tab = DETAIL_TABS.some(([k]) => k === startTab) ? startTab : "overview";
  openModal(shell(a), { onMount: wire, onDismiss: () => { openId = null; } });
}
