/**
 * Billing batch drawer — one billing event: the cedant document, a Closing
 * Slip per reinsurer, the checklist that gates it, and the four-eyes actions.
 * Reads state and paints; every write goes through billing.service.js.
 */
import { onAction } from "../core/dom.js";
import { currentUser } from "../core/store.js";
import { statusPill, financeBadge, subBadge } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import { openPrintable } from "./print-document.js";
import { PAYMENT_WARRANTY_DAYS } from "../domain/intake.js";
import { issueChecklist, issueAuthority, fromCents, formatShare, SOURCE_KINDS } from "../domain/billing.js";
import {
  batchByRef, updateBatchTerms, submitBatch, returnBatch, issueBatch, markDocumentSent, raiseCancellation,
} from "../services/billing.service.js";

let openRef = null;
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const money = (cents, ccy) => `${ccy} ${fromCents(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const notSet = "<span class='muted'>Not set</span>";

function nextStep(b) {
  const user = currentUser();
  const blockers = issueChecklist(b).filter((c) => c.state === "blocking");
  if (b.status === "Draft") {
    return { title: blockers.length ? "Complete the billing draft" : "Submit for approval", detail: blockers.length ? blockers.map((x) => x.detail).join(" ") : "A different authorised person approves and issues every document in this batch at once.",
      primary: { action: "submit", label: "Submit for approval", disabled: blockers.length > 0 }, secondary: b.sourceKind !== "reversal" ? { action: "edit", label: "Edit billing terms" } : null, blocked: blockers.length > 0 };
  }
  if (b.status === "Pending Approval") {
    const auth = issueAuthority(b, user);
    return { title: auth.allowed ? "Approve and issue" : "Waiting for an authorised approver", detail: auth.allowed ? `Prepared by ${b.preparedBy?.name}. Issuing numbers and freezes the ${b.cedantDocType.toLowerCase()} and ${b.computed.slips.length} closing slip${b.computed.slips.length === 1 ? "" : "s"}.` : auth.reason,
      primary: { action: "issue", label: "Approve and issue", disabled: !auth.allowed || blockers.length > 0 }, secondary: auth.allowed ? { action: "return", label: "Return to preparer" } : null, blocked: !auth.allowed };
  }
  if (b.status === "Issued") {
    const unsent = b.documents.filter((d) => d.delivery !== "Sent").length;
    return { title: unsent ? `Send ${unsent} document${unsent === 1 ? "" : "s"}` : "Issued and sent", detail: unsent ? "Print or save each document, send it to its counterparty, then mark it sent." : "Receipts and remittances follow in the next phase.",
      primary: null, secondary: b.sourceKind !== "reversal" ? { action: "cancel", label: "Cancel by credit note" } : null, done: !unsent };
  }
  return { title: "Cancelled", detail: `Reversed by ${b.cancelledBy || "a reversing batch"}. Kept for the record.`, primary: null, secondary: null, done: true };
}

function card(b) {
  const n = nextStep(b);
  return `<div class="next-action${n.blocked ? " blocked" : n.done ? " done" : ""}"><div class="next-action-body">
    <div class="next-action-kicker">${n.done ? icons.check : ""}${esc(SOURCE_KINDS[b.sourceKind])} · ${esc(b.status)}</div>
    <h4>${esc(n.title)}</h4><p>${esc(n.detail)}</p>
    <div class="next-action-actions">
      ${n.primary ? `<button class="btn primary" data-action="${n.primary.action}"${n.primary.disabled ? " disabled" : ""}>${n.primary.label}</button>` : ""}
      ${n.secondary ? `<button class="btn next-action-secondary" data-action="${n.secondary.action}">${n.secondary.label}</button>` : ""}
    </div></div></div>`;
}

function docBlock(b, d, i) {
  const issued = Boolean(d.id);
  return `<div class="bill-doc">
    <div class="bill-doc-head">
      <span>${financeBadge(d.docType)} <strong>${issued ? esc(d.id) : "Unnumbered draft"}</strong> · ${esc(d.counterparty)}${d.share != null ? ` <span class="signed-line">${formatShare(d.share)}</span>` : ""}</span>
      <span class="wrow-actions">${issued ? `${statusPill(d.delivery)}
        <button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="print" data-i="${i}">Print</button>
        ${d.delivery !== "Sent" ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="sent" data-i="${i}">Mark sent</button>` : ""}` : ""}</span>
    </div>
    ${d.lines.map((l) => `<div class="confirm-row"><span>${esc(l.label)}</span><span class="mono">${money(l.cents, b.ccy)}</span></div>`).join("")}
    <div class="confirm-row bill-total"><span>${d.docType === "Closing Slip" ? "Net to reinsurer" : d.total < 0 ? "Due to cedant" : "Due from cedant"}</span><span class="mono">${money(d.total, b.ccy)}</span></div>
  </div>`;
}

