/**
 * Submission service — the cedant portal's way into the broker intake queue.
 *
 * A portal submission is an intake with `source: "portal"`; it sits in the
 * same queue as a manually recorded one and is worked up the same way. This
 * module is kept so existing callers keep their names.
 */
import { state, currentCedant } from "../core/store.js";
import { createPortalIntake, intakesForCedant } from "./intake.service.js";

/** Queue a risk or renewal request from the cedant portal. */
export function submitRisk({ cls, type, amount, notes, insuredName, ccy, paymentWarrantyDays, rate }) {
  const intake = createPortalIntake({
    cls, requestedType: type, sumInsured: amount, notes, insuredName, ccy, paymentWarrantyDays, rate,
  });
  // Mirror onto the legacy list so anything still reading it sees the request.
  state.pendingSubmissions.unshift({ cls, type, amount, notes, received: new Date(), intakeId: intake.id });
  return intake;
}

/** What the signed-in cedant has with the desk, newest first. */
export const pendingSubmissions = () => intakesForCedant(currentCedant());
