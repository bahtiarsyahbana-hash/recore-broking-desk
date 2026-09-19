/**
 * Placement service — every write to the placement book goes through here.
 *
 * Each operation applies the lifecycle rules from domain/lifecycle.js, records
 * the paper trail on the program, raises any finance document the transition
 * implies, and publishes what changed. Views never mutate a program directly.
 */
import { state, programById, nextProgramId, currentUser, cedantNamed } from "../core/store.js";
import { todayISO, TODAY } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import { canBind, statusAfterConfirmationRound } from "../domain/lifecycle.js";
import { stamp, usedOverride } from "../domain/authority.js";
import { canReleaseSlip, readyToSubmit } from "../domain/slip-approval.js";
import { cessionRate } from "../domain/technical-account.js";
import { raiseInvoice } from "./finance.service.js";

/**
 * Re-open an expiring program at Issue Slip, pre-populated from expiring terms.
 * This is what makes the lifecycle loop rather than end at Bound.
 */
export function startRenewal(id) {
  const p = programById(id);
  if (!p) return null;
  // A renewal is a new slip on new terms, so it goes back through the gate
  // rather than inheriting the expiring placement's release.
  p.status = "Draft";
  p.preparedBy = stamp(currentUser());
  p.approvedBy = null;
  p.marketConfirmations.forEach((mc) => { mc.s = "Sent"; });
  p.documents.unshift({
    name: "Renewal slip — drafted.pdf", from: "Broker", date: todayISO(), type: "Slip",
  });
  emit(TOPICS.PROGRAMS, { id, action: "renewal-started" });
  return p;
}

/**
 * Adjust a market's signed line while the slip is still a draft.
 *
 * Only in draft: once a slip is with the market, its lines are what the
 * reinsurers were asked to sign, and editing them behind their back would make
 * every confirmation meaningless.
 */
export function setSignedLine(id, marketName, line) {
  const p = programById(id);
  if (!p || p.status !== "Draft") return null;
  const mc = p.marketConfirmations.find((x) => x.m === marketName);
  if (!mc) return null;
  mc.line = Math.max(0, Math.min(100, Number(line) || 0));
  emit(TOPICS.PROGRAMS, { id, action: "line-changed" });
  return p;
}

/** Take a market off a draft slip. */
export function removeMarketFromDraft(id, marketName) {
  const p = programById(id);
  if (!p || p.status !== "Draft") return null;
  p.marketConfirmations = p.marketConfirmations.filter((x) => x.m !== marketName);
  emit(TOPICS.PROGRAMS, { id, action: "market-removed" });
  return p;
}

/**
 * Preparer hands the draft to an authorised signatory.
 * Refuses an incomplete slip — the checker should not be the one to notice a
 * panel that does not add up.
 */
export function submitForApproval(id) {
  const p = programById(id);
  if (!p || p.status !== "Draft") return null;
  if (!readyToSubmit(p).ready) return null;

  p.status = "Pending Approval";
  p.submittedAt = todayISO();
  if (!p.preparedBy) p.preparedBy = stamp(currentUser());
  emit(TOPICS.PROGRAMS, { id, action: "submitted-for-approval" });
  return p;
}

/**
 * The release gate. An authorised signatory who did not prepare the submission
 * puts the slip in front of the market — this is the moment the placement
 * becomes visible outside the firm, so every condition is re-checked here
 * rather than trusted from the submit step.
 */
export function releaseSlip(id) {
  const p = programById(id);
  if (!p || p.status !== "Pending Approval") return null;

  const user = currentUser();
  if (!canReleaseSlip(p, cedantNamed(p.cedant), user)) return null;

  const override = usedOverride(p, user);

  p.status = "Slip Issued";
  p.approvedBy = stamp(user);
  p.releasedAt = todayISO();
  // A self-approval must not look the same as a witnessed one on the record.
  p.releasedUnderOverride = override;
  p.documents.unshift({
    name: override
      ? `Slip — released under administrator override.pdf`
      : `Slip — released to market.pdf`,
    from: user.name, date: todayISO(), type: "Slip",
  });
  emit(TOPICS.PROGRAMS, { id, action: "slip-released" });

  // Issuing a slip is sending it, so the panel responds in the same act.
  return sendSlipToMarkets(id);
}