function documentsView(b) {
  if (b.documents.length) return b.documents.map((d, i) => docBlock(b, d, i)).join("");
  const c = b.computed;
  const draftDocs = [{ docType: b.cedantDocType, counterparty: b.cedant, lines: c.cedant.lines, total: c.cedant.total },
    ...c.slips.map((s) => ({ docType: "Closing Slip", counterparty: s.reinsurer, share: s.weight, lines: s.lines, total: s.total }))];
  return draftDocs.map((d, i) => docBlock(b, d, i)).join("");
}

function body(b) {
  const c = b.computed;
  const checks = issueChecklist(b);
  const trail = (label, who) => (who ? `<div class="confirm-row"><span>${label}</span><span class="prov-who">${esc(who.name)} · ${esc(who.title)}</span></div>` : "");
  return card(b) + `<div class="cols-2" style="margin-top:16px;">
    <div><div class="panel-title" style="font-size:12.5px;">Documents</div>${documentsView(b)}</div>
    <div>
      <div class="panel-title" style="font-size:12.5px;">Terms</div>
      <div class="confirm-row"><span>Source</span><span>${esc(b.sourceLabel)}</span></div>
      <div class="confirm-row"><span>Commission</span><span>${b.sourceKind === "treaty" ? "From technical account" : b.commissionPct != null ? `${b.commissionPct}%` : notSet}</span></div>
      <div class="confirm-row"><span>Brokerage (deducted from remittance)</span><span>${b.brokeragePct != null ? `${b.brokeragePct}%` : notSet}</span></div>
      <div class="confirm-row"><span>Payment warranty</span><span>${b.paymentWarrantyDays ? `${b.paymentWarrantyDays} days` : b.sourceKind === "reversal" ? "—" : notSet}</span></div>
      ${b.computed && b.computed.cedant.total > 0 ? `<div class="confirm-row"><span>Cedant pays into</span><span>${(b.documents[0]?.payTo || b.payTo) ? `${esc((b.documents[0]?.payTo || b.payTo).bankName)} · ${esc((b.documents[0]?.payTo || b.payTo).accountNo || (b.documents[0]?.payTo || b.payTo).iban)}` : `<span class="muted">No ${esc(b.ccy)} collection account</span>`}</span></div>` : ""}
      <div class="confirm-row"><span>Due date</span><span>${b.dueDate ? `${esc(b.dueDate)} <span class="muted">(${esc(b.basisDate)} + ${b.paymentWarrantyDays}d)</span>` : b.sourceKind === "reversal" ? "—" : notSet}</span></div>
      <div class="panel-title" style="font-size:12.5px; margin-top:14px;">Balance</div>
      <div class="confirm-row"><span>Brokerage retained</span><span class="mono">${money(c.brokerageRetained, b.ccy)}</span></div>
      <div class="confirm-row"><span>Taxes held for authorities</span><span class="mono">${money(c.taxesHeld, b.ccy)}</span></div>
      ${c.brokerTaxes.map((t) => `<div class="confirm-row"><span>${esc(t.label)} · broker's cost</span><span class="mono">${money(t.cents, b.ccy)}</span></div>`).join("")}
      ${b.status === "Issued" || b.status === "Cancelled" ? "" : `<div class="panel-title" style="font-size:12.5px; margin-top:14px;">Before this can issue</div>
      <ul class="checklist">${checks.map((x) => `<li class="check-item ${x.state}"><span class="check-glyph">${x.state === "done" ? "✓" : x.state === "optional" ? "○" : "!"}</span><span class="check-text"><span class="check-label">${x.label}</span><span class="check-detail">${esc(x.detail)}</span></span></li>`).join("")}</ul>`}
      <div class="panel-title" style="font-size:12.5px; margin-top:14px;">Authority trail</div>
      ${trail("Prepared by", b.preparedBy)}${trail("Approved by", b.approvedBy)}
      ${b.overrideUsed ? `<div class="override-note">${icons.info}Approved under administrator override — the preparer approved their own batch.</div>` : ""}
      <div class="panel-title" style="font-size:12.5px; margin-top:14px;">History</div>
      ${b.history.slice().reverse().map((h) => `<div class="hist-row"><span class="hist-when">${h.at}</span><span class="hist-what"><strong>${esc(h.action)}</strong>${h.notes ? ` — ${esc(h.notes)}` : ""}<span class="hist-who">${esc(h.actor)}</span></span></div>`).join("")}
    </div></div>`;
}

const shell = (b) => `<div class="modal-backdrop"><div class="modal" style="max-width:900px;">
  <div class="modal-head"><div>
    <div class="panel-title" style="margin:0;">${esc(b.ref)} · ${esc(b.cedant)} ${statusPill(b.status)}</div>
    <div class="panel-sub" style="margin:2px 0 0;">${financeBadge(b.cedantDocType)} ${subBadge(`${b.computed.slips.length} closing slip${b.computed.slips.length === 1 ? "" : "s"}`)} ${esc(b.ccy)} · ${money(b.computed.cedant.total, b.ccy)}</div></div>
    <button class="close-x" data-action="close-modal" aria-label="Close">✕</button></div>
  <div class="modal-body">${body(b)}</div></div></div>`;

function wire() {
  onAction("#modal-root", {
    submit: () => { submitBatch(openRef); repaint(); },
    issue: () => { issueBatch(openRef); repaint(); },
    return: () => openFormModal({ title: `Return ${openRef}`, fields: [{ name: "notes", label: "Reason", type: "textarea", rows: 3, required: true }], submitLabel: "Return",
      onSubmit: ({ notes }) => { returnBatch(openRef, notes); reopen(); } }),
    cancel: () => openFormModal({ title: `Cancel ${openRef}`, subtitle: "Drafts a reversing credit note. It needs the same four-eyes approval before the original is cancelled.",
      fields: [{ name: "notes", label: "Reason", type: "textarea", rows: 3, required: true }], submitLabel: "Draft cancellation",
      onSubmit: ({ notes }) => { const r = raiseCancellation(openRef, notes); if (r) openRef = r.ref; reopen(); } }),
    edit: () => {
      const b = batchByRef(openRef);
      openFormModal({
        title: `Billing terms — ${b.ref}`, subtitle: "Enter each rate explicitly. 0 is a valid choice; blank is not.",
        fields: [
          ...(b.sourceKind === "treaty" ? [] : [{ name: "commissionPct", label: "Commission %", type: "number", value: b.commissionPct ?? "", half: true, validate: (v) => (+v >= 0 && +v <= 100 ? null : "0–100") }]),
          { name: "brokeragePct", label: "Brokerage %", type: "number", value: b.brokeragePct ?? "", half: true, validate: (v) => (+v >= 0 && +v <= 100 ? null : "0–100"), hint: "Deducted from each reinsurer's remittance." },
          { name: "paymentWarrantyDays", label: "Payment warranty (days)", type: "select", options: ["", ...PAYMENT_WARRANTY_DAYS.map(String)], value: b.paymentWarrantyDays != null ? String(b.paymentWarrantyDays) : "", half: true,
            hint: `Counted from ${b.basisDate || "the basis date"}.` },
          { name: "notes", label: "Notes", type: "textarea", rows: 2, value: b.notes || "" },
        ],
        submitLabel: "Save", onSubmit: (v) => { updateBatchTerms(openRef, v); reopen(); },
      });
    },
    print: ({ i }) => { const b = batchByRef(openRef); openPrintable(b, b.documents[Number(i)]); },
    sent: ({ i }) => { const b = batchByRef(openRef); markDocumentSent(openRef, b.documents[Number(i)].id); repaint(); },
  });
}

function repaint() { const b = batchByRef(openRef); if (!b) return closeModal(); updateModal(shell(b), { onMount: wire }); }
function reopen() { const b = batchByRef(openRef); if (b) openModal(shell(b), { onMount: wire, onDismiss: () => { openRef = null; } }); }

export function openBillingDetail(ref) {
  const b = batchByRef(ref);
  if (!b) return;
  openRef = ref;
  openModal(shell(b), { onMount: wire, onDismiss: () => { openRef = null; } });
}
