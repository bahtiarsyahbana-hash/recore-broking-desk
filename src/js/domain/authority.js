/**
 * Who is at the desk, and what they are allowed to release.
 *
 * Issuing a slip is an outward-facing act: it puts the firm's name and the
 * cedant's terms in front of the reinsurance market. So it is governed by the
 * maker–checker (four-eyes) rule that any broking control framework expects —
 * the person who prepares a submission may not be the person who releases it.
 *
 * This is a simulated identity, deliberately: the desk has two seats you can
 * act as, rather than a full user system. Everything that a real one would need
 * is already modelled — a current actor, an authority level, and `preparedBy` /
 * `approvedBy` stamped on the record — so swapping in real users later means
 * replacing `currentUser()` and nothing else.
 */

/** The two seats at the desk. */
export const DESK_USERS = {
  broker: {
    id: "vr",
    name: "Victor Roy",
    initials: "VR",
    title: "Placement Broker",
    /** May prepare and submit, but not release to market. */
    canReleaseSlips: false,
  },
  signatory: {
    id: "ml",
    name: "Maya Lindqvist",
    initials: "ML",
    title: "Authorised Signatory",
    canReleaseSlips: true,
  },
  /*
   * A second signatory is not decoration. With only one, any slip that person
   * prepared could never be released by anybody — four-eyes would deadlock the
   * placement permanently, with no way out of the drawer. Any desk operating
   * this control in earnest has at least two people who can sign.
   */
  signatory2: {
    id: "ao",
    name: "Adeola Okonjo",
    initials: "AO",
    title: "Authorised Signatory",
    canReleaseSlips: true,
  },
  /*
   * The administrator releases without the separate-person rule, including
   * slips they prepared themselves. This is an override, not an exemption the
   * control forgot about: it keeps the desk moving while the full approval
   * hierarchy is still being set up.
   *
   * Turning it off later means deleting `bypassFourEyes` from this record —
   * nothing else reads it.
   */
  admin: {
    id: "adm",
    name: "Desk Administrator",
    initials: "AD",
    title: "Administrator",
    canReleaseSlips: true,
    bypassFourEyes: true,
  },
};

export const DEFAULT_SEAT = "broker";

/** @returns {object} the seat's user record, falling back to the broker. */
export const userForSeat = (seat) => DESK_USERS[seat] || DESK_USERS[DEFAULT_SEAT];

/** Readable list: "A", "A or B", "A, B or C". */
function orList(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * Every seat that could release this slip — holds signing authority and did
 * not prepare it. Used to name names rather than telling an operator to go
 * looking for "an authorised signatory".
 *
 * @returns {{seat: string, name: string, title: string}[]}
 */
export function eligibleApprovers(program) {
  return Object.entries(DESK_USERS)
    .filter(([, u]) => u.canReleaseSlips)
    // The administrator stays eligible even on their own submissions.
    .filter(([, u]) => u.bypassFourEyes || !program.preparedBy || program.preparedBy.id !== u.id)
    .map(([seat, u]) => ({ seat, name: u.name, title: u.title }));
}

/** "Maya Lindqvist or Adeola Okonjo can release this slip." */
export function approverHint(program) {
  const eligible = eligibleApprovers(program);
  if (!eligible.length) {
    return "No other authorised signatory is available, so this slip cannot be released. It needs to be prepared by someone else.";
  }
  return `${orList(eligible.map((u) => u.name))} can release this slip — switch seats in the top bar.`;
}

/**
 * Whether `user` may release this particular slip.
 *
 * Two conditions, and the second is the point of the control: holding signing
 * authority is not enough if you are the one who prepared the submission.
 *
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function releaseAuthority(program, user) {
  if (!user?.canReleaseSlips) {
    return {
      allowed: false,
      reason: `${user?.name || "This seat"} is a ${user?.title || "non-signatory"} and cannot release a slip to market.`,
    };
  }
  if (program.preparedBy && program.preparedBy.id === user.id && !user.bypassFourEyes) {
    return {
      allowed: false,
      reason: `${user.name} prepared this submission. Under four-eyes, a different authorised person must release it.`,
    };
  }
  return { allowed: true, reason: null };
}

/** True when this release relied on the administrator override. */
export const usedOverride = (program, user) =>
  Boolean(user?.bypassFourEyes && program.preparedBy && program.preparedBy.id === user.id);

/** A compact record of who someone was, stamped onto a placement. */
export const stamp = (user) => ({ id: user.id, name: user.name, title: user.title });
