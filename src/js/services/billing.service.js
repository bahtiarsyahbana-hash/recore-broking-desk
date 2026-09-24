/**
 * Billing service — the only writer to state.billing.
 *
 * Billing events (a bind, a placement endorsement, a treaty technical account
 * reaching Agreed) create a Draft batch and nothing more. A preparer
 * completes and submits it; a different authorised person approves it, which
 * numbers and issues every document in it at once. Issued documents are
 * frozen: a correction is a reversing batch, issued the same way.
 */
import {
  state, programById, agreementById, counterpartyNamed, currentUser,
  nextInvoiceNo, nextCreditNoteNo, nextDebitNoteNo, nextBillingBatchRef, nextClosingSlipNo,
} from "../core/store.js";
import { todayISO } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import { stamp } from "../domain/authority.js";
import { isValidPaymentWarranty } from "../domain/intake.js";
import { picsOf } from "../domain/counterparty-profile.js";
import {
  computeBilling, placementWeights, cedantDocType, dueDate, issueAuthority,
  canSubmitBatch, canIssueBatch, validateTaxRule, fromCents,
  validateBrokerAccount, collectionAccountFor, cedantPays, validateBrokerProfile,
} from "../domain/billing.js";

const actor = () => currentUser()?.name || "Desk";
const publish = (payload) => emit(TOPICS.FINANCE, payload);
const num = (v) => (v === "" || v == null ? null : Number(v));

function log(batch, action, notes = "") {
  batch.history.push({ at: todayISO(), actor: actor(), action, notes: notes || "" });
}

export const batchByRef = (ref) => state.billing.batches.find((b) => b.ref === ref);
export const batchesForSource = (kind, sourceRef) => state.billing.batches.filter((b) => b.source.ref === sourceRef && (!kind || b.sourceKind === kind));

/* ---- inputs from each source -------------------------------------------------- */

const countryOf = (name) => counterpartyNamed(name)?.country || "";

function inputsFor(batch) {
  const base = { sourceKind: batch.sourceKind, taxRules: state.billing.taxRules, cedantCountry: countryOf(batch.cedant) };
  if (batch.sourceKind === "treaty") {
    const a = agreementById(batch.source.agreementId);
    const t = state.treaty.technicalAccounts.find((x) => x.ref === batch.source.ref);
    return {
      ...base, gross: t?.premium || 0, commissionAmount: t?.commission || 0, claims: t?.claims || 0, accountTax: t?.tax || 0,
      brokeragePct: batch.brokeragePct,
      panel: (a?.panel || []).map((p) => ({ reinsurer: p.reinsurer, weight: (Number(p.share) || 0) / 100, country: countryOf(p.reinsurer) })),
    };
  }
  const p = programById(batch.source.ref);
  const terms = p?.boundTerms ? { ...p, layers: p.boundTerms.layers, marketConfirmations: p.boundTerms.panel } : p;
  return {
    ...base, gross: batch.gross, commissionPct: batch.commissionPct, brokeragePct: batch.brokeragePct,
    panel: placementWeights(terms || {}).map((w) => ({ ...w, country: countryOf(w.reinsurer) })),
  };
}

/** Recompute a batch that is still open. Issued batches are never recomputed. */
function recompute(batch) {
  if (batch.status === "Issued" || batch.status === "Cancelled" || batch.sourceKind === "reversal") return batch;
  batch.computed = computeBilling(inputsFor(batch));
  batch.cedantDocType = cedantDocType(batch.sourceKind, batch.computed.cedant.total);
  batch.dueDate = dueDate(batch.basisDate, batch.paymentWarrantyDays);
  batch.payTo = payToFor(batch);
  return batch;
}

/** The broker's details as they stood when a document was issued. */
function brokerSnapshot() {
  const p = state.billing.brokerProfile;
  return { legalName: p.legalName, address: p.address, postalCode: p.postalCode, country: p.country, email: p.email, phone: p.phone, taxId: p.taxId };
}

/** The recipient's details from the registry, in the same shape as the broker's. */
function counterpartySnapshot(name) {
  const c = counterpartyNamed(name) || { name };
  const pics = picsOf(c);
  const finance = pics.find((x) => x.division === "Technical Accounting / Finance") || pics.find((x) => x.primary) || pics[0];
  return { legalName: c.name, address: c.address || "", postalCode: c.postalCode || "", country: c.country || "", email: finance?.email || c.contactEmail || "", attention: finance?.name || "" };
}

