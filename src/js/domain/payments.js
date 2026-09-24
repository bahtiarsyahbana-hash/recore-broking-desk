/**
 * Payments — cash in from the cedant, cash out to the reinsurers.
 *
 * A receipt is money the cedant paid against an issued invoice or debit note.
 * Each receipt is split across everything that invoice pays for: every
 * Closing Slip's net amount (a remittance to that reinsurer), the broker's
 * brokerage, and taxes held for the authorities. The split is cumulative —
 * each receipt takes the share of "paid so far" that the ones before it had
 * not already taken — so however many part-payments arrive, the final one
 * lands every component on its exact closing-slip figure.
 *
 * Pure: batches, receipts and remittances in; findings out. Amounts in cents.
 */
import { allocate } from "./billing.js";

export const PAYMENT_STATES = ["Unpaid", "Part paid", "Paid"];
export const REMITTANCE_STATUSES = ["Draft", "Pending Approval", "Approved", "Paid", "Cancelled"];

/** Documents a cedant pays: issued invoices and debit notes with a positive total. */
export const isReceivable = (doc) => Boolean(doc) && (doc.docType === "Invoice" || doc.docType === "Debit Note") && doc.total > 0;

/**
 * What an issued batch's cedant total pays for, as components that add back
 * to it exactly: one per Closing Slip, then brokerage, then taxes held.
 */
export function componentsOf(batch) {
  const cedant = batch.documents?.[0];
  if (!cedant) return [];
  const slips = batch.documents.slice(1).map((d) => ({ key: d.id, kind: "remittance", closingSlipId: d.id, reinsurer: d.counterparty, cents: d.total }));
  const taxes = batch.computed?.taxesHeld || 0;
  const brokerage = batch.computed?.brokerageRetained || 0;
  return [...slips, { key: "brokerage", kind: "brokerage", cents: brokerage }, { key: "taxes", kind: "taxes", cents: taxes }];
}

/** Whether a batch's components can be split pro rata (all non-negative, adding to the total). */
export function splittable(batch) {
  const parts = componentsOf(batch);
  const total = batch.documents?.[0]?.total || 0;
  return parts.length > 0 && parts.every((p) => p.cents >= 0) && parts.reduce((s, p) => s + p.cents, 0) === total;
}

/**
 * Split one receipt. `paidBefore` is what earlier active receipts covered.
 * @returns {{ key, kind, closingSlipId?, reinsurer?, cents }[]}
 */
export function allocateReceipt(batch, paidBefore, receiptCents) {
  const parts = componentsOf(batch);
  const total = batch.documents[0].total;
  const weights = parts.map((p) => p.cents);
  // Share of the running total, less what earlier receipts already took.
  const cumulative = (paid) => (paid >= total ? parts.map((p) => p.cents) : allocate(paid, weights));
  const before = cumulative(paidBefore);
  const after = cumulative(paidBefore + receiptCents);
  return parts.map((p, i) => ({ ...p, cents: after[i] - before[i] }));
}

const activeReceipts = (receipts, docId) => receipts.filter((r) => r.docId === docId && !r.reversed);

/**
 * Payment position of one cedant document. Overdue is derived from the due
 * date, never stored.
 */
export function paymentState(doc, receipts = [], today) {
  const paid = activeReceipts(receipts, doc.id).reduce((s, r) => s + r.cents, 0);
  const outstanding = Math.max(0, doc.total - paid);
  const status = paid <= 0 ? "Unpaid" : outstanding === 0 ? "Paid" : "Part paid";
  const day = today instanceof Date ? today.toISOString().slice(0, 10) : today;
  const overdue = outstanding > 0 && Boolean(doc.dueDate) && Boolean(day) && doc.dueDate < day;
  return { paid, outstanding, status, overdue, label: overdue ? "Overdue" : status };
}

/**
 * Validate a receipt before it is recorded.
 * @param {object} r        { cents, receivedDate, accountId }
 * @param {object} ctx      { doc, batch, receipts, account, today }
 */
