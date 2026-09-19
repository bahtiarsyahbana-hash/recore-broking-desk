/**
 * Claims service — notification through to agreement, with the credit-control
 * gate that holds a claim while its program's premium is outstanding.
 */
import { state, sequences, programById, programIdFromLabel } from "../core/store.js";
import { emit, TOPICS } from "../core/events.js";

const NEXT_STATUS = { "Notified": "Under Review", "Under Review": "Agreed" };

/** True when the claim's program has settled its premium. */
export function premiumSettled(claim) {
  const program = programById(programIdFromLabel(claim.program));
  return program ? program.premiumPaid : true;
}

/**
 * A claim is held while premium is outstanding — credit control clears it
 * before the claim may proceed. Already-agreed and paid claims are never held.
 */
export function isHeldByCreditControl(claim) {
  return !premiumSettled(claim) && claim.status !== "Paid" && claim.status !== "Agreed";
}

/** Advance a claim one step along notification → review → agreed. */
export function advanceClaim(index) {
  const claim = state.claims[index];
  if (!claim) return null;
  const next = NEXT_STATUS[claim.status];
  if (next) claim.status = next;
  emit(TOPICS.CLAIMS, { index, status: claim.status });
  return claim;
}

/** Register a new notification against the tower. */
export function registerClaim() {
  const seq = sequences.claim++;
  state.claims.unshift({
    dol: `2026-09-1${seq % 9}`,
    program: "P-1006 · Pacífico General XL",
    cause: "New notification — awaiting adjuster report",
    layer: "Testing against tower...",
    reserve: Math.floor(200_000 + Math.random() * 900_000),
    status: "Notified",
  });
  emit(TOPICS.CLAIMS, { action: "registered" });
  return state.claims[0];
}