/** A copy of the collection account the cedant should pay into, or null. */
function payToFor(batch) {
  if (!batch.computed || !cedantPays(batch.cedantDocType, batch.computed.cedant.total)) return null;
  const a = collectionAccountFor(state.billing.brokerAccounts, batch.ccy);
  return a ? { id: a.id, bankName: a.bankName, accountName: a.accountName, accountNo: a.accountNo || "", iban: a.iban || "", swift: a.swift || "", branch: a.branch || "", ccy: a.ccy } : null;
}

function newBatch(fields) {
  const batch = {
    ref: nextBillingBatchRef(), status: "Draft", documents: [], history: [],
    preparedBy: stamp(currentUser() || { id: "desk", name: "Desk", title: "" }), approvedBy: null, overrideUsed: false,
    createdAt: todayISO(), issuedAt: null, notes: "", ...fields,
  };
  recompute(batch);
  log(batch, "Draft prepared", `${batch.sourceLabel}`);
  state.billing.batches.unshift(batch);
  publish({ ref: batch.ref, action: "draft" });
  return batch;
}

const openBatchFor = (kind, ref) => state.billing.batches.find((b) => b.sourceKind === kind && b.source.ref === ref && b.status !== "Cancelled");

/** Draft the bind billing for a newly bound placement. */
export function createBindDraft(program) {
  if (!program || openBatchFor("bind", program.id)) return null;
  return newBatch({
    sourceKind: "bind", source: { ref: program.id }, sourceLabel: `${program.id} bound ${program.boundAt || todayISO()}`,
    cedant: program.cedant, ccy: program.ccy, gross: program.premium,
    commissionPct: num(program.terms?.commissionPct), brokeragePct: num(program.terms?.brokeragePct),
    basisDate: program.boundAt || todayISO(), paymentWarrantyDays: num(program.terms?.paymentWarrantyDays),
  });
}

/** Draft the billing for a placement endorsement. Due date runs from the endorsement date. */
export function createEndorsementDraft(program, endorsement) {
  if (!program || !endorsement) return null;
  const last = state.billing.batches.find((b) => b.source.ref === program.id && b.status === "Issued" && b.sourceKind !== "reversal");
  return newBatch({
    sourceKind: "endorsement", source: { ref: program.id, endorsementRef: endorsement.ref },
    sourceLabel: `${program.id} endorsement ${endorsement.ref} · ${endorsement.date}`,
    cedant: program.cedant, ccy: program.ccy, gross: Number(endorsement.premium) || 0,
    commissionPct: last ? last.commissionPct : num(program.terms?.commissionPct),
    brokeragePct: last ? last.brokeragePct : num(program.terms?.brokeragePct),
    basisDate: endorsement.date, paymentWarrantyDays: num(program.terms?.paymentWarrantyDays),
  });
}

/** Draft the billing for a treaty technical account that has just been Agreed. */
export function createTreatyDraft(account) {
  if (!account || openBatchFor("treaty", account.ref)) return null;
  const a = agreementById(account.agreementId);
  if (!a) return null;
  return newBatch({
    sourceKind: "treaty", source: { ref: account.ref, agreementId: a.id },
    sourceLabel: `${a.id} technical account ${account.ref} · ${account.period}`,
    cedant: a.cedant, ccy: account.ccy || a.ccy, gross: account.premium,
    commissionPct: null, brokeragePct: num(a.reporting?.brokeragePct) ?? 0,
    basisDate: account.agreedAt || todayISO(), paymentWarrantyDays: num(a.reporting?.paymentWarrantyDays),
  });
}

/* ---- preparing -------------------------------------------------------------------- */

