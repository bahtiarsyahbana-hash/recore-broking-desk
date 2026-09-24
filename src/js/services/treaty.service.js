/**
 * Treaty service — the only writer to the treaty register and its
 * workstreams. Applies the rules in domain/treaty.js, records every material
 * change on the agreement's audit trail, and publishes what changed.
 *
 * Nothing here simulates a counterparty or moves a status on its own: every
 * transition is an explicit call from a user action.
 */
import { state, agreementById, nextTreatyRef, currentUser } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import { stamp } from "../domain/authority.js";
import {
  validateBasics, validateStructure, validatePanel, canActivate, canTransitionAgreement, acceptsTransactions,
  validatePremiumBordereau, validateClaimsBordereau, validateCession, validateTechnicalAccount, validateSettlement,
  accountNet, BORDEREAU_STATUSES, CESSION_STATUSES, ACCOUNT_STATUSES, SETTLEMENT_STATUSES, AGREEMENT_STATUSES,
} from "../domain/treaty.js";

const actor = () => currentUser()?.name || "Desk";

function audit(a, action, notes = "") {
  a.audit = a.audit || [];
  a.audit.push({ at: todayISO(), actor: actor(), action, notes: notes || "" });
}

const publish = (payload) => emit(TOPICS.TREATY, payload);

const num = (v) => (v === "" || v == null ? null : Number(v));
const clean = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

/** Structure fields are numeric except the named text ones. */
function normaliseStructure(type, s = {}) {
  const out = {};
  const text = new Set(["premiumBasis", "eventDefinition", "lossRatioBasis", "layerMode"]);
  Object.entries(s).forEach(([k, v]) => {
    if (k === "layers") out.layers = (v || []).map((l) => ({
      limit: num(l.limit), attachment: num(l.attachment), reinstatements: num(l.reinstatements), premium: num(l.premium),
    }));
    else out[k] = text.has(k) ? (v == null ? null : String(v).trim() || null) : num(v);
  });
  return out;
}

const normalisePanel = (panel = []) => panel.map((p) => ({
  reinsurer: String(p.reinsurer || "").trim(), share: num(p.share) ?? 0, role: p.role || "Follow",
  brokeragePct: num(p.brokeragePct), marketRef: String(p.marketRef || "").trim(),
}));

const normaliseReporting = (r = {}) => ({
  premiumBdxFrequency: r.premiumBdxFrequency || null, claimsBdxFrequency: r.claimsBdxFrequency || null,
  accountingFrequency: r.accountingFrequency || null, reportingDeadlineDays: num(r.reportingDeadlineDays),
  paymentWarrantyDays: num(r.paymentWarrantyDays), brokeragePct: num(r.brokeragePct), commissionPct: num(r.commissionPct),
  taxPct: num(r.taxPct), settlementCcy: r.settlementCcy || null,
  declarationsRequired: r.declarationsRequired === true || r.declarationsRequired === "Yes",
  cashCallThreshold: num(r.cashCallThreshold),
});

/**
 * Register an agreement. Saved as Draft Setup unless every activation gate is
 * met and `activate` is requested. The agreement number must be unique.
 *
 * @returns {{ agreement } | { errors: Record<string,string> }}
 */
export function registerAgreement(draft, { activate = false } = {}) {
  const basics = clean(draft);
  const errors = validateBasics({ ...basics, status: undefined });
  if (basics.id && agreementById(basics.id)) errors.id = `Agreement number ${basics.id} is already registered.`;
  Object.assign(errors, prefixed(validateStructureSoft(basics.type, draft.structure)));
  Object.assign(errors, validatePanel(normalisePanel(draft.panel)));
  if (Object.keys(errors).length) return { errors };

  const a = {
    id: basics.id, name: basics.name, cedant: basics.cedant, cls: basics.cls || null,
    inception: basics.inception || null, expiry: basics.expiry || null, originalInception: basics.originalInception || basics.inception || null,
    ccy: basics.ccy, type: basics.type, status: "Draft Setup", source: basics.source || "Manual Registration", origin: basics.origin || null,
    structure: normaliseStructure(basics.type, draft.structure), panel: normalisePanel(draft.panel), reporting: normaliseReporting(draft.reporting),
    documents: (draft.documents || []).map((d) => ({ date: todayISO(), from: actor(), version: 1, ...d })),
    endorsements: (draft.endorsements || []).map((e) => ({ date: todayISO(), ...e })),
    audit: [], registeredBy: stamp(currentUser() || { id: "desk", name: "Desk", title: "" }), activatedAt: null,
  };
  audit(a, a.source === "Imported" ? "Agreement imported" : "Agreement registered", `${a.type} · ${a.cedant}`);
  state.treaty.agreements.unshift(a);
  publish({ id: a.id, action: "registered" });
  if (activate) {
    const result = activateAgreement(a.id);
    if (!result) return { agreement: a, activationRefused: true };
  }
  return { agreement: a };
}

