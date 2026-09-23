/* eslint-disable import/order */
/**
 * Placement lifecycle — the states a placement moves through from intake to
 * bind, and the rules governing each transition.
 *
 * Pure state machine: it answers "where is this placement and what may happen
 * next". The service layer applies the answers and records the side effects.
 *
 * The business journey:
 *
 *   Intake → Draft Slip → internal approval → Placed to Market
 *   → Market Negotiation → Backup Secured → Proposal Sent → Cedant Negotiation
 *   → Cedant Approved (awaiting instruction to bind) → Bind Instructed → Bound Issued
 *
 * Four distinctions the states keep apart, because conflating them is how a
 * desk binds something nobody agreed to:
 *   - market backup (capacity confirmed) is not cedant approval;
 *   - cedant approval is not an instruction to bind;
 *   - the instruction to bind is an explicit, recorded act;
 *   - placing a slip and binding a placement are different actions by
 *     different people, and the four-eyes release gate sits between them.
 */
import { releaseAuthority, approverHint } from "./authority.js";
import { readyToSubmit, releaseBlockers } from "./slip-approval.js";
import { backupSecured, anyResponded, responseProgress, capacityUnits, isLayered } from "./panel.js";

/**
 * The six business stages shown on the Kanban and the journey rail. Finer
 * states appear as a substatus on the stage they belong to.
 */
export const LIFECYCLE_STEPS = [
  "Intake",
  "Draft Slip",
  "Market Negotiation",
  "Proposal Sent",
  "Cedant Approved",
  "Bound Issued",
];

/** Canonical placement statuses. */
export const STATUS = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  PLACED: "Placed to Market",
  NEGOTIATING: "Market Negotiation",
  BACKUP: "Backup Secured",
  PROPOSAL_SENT: "Proposal Sent",
  CEDANT_NEGOTIATION: "Cedant Negotiation",
  CEDANT_APPROVED: "Cedant Approved",
  BIND_INSTRUCTED: "Bind Instructed",
  BOUND: "Bound",
  RENEWAL_DUE: "Renewal Due",
};

/**
 * Compatibility: statuses written by earlier versions of the desk, mapped to
 * the canonical vocabulary. Records are never rewritten — the mapping is
 * applied on read, so seeded and historical placements keep rendering and
 * remain operable.
 *
 *   Draft, Pending Approval    unchanged
 *   Slip Issued (and the older Issue Slip, Sent for Confirmation, In Placement)
 *                              → Placed to Market
 *   Negotiating                → Market Negotiation
 *   Cedant Approval            → Proposal Sent (markets confirmed, awaiting the cedant)
 *   Bound, Renewal Due         unchanged
 */
const LEGACY_STATUS = {
  "Slip Issued": STATUS.PLACED,
  "Issue Slip": STATUS.PLACED,
  "Sent for Confirmation": STATUS.PLACED,
  "In Placement": STATUS.PLACED,
  "Negotiating": STATUS.NEGOTIATING,
  "Cedant Approval": STATUS.PROPOSAL_SENT,
};

/** Canonical status for any record, current or historical. */
export const normaliseStatus = (status) => LEGACY_STATUS[status] || status;

/** Kanban column and substatus for each canonical status. */
const STAGE_OF = {
  [STATUS.DRAFT]:              { step: 1, substatus: "Draft" },
  [STATUS.PENDING_APPROVAL]:   { step: 1, substatus: "Pending internal approval" },
  [STATUS.PLACED]:             { step: 2, substatus: "Placed to market" },
  [STATUS.NEGOTIATING]:        { step: 2, substatus: "Market negotiation" },
  [STATUS.BACKUP]:             { step: 2, substatus: "Backup secured" },
  [STATUS.PROPOSAL_SENT]:      { step: 3, substatus: "Awaiting cedant decision" },
  [STATUS.CEDANT_NEGOTIATION]: { step: 3, substatus: "Cedant requested revision" },
  [STATUS.CEDANT_APPROVED]:    { step: 4, substatus: "Awaiting instruction to bind" },
  [STATUS.BIND_INSTRUCTED]:    { step: 4, substatus: "Bind instructed" },
  [STATUS.BOUND]:              { step: 5, substatus: "Bound" },
  [STATUS.RENEWAL_DUE]:        { step: 5, substatus: "Renewal due" },
};