/** Change the preparer's inputs on a Draft. */
export function updateBatchTerms(ref, { commissionPct, brokeragePct, paymentWarrantyDays, notes } = {}) {
  const b = batchByRef(ref);
  if (!b || b.status !== "Draft") return null;
  const changed = [];
  if (commissionPct !== undefined && b.sourceKind !== "treaty") { b.commissionPct = num(commissionPct); changed.push(`commission ${b.commissionPct ?? "not set"}%`); }
  if (brokeragePct !== undefined) { b.brokeragePct = num(brokeragePct); changed.push(`brokerage ${b.brokeragePct ?? "not set"}%`); }
  if (paymentWarrantyDays !== undefined) {
    if (paymentWarrantyDays !== "" && paymentWarrantyDays != null && !isValidPaymentWarranty(paymentWarrantyDays)) return null;
    b.paymentWarrantyDays = num(paymentWarrantyDays); changed.push(`warranty ${b.paymentWarrantyDays ?? "not set"} days`);
  }
  if (notes !== undefined) b.notes = String(notes || "").trim();
  recompute(b);
  if (changed.length) log(b, "Terms updated", changed.join(" · "));
  publish({ ref, action: "updated" });
  return b;
}

export function submitBatch(ref) {
  const b = batchByRef(ref);
  if (!b) return null;
  recompute(b);
  if (!canSubmitBatch(b)) return null;
  b.status = "Pending Approval";
  log(b, "Submitted for approval");
  publish({ ref, action: "submitted" });
  return b;
}

export function returnBatch(ref, reason) {
  const b = batchByRef(ref);
  if (!b || b.status !== "Pending Approval") return null;
  b.status = "Draft";
  log(b, "Returned to preparer", reason);
  publish({ ref, action: "returned" });
  return b;
}

/* ---- issuing ------------------------------------------------------------------------ */

const numberFor = (docType) => (docType === "Invoice" ? nextInvoiceNo() : docType === "Debit Note" ? nextDebitNoteNo() : nextCreditNoteNo());

/**
 * Approve and issue: four-eyes checked, every document numbered now and in
 * order — the cedant document first, then each Closing Slip — and frozen.
 */
export function issueBatch(ref) {
  const b = batchByRef(ref);
  const user = currentUser();
  if (!b) return null;
  recompute(b);
  if (!canIssueBatch(b, user)) return null;
  const auth = issueAuthority(b, user);
  const today = todayISO();
  const c = b.computed;
  // The pay-to account is copied onto the issued document, so a later change
  // to the broker's accounts never alters an invoice already sent.
  if (b.sourceKind === "reversal") b.payTo = payToFor(b);
  b.documents = [
    { id: numberFor(b.cedantDocType), docType: b.cedantDocType, role: "Cedant", counterparty: b.cedant, lines: c.cedant.lines, total: c.cedant.total, delivery: "Issued", sentAt: null, payTo: b.payTo ? { ...b.payTo } : null },
    ...c.slips.map((s) => ({ id: nextClosingSlipNo(), docType: "Closing Slip", role: "Reinsurer", counterparty: s.reinsurer, share: s.weight, lines: s.lines, total: s.total, delivery: "Issued", sentAt: null })),
  ].map((d) => ({ ...d, issueDate: today, dueDate: b.dueDate, ccy: b.ccy, from: brokerSnapshot(), billTo: counterpartySnapshot(d.counterparty) }));
  b.status = "Issued";
  b.issuedAt = today;
  b.approvedBy = stamp(user);
  b.overrideUsed = Boolean(auth.override);
  log(b, "Approved and issued", `${b.documents.map((d) => d.id).join(", ")}${b.overrideUsed ? " · administrator override" : ""}`);
  if (b.sourceKind === "reversal") {
    const original = batchByRef(b.source.ref);
    if (original) {
      original.status = "Cancelled";
      original.cancelledBy = b.documents[0].id;
      log(original, "Cancelled", `Reversed by ${b.ref} (${b.documents[0].id})`);
    }
  }
  publish({ ref, action: "issued" });
  return b;
}

/** Record that one issued document has been sent to its counterparty. */
export function markDocumentSent(ref, docId) {
  const b = batchByRef(ref);
  const d = b?.documents.find((x) => x.id === docId);
  if (!d || d.delivery === "Sent") return null;
  d.delivery = "Sent";
  d.sentAt = todayISO();
  log(b, `${docId} sent`, d.counterparty);
  publish({ ref, action: "sent" });
  return d;
}

/**
 * Cancel an issued batch the only way an issued document may change: a
 * reversing batch with every line negated, prepared as a Draft and issued by a
 * second person. The original is marked Cancelled only when the reversal issues.
 */
