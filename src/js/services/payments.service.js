/**
 * Payments service — the only writer to state.billing.receipts and
 * state.billing.remittances.
 *
 * Recording a receipt against an issued invoice or debit note splits it
 * across the batch (payments.js) and drafts one remittance per Closing Slip.
 * A remittance is money leaving the firm, so it is approved by a second
 * authorised person, and only once the reinsurer has a bank account in its
 * currency; then the actual transfer is recorded with its bank reference.
 * Nothing is paid, approved or reversed without an explicit user action.
 */
import { state, currentUser, counterpartyNamed, nextReceiptRef, nextRemittanceRef } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import { stamp } from "../domain/authority.js";
import { toCents } from "../domain/billing.js";
import { bankAccountsOf } from "../domain/counterparty-profile.js";
import {
  allocateReceipt, paymentState, validateReceipt, remittanceAuthority, remittanceChecklist,
  validateRemittancePayment, reinsurerAccountFor, isReceivable,
} from "../domain/payments.js";
import { batchByRef } from "./billing.service.js";
import { setPremiumPaid } from "./placement.service.js";

const actor = () => currentUser()?.name || "Desk";
const who = () => stamp(currentUser() || { id: "desk", name: "Desk", title: "" });
const publish = (payload) => emit(TOPICS.FINANCE, payload);
const log = (rec, action, notes = "") => { rec.history = rec.history || []; rec.history.push({ at: todayISO(), actor: actor(), action, notes: notes || "" }); };

const brokerAccount = (id) => state.billing.brokerAccounts.find((a) => a.id === id);
const accountCopy = (a) => (a ? { id: a.id, bankName: a.bankName, accountName: a.accountName, accountNo: a.accountNo || "", iban: a.iban || "", swift: a.swift || "", ccy: a.ccy } : null);

/** The issued cedant document a receipt is recorded against. */
function receivable(batchRef) {
  const batch = batchByRef(batchRef);
  return { batch, doc: batch?.documents?.[0] || null };
}

export const receiptsFor = (docId) => state.billing.receipts.filter((r) => r.docId === docId);
export const remittancesFor = (batchRef) => state.billing.remittances.filter((r) => r.batchRef === batchRef);
export const remittanceByRef = (ref) => state.billing.remittances.find((r) => r.ref === ref);
export const receiptByRef = (ref) => state.billing.receipts.find((r) => r.ref === ref);

/** Payment position of a batch's cedant document. */
export function paymentOf(batchRef) {
  const { doc } = receivable(batchRef);
  return doc && isReceivable(doc) ? paymentState(doc, state.billing.receipts, todayISO()) : null;
}

/** Validate without writing — for forms. `amount` is in currency units. */
export function checkReceipt(batchRef, { amount, receivedDate, accountId } = {}) {
  const { batch, doc } = receivable(batchRef);
  return validateReceipt({ cents: toCents(amount), receivedDate, accountId }, { doc, batch, receipts: state.billing.receipts, account: brokerAccount(accountId), today: todayISO() });
}

/* ---- credit control ------------------------------------------------------------ */

/** Recompute premiumPaid for a placement from every receivable document billed to it. */
function refreshCreditControl(programId, why) {
  if (!programId) return;
  const docs = state.billing.batches
    .filter((b) => b.status === "Issued" && b.source.ref === programId && (b.sourceKind === "bind" || b.sourceKind === "endorsement"))
    .map((b) => b.documents[0]).filter(isReceivable);
  if (!docs.length) return;
  const paid = docs.every((d) => paymentState(d, state.billing.receipts, todayISO()).status === "Paid");
  setPremiumPaid(programId, paid, why);
}

/* ---- receipts --------------------------------------------------------------------- */

/**
 * Record money received. Splits it across the batch and drafts one remittance
 * per Closing Slip that receives a share.
 * @returns {{ receipt, remittances } | { errors }}
 */
export function recordReceipt(batchRef, { amount, receivedDate, accountId, bankRef, notes } = {}) {
  const { batch, doc } = receivable(batchRef);
  const cents = toCents(amount);
  const account = brokerAccount(accountId);
  const errors = validateReceipt({ cents, receivedDate, accountId }, { doc, batch, receipts: state.billing.receipts, account, today: todayISO() });
  if (Object.keys(errors).length) return { errors };

  const before = paymentState(doc, state.billing.receipts, todayISO()).paid;
  const split = allocateReceipt(batch, before, cents);
  const receipt = {
    ref: nextReceiptRef(), batchRef, docId: doc.id, cedant: batch.cedant, ccy: doc.ccy, cents, receivedDate,
    account: accountCopy(account), bankRef: String(bankRef || "").trim(), notes: String(notes || "").trim(),
    recordedBy: who(), recordedAt: todayISO(), reversed: null,
    brokerageCents: split.find((x) => x.kind === "brokerage").cents,
    taxesHeldCents: split.find((x) => x.kind === "taxes").cents,
    history: [],
  };
  log(receipt, "Receipt recorded", `${doc.id} · ${doc.ccy} ${(cents / 100).toFixed(2)}${receipt.bankRef ? ` · ${receipt.bankRef}` : ""}`);
  state.billing.receipts.unshift(receipt);

  const remittances = split.filter((x) => x.kind === "remittance" && x.cents > 0).map((x) => {
    const rem = {
      ref: nextRemittanceRef(), receiptRef: receipt.ref, batchRef, closingSlipId: x.closingSlipId, reinsurer: x.reinsurer,
      ccy: doc.ccy, cents: x.cents, status: "Draft", preparedBy: who(), approvedBy: null, overrideUsed: false,
      payTo: null, paidDate: null, fromAccount: null, bankRef: "", receiptReversed: false,
      agreementId: batch.source.agreementId || null, sourceLabel: batch.sourceLabel, history: [],
    };
    log(rem, "Drafted from receipt", `${receipt.ref} · ${x.closingSlipId}`);
    state.billing.remittances.unshift(rem);
    return rem;
  });
  receipt.remittanceRefs = remittances.map((r) => r.ref);

  log(batch, `Receipt ${receipt.ref}`, `${doc.ccy} ${(cents / 100).toFixed(2)} → ${remittances.length} remittance draft${remittances.length === 1 ? "" : "s"}`);
  refreshCreditControl(batch.source.ref, `${receipt.ref} on ${doc.id}`);
  publish({ ref: receipt.ref, action: "receipt" });
  return { receipt, remittances };
}