/**
 * Where a placement sits: its Kanban column (a LIFECYCLE_STEPS label), the
 * column index, and the substatus badge shown on the card.
 */
export function stageOf(program) {
  const canonical = normaliseStatus(program.status);
  const stage = STAGE_OF[canonical] || { step: LIFECYCLE_STEPS.length - 1, substatus: canonical };
  return { column: LIFECYCLE_STEPS[stage.step], stepIndex: stage.step, substatus: stage.substatus, status: canonical };
}

/** Position of a status on the rail; unknown statuses read as complete. */
export function stepIndexFor(status) {
  const stage = STAGE_OF[normaliseStatus(status)];
  return stage ? stage.step : LIFECYCLE_STEPS.length - 1;
}

/** Stages before the slip has gone to market. */
export const PRE_MARKET_STATUSES = [STATUS.DRAFT, STATUS.PENDING_APPROVAL];
export const isPreMarket = (program) => PRE_MARKET_STATUSES.includes(normaliseStatus(program.status));

/** In market: released and not yet bound or expiring. */
const IN_MARKET = new Set([
  STATUS.PLACED, STATUS.NEGOTIATING, STATUS.BACKUP, STATUS.PROPOSAL_SENT,
  STATUS.CEDANT_NEGOTIATION, STATUS.CEDANT_APPROVED, STATUS.BIND_INSTRUCTED,
]);
export const isInMarket = (program) => IN_MARKET.has(normaliseStatus(program.status));

export const isBound = (program) => normaliseStatus(program.status) === STATUS.BOUND;

/** True when the placement's confirmations belong to an expiring contract. */
export const awaitingRenewal = (program) => normaliseStatus(program.status) === STATUS.RENEWAL_DUE;

/* ---- market panel, delegated to panel.js but kept as the old names ------ */

export const allConfirmed = (program) => backupSecured(program);

export const anyQueried = (program) => responseProgress(program).queried > 0;

export const confirmationProgress = (program) => responseProgress(program);

/**
 * Status implied by the market panel while the placement is in market:
 * nobody has answered → still Placed to Market; capacity fully confirmed →
 * Backup Secured; anything else → Market Negotiation. Only the market-facing
 * statuses are re-derived; once a proposal has gone to the cedant, a market
 * change is recorded but does not pull the placement back by itself.
 */
export function statusAfterMarketResponse(program) {
  const s = normaliseStatus(program.status);
  if (![STATUS.PLACED, STATUS.NEGOTIATING, STATUS.BACKUP].includes(s)) return s;
  if (backupSecured(program)) return STATUS.BACKUP;
  if (anyResponded(program)) return STATUS.NEGOTIATING;
  return STATUS.PLACED;
}

/** Kept for callers of the previous name. */
export const statusAfterConfirmationRound = statusAfterMarketResponse;

/** The cedant has seen a proposal and has not yet instructed a bind. */
const CEDANT_STAGE = new Set([STATUS.PROPOSAL_SENT, STATUS.CEDANT_NEGOTIATION, STATUS.CEDANT_APPROVED, STATUS.BIND_INSTRUCTED]);
export const isWithCedant = (program) => CEDANT_STAGE.has(normaliseStatus(program.status));

/**
 * Status after the panel changes once a proposal has gone out. The proposal
 * the cedant saw described a panel that no longer exists, so the placement
 * drops back to the market stage the panel now supports; the service marks
 * the proposal stale and voids any approval or instruction on the way.
 */
export function statusAfterPanelChangeWithCedant(program) {
  return backupSecured(program) ? STATUS.BACKUP : STATUS.NEGOTIATING;
}

/* ---- gates ---------------------------------------------------------- */

/**
 * A proposal may go to the cedant once market backup is secured — and, if the
 * cedant asked for a revision, only after the slip has actually been revised
 * (a new slip version through approval and placement). Re-sending the same
 * stale terms is not a revision.
 */