/** Structure errors only where the type is known; a draft may still be partial. */
function validateStructureSoft(type, structure) {
  const errors = validateStructure(type, normaliseStructure(type, structure));
  // A draft may leave the structure incomplete; only actively wrong values block saving.
  const hardOnly = {};
  Object.entries(errors).forEach(([k, v]) => {
    if (/must|cannot|exceed|total 100|appears twice|should equal/.test(v)) hardOnly[k] = v;
  });
  return hardOnly;
}
const prefixed = (errors) => Object.fromEntries(Object.entries(errors).map(([k, v]) => [`structure.${k}`, v]));

/** Edit basics, structure, panel or reporting on an agreement that is not Closed. */
export function updateAgreement(id, patch) {
  const a = agreementById(id);
  if (!a || a.status === "Closed") return null;
  const changed = [];
  if (patch.basics) {
    const basics = clean(patch.basics);
    delete basics.id; delete basics.status;
    const errors = validateBasics({ ...a, ...basics });
    if (Object.keys(errors).length) return { errors };
    Object.entries(basics).forEach(([k, v]) => { if (v !== undefined && a[k] !== v) { a[k] = v === "" ? null : v; changed.push(k); } });
  }
  if (patch.structure) {
    const structure = normaliseStructure(a.type, patch.structure);
    const errors = validateStructure(a.type, structure);
    if (Object.keys(errors).length && a.status !== "Draft Setup") return { errors: prefixed(errors) };
    a.structure = structure; changed.push("structure");
  }
  if (patch.panel) {
    const panel = normalisePanel(patch.panel);
    const errors = validatePanel(panel);
    if (Object.keys(errors).length) return { errors };
    a.panel = panel; changed.push("panel");
  }
  if (patch.reporting) { a.reporting = { ...a.reporting, ...normaliseReporting({ ...a.reporting, ...patch.reporting }) }; changed.push("reporting"); }
  if (changed.length) {
    audit(a, "Agreement updated", changed.join(", "));
    publish({ id, action: "updated" });
  }
  return { agreement: a };
}

/** Draft Setup → Active, only when every hard gate holds. */
export function activateAgreement(id) {
  const a = agreementById(id);
  if (!a || !canTransitionAgreement(a.status, "Active") || !canActivate(a)) return null;
  a.status = "Active";
  a.activatedAt = todayISO();
  audit(a, "Agreement activated");
  publish({ id, action: "activated" });
  return a;
}

/** Explicit status move: Expiring, Run-off, Closed, or back to Active from Expiring. */
export function setAgreementStatus(id, status, notes) {
  const a = agreementById(id);
  if (!a || !AGREEMENT_STATUSES.includes(status) || !canTransitionAgreement(a.status, status)) return null;
  if (status === "Active" && !canActivate(a)) return null;
  a.status = status;
  audit(a, `Status → ${status}`, notes);
  publish({ id, action: "status" });
  return a;
}

export const DOCUMENT_TYPES = ["Signed treaty wording", "Slip", "Cover note", "Endorsement", "Correspondence", "Other"];

export function addAgreementDocument(id, doc) {
  const a = agreementById(id);
  if (!a || a.status === "Closed" || !String(doc?.name || "").trim()) return null;
  const stored = { name: doc.name.trim(), type: DOCUMENT_TYPES.includes(doc.type) ? doc.type : "Other", date: doc.date || todayISO(), from: doc.from || actor(), version: num(doc.version) || 1 };
  a.documents.unshift(stored);
  audit(a, "Document filed", `${stored.type} · ${stored.name}`);
  publish({ id, action: "document" });
  return stored;
}

export function addEndorsement(id, e) {
  const a = agreementById(id);
  if (!a || a.status === "Closed" || !String(e?.summary || "").trim()) return null;
  const ref = e.ref?.trim() || `E${(a.endorsements?.length || 0) + 1}`;
  const stored = { ref, date: e.date || todayISO(), effective: e.effective || e.date || todayISO(), summary: e.summary.trim() };
  a.endorsements = a.endorsements || [];
  a.endorsements.push(stored);
  audit(a, `Endorsement ${ref} recorded`, stored.summary);
  publish({ id, action: "endorsement" });
  return stored;
}

/* ---- workstreams --------------------------------------------------------- */