/**
 * Reverse a receipt recorded in error. Its remittances that have not been paid
 * are cancelled with it; if any has already been paid the reversal is refused,
 * because that money has left the firm.
 */
export function reverseReceipt(ref, reason) {
  const r = receiptByRef(ref);
  if (!r || r.reversed || !String(reason || "").trim()) return null;
  const linked = state.billing.remittances.filter((m) => m.receiptRef === ref);
  if (linked.some((m) => m.status === "Paid")) return { errors: { ref: "A remittance from this receipt has already been paid. Reverse it with the reinsurer first." } };
  r.reversed = { by: who(), at: todayISO(), reason: String(reason).trim() };
  log(r, "Receipt reversed", reason);
  linked.forEach((m) => {
    if (m.status === "Cancelled") return;
    m.status = "Cancelled"; m.receiptReversed = true;
    log(m, "Cancelled", `Receipt ${ref} reversed`);
  });
  const batch = batchByRef(r.batchRef);
  if (batch) {
    log(batch, `Receipt ${ref} reversed`, reason);
    refreshCreditControl(batch.source.ref, `${ref} reversed`);
  }
  publish({ ref, action: "receipt-reversed" });
  return { receipt: r };
}

/* ---- remittances ------------------------------------------------------------------ */

const reinsurerAccounts = (name) => bankAccountsOf(counterpartyNamed(name) || {});

export const remittanceBlockers = (rem) => remittanceChecklist(rem, reinsurerAccounts(rem.reinsurer)).filter((c) => c.state === "blocking");
export const remittanceChecks = (rem) => remittanceChecklist(rem, reinsurerAccounts(rem.reinsurer));

export function submitRemittance(ref) {
  const m = remittanceByRef(ref);
  if (!m || m.status !== "Draft" || remittanceBlockers(m).length) return null;
  m.status = "Pending Approval";
  log(m, "Submitted for approval");
  publish({ ref, action: "remittance-submitted" });
  return m;
}

export function returnRemittance(ref, reason) {
  const m = remittanceByRef(ref);
  if (!m || m.status !== "Pending Approval") return null;
  m.status = "Draft";
  log(m, "Returned to preparer", reason);
  publish({ ref, action: "remittance-returned" });
  return m;
}

/** Approve: four-eyes, destination account checked again, and copied onto the record. */
export function approveRemittance(ref) {
  const m = remittanceByRef(ref);
  const user = currentUser();
  if (!m || m.status !== "Pending Approval" || remittanceBlockers(m).length) return null;
  const auth = remittanceAuthority(m, user);
  if (!auth.allowed) return null;
  const dest = reinsurerAccountFor(reinsurerAccounts(m.reinsurer), m.ccy);
  m.payTo = { bankName: dest.bankName, accountName: dest.accountName, accountNo: dest.accountNo || "", iban: dest.iban || "", swift: dest.swift || "", ccy: dest.ccy };
  m.status = "Approved";
  m.approvedBy = stamp(user);
  m.overrideUsed = Boolean(auth.override);
  log(m, "Approved", `${dest.bankName}${m.overrideUsed ? " · administrator override" : ""}`);
  publish({ ref, action: "remittance-approved" });
  return m;
}

/** Record the transfer itself. */
export function recordRemittancePayment(ref, { paidDate, accountId, bankRef, notes } = {}) {
  const m = remittanceByRef(ref);
  const account = brokerAccount(accountId);
  const errors = validateRemittancePayment({ paidDate, bankRef }, { rem: m, account, today: todayISO() });
  if (Object.keys(errors).length) return { errors };
  m.status = "Paid";
  m.paidDate = paidDate;
  m.fromAccount = accountCopy(account);
  m.bankRef = String(bankRef).trim();
  log(m, "Paid", `${m.bankRef}${notes ? ` · ${notes}` : ""}`);
  publish({ ref, action: "remittance-paid" });
  return { remittance: m };
}

/** Validate a payment without writing — for forms. */
export const checkRemittancePayment = (ref, { paidDate, accountId, bankRef } = {}) =>
  validateRemittancePayment({ paidDate, bankRef }, { rem: remittanceByRef(ref), account: brokerAccount(accountId), today: todayISO() });

/** Taxes held from receipts, by currency — a liability to the authorities. */
export function taxesHeldByCurrency() {
  const out = {};
  state.billing.receipts.filter((r) => !r.reversed).forEach((r) => { out[r.ccy] = (out[r.ccy] || 0) + r.taxesHeldCents; });
  return out;
}

/** Remittances raised from treaty billing for one agreement — shown in the Treaty Engine. */
export const remittancesForAgreement = (agreementId) => state.billing.remittances.filter((r) => r.agreementId === agreementId);
