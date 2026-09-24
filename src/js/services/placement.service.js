/**
 * Placement service — every write to the placement book goes through here.
 *
 * Each operation applies the lifecycle rules from domain/lifecycle.js, records
 * the paper trail on the program (history, documents, versions), raises any
 * finance document the transition implies, and publishes what changed. Views
 * never mutate a program directly.
 *
 * Nothing here simulates a counterparty. Markets and cedants answer in the
 * real world; a broker records what they said.
 */
import { state, programById, nextProgramId, currentUser, cedantNamed } from "../core/store.js";
import { todayISO, TODAY } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import {
  STATUS, normaliseStatus, canBind, statusAfterMarketResponse, isPreMarket, isWithCedant,
  statusAfterPanelChangeWithCedant,
  canSendProposal, canRecordCedantDecision, canRecordCedantRevision, canRecordBindInstruction,
} from "../domain/lifecycle.js";
import { isValidPaymentWarranty } from "../domain/intake.js";
import { stamp, usedOverride } from "../domain/authority.js";
import { canReleaseSlip, readyToSubmit } from "../domain/slip-approval.js";
import { isLayered, panelEntries, panelMarkets, canRecordResponse, backupSecured } from "../domain/panel.js";
import { structureLine, estimatedGrossPremium } from "../domain/placement-terms.js";
import { createBindDraft, createEndorsementDraft } from "./billing.service.js";

/* ---- paper trail ------------------------------------------------------ */

const actorName = () => currentUser()?.name || "Desk";

/** Append an audit line: who did what, when, against which version. */
function record(p, action, notes = "", extra = {}) {
  p.history = p.history || [];
  p.history.push({
    at: todayISO(), actor: actorName(), action, notes: notes || "",
    slipVersion: p.slipVersion || 1, proposalVersion: p.proposalVersion || 0, ...extra,
  });
}

/** File a document against the placement. Newest first, as the dropbox reads. */
function file(p, doc) {
  p.documents = p.documents || [];
  p.documents.unshift({ date: todayISO(), from: actorName(), delivery: "Filed", ...doc });
  return p.documents[0];
}

/** Every allocation, whichever shape the panel is stored in. */
const entries = (p) => panelEntries(p);

/** Keep the flat confirmations array in step with a layered tower. */
function syncFlat(p) {
  if (isLayered(p)) p.marketConfirmations = p.layers.flatMap((l, i) => (l.markets || []).map((mc) => ({ ...mc, layer: i })));
}

/** Find one allocation: by market, and by layer for a tower. */
function allocation(p, market, layer) {
  if (isLayered(p)) {
    const l = p.layers[Number(layer) || 0];
    return l ? (l.markets || []).find((mc) => mc.m === market) : null;
  }
  return (p.marketConfirmations || []).find((mc) => mc.m === market);
}

/* ---- drafting --------------------------------------------------------- */

/**
 * Re-open an expiring program as a Draft Slip, pre-populated from the expiring
 * terms. This is what makes the lifecycle loop rather than end at Bound. A
 * renewal is a new slip on new terms, so it goes back through the four-eyes
 * gate rather than inheriting the expiring placement's release.
 */
export function startRenewal(id) {
  const p = programById(id);
  if (!p) return null;
  p.status = STATUS.DRAFT;
  p.preparedBy = stamp(currentUser());
  p.approvedBy = null;
  p.slipVersion = (p.slipVersion || 1) + 1;
  p.proposalVersion = 0;
  p.cedantApproval = null;
  p.bindInstruction = null;
  p.proposalSentAt = null;
  entries(p).forEach((mc) => { mc.s = "Sent"; });
  syncFlat(p);
  file(p, { name: `Renewal slip v${p.slipVersion} — drafted.pdf`, type: "Slip", version: p.slipVersion, recipient: "Internal", from: "Broker" });
  record(p, "Renewal started", "New slip drafted from expiring terms");
  emit(TOPICS.PROGRAMS, { id, action: "renewal-started" });
  return p;
}

/**
 * Adjust a market's signed line while the slip is still a draft. Only in
 * draft: once a slip is with the market, its lines are what the reinsurers
 * were asked to sign.
 */
export function setSignedLine(id, marketName, line, layer) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.DRAFT) return null;
  const mc = allocation(p, marketName, layer);
  if (!mc) return null;
  mc.line = Math.max(0, Math.min(100, Number(line) || 0));
  syncFlat(p);
  emit(TOPICS.PROGRAMS, { id, action: "line-changed" });
  return p;
}

