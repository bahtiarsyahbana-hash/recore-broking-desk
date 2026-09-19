/**
 * Counterparty identity rules.
 *
 * Grounded in how a reinsurance counterparty is actually identified for
 * regulatory reporting. The PRA's IR.31.01 / Solvency II S.31.01 outwards
 * reinsurance templates require each reinsurer to carry an identification code
 * in a strict order of priority:
 *
 *   1. LEI  — Legal Entity Identifier, ISO 17442, 20 alphanumeric characters
 *   2. LSY  — Lloyd's Syndicate Code, 4 numeric, which *takes priority over LEI*
 *             when the counterparty is a syndicate
 *   3. SC   — a specific code the reporting undertaking assigns itself
 *
 * That priority is why the Lloyd's page asks for a syndicate number as a
 * required field while every other page treats the LEI as the primary code.
 *
 * Pure functions — no DOM, no state.
 */

/** Letters carry their alphabet position + 9, per ISO 7064 MOD 97-10. */
const charValue = (ch) =>
  ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);

/**
 * ISO 17442 LEI: 20 alphanumeric characters whose final two are check digits.
 * Validated with ISO 7064 MOD 97-10 — the whole string read as a number must
 * leave a remainder of 1, which catches transposed and mistyped characters
 * that a length check alone would pass.
 */
export function isValidLEI(value) {
  const lei = String(value || "").trim().toUpperCase();
  if (!/^[0-9A-Z]{20}$/.test(lei)) return false;

  // 20 chars expand past Number.MAX_SAFE_INTEGER, so fold the modulo as we go.
  let remainder = 0;
  for (const ch of lei) {
    remainder = Number(String(remainder) + charValue(ch)) % 97;
  }
  return remainder === 1;
}

/** Lloyd's syndicate codes are four digits, reported as LSY/XXXX. */
export function isValidSyndicateNumber(value) {
  return /^[0-9]{4}$/.test(String(value || "").trim());
}

/**
 * Deliberately permissive: one @, something either side, a dot in the domain.
 * A stricter pattern rejects addresses that are perfectly deliverable.
 */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/** Digits, spaces and the usual punctuation, with an optional leading +. */
export function isValidPhone(value) {
  const phone = String(value || "").trim();
  return /^\+?[0-9\s().-]{6,24}$/.test(phone);
}

/** The counterparty code a regulatory return would carry, in priority order. */
export function reportingCode({ syndicateNo, lei }) {
  if (isValidSyndicateNumber(syndicateNo)) return `LSY/${String(syndicateNo).trim()}`;
  if (isValidLEI(lei)) return `LEI/${String(lei).trim().toUpperCase()}`;
  return null;
}