export function validateReceipt(r, { doc, batch, receipts = [], account, today }) {
  const errors = {};
  if (!isReceivable(doc)) errors.doc = "Receipts are recorded against an issued invoice or debit note.";
  else if (batch?.status !== "Issued") errors.doc = `${doc.id} is ${batch?.status?.toLowerCase() || "not issued"} and cannot take a receipt.`;
  else if (!splittable(batch)) errors.doc = "This document's amounts cannot be split for remittance.";
  const cents = Number(r.cents);
  const { outstanding } = doc ? paymentState(doc, receipts, today) : { outstanding: 0 };
  if (!Number.isInteger(cents) || cents <= 0) errors.amount = "Enter the amount received.";
  else if (cents > outstanding) errors.amount = `More than the ${(outstanding / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} outstanding. Overpayments are not accepted.`;
  if (!r.receivedDate) errors.receivedDate = "Give the date the money arrived.";
  else if (today && r.receivedDate > (today instanceof Date ? today.toISOString().slice(0, 10) : today)) errors.receivedDate = "A receipt cannot be dated in the future.";
  if (!account) errors.accountId = "Choose the broker account the money arrived in.";
  else {
    if (account.active === false) errors.accountId = "That account is inactive.";
    else if (account.purpose === "Remittance") errors.accountId = "That account is for remittances, not collection.";
    else if (doc && account.ccy !== doc.ccy) errors.accountId = `The receipt must be in ${doc.ccy}; that account is ${account.ccy}.`;
  }
  return errors;
}

/** The reinsurer's active account in the remittance currency, primary first. */
export function reinsurerAccountFor(bankAccounts = [], ccy) {
  const eligible = bankAccounts.filter((b) => b.ccy === ccy && b.active !== false);
  return eligible.find((b) => b.primary) || eligible[0] || null;
}

/** Four-eyes on money going out: the preparer may not approve; the approver needs signing authority. */
export function remittanceAuthority(rem, user) {
  if (!user?.canReleaseSlips) return { allowed: false, reason: `${user?.name || "This seat"} does not hold signing authority and cannot approve a remittance.` };
  if (rem.preparedBy && rem.preparedBy.id === user.id && !user.bypassFourEyes) {
    return { allowed: false, reason: `${user.name} prepared this remittance. A different authorised person must approve it.` };
  }
  return { allowed: true, reason: null, override: Boolean(user.bypassFourEyes && rem.preparedBy?.id === user.id) };
}

/** What must hold before a remittance can be approved. */
export function remittanceChecklist(rem, reinsurerAccounts = []) {
  const dest = reinsurerAccountFor(reinsurerAccounts, rem.ccy);
  return [
    { key: "amount", label: "Amount to remit", state: rem.cents > 0 ? "done" : "blocking", detail: rem.cents > 0 ? `${rem.ccy} ${(rem.cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "Nothing to remit." },
    { key: "destination", label: `Reinsurer account in ${rem.ccy}`, state: dest ? "done" : "blocking",
      detail: dest ? `${dest.bankName} · ${dest.accountNo || dest.iban}` : `${rem.reinsurer} has no active ${rem.ccy} bank account in the Registry. Add one before this can be approved.` },
    { key: "receipt", label: "Backed by a receipt", state: rem.receiptRef && !rem.receiptReversed ? "done" : "blocking", detail: rem.receiptRef ? rem.receiptRef : "No receipt." },
  ];
}

/** Validate recording the actual payment of an approved remittance. */
export function validateRemittancePayment(p, { rem, account, today }) {
  const errors = {};
  if (rem?.status !== "Approved") errors.status = "Only an approved remittance can be marked paid.";
  if (!p.paidDate) errors.paidDate = "Give the date the transfer was made.";
  else if (today && p.paidDate > (today instanceof Date ? today.toISOString().slice(0, 10) : today)) errors.paidDate = "A payment cannot be dated in the future.";
  if (!account) errors.accountId = "Choose the broker account the payment was made from.";
  else if (account.active === false) errors.accountId = "That account is inactive.";
  else if (account.purpose === "Collection") errors.accountId = "That account is for collection, not remittance.";
  else if (rem && account.ccy !== rem.ccy) errors.accountId = `The remittance is in ${rem.ccy}; that account is ${account.ccy}.`;
  if (!String(p.bankRef || "").trim()) errors.bankRef = "Enter the bank's transfer reference.";
  return errors;
}
