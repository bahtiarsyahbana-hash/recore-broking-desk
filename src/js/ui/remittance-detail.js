/**
 * Remittance drawer — one payment to one reinsurer, drafted from a receipt.
 * Submit, approve under four-eyes, then record the transfer. Every write goes
 * through payments.service.js.
 */
import { onAction } from "../core/dom.js";
import { state, currentUser } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { statusPill } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import { fromCents } from "../domain/billing.js";
import { remittanceAuthority } from "../domain/payments.js";
import {
  remittanceByRef, remittanceChecks, submitRemittance, returnRemittance, approveRemittance,
  recordRemittancePayment, checkRemittancePayment,
} from "../services/payments.service.js";

/** This drawer's own element. Listeners bound here die with it, so they never fire for another drawer. */
const drawerRoot = () => document.querySelector("#modal-root > .modal-backdrop");

let openRef = null;

/** A broker account as a select option, and back. */
export const accountOption = (a) => `${a.id} · ${a.bankName} · ${a.accountNo || a.iban}`;
export const accountIdOf = (option) => String(option || "").split(" · ")[0];
let onBack = null;
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const money = (cents, ccy) => `${ccy} ${fromCents(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const acct = (a) => (a ? `${esc(a.bankName)} · ${esc(a.accountName)} · ${esc(a.accountNo || a.iban)}${a.swift ? ` · ${esc(a.swift)}` : ""}` : "<span class='muted'>Not set</span>");

function next(m) {
  const blockers = remittanceChecks(m).filter((c) => c.state === "blocking");
  if (m.status === "Draft") return { title: blockers.length ? "Cannot submit yet" : "Submit for approval", detail: blockers.length ? blockers.map((b) => b.detail).join(" ") : "A different authorised person approves money leaving the firm.", primary: ["submit", "Submit for approval", blockers.length > 0], blocked: blockers.length > 0 };
  if (m.status === "Pending Approval") {
    const auth = remittanceAuthority(m, currentUser());
    return { title: auth.allowed ? "Approve the remittance" : "Waiting for an authorised approver", detail: auth.allowed ? `Prepared by ${m.preparedBy?.name}. Approving fixes the reinsurer's bank account on the record.` : auth.reason,
      primary: ["approve", "Approve", !auth.allowed || blockers.length > 0], secondary: auth.allowed ? ["return", "Return to preparer"] : null, blocked: !auth.allowed };
  }
  if (m.status === "Approved") return { title: "Make the transfer, then record it", detail: `Pay ${money(m.cents, m.ccy)} to ${m.payTo?.bankName || "the reinsurer"} and record the bank's reference.`, primary: ["pay", "Record payment", false] };
  if (m.status === "Paid") return { title: "Paid", detail: `Transferred on ${m.paidDate} from ${m.fromAccount?.bankName || "—"} · ${m.bankRef}.`, done: true };
  return { title: "Cancelled", detail: m.receiptReversed ? "The receipt behind it was reversed." : "Cancelled.", done: true };
}