/** Take a market off a draft slip. */
export function removeMarketFromDraft(id, marketName, layer) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.DRAFT) return null;
  if (isLayered(p)) {
    const l = p.layers[Number(layer) || 0];
    if (l) l.markets = (l.markets || []).filter((x) => x.m !== marketName);
    syncFlat(p);
  } else {
    p.marketConfirmations = p.marketConfirmations.filter((x) => x.m !== marketName);
  }
  emit(TOPICS.PROGRAMS, { id, action: "market-removed" });
  return p;
}

/**
 * Preparer hands the draft to an authorised signatory. Refuses an incomplete
 * slip — the checker should not be the one to notice a panel that does not
 * add up.
 */
export function submitForApproval(id) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.DRAFT) return null;
  if (!readyToSubmit(p).ready) return null;
  p.status = STATUS.PENDING_APPROVAL;
  p.submittedAt = todayISO();
  if (!p.preparedBy) p.preparedBy = stamp(currentUser());
  record(p, "Submitted for internal approval");
  emit(TOPICS.PROGRAMS, { id, action: "submitted-for-approval" });
  return p;
}

/**
 * The release gate — "Place to market". An authorised signatory who did not
 * prepare the submission puts the slip in front of the market. Every
 * condition is re-checked here rather than trusted from the submit step.
 *
 * Placing sends the slip; it does not answer it. Every line is Sent until a
 * broker records what the market actually said.
 */
export function releaseSlip(id) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.PENDING_APPROVAL) return null;
  const user = currentUser();
  if (!canReleaseSlip(p, cedantNamed(p.cedant), user)) return null;

  const override = usedOverride(p, user);
  p.status = STATUS.PLACED;
  p.approvedBy = stamp(user);
  p.releasedAt = todayISO();
  // A self-approval must not look the same as a witnessed one on the record.
  p.releasedUnderOverride = override;
  entries(p).forEach((mc) => { if (!mc.s) mc.s = "Sent"; });
  syncFlat(p);
  file(p, {
    name: override ? `Slip v${p.slipVersion || 1} — placed under administrator override.pdf` : `Slip v${p.slipVersion || 1} — placed to market.pdf`,
    type: "Slip", version: p.slipVersion || 1, recipient: panelMarkets(p).join(", ") || "Market", from: user.name, delivery: "Sent",
  });
  record(p, "Placed to market", override ? "Released under administrator override" : "", { approvedBy: user.name });
  emit(TOPICS.PROGRAMS, { id, action: "slip-released" });
  return p;
}

/** Checker sends it back for rework, with the reason on the record. */
export function returnToDraft(id, reason) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.PENDING_APPROVAL) return null;
  p.status = STATUS.DRAFT;
  file(p, { name: `Returned to preparer — ${reason || "see notes"}.txt`, type: "Review", recipient: "Internal" });
  record(p, "Returned to preparer", reason);
  emit(TOPICS.PROGRAMS, { id, action: "returned-to-draft" });
  return p;
}

/**
 * Revise a slip that is already in market: back to Draft as a new slip
 * version. Whatever the markets confirmed was confirmed against the old
 * version, so every response resets to Sent and the slip goes back through
 * approval. Any cedant approval or bind instruction is invalidated with it.
 */
export function reviseSlip(id, reason) {
  const p = programById(id);
  if (!p) return null;
  const s = normaliseStatus(p.status);
  if (isPreMarket(p) || s === STATUS.BOUND || s === STATUS.RENEWAL_DUE) return null;
  invalidateCedantDecisions(p, "Slip revised");
  if (p.proposalVersion) {
    record(p, `Proposal v${p.proposalVersion} superseded`, "Slip revised — a new proposal is required after re-placement");
  }
  p.proposalStale = false;
  p.revisionRequired = false;
  p.status = STATUS.DRAFT;
  p.slipVersion = (p.slipVersion || 1) + 1;
  p.approvedBy = null;
  p.preparedBy = stamp(currentUser());
  entries(p).forEach((mc) => { mc.s = "Sent"; });
  syncFlat(p);
  file(p, { name: `Slip v${p.slipVersion} — revision drafted.pdf`, type: "Slip", version: p.slipVersion, recipient: "Internal" });
  record(p, "Slip revised", reason);
  emit(TOPICS.PROGRAMS, { id, action: "slip-revised" });
  return p;
}