export function raiseCancellation(ref, reason) {
  const original = batchByRef(ref);
  if (!original || original.status !== "Issued" || original.sourceKind === "reversal") return null;
  if (state.billing.batches.some((b) => b.sourceKind === "reversal" && b.source.ref === ref && b.status !== "Cancelled")) return null;
  const neg = (lines) => lines.map((l) => ({ ...l, label: `Reversal: ${l.label}`, cents: -l.cents }));
  const cedant = original.documents[0];
  const computed = {
    cedant: { lines: neg(cedant.lines), total: -cedant.total },
    slips: original.documents.slice(1).map((d) => ({ reinsurer: d.counterparty, weight: d.share, lines: neg(d.lines), total: -d.total })),
    brokerageRetained: -original.computed.brokerageRetained, taxesHeld: -original.computed.taxesHeld,
    brokerTaxes: original.computed.brokerTaxes.map((t) => ({ ...t, cents: -t.cents })), balanced: original.computed.balanced, balance: -original.computed.balance,
  };
  const batch = {
    ref: nextBillingBatchRef(), status: "Draft", documents: [], history: [],
    preparedBy: stamp(currentUser() || { id: "desk", name: "Desk", title: "" }), approvedBy: null, overrideUsed: false,
    createdAt: todayISO(), issuedAt: null, notes: reason || "",
    sourceKind: "reversal", source: { ref: original.ref }, sourceLabel: `Cancels ${original.ref} (${cedant.id})`,
    cedant: original.cedant, ccy: original.ccy, gross: -original.gross, commissionPct: original.commissionPct, brokeragePct: original.brokeragePct,
    basisDate: null, paymentWarrantyDays: null, dueDate: null,
    computed, cedantDocType: cedantDocType("reversal", computed.cedant.total),
  };
  batch.payTo = payToFor(batch);
  log(batch, "Cancellation drafted", reason);
  log(original, "Cancellation drafted", `${batch.ref}${reason ? ` — ${reason}` : ""}`);
  state.billing.batches.unshift(batch);
  publish({ ref: batch.ref, action: "reversal" });
  return batch;
}

/* ---- tax rules -------------------------------------------------------------------------- */

let taxSeq = 1;

export function addTaxRule(rule) {
  const errors = validateTaxRule(rule);
  if (Object.keys(errors).length) return { errors };
  const stored = { id: `TX-${String(taxSeq++).padStart(3, "0")}`, name: rule.name.trim(), rate: Number(rule.rate), basis: rule.basis, bearer: rule.bearer,
    appliesTo: rule.appliesTo, jurisdictionOf: rule.jurisdictionOf, country: String(rule.country || "").trim(), active: rule.active !== false && rule.active !== "No", notes: String(rule.notes || "").trim() };
  state.billing.taxRules.push(stored);
  state.billing.batches.forEach(recompute);
  publish({ action: "tax-rule" });
  return { rule: stored };
}

export function updateTaxRule(id, patch) {
  const r = state.billing.taxRules.find((x) => x.id === id);
  if (!r) return null;
  const merged = { ...r, ...patch, active: patch.active === undefined ? r.active : patch.active === true || patch.active === "Yes" };
  const errors = validateTaxRule(merged);
  if (Object.keys(errors).length) return { errors };
  Object.assign(r, { ...merged, rate: Number(merged.rate), name: String(merged.name).trim(), country: String(merged.country || "").trim() });
  state.billing.batches.forEach(recompute);
  publish({ action: "tax-rule" });
  return { rule: r };
}

export function removeTaxRule(id) {
  const before = state.billing.taxRules.length;
  state.billing.taxRules = state.billing.taxRules.filter((x) => x.id !== id);
  if (state.billing.taxRules.length === before) return null;
  state.billing.batches.forEach(recompute);
  publish({ action: "tax-rule" });
  return true;
}

/* ---- the broker's company profile -------------------------------------------------------- */

const PROFILE_FIELDS = ["legalName", "address", "postalCode", "country", "email", "phone", "taxId"];

