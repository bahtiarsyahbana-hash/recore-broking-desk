/* eslint-disable import/order */
/**
 * Placement lifecycle — the states a program moves through from slip to bind,
 * and the rules governing each transition.
 *
 * Pure state machine: it answers "where is this program and what may happen
 * next". The service layer applies the answers and records the side effects.
 */
import { releaseAuthority, approverHint } from "./authority.js";
import { readyToSubmit, releaseBlockers } from "./slip-approval.js";

/**
 * Six steps. Preparation and release are separated, because they are different
 * acts with different consequences: a draft is internal bookkeeping, an issued
 * slip is the firm's name in front of the market.
 *
 * "Sent for Confirmation" used to sit between Issue Slip and Negotiating and
 * was never actually visible — the confirmation round overwrote it inside the
 * same call. Issuing a slip *is* sending it, so the two are now one step.
 */
export const LIFECYCLE_STEPS = [
  "Draft",
  "Pending Approval",
  "Slip Issued",
  "Negotiating",
  "Cedant Approval",
  "Bound",
];

const STEP_INDEX = {
  "Bound": 5,
  "Cedant Approval": 4,
  "Negotiating": 3,
  "Slip Issued": 2,
  "Pending Approval": 1,
  "Draft": 0,
  "Renewal Due": 0,
  // Statuses from the five-step model, kept so old records still place.
  "Issue Slip": 2,
  "Sent for Confirmation": 2,
  "In Placement": 2,
};

/** Position of a status on the rail; unknown statuses read as complete. */
export function stepIndexFor(status) {
  return STEP_INDEX[status] ?? LIFECYCLE_STEPS.length - 1;
}

/** Stages before the slip has gone to market. */
export const PRE_MARKET_STATUSES = ["Draft", "Pending Approval"];
export const isPreMarket = (program) => PRE_MARKET_STATUSES.includes(program.status);

export const allConfirmed = (program) =>
  program.marketConfirmations.length > 0 &&
  program.marketConfirmations.every((mc) => mc.s === "Confirmed");

export const anyQueried = (program) =>
  program.marketConfirmations.some((mc) => mc.s === "Queried");

/**
 * Statuses in which a placement is not in the market, so nothing about it can
 * be bound however the confirmations read.
 *
 * "Renewal Due" is the trap: an expiring program still carries the confirmed
 * panel from the *expiring* contract. Those are last year's lines on last
 * year's terms, and binding off them would raise an invoice for a placement no
 * market has actually agreed. The renewal must re-issue the slip first, which
 * resets every confirmation to Sent.
 */
const NOT_IN_MARKET = new Set(["Renewal Due", "Bound", "Draft", "Pending Approval"]);

/**
 * A program may only bind once every named market has confirmed its line — and
 * only while it is genuinely in the market.
 */
export const canBind = (program) =>
  !NOT_IN_MARKET.has(program.status) && allConfirmed(program);

/** True when the placement's confirmations belong to an expiring contract. */
export const awaitingRenewal = (program) => program.status === "Renewal Due";

/**
 * Status implied by the state of the market panel after a confirmation round.
 * Queries pull the placement back into negotiation; a clean sweep pushes it
 * forward to the cedant for sign-off.
 */
export function statusAfterConfirmationRound(program) {
  if (anyQueried(program)) return "Negotiating";
  if (allConfirmed(program)) return "Cedant Approval";
  return program.status;
}

/* ------------------------------------------------------------------ *
 * Guidance — what the desk should do next, and what is holding it up.
 *
 * These answer the questions an operator actually has in front of a
 * placement: where am I, what is blocking me, and what do I click. Keeping
 * them here rather than in the drawer means the answer is derived from the
 * same rules that govern the transitions, and cannot drift from them.
 * ------------------------------------------------------------------ */