/** Checker sends it back for rework, with the reason on the record. */
export function returnToDraft(id, reason) {
  const p = programById(id);
  if (!p || p.status !== "Pending Approval") return null;

  p.status = "Draft";
  p.documents.unshift({
    name: `Returned to preparer — ${reason || "see notes"}.txt`,
    from: currentUser().name, date: todayISO(), type: "Review",
  });
  emit(TOPICS.PROGRAMS, { id, action: "returned-to-draft" });
  return p;
}

/**
 * Send or resend the slip to the named market panel and record the round.
 * Markets respond; the resulting mix of confirmations and queries decides
 * whether the placement advances or drops back into negotiation.
 */
export function sendSlipToMarkets(id) {
  const p = programById(id);
  if (!p) return null;
  // Reaching here from anything but an issued slip means this is a chase.
  if (p.status !== "Slip Issued") p.status = "Slip Issued";
  // Simulated panel response: every third market comes back with a query.
  p.marketConfirmations.forEach((mc, i) => {
    if (mc.s === "Sent" || !mc.s) mc.s = (i % 3 === 2) ? "Queried" : "Confirmed";
  });
  p.status = statusAfterConfirmationRound(p);
  p.documents.push({
    name: `Confirmation round — ${todayISO()}.pdf`,
    from: "Panel", date: todayISO(), type: "Confirmation",
  });
  emit(TOPICS.PROGRAMS, { id, action: "slip-sent" });
  return p;
}

/**
 * Add a negotiation document. Filing a note against a queried placement
 * resolves the oldest open query — the paper trail is what moves the deal.
 */
export function addDocument(id) {
  const p = programById(id);
  if (!p) return null;
  p.documents.push({
    name: `Negotiation note ${p.documents.length + 1}.pdf`,
    from: "Broker", date: todayISO(), type: "Negotiation",
  });
  if (p.status === "Negotiating") {
    const queried = p.marketConfirmations.find((mc) => mc.s === "Queried");
    if (queried) queried.s = "Confirmed";
    p.status = statusAfterConfirmationRound(p);
  }
  emit(TOPICS.PROGRAMS, { id, action: "document-added" });
  return p;
}

/**
 * Bind the placement once the cedant approves. Binding captures the binding
 * instructions, opens the premium as unpaid, and raises the market invoice.
 */
export function approveAndBind(id, bindingInstructions) {
  const p = programById(id);
  if (!p || !canBind(p)) return null;
  if (bindingInstructions != null) p.bindingInstructions = bindingInstructions;
  p.status = "Bound";
  p.premiumPaid = false;
  raiseInvoice({
    program: p.id,
    counterparty: p.marketConfirmations.map((mc) => mc.m).join(", "),
    amount: Math.round(p.premium * cessionRate(p.type)),
    ccy: p.ccy,
    coBroker: p.coBroker,
  });
  emit(TOPICS.PROGRAMS, { id, action: "bound" });
  return p;
}

/**
 * Save a new submission as a draft.
 *
 * Nothing leaves the firm here: the record exists, the panel is named with its
 * signed lines, and the slip waits for an authorised signatory to release it.
 */
export function saveDraft({ cedant, cls, type, structure, markets, premium, terms }) {
  const id = nextProgramId();
  const confirmations = Object.entries(markets || {})
    .filter(([, line]) => line > 0)
    .map(([m, line]) => ({ m, s: "Sent", line }));

  state.programs.unshift({
    id,
    cedant, cls, type, structure,
    // Priced from the terms entered in the wizard. A submission that cannot
    // price itself carries nothing rather than an invented figure.
    premium: Math.round(premium) || 0,
    terms: terms || {},
    ccy: "USD",
    status: "Draft",
    expiry: "2027-06-01",
    loss: 0,
    earned: 0,
    premiumPaid: false,
    coBroker: null,
    bindingInstructions: "",
    preparedBy: stamp(currentUser()),
    approvedBy: null,
    marketConfirmations: confirmations,
    documents: [{ name: "Slip v1 — draft.pdf", from: "Broker", date: todayISO(), type: "Slip" }],
  });

  emit(TOPICS.PROGRAMS, { id, action: "draft-saved" });
  return id;
}

export { TODAY };