/** Normalisers: what each workstream record looks like once numbers are numbers and defaults applied. */
const NORMALISE = {
  premiumBordereaux: (b) => ({ ...b, grossPremium: num(b.grossPremium), cededPremium: num(b.cededPremium), commission: num(b.commission) ?? 0,
    ccy: b.ccy || agreementById(b.agreementId)?.ccy, status: b.status || "Received", receivedDate: b.receivedDate || todayISO(), dueDate: b.dueDate || null }),
  claimsBordereaux: (b) => ({ ...b, claimCount: num(b.claimCount), paid: num(b.paid), outstanding: num(b.outstanding), recoverable: num(b.recoverable) ?? 0,
    ccy: b.ccy || agreementById(b.agreementId)?.ccy, status: b.status || "Received", receivedDate: b.receivedDate || todayISO(), dueDate: b.dueDate || null }),
  cessions: (c) => ({ ...c, sumInsured: num(c.sumInsured), retention: num(c.retention), ceded: num(c.ceded), status: c.status || "Declared" }),
  technicalAccounts: (t) => ({ ...t, premium: num(t.premium) ?? 0, commission: num(t.commission) ?? 0, claims: num(t.claims) ?? 0, tax: num(t.tax) ?? 0,
    ccy: t.ccy || agreementById(t.agreementId)?.ccy, status: t.status || "Draft" }),
  settlements: (s) => ({ ...s, amount: num(s.amount), ccy: s.ccy || agreementById(s.agreementId)?.ccy, paymentStatus: s.paymentStatus || "Pending" }),
};
const VALIDATE = { premiumBordereaux: validatePremiumBordereau, claimsBordereaux: validateClaimsBordereau, cessions: validateCession, technicalAccounts: validateTechnicalAccount, settlements: validateSettlement };
const KIND = { premiumBordereaux: "premiumBdx", claimsBordereaux: "claimsBdx", cessions: "cession", technicalAccounts: "account", settlements: "settlement" };
const DESCRIBE = {
  premiumBordereaux: (r) => `Premium bordereau ${r.ref} received · ${r.period}`,
  claimsBordereaux: (r) => `Claims bordereau ${r.ref} received · ${r.period}`,
  cessions: (r) => `Cession ${r.ref} declared · ${r.insured}`,
  technicalAccounts: (r) => `Technical account ${r.ref} drafted · ${r.period} · net ${accountNet(r)}`,
  settlements: (r) => `Settlement ${r.ref} raised · ${r.counterparty} · due ${r.dueDate}`,
};

/** Validate a workstream record without writing it. Used by forms before submit. */
export function validateWorkstreamRecord(collection, record) {
  const norm = NORMALISE[collection]; if (!norm) return { collection: "Unknown workstream." };
  return VALIDATE[collection](norm(record), agreementById(record?.agreementId));
}

function addRecord(collection, record) {
  const normalised = NORMALISE[collection](record);
  const a = agreementById(record?.agreementId);
  const errors = VALIDATE[collection](normalised, a);
  if (Object.keys(errors).length) return { errors };
  const stored = { ref: record.ref?.trim() || nextTreatyRef(KIND[collection]), ...clean(normalised) };
  state.treaty[collection].unshift(stored);
  audit(a, DESCRIBE[collection](stored));
  publish({ id: a.id, action: collection });
  return { record: stored };
}

export const addPremiumBordereau = (b) => addRecord("premiumBordereaux", b);
export const addClaimsBordereau = (b) => addRecord("claimsBordereaux", b);
export const addCession = (c) => addRecord("cessions", c);
export const addTechnicalAccount = (t) => addRecord("technicalAccounts", t);
export const addSettlement = (s) => addRecord("settlements", s);

/** Move a workstream record's status. Explicit, one step, recorded on the agreement. */
const STATUS_FIELD = { premiumBordereaux: ["status", BORDEREAU_STATUSES], claimsBordereaux: ["status", BORDEREAU_STATUSES], cessions: ["status", CESSION_STATUSES], technicalAccounts: ["status", ACCOUNT_STATUSES], settlements: ["paymentStatus", SETTLEMENT_STATUSES] };

export function setRecordStatus(collection, ref, status, notes) {
  const spec = STATUS_FIELD[collection];
  const record = state.treaty[collection]?.find((r) => r.ref === ref);
  if (!spec || !record || !spec[1].includes(status)) return null;
  const a = agreementById(record.agreementId);
  if (!acceptsTransactions(a)) return null;
  const [field] = spec;
  if (record[field] === status) return record;
  record[field] = status;
  audit(a, `${ref} → ${status}`, notes);
  publish({ id: a.id, action: collection });
  return record;
}

/** Every operational record for one agreement, grouped. */
export function recordsFor(agreementId) {
  const t = state.treaty;
  const of = (list) => list.filter((r) => r.agreementId === agreementId);
  return { premiumBordereaux: of(t.premiumBordereaux), claimsBordereaux: of(t.claimsBordereaux), cessions: of(t.cessions), technicalAccounts: of(t.technicalAccounts), settlements: of(t.settlements) };
}