export const canSendProposal = (program) =>
  normaliseStatus(program.status) === STATUS.BACKUP && backupSecured(program) && !program.revisionRequired;

/** The cedant's answer may be recorded while a live proposal is with them. */
export const canRecordCedantDecision = (program) =>
  normaliseStatus(program.status) === STATUS.PROPOSAL_SENT;

/** A revision may be requested any time after the proposal went out and before bind. */
export const canRecordCedantRevision = (program) =>
  [STATUS.PROPOSAL_SENT, STATUS.CEDANT_NEGOTIATION, STATUS.CEDANT_APPROVED, STATUS.BIND_INSTRUCTED].includes(normaliseStatus(program.status));

/** An instruction to bind follows the cedant's approval — never before it. */
export const canRecordBindInstruction = (program) =>
  normaliseStatus(program.status) === STATUS.CEDANT_APPROVED && Boolean(program.cedantApproval);

/**
 * Binding executes only on a recorded instruction, with capacity still
 * confirmed at 100% on every unit. "Renewal Due" is the trap: an expiring
 * program still carries the confirmed panel from the expiring contract, and
 * binding off it would raise an invoice no market has agreed to.
 */
export const canBind = (program) =>
  normaliseStatus(program.status) === STATUS.BIND_INSTRUCTED &&
  Boolean(program.bindInstruction) &&
  backupSecured(program);

/* ---- guidance -------------------------------------------------------- *
 * What the desk should do next, and what is holding it up. Derived from the
 * same rules that govern the transitions, so the drawer cannot drift.
 * ---------------------------------------------------------------------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function list(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const action = (stepIndex, fields) => ({ blocked: false, blockedReason: null, needsInstructions: false, ...fields, stepIndex });

/**
 * The single next thing to do on this placement, for the seat now at the desk.
 *
 * @returns {null | { stepIndex, title, detail, actionLabel, action, blocked, blockedReason, needsInstructions, needsNotes?, secondaryAction? }}
 *   null once the placement is bound.
 */