/* ---- market negotiation ------------------------------------------------ */

/**
 * Chase the panel: resend the current slip version without touching any
 * response already recorded.
 */
export function sendSlipToMarkets(id) {
  const p = programById(id);
  if (!p || ![STATUS.PLACED, STATUS.NEGOTIATING].includes(normaliseStatus(p.status))) return null;
  file(p, { name: `Slip v${p.slipVersion || 1} — chaser ${todayISO()}.pdf`, type: "Correspondence", version: p.slipVersion || 1, recipient: panelMarkets(p).join(", "), delivery: "Sent" });
  record(p, "Slip re-sent to panel");
  emit(TOPICS.PROGRAMS, { id, action: "slip-sent" });
  return p;
}

/**
 * Record what a market said. Manual, one line at a time — the response is the
 * broker's evidence of a conversation, never an assumption. While the
 * placement is in the market stage its status follows the panel: Backup
 * Secured when every unit is confirmed at 100%, Market Negotiation otherwise.
 * Once a proposal is with the cedant a market change is recorded and flagged,
 * but does not silently move the placement.
 */
export function recordMarketResponse(id, marketName, response, { layer, notes, line } = {}) {
  const p = programById(id);
  if (!p) return null;
  const s = normaliseStatus(p.status);
  if (isPreMarket(p) || s === STATUS.BOUND || s === STATUS.RENEWAL_DUE) return null;
  const mc = allocation(p, marketName, layer);
  if (!mc || !canRecordResponse(mc.s, response)) return null;

  mc.s = response;
  if (line != null && line !== "") mc.line = Math.max(0, Math.min(100, Number(line) || 0));
  syncFlat(p);
  const layerNote = isLayered(p) ? ` (layer ${(Number(layer) || 0) + 1})` : "";
  record(p, `Market response: ${marketName}${layerNote} — ${response}`, notes);
  if (response === "Quoted" || response === "Queried" || response === "Declined") {
    file(p, { name: `${marketName} — ${response.toLowerCase()}${layerNote}.pdf`, type: "Market response", from: marketName, recipient: "Broker", delivery: "Received" });
  }
  const before = p.status;
  if (isWithCedant(p)) {
    // The cedant saw a proposal describing a panel that has now changed. That
    // proposal is stale, whatever it was: approval and instruction are void,
    // and the placement drops back to the market stage the panel supports.
    // Recovering the capacity later does not revive the old decisions — a new
    // proposal version and a new approval are required.
    record(p, `Proposal v${p.proposalVersion || 1} marked stale`, `Panel changed after proposal: ${marketName}${layerNote} → ${response}`);
    invalidateCedantDecisions(p, "Panel changed after proposal");
    p.proposalStale = true;
    p.status = statusAfterPanelChangeWithCedant(p);
  } else {
    p.status = statusAfterMarketResponse(p);
  }
  if (p.status !== before) record(p, `Status → ${p.status}`, "Derived from market responses");
  emit(TOPICS.PROGRAMS, { id, action: "market-response" });
  return p;
}

/**
 * Set the agreed payment warranty on a draft. Only while it is a draft — once
 * a slip is issued the period is part of what the market signed. Never
 * defaults: an unsupported value is refused rather than rounded.
 */
export function setPaymentWarranty(id, days) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.DRAFT) return null;
  if (!isValidPaymentWarranty(days)) return null;
  p.terms = { ...(p.terms || {}), paymentWarrantyDays: Number(days) };
  record(p, "Payment warranty set", `${Number(days)} days`);
  emit(TOPICS.PROGRAMS, { id, action: "warranty-set" });
  return p;
}

/** Add a negotiation or correspondence document. Filing never moves a status. */
export function addDocument(id, { name, type = "Negotiation", recipient = "Internal", from } = {}) {
  const p = programById(id);
  if (!p) return null;
  file(p, { name: name || `Negotiation note ${(p.documents?.length || 0) + 1}.pdf`, type, recipient, from: from || actorName() });
  record(p, "Document filed", name || type);
  emit(TOPICS.PROGRAMS, { id, action: "document-added" });
  return p;
}