function shell(m) {
  const n = next(m);
  const checks = remittanceChecks(m);
  return `<div class="modal-backdrop"><div class="modal" style="max-width:720px;">
    <div class="modal-head"><div>
      <div class="panel-title" style="margin:0;">${esc(m.ref)} · ${esc(m.reinsurer)} ${statusPill(m.status)}</div>
      <div class="panel-sub" style="margin:2px 0 0;">${money(m.cents, m.ccy)} · ${esc(m.closingSlipId)} · from receipt ${esc(m.receiptRef)}</div></div>
      <button class="close-x" data-action="close-modal" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="next-action${n.blocked ? " blocked" : n.done ? " done" : ""}"><div class="next-action-body">
        <div class="next-action-kicker">${n.done ? icons.check : ""}Remittance · ${esc(m.status)}</div>
        <h4>${esc(n.title)}</h4><p>${esc(n.detail)}</p>
        <div class="next-action-actions">
          ${n.primary ? `<button class="btn primary" data-action="${n.primary[0]}"${n.primary[2] ? " disabled" : ""}>${n.primary[1]}</button>` : ""}
          ${n.secondary ? `<button class="btn next-action-secondary" data-action="${n.secondary[0]}">${n.secondary[1]}</button>` : ""}
          ${onBack ? `<button class="btn next-action-secondary" data-action="back">Back to batch</button>` : ""}
        </div></div></div>
      <div class="cols-2" style="margin-top:16px;">
        <div>
          <div class="panel-title" style="font-size:12.5px;">Payment</div>
          <div class="confirm-row"><span>Amount</span><span class="mono">${money(m.cents, m.ccy)}</span></div>
          <div class="confirm-row"><span>Source</span><span>${esc(m.sourceLabel)}</span></div>
          <div class="confirm-row"><span>Pay to</span><span>${acct(m.payTo)}</span></div>
          <div class="confirm-row"><span>Paid from</span><span>${acct(m.fromAccount)}</span></div>
          <div class="confirm-row"><span>Paid on</span><span>${m.paidDate || "<span class='muted'>—</span>"}</span></div>
          <div class="confirm-row"><span>Bank reference</span><span>${esc(m.bankRef) || "<span class='muted'>—</span>"}</span></div>
          ${m.status === "Draft" || m.status === "Pending Approval" ? `<div class="panel-title" style="font-size:12.5px; margin-top:14px;">Before this can be approved</div>
          <ul class="checklist">${checks.map((c) => `<li class="check-item ${c.state}"><span class="check-glyph">${c.state === "done" ? "✓" : "!"}</span><span class="check-text"><span class="check-label">${c.label}</span><span class="check-detail">${esc(c.detail)}</span></span></li>`).join("")}</ul>` : ""}
        </div>
        <div>
          <div class="panel-title" style="font-size:12.5px;">Authority trail</div>
          <div class="confirm-row"><span>Prepared by</span><span class="prov-who">${esc(m.preparedBy?.name)}</span></div>
          <div class="confirm-row"><span>Approved by</span><span class="prov-who">${esc(m.approvedBy?.name) || "—"}</span></div>
          ${m.overrideUsed ? `<div class="override-note">${icons.info}Approved under administrator override.</div>` : ""}
          <div class="panel-title" style="font-size:12.5px; margin-top:14px;">History</div>
          ${m.history.slice().reverse().map((h) => `<div class="hist-row"><span class="hist-when">${h.at}</span><span class="hist-what"><strong>${esc(h.action)}</strong>${h.notes ? ` — ${esc(h.notes)}` : ""}<span class="hist-who">${esc(h.actor)}</span></span></div>`).join("")}
        </div>
      </div>
    </div></div></div>`;
}

function wire() {
  onAction(drawerRoot(), {
    submit: () => { submitRemittance(openRef); repaint(); },
    approve: () => { approveRemittance(openRef); repaint(); },
    return: () => openFormModal({ title: `Return ${openRef}`, fields: [{ name: "notes", label: "Reason", type: "textarea", rows: 3, required: true }], submitLabel: "Return",
      onSubmit: ({ notes }) => { returnRemittance(openRef, notes); reopen(); } }),
    pay: () => {
      const m = remittanceByRef(openRef);
      const accounts = state.billing.brokerAccounts.filter((a) => a.active !== false && a.ccy === m.ccy && a.purpose !== "Collection");
      openFormModal({
        title: `Record payment — ${m.ref}`, subtitle: `${money(m.cents, m.ccy)} to ${m.reinsurer}`,
        fields: [
          { name: "paidDate", label: "Date paid", type: "date", required: true, value: todayISO(), half: true },
          { name: "accountId", label: "Paid from", type: "select", options: accounts.length ? accounts.map(accountOption) : [""], value: accounts[0] ? accountOption(accounts[0]) : "", half: true,
            hint: accounts.length ? "" : `No ${m.ccy} remittance account. Add one under Finance → Broker Profile.` },
          { name: "bankRef", label: "Bank transfer reference", type: "text", required: true },
          { name: "notes", label: "Notes", type: "textarea", rows: 2 },
        ],
        submitLabel: "Record payment",
        validate: (v) => checkRemittancePayment(openRef, { ...v, accountId: accountIdOf(v.accountId) }),
        onSubmit: (v) => { recordRemittancePayment(openRef, { ...v, accountId: accountIdOf(v.accountId) }); reopen(); },
      });
    },
    back: () => { const go = onBack; closeModal(); go?.(); },
  });
}

function repaint() { const m = remittanceByRef(openRef); if (!m) return closeModal(); updateModal(shell(m), { onMount: wire }); }
function reopen() { const m = remittanceByRef(openRef); if (m) openModal(shell(m), { onMount: wire, onDismiss: () => { openRef = null; } }); }

/** Open a remittance. `back` returns to wherever it was opened from. */
export function openRemittanceDetail(ref, back) {
  const m = remittanceByRef(ref);
  if (!m) return;
  openRef = ref; onBack = back || null;
  openModal(shell(m), { onMount: wire, onDismiss: () => { openRef = null; } });
}