export function nextAction(program, context = {}) {
  const status = normaliseStatus(program.status);
  if (status === STATUS.BOUND) return null;
  const { user, cedant } = context;
  const stepIndex = stepIndexFor(status);

  if (status === STATUS.DRAFT) {
    const ready = readyToSubmit(program);
    return action(stepIndex, {
      title: "Finish the slip and submit it for internal approval",
      detail: ready.ready
        ? "The slip is complete. Submitting puts it in the approval queue — an authorised signatory places it to market."
        : "This draft is not yet complete enough to go for approval.",
      actionLabel: "Submit for internal approval", action: "submit-approval",
      blocked: !ready.ready, blockedReason: ready.reason,
    });
  }

  if (status === STATUS.PENDING_APPROVAL) {
    const authority = user ? releaseAuthority(program, user) : { allowed: false, reason: "No seat is selected." };
    const blockers = user ? releaseBlockers(program, cedant, user) : [];
    const preparer = program.preparedBy?.name || "the preparer";
    const otherBlockers = blockers.filter((b) => b.key !== "authority");
    return action(stepIndex, {
      title: authority.allowed ? "Review the slip and place it to market" : "Waiting for an authorised signatory",
      detail: authority.allowed
        ? `Prepared by ${preparer}. Placing sends the slip to every named market — this is the point it becomes visible outside the firm.`
        : `${authority.reason} ${approverHint(program)}`,
      actionLabel: "Place to market", action: "release-slip",
      blocked: blockers.length > 0,
      blockedReason: otherBlockers.length
        ? (otherBlockers.length === 1 ? otherBlockers[0].detail : `${otherBlockers.length} other conditions are not met — see the checklist.`)
        : null,
      secondaryAction: authority.allowed ? { action: "return-to-draft", label: "Return to preparer" } : undefined,
    });
  }

  if (awaitingRenewal(program)) {
    return action(stepIndex, {
      title: "Start the renewal",
      detail: `This program expires on ${program.expiry}. The confirmations below are from the expiring placement — starting the renewal drafts a new slip on the new terms and puts every market back to Sent.`,
      actionLabel: "Start renewal — draft new slip", action: "start-renewal",
    });
  }

  const progress = responseProgress(program);

  if (status === STATUS.PLACED || status === STATUS.NEGOTIATING) {
    if (progress.total === 0) {
      return action(stepIndex, {
        title: "Name the market panel", detail: "No reinsurers are on this slip, so there is nobody to negotiate with. Revise the slip to add markets.",
        actionLabel: "Revise slip", action: "revise-slip",
      });
    }
    if (progress.declined > 0 && !backupSecured(program)) {
      return action(stepIndex, {
        title: `Replace declined capacity from ${list(progress.declinedNames)}`,
        detail: "A declined line leaves the slip short. Revise the slip to replace the market — the new version goes back through internal approval before it is re-placed.",
        actionLabel: "Revise slip", action: "revise-slip",
      });
    }
    if (progress.queried > 0) {
      return action(stepIndex, {
        title: `Resolve ${plural(progress.queried, "open query", "open queries")}`,
        detail: `${list(progress.queriedNames)} ${progress.queried === 1 ? "has" : "have"} queried the terms. Record each market's answer as it comes back.`,
        actionLabel: "Record market response", action: "record-response",
      });
    }
    return action(stepIndex, {
      title: status === STATUS.PLACED ? "Collect market responses" : `Chase ${plural(progress.awaiting, "market", "markets")} still to confirm`,
      detail: status === STATUS.PLACED
        ? `The slip is with ${list(progress.awaitingNames)}. Record each response as it arrives — backup is secured when confirmed lines reach 100%${isLayered(program) ? " on every layer" : ""}.`
        : `Still waiting on ${list(progress.awaitingNames)}. ${progress.confirmed} of ${progress.total} lines confirmed.`,
      actionLabel: "Record market response", action: "record-response",
    });
  }

  if (status === STATUS.BACKUP) {
    if (program.revisionRequired) {
      return action(stepIndex, {
        title: "Revise the slip before a new proposal",
        detail: `The cedant asked for changes${program.cedantRevisionNotes ? `: ${program.cedantRevisionNotes}` : ""}. Backup is secured, but the same terms cannot go back as a new proposal — revise the slip first.`,
        actionLabel: "Revise slip", action: "revise-slip",
      });
    }
    const stale = program.proposalStale ? ` Proposal v${program.proposalVersion} was marked stale when the panel changed, so this goes as v${(program.proposalVersion || 0) + 1}.` : "";
    return action(stepIndex, {
      title: program.proposalStale ? "Send a new proposal to the cedant" : "Send the proposal to the cedant",
      detail: `Market backup is secured: every line is confirmed at 100%. This is capacity, not approval — the cedant now sees the terms and decides.${stale}`,
      actionLabel: "Record proposal sent", action: "proposal-sent", needsNotes: true,
    });
  }

  if (status === STATUS.PROPOSAL_SENT) {
    return action(stepIndex, {
      title: "Record the cedant's decision",
      detail: `Proposal v${program.proposalVersion || 1} is with the cedant. Record their approval, or the revision they asked for. Approval is not yet an instruction to bind.`,
      actionLabel: "Record cedant approval", action: "cedant-approved", needsNotes: true,
      secondaryAction: { action: "cedant-revision", label: "Cedant requested revision" },
    });
  }

  if (status === STATUS.CEDANT_NEGOTIATION) {
    return action(stepIndex, {
      title: "Revise the slip",
      detail: `The cedant asked for changes${program.cedantRevisionNotes ? `: ${program.cedantRevisionNotes}` : ""}. Revising opens a new slip version: change the terms or panel, then it goes back through internal approval and to market before a new proposal can be sent. Any approval or instruction already recorded is void.`,
      actionLabel: "Revise slip", action: "revise-slip",
    });
  }

  if (status === STATUS.CEDANT_APPROVED) {
    return action(stepIndex, {
      title: "Awaiting the cedant's instruction to bind",
      detail: "The cedant approved the terms. Nothing binds until they instruct it — record the instruction when it arrives, with its reference.",
      actionLabel: "Record instruction to bind", action: "bind-instructed", needsNotes: true,
      secondaryAction: { action: "cedant-revision", label: "Cedant requested revision" },
    });
  }

  if (status === STATUS.BIND_INSTRUCTED) {
    const ok = canBind(program);
    return action(stepIndex, {
      title: "Execute the binding",
      detail: `Instruction received${program.bindInstruction?.reference ? ` (${program.bindInstruction.reference})` : ""}. Binding freezes the terms, issues the RI slip to the cedant and a binding slip to each reinsurer, and raises the premium invoice.`,
      actionLabel: "Bind and issue", action: "bind", needsInstructions: true,
      blocked: !ok, blockedReason: ok ? null : "Confirmed capacity no longer totals 100% — resolve the panel before binding.",
    });
  }

  return action(stepIndex, { title: "Review this placement", detail: `Status "${program.status}" needs a broker's attention.`, actionLabel: "Open", action: "noop", blocked: true, blockedReason: "No automatic next step for this status." });
}

