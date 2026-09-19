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

/** Signed lines must add to exactly this before a slip may be released. */
export const REQUIRED_SIGNED_LINES = 100;

/** Rounding tolerance, so 33.33 × 3 is not treated as a shortfall. */
const TOLERANCE = 0.01;

/** Total of the signed lines named on the slip. */
export function signedLines(program) {
  return program.marketConfirmations.reduce((sum, mc) => sum + (mc.line || 0), 0);
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
  const panel = program.marketConfirmations;
  const lines = signedLines(program);
  const shortfall = REQUIRED_SIGNED_LINES - lines;
  const authority = releaseAuthority(program, user);

  const linesState =
    Math.abs(shortfall) <= TOLERANCE ? "done" : "blocking";
  const linesDetail =
    Math.abs(shortfall) <= TOLERANCE ? `${lines.toFixed(0)}% placed`
    : shortfall > 0 ? `${lines.toFixed(0)}% placed — ${shortfall.toFixed(0)}% short`
    : `${lines.toFixed(0)}% placed — ${Math.abs(shortfall).toFixed(0)}% oversubscribed`;

  return [
    {
      key: "panel",
      label: "Market panel named",
      state: panel.length > 0 ? "done" : "blocking",
      detail: panel.length ? `${panel.length} market${panel.length === 1 ? "" : "s"} on the slip` : "No markets on this slip",
    },
    {
      key: "lines",
      label: "Signed lines total 100%",
      state: linesState,
      detail: linesDetail,
    },
    {
      key: "kyc",
      label: "Cedant KYC current",
      state: cedant?.kyc === "Current" ? "done" : "blocking",
      detail: !cedant ? "Cedant not found on the registry"
        : cedant.kyc === "Current" ? `Refreshed ${cedant.refreshed}`
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
  const lines = signedLines(program);
  if (!program.marketConfirmations.length) {
    return { ready: false, reason: "Name at least one market on the slip before submitting it." };
  }
  if (Math.abs(REQUIRED_SIGNED_LINES - lines) > TOLERANCE) {
    return {
      ready: false,
      reason: `Signed lines total ${lines.toFixed(0)}%. A slip must be placed at exactly 100% before it goes for approval.`,
    };
  }
  return { ready: true, reason: null };
}