/** Move a document's delivery status along: Issued → Sent → Delivered → Acknowledged. */
export const DELIVERY_STATUSES = ["Filed", "Issued", "Sent", "Delivered", "Acknowledged"];
export function setDocumentDelivery(id, docIndex, delivery) {
  const p = programById(id);
  const doc = p?.documents?.[docIndex];
  if (!doc || !DELIVERY_STATUSES.includes(delivery)) return null;
  doc.delivery = delivery;
  record(p, `Document ${delivery.toLowerCase()}`, doc.name);
  emit(TOPICS.PROGRAMS, { id, action: "document-delivery" });
  return p;
}

/* ---- cedant workflow --------------------------------------------------- */

/** A revision after approval voids the approval and any instruction to bind. */
function invalidateCedantDecisions(p, why) {
  if (p.cedantApproval) {
    record(p, "Cedant approval invalidated", `${why} — approval of proposal v${p.cedantApproval.proposalVersion} no longer stands`);
    p.cedantApproval = null;
  }
  if (p.bindInstruction) {
    record(p, "Instruction to bind invalidated", `${why} — instruction ${p.bindInstruction.reference || ""} no longer stands`.trim());
    p.bindInstruction = null;
  }
}

/** The broker sends the proposal (terms plus confirmed panel) to the cedant. */
export function recordProposalSent(id, notes) {
  const p = programById(id);
  if (!p || !canSendProposal(p)) return null;
  p.proposalVersion = (p.proposalVersion || 0) + 1;
  p.proposalSentAt = todayISO();
  p.proposalSlipVersion = p.slipVersion || 1;
  p.proposalStale = false;
  p.status = STATUS.PROPOSAL_SENT;
  file(p, { name: `Proposal v${p.proposalVersion} — ${p.cedant}.pdf`, type: "Proposal", version: p.proposalVersion, recipient: p.cedant, delivery: "Sent" });
  record(p, `Proposal v${p.proposalVersion} sent to cedant`, notes);
  emit(TOPICS.PROGRAMS, { id, action: "proposal-sent" });
  return p;
}

/** The cedant asked for changes. Anything they had approved is void. */
export function recordCedantRevision(id, notes) {
  const p = programById(id);
  if (!p || !canRecordCedantRevision(p)) return null;
  invalidateCedantDecisions(p, "Cedant requested revision");
  p.status = STATUS.CEDANT_NEGOTIATION;
  // The same terms may not go back as a "revised" proposal; the slip must change.
  p.revisionRequired = true;
  p.proposalStale = true;
  p.cedantRevisionNotes = notes || "";
  record(p, "Cedant requested revision", notes);
  emit(TOPICS.PROGRAMS, { id, action: "cedant-revision" });
  return p;
}

/**
 * The cedant approved the proposal. This is approval of terms only; the
 * placement now waits for an explicit instruction to bind.
 */
export function recordCedantApproval(id, notes) {
  const p = programById(id);
  if (!p || !canRecordCedantDecision(p)) return null;
  p.cedantApproval = { at: todayISO(), by: actorName(), notes: notes || "", proposalVersion: p.proposalVersion || 1 };
  p.status = STATUS.CEDANT_APPROVED;
  record(p, `Cedant approved proposal v${p.cedantApproval.proposalVersion}`, notes);
  emit(TOPICS.PROGRAMS, { id, action: "cedant-approved" });
  return p;
}

/** The cedant's instruction to bind — an explicit, referenced act. */
export function recordBindInstruction(id, { reference, notes } = {}) {
  const p = programById(id);
  if (!p || !canRecordBindInstruction(p)) return null;
  p.bindInstruction = { at: todayISO(), by: actorName(), reference: reference || "", notes: notes || "", proposalVersion: p.proposalVersion || 1 };
  p.status = STATUS.BIND_INSTRUCTED;
  file(p, { name: `Instruction to bind${reference ? ` — ${reference}` : ""}.pdf`, type: "Instruction", from: p.cedant, recipient: "Broker", delivery: "Received" });
  record(p, "Instruction to bind received", [reference, notes].filter(Boolean).join(" · "));
  emit(TOPICS.PROGRAMS, { id, action: "bind-instructed" });
  return p;
}

/* ---- binding ----------------------------------------------------------- */

