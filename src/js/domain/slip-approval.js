/**
 * The release gate — what an authorised signatory checks before a slip leaves
 * the building.
 *
 * These are the rules the old flow promised but never enforced. The submission
 * wizard tinted its signed-line total red or green and then issued the slip
 * regardless; the registry captured a cedant's KYC status and nothing ever read
 * it. Both belong here, at the one moment the placement becomes visible to the
 * market.
 *
 * Pure: takes a placement and its cedant record, returns findings.
 */
import { releaseAuthority, approverHint, usedOverride } from "./authority.js";
import { capacityUnits, panelEntries, signedLinesComplete, REQUIRED_SIGNED_LINES } from "./panel.js";
import { isValidPaymentWarranty, PAYMENT_WARRANTY_DAYS } from "./intake.js";

/**
 * A slip cannot be issued without the agreed payment warranty. Historical
 * records without the field stay readable, but cannot be newly submitted or
 * re-placed until it is completed — and it is never defaulted for them.
 */
export function paymentWarrantyCheck(program) {
  const days = program.terms?.paymentWarrantyDays;
  if (isValidPaymentWarranty(days)) return { ok: true, reason: null, days: Number(days) };
  return {
    ok: false, days: null,
    reason: days == null || days === ""
      ? `Payment warranty is not set. Choose the agreed period (${PAYMENT_WARRANTY_DAYS.join(", ")} days) before this slip can be issued.`
      : `Payment warranty "${days}" is not a supported period. Choose one of ${PAYMENT_WARRANTY_DAYS.join(", ")} days.`,
  };
}

export { REQUIRED_SIGNED_LINES };

/**
 * Total of the signed lines named on the slip. For a layered placement this is
 * the average across layers — a single figure for display only; the gate below
 * checks every layer on its own.
 */
export function signedLines(program) {
  const units = capacityUnits(program);
  if (!units.length) return 0;
  return units.reduce((sum, u) => sum + u.signed, 0) / units.length;
}

/**
 * Every condition on releasing a slip, whether or not it is met.
 *
 * `state` is "done" | "blocking" | "optional"; `blocking` items are what
 * actually stop the release.
 *
 * @param {object} program
 * @param {object|undefined} cedant  the cedant's registry record
 * @param {object} user              the seat attempting the release
 */
export function releaseChecklist(program, cedant, user) {
  const panel = panelEntries(program);
  const complete = signedLinesComplete(program);
  const units = capacityUnits(program);
  const authority = releaseAuthority(program, user);
  const warranty = paymentWarrantyCheck(program);

  const linesState = complete.complete ? "done" : "blocking";
  const linesDetail = complete.complete
    ? (units.length > 1 ? `${units.length} layers each placed at 100%` : "100% placed")
    : complete.reason;

  return [
    {
      key: "panel",
      label: "Market panel named",
      state: panel.length > 0 ? "done" : "blocking",
      detail: panel.length ? `${panel.length} market${panel.length === 1 ? "" : "s"} on the slip` : "No markets on this slip",
    },
    {
      key: "lines",
      label: units.length > 1 ? "Signed lines total 100% on every layer" : "Signed lines total 100%",
      state: linesState,
      detail: linesDetail,
    },
    {
      key: "warranty",
      label: "Payment warranty agreed",
      state: warranty.ok ? "done" : "blocking",
      detail: warranty.ok ? `${warranty.days} days` : warranty.reason,
    },
    {
      key: "kyc",
      label: "Cedant KYC current",
      state: cedant?.kyc === "Current" ? "done" : "blocking",
      detail: !cedant ? "Cedant not found on the registry"
        : cedant.kyc === "Current" ? `Refreshed ${cedant.refreshed}`
        : cedant.kyc === "Not assessed"
          ? "Never onboarded — complete KYC before placing for this cedant"
          : `KYC ${String(cedant.kyc).toLowerCase()} — refresh before releasing`,
    },
    {
      key: "authority",
      // Naming it accurately matters: an administrator releasing their own
      // submission is an override, not a second pair of eyes.
      label: usedOverride(program, user)
        ? "Released under administrator override"
        : "Released by a second authorised person",
      state: authority.allowed ? "done" : "blocking",
      detail: authority.allowed
        ? (usedOverride(program, user)
            ? `${user.name} prepared this and may release it without a second approver`
            : `${user.name} may release this slip`)
        : approverHint(program),
    },
  ];
}

/** The blocking findings only. */
export const releaseBlockers = (program, cedant, user) =>
  releaseChecklist(program, cedant, user).filter((c) => c.state === "blocking");

/** Whether this seat may release this slip right now. */
export const canReleaseSlip = (program, cedant, user) =>
  releaseBlockers(program, cedant, user).length === 0;

/**
 * Whether the submission is complete enough to go for approval at all.
 * The preparer's own checks — authority is not among them, since the preparer
 * is by definition not the one who will release it.
 */
export function readyToSubmit(program) {
  const complete = signedLinesComplete(program);
  if (!complete.complete) return { ready: false, reason: complete.reason };
  const warranty = paymentWarrantyCheck(program);
  if (!warranty.ok) return { ready: false, reason: warranty.reason };
  return { ready: true, reason: null };
}
