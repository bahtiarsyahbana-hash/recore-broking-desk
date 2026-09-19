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

import { USERS, brokerUsers } from "../data/users.data.js";

/**
 * The broker seats, keyed by user id. Authority now travels with the signed-in
 * user rather than a dropdown, so this is derived from the user records rather
 * than declared a second time.
 */
export const DESK_USERS = Object.fromEntries(brokerUsers().map((u) => [u.id, u]));

/** Any account, broker or cedant, by id. */
export const userById = (id) => USERS.find((u) => u.id === id);

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
  return brokerUsers()
    .filter((u) => u.canReleaseSlips)
    // The administrator stays eligible even on their own submissions.
    .filter((u) => u.bypassFourEyes || !program.preparedBy || program.preparedBy.id !== u.id)
    .map((u) => ({ username: u.username, name: u.name, title: u.title }));
}

/** "Maya Lindqvist or Adeola Okonjo can release this slip." */
export function approverHint(program) {
  const eligible = eligibleApprovers(program);
  if (!eligible.length) {
    return "No other authorised signatory is available, so this slip cannot be released. It needs to be prepared by someone else.";
  }
  // Identity comes from sign-in now, so the instruction has to match: there is
  // no seat switcher to reach for.
  return `${orList(eligible.map((u) => u.name))} can release this slip. Sign out and sign back in as one of them.`;
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