/** Update the broker's own details. Every change is recorded. */
export function updateBrokerProfile(patch = {}) {
  const current = state.billing.brokerProfile;
  const next = { ...current };
  PROFILE_FIELDS.forEach((k) => { if (patch[k] !== undefined) next[k] = String(patch[k] ?? "").trim(); });
  const errors = validateBrokerProfile(next);
  if (Object.keys(errors).length) return { errors };
  const changed = PROFILE_FIELDS.filter((k) => current[k] !== next[k]);
  PROFILE_FIELDS.forEach((k) => { current[k] = next[k]; });
  if (changed.length) {
    current.history = current.history || [];
    current.history.push({ at: todayISO(), actor: actor(), action: "Profile updated", notes: changed.join(", ") });
  }
  publish({ action: "broker-profile" });
  return { profile: current };
}

/* ---- the broker's bank accounts ---------------------------------------------------------- */

let acctSeq = 1;
const ACCOUNT_FIELDS = ["bankName", "accountName", "accountNo", "iban", "swift", "ccy", "branch", "purpose", "notes"];

function normaliseAccount(input, existing = {}) {
  const out = { ...existing };
  ACCOUNT_FIELDS.forEach((k) => { if (input[k] !== undefined) out[k] = String(input[k] ?? "").trim(); });
  if (out.swift) out.swift = out.swift.toUpperCase();
  if (out.iban) out.iban = out.iban.replace(/\s+/g, "").toUpperCase();
  if (input.primary !== undefined) out.primary = input.primary === true || input.primary === "Yes";
  if (input.active !== undefined) out.active = !(input.active === false || input.active === "No");
  return out;
}

/** One primary per currency and purpose family; the newest primary wins. */
function enforcePrimary(account) {
  if (!account.primary) return;
  const overlaps = (a) => a.purpose === "Both" || account.purpose === "Both" || a.purpose === account.purpose;
  state.billing.brokerAccounts.forEach((a) => { if (a !== account && a.ccy === account.ccy && overlaps(a)) a.primary = false; });
}

function accountHistory(a, action, notes = "") {
  a.history = a.history || [];
  a.history.push({ at: todayISO(), actor: actor(), action, notes });
}

export function addBrokerAccount(input) {
  const a = normaliseAccount({ purpose: "Collection", primary: "No", active: "Yes", ...input }, { id: `BA-${String(acctSeq++).padStart(3, "0")}` });
  const errors = validateBrokerAccount(a);
  if (Object.keys(errors).length) return { errors };
  if (!state.billing.brokerAccounts.some((x) => x.ccy === a.ccy && x.active !== false)) a.primary = true;
  state.billing.brokerAccounts.push(a);
  enforcePrimary(a);
  accountHistory(a, "Account added", `${a.bankName} · ${a.ccy} · ${a.purpose}`);
  state.billing.batches.forEach(recompute);
  publish({ action: "broker-account" });
  return { account: a };
}

export function updateBrokerAccount(id, input) {
  const a = state.billing.brokerAccounts.find((x) => x.id === id);
  if (!a) return null;
  const next = normaliseAccount(input, a);
  const errors = validateBrokerAccount(next);
  if (Object.keys(errors).length) return { errors };
  const changed = ACCOUNT_FIELDS.concat(["primary", "active"]).filter((k) => String(a[k] ?? "") !== String(next[k] ?? ""));
  Object.assign(a, next);
  enforcePrimary(a);
  if (changed.length) accountHistory(a, "Account updated", changed.join(", "));
  state.billing.batches.forEach(recompute);
  publish({ action: "broker-account" });
  return { account: a };
}

/** Remove an account. Issued documents keep their own copy of it. */
export function removeBrokerAccount(id) {
  const before = state.billing.brokerAccounts.length;
  state.billing.brokerAccounts = state.billing.brokerAccounts.filter((x) => x.id !== id);
  if (state.billing.brokerAccounts.length === before) return null;
  state.billing.batches.forEach(recompute);
  publish({ action: "broker-account" });
  return true;
}

/* ---- read helpers ----------------------------------------------------------------------- */

/** Every issued document, newest batch first. */
export const issuedDocuments = () => state.billing.batches.filter((b) => b.documents.length).flatMap((b) => b.documents.map((d) => ({ ...d, batchRef: b.ref, sourceLabel: b.sourceLabel, batchStatus: b.status })));

export { fromCents };