/**
 * Execute the binding on the cedant's instruction. Binding freezes the agreed
 * terms, issues the RI slip to the cedant and a binding slip to each reinsurer,
 * opens the premium as unpaid and prepares the billing as a Draft batch — an
 * invoice to the cedant and a Closing Slip per reinsurer, issued later by a
 * second authorised person. Anything that changes after this is an
 * endorsement, never an edit.
 */
export function executeBinding(id, bindingInstructions) {
  const p = programById(id);
  if (!p || !canBind(p)) return null;
  if (bindingInstructions != null) p.bindingInstructions = bindingInstructions;

  const markets = panelMarkets(p);
  p.boundTerms = {
    frozenAt: todayISO(), by: actorName(),
    slipVersion: p.slipVersion || 1, proposalVersion: p.proposalVersion || 1,
    type: p.type, structure: p.structure, premium: p.premium, ccy: p.ccy,
    terms: JSON.parse(JSON.stringify(p.terms || {})),
    layers: p.layers ? JSON.parse(JSON.stringify(p.layers)) : null,
    panel: entries(p).map((mc) => ({ ...mc })),
    bindingInstructions: p.bindingInstructions || "",
  };
  p.status = STATUS.BOUND;
  p.boundAt = todayISO();
  p.boundBy = stamp(currentUser());
  p.premiumPaid = false;

  // Reinsurers first so the cedant's RI slip sits on top of the dropbox.
  markets.slice().reverse().forEach((m) => file(p, {
    name: `Binding slip — ${m}.pdf`, type: "Binding Slip", version: p.slipVersion || 1, recipient: m, delivery: "Issued",
  }));
  file(p, { name: `RI slip — ${p.cedant}.pdf`, type: "RI Slip", version: p.slipVersion || 1, recipient: p.cedant, delivery: "Issued" });

  record(p, "Bound and issued", `Terms frozen at slip v${p.slipVersion || 1}, proposal v${p.proposalVersion || 1}. RI slip and ${markets.length} binding slip(s) issued.`);
  const batch = createBindDraft(p);
  if (batch) record(p, "Billing drafted", `${batch.ref} — invoice and ${batch.computed.slips.length} closing slip(s) await approval`);
  emit(TOPICS.PROGRAMS, { id, action: "bound" });
  return p;
}

/** Kept for callers of the previous name. */
export const approveAndBind = executeBinding;

/**
 * Credit control: whether the placement's premium is settled. Set by the
 * payments service from receipts — true once every issued invoice and debit
 * note for the placement is paid in full — and recorded when it changes.
 */
export function setPremiumPaid(id, paid, notes = "") {
  const p = programById(id);
  if (!p || Boolean(p.premiumPaid) === Boolean(paid)) return p || null;
  p.premiumPaid = Boolean(paid);
  record(p, paid ? "Premium settled" : "Premium outstanding again", notes);
  emit(TOPICS.PROGRAMS, { id, action: "premium-paid" });
  return p;
}

/**
 * Record an endorsement on a bound placement and draft its billing. The bound
 * terms stay frozen; the endorsement is its own dated record, and the premium
 * change is billed from the endorsement date.
 *
 * @returns {{ program, endorsement, batch } | { errors }}
 */
export function recordEndorsement(id, { ref, date, premium, notes } = {}) {
  const p = programById(id);
  const errors = {};
  if (!p || normaliseStatus(p.status) !== STATUS.BOUND) errors.id = "Only a bound placement can be endorsed.";
  if (!date) errors.date = "Give the endorsement date.";
  const amount = Number(premium);
  if (premium === "" || premium == null || !Number.isFinite(amount) || amount === 0) errors.premium = "Enter the premium change — positive for additional, negative for return.";
  if (Object.keys(errors).length) return { errors };
  p.endorsements = p.endorsements || [];
  const endorsement = { ref: String(ref || "").trim() || `E${p.endorsements.length + 1}`, date, premium: amount, notes: String(notes || "").trim(), by: actorName(), at: todayISO() };
  if (p.endorsements.some((e) => e.ref === endorsement.ref)) return { errors: { ref: `Endorsement ${endorsement.ref} already exists on ${p.id}.` } };
  p.endorsements.push(endorsement);
  file(p, { name: `Endorsement ${endorsement.ref} — ${p.id}.pdf`, type: "Endorsement", recipient: p.cedant, delivery: "Filed" });
  record(p, `Endorsement ${endorsement.ref} recorded`, `${amount > 0 ? "Additional" : "Return"} premium ${amount} ${p.ccy}, effective ${date}`);
  const batch = createEndorsementDraft(p, endorsement);
  if (batch) record(p, "Billing drafted", `${batch.ref} — ${batch.cedantDocType} awaits approval`);
  emit(TOPICS.PROGRAMS, { id, action: "endorsed" });
  return { program: p, endorsement, batch };
}

