/**
 * Sign-in for the prototype.
 *
 * ⚠ Not security. The comparison below is a plain string match against
 * credentials that ship in the browser bundle and are printed on the sign-in
 * screen. It exists so the app knows which portal to open and whose authority
 * to apply — not to keep anybody out.
 *
 * Pure: takes credentials, returns a user or a reason.
 */
import { USERS } from "../data/users.data.js";

/**
 * @returns {{ ok: true, user: object } | { ok: false, reason: string }}
 */
export function authenticate(username, password) {
  const name = String(username || "").trim().toLowerCase();
  if (!name) return { ok: false, reason: "Enter a username." };
  if (!password) return { ok: false, reason: "Enter a password." };

  const user = USERS.find((u) => u.username.toLowerCase() === name);
  // Deliberately the same message either way, which costs nothing here and is
  // the habit worth keeping when this is replaced by something real.
  if (!user || user.password !== password) {
    return { ok: false, reason: "That username and password do not match an account." };
  }
  return { ok: true, user };
}

export const userByUsername = (username) =>
  USERS.find((u) => u.username.toLowerCase() === String(username || "").trim().toLowerCase());