/** How the market panel is responding, counted. */
export function confirmationProgress(program) {
  const panel = program.marketConfirmations;
  const confirmed = panel.filter((mc) => mc.s === "Confirmed");
  const queried = panel.filter((mc) => mc.s === "Queried");
  return {
    total: panel.length,
    confirmed: confirmed.length,
    queried: queried.length,
    awaiting: panel.length - confirmed.length - queried.length,
    queriedNames: queried.map((mc) => mc.m),
    awaitingNames: panel
      .filter((mc) => mc.s !== "Confirmed" && mc.s !== "Queried")
      .map((mc) => mc.m),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Join names readably: "A", "A and B", "A, B and C". */
function list(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The single next thing to do on this placement, for the seat now at the desk.
 *
 * @param {object} program
 * @param {object} [context]
 * @param {object} [context.user]    the current seat — decides who may release
 * @param {object} [context.cedant]  the cedant's registry record, for KYC
 * @returns {null | {
 *   stepIndex: number, title: string, detail: string, actionLabel: string,
 *   action: "submit-approval"|"release-slip"|"return-to-draft"|"send-slip"|"add-document"|"bind"|"start-renewal",
 *   blocked: boolean, blockedReason: string|null, needsInstructions: boolean,
 *   secondaryAction?: { action: string, label: string }
 * }} null once the placement is bound — there is nothing left to do.
 */
export function nextAction(program, context = {}) {
  if (program.status === "Bound") return null;

  const { user, cedant } = context;

  // --- preparation, before the slip exists in the market -----------------
  if (program.status === "Draft") {
    const ready = readyToSubmit(program);
    return {
      stepIndex: 0,
      title: "Finish the submission and send it for approval",
      detail: ready.ready
        ? "The slip is complete. Submitting it puts it in the approval queue — an authorised signatory releases it to the market."
        : "This draft is not yet complete enough to go for approval.",
      actionLabel: "Submit for approval",
      action: "submit-approval",
      blocked: !ready.ready,
      blockedReason: ready.reason,
      needsInstructions: false,
    };
  }

  if (program.status === "Pending Approval") {
    const authority = user ? releaseAuthority(program, user) : { allowed: false, reason: "No seat is selected." };
    const blockers = user ? releaseBlockers(program, cedant, user) : [];
    const preparer = program.preparedBy?.name || "the preparer";

    // Blockers other than authority. The authority problem is already the
    // whole point of the title and detail, so repeating it underneath just
    // says the same sentence twice.
    const otherBlockers = blockers.filter((b) => b.key !== "authority");

    return {
      stepIndex: 1,
      title: authority.allowed
        ? "Review the slip and release it to market"
        : "Waiting for an authorised signatory",
      // When the seat cannot release, name who can — an operator should never
      // have to go hunting for which seat to switch to.
      detail: authority.allowed
        ? `Prepared by ${preparer}. Releasing sends the slip to every named market for confirmation — this is the point it becomes visible outside the firm.`
        : `${authority.reason} ${approverHint(program)}`,
      actionLabel: "Release slip to market",
      action: "release-slip",
      blocked: blockers.length > 0,
      blockedReason: otherBlockers.length
        ? (otherBlockers.length === 1
            ? otherBlockers[0].detail
            : `${otherBlockers.length} other conditions are not met — see the checklist.`)
        : null,
      needsInstructions: false,
      secondaryAction: authority.allowed
        ? { action: "return-to-draft", label: "Return to preparer" }
        : undefined,
    };
  }

  const progress = confirmationProgress(program);
  // The rail is the single source of truth for position. Guidance describes
  // what to do from here; it never renumbers the journey.
  const stepIndex = stepIndexFor(program.status);

  // A slip with nobody on it cannot go anywhere.
  if (progress.total === 0) {
    return {
      stepIndex,
      title: "Name the market panel",
      detail: "No reinsurers are on this slip yet, so there is nobody to send it to.",
      actionLabel: "Send slip for confirmation",
      action: "send-slip",
      blocked: true,
      blockedReason: "This slip has no markets on it.",
      needsInstructions: false,
    };
  }

  // Expiring, not yet re-marketed. Must come before the allConfirmed check,
  // because the stale panel below would otherwise read as ready to bind.
  if (awaitingRenewal(program)) {
    return {
      stepIndex,
      title: "Start the renewal",
      detail: `This program expires on ${program.expiry}. The confirmations below are from the expiring placement — starting the renewal re-issues the slip on the new terms and puts every market back to Sent.`,
      actionLabel: "Start renewal — re-issue slip",
      action: "start-renewal",
      blocked: false,
      blockedReason: null,
      needsInstructions: false,
    };
  }

  // Everyone has confirmed — the only thing left is the cedant's sign-off.
  if (allConfirmed(program)) {
    return {
      stepIndex,
      title: "Get the cedant's sign-off, then bind",
      detail: progress.total === 1
        ? "The only market on the slip has confirmed its line. Record any binding instructions, then bind the placement."
        : `All ${progress.total} markets have confirmed their lines. Record any binding instructions, then bind the placement.`,
      actionLabel: "Cedant approves — Bind",
      action: "bind",
      blocked: false,
      blockedReason: null,
      needsInstructions: true,
    };
  }

  // Queries outstanding — the paper trail is what clears them.
  if (progress.queried > 0) {
    return {
      stepIndex,
      title: `Resolve ${plural(progress.queried, "open query", "open queries")}`,
      detail: `${list(progress.queriedNames)} ${progress.queried === 1 ? "has" : "have"} queried the terms. Filing your response in the dropbox clears one query at a time.`,
      actionLabel: "File response — clears 1 query",
      action: "add-document",
      blocked: false,
      blockedReason: null,
      needsInstructions: false,
    };
  }

  // Markets named but not yet asked.
  return {
    stepIndex,
    title: progress.awaiting === progress.total
      ? "Send the slip to the market panel"
      : `Chase ${plural(progress.awaiting, "market", "markets")} still to respond`,
    detail: progress.awaiting === progress.total
      ? `${list(progress.awaitingNames)} ${progress.awaiting === 1 ? "is" : "are"} named on the slip but ${progress.awaiting === 1 ? "has" : "have"} not been asked yet. Each will come back confirming its line or querying the terms.`
      : `Still waiting on ${list(progress.awaitingNames)}. Resending puts the slip back in front of them.`,
    actionLabel: progress.awaiting === progress.total
      ? "Send slip for confirmation"
      : "Resend slip to outstanding markets",
    action: "send-slip",
    blocked: false,
    blockedReason: null,
    needsInstructions: false,
  };
}

/**
 * The bind gate, stated as a checklist an operator can read.
 *
 * `state` is one of "done" | "blocking" | "todo" | "optional".
 */
export function bindChecklist(program) {
  const progress = confirmationProgress(program);
  const panelNamed = progress.total > 0;
  const everyoneIn = allConfirmed(program);
  const stale = awaitingRenewal(program);

  return [
    ...(stale ? [{
      label: "Renewal slip issued",
      state: "blocking",
      detail: "Confirmations below are from the expiring placement",
    }] : []),
    {
      label: "Market panel named",
      state: panelNamed ? "done" : "blocking",
      detail: panelNamed
        ? `${plural(progress.total, "market", "markets")} on the slip`
        : "No markets on this slip",
    },
    {
      label: "No open queries",
      state: progress.queried > 0 ? "blocking" : panelNamed ? "done" : "todo",
      detail: progress.queried > 0
        ? `${plural(progress.queried, "query", "queries")} outstanding`
        : "No terms under query",
    },
    {
      label: "Every market confirmed",
      state: everyoneIn && !stale ? "done" : "blocking",
      detail: stale
        ? "Expiring terms — re-issue to reconfirm"
        : `${progress.confirmed} of ${progress.total} confirmed`,
    },
    {
      label: "Binding instructions",
      state: "optional",
      detail: program.bindingInstructions
        ? "Recorded"
        : "Optional — payment terms, subjectivities",
    },
  ];
}