/**
 * The bind gate, stated as a checklist an operator can read.
 * `state` is one of "done" | "blocking" | "todo" | "optional".
 */
export function bindChecklist(program) {
  const status = normaliseStatus(program.status);
  const progress = responseProgress(program);
  const units = capacityUnits(program);
  const panelNamed = progress.total > 0;
  const stale = awaitingRenewal(program);
  const secured = backupSecured(program) && !stale;
  const order = [STATUS.PLACED, STATUS.NEGOTIATING, STATUS.BACKUP, STATUS.PROPOSAL_SENT, STATUS.CEDANT_NEGOTIATION, STATUS.CEDANT_APPROVED, STATUS.BIND_INSTRUCTED, STATUS.BOUND];
  const reached = (s) => order.indexOf(status) >= order.indexOf(s);
  const short = units.filter((u) => !u.backupSecured);

  return [
    ...(stale ? [{ label: "Renewal slip drafted", state: "blocking", detail: "Confirmations below are from the expiring placement" }] : []),
    { label: "Market panel named", state: panelNamed ? "done" : "blocking", detail: panelNamed ? `${plural(progress.total, "line", "lines")} on the slip` : "No markets on this slip" },
    { label: "No open queries or declines", state: progress.queried + progress.declined > 0 ? "blocking" : panelNamed ? "done" : "todo",
      detail: progress.queried + progress.declined > 0 ? `${plural(progress.queried, "query", "queries")}, ${plural(progress.declined, "decline", "declines")}` : "Every response is clean" },
    { label: units.length > 1 ? "Backup secured on every layer" : "Backup secured at 100%", state: secured ? "done" : "blocking",
      detail: stale ? "Expiring terms — re-place to reconfirm" : secured ? (units.length > 1 ? `${units.length} layers confirmed` : `${units[0]?.confirmed.toFixed(0) ?? 0}% confirmed`)
        : short.length ? `${short.map((u) => `${u.label} ${u.confirmed.toFixed(0)}%`).join(" · ")}` : "0% confirmed" },
    { label: "Proposal sent to cedant", state: reached(STATUS.PROPOSAL_SENT) ? "done" : "todo",
      detail: program.proposalSentAt ? `v${program.proposalVersion || 1} on ${program.proposalSentAt}` : reached(STATUS.PROPOSAL_SENT) ? "Recorded; date unavailable" : "Not yet sent" },
    { label: "Cedant approved", state: program.cedantApproval ? "done" : "todo", detail: program.cedantApproval ? `${program.cedantApproval.at} · ${program.cedantApproval.by}` : "Approval not recorded" },
    { label: "Instruction to bind received", state: program.bindInstruction ? "done" : reached(STATUS.CEDANT_APPROVED) ? "blocking" : "todo",
      detail: program.bindInstruction ? `${program.bindInstruction.at}${program.bindInstruction.reference ? ` · ${program.bindInstruction.reference}` : ""}` : "Cedant approval is not an instruction to bind" },
    { label: "Binding instructions", state: "optional", detail: program.bindingInstructions ? "Recorded" : "Optional — payment terms, subjectivities" },
  ];
}