/* ---- creating and editing drafts -------------------------------------- */

/** Build a fresh program record. Nothing leaves the firm here. */
function newProgram({ id: existingId, cedant, cls, type, ccy, terms, layers, markets, structure, premium, intakeRef }) {
  const id = existingId || nextProgramId();
  const layered = type === "Excess of Loss" && Array.isArray(layers) && layers.length;
  const confirmations = layered
    ? layers.flatMap((l, i) => (l.markets || []).map((mc) => ({ ...mc, layer: i })))
    : (markets || []).map((mc) => ({ m: mc.m, s: "Sent", offered: mc.offered ?? null, line: Number(mc.line) || 0 }));
  const program = {
    id, cedant, cls, type,
    structure: structure || structureLine(type, terms, layers),
    premium: Math.round(premium ?? estimatedGrossPremium(type, terms)) || 0,
    terms: { ...(terms || {}), paymentWarrantyDays: isValidPaymentWarranty(terms?.paymentWarrantyDays) ? Number(terms.paymentWarrantyDays) : null },
    ccy: ccy || "USD",
    status: STATUS.DRAFT,
    expiry: "2027-06-01",
    loss: 0, earned: 0, premiumPaid: false, coBroker: null,
    bindingInstructions: "",
    preparedBy: stamp(currentUser()),
    approvedBy: null,
    slipVersion: 1, proposalVersion: 0, proposalSlipVersion: null, proposalStale: false, revisionRequired: false,
    cedantApproval: null, bindInstruction: null, boundTerms: null,
    intakeRef: intakeRef || null,
    layers: layered ? layers.map((l) => ({ limit: Number(l.limit) || 0, attachment: Number(l.attachment) || 0, markets: (l.markets || []).map((mc) => ({ m: mc.m, s: "Sent", offered: mc.offered ?? null, line: Number(mc.line) || 0 })) })) : null,
    marketConfirmations: confirmations,
    documents: [{ name: "Slip v1 — draft.pdf", from: "Broker", date: todayISO(), type: "Slip", version: 1, recipient: "Internal", delivery: "Filed" }],
    history: [],
  };
  if (program.layers) syncFlat(program);
  return program;
}

/**
 * Save a new placement as a Draft Slip.
 *
 * @param {object} draft
 * @param {string} draft.cedant  registry cedant name
 * @param {string} draft.type    "Quota Share" | "Excess of Loss"
 * @param {object} draft.terms   { insured, sumInsured, rate, paymentWarrantyDays, ... }
 * @param {{m, offered, line}[]} [draft.markets]   quota share panel
 * @param {{limit, attachment, markets}[]} [draft.layers]  XoL tower
 */
export function saveDraft(draft) {
  const p = newProgram(draft);
  state.programs.unshift(p);
  record(p, "Draft slip saved", draft.intakeRef ? `From intake ${draft.intakeRef}` : "");
  emit(TOPICS.PROGRAMS, { id: p.id, action: "draft-saved" });
  return p.id;
}

/** Called by the intake service when an intake is accepted. */
export function createDraftFromIntake(draft) {
  return saveDraft({ ...draft, markets: [], layers: null });
}

/**
 * Replace a draft's terms and panel with what the wizard captured. Only while
 * it is a Draft — after that the slip is a versioned document.
 */
export function updateDraft(id, draft) {
  const p = programById(id);
  if (!p || normaliseStatus(p.status) !== STATUS.DRAFT) return null;
  const fresh = newProgram({ ...draft, id: p.id, intakeRef: p.intakeRef });
  Object.assign(p, {
    cedant: fresh.cedant, cls: fresh.cls, type: fresh.type, ccy: fresh.ccy,
    terms: fresh.terms, structure: fresh.structure, premium: fresh.premium,
    layers: fresh.layers, marketConfirmations: fresh.marketConfirmations,
  });
  record(p, "Draft slip updated");
  emit(TOPICS.PROGRAMS, { id, action: "draft-updated" });
  return p;
}

export { TODAY, backupSecured };
