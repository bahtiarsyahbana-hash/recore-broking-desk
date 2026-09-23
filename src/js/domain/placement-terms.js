/**
 * The terms a submission carries, and what they imply.
 *
 * A placement's economics differ by treaty form: a facultative risk is priced
 * off a sum insured and a rate, a quota share off the cedant's premium income,
 * an excess-of-loss layer off its limit and rate on line. This module holds
 * that per-form knowledge in one place — how to describe the structure on a
 * slip, and what gross premium the terms imply.
 *
 * Pure: terms in, strings and numbers out.
 */
import { fmt } from "../core/format.js";

/**
 * Gross premium implied by the terms, in the placement currency.
 *
 * Returns 0 when the terms cannot price the risk, which the caller should
 * treat as "not yet priced" rather than "free".
 */
export function estimatedGrossPremium(type, terms = {}) {
  const n = (v) => Number(v) || 0;
  // A facultative placement — whichever form it is ceded on — is priced off the
  // insured's sum insured and the agreed rate. That is the new-placement path.
  if (terms.sumInsured && terms.rate != null && terms.rate !== "") {
    return n(terms.sumInsured) * n(terms.rate) / 100;
  }
  switch (type) {
    // Rate on the sum insured.
    case "Facultative":
      return n(terms.sumInsured) * n(terms.rate) / 100;
    // The cedant's whole premium income is the gross; the cession is the share.
    case "Quota Share":
      return n(terms.gnpi);
    // Entered directly — a surplus treaty's premium follows the ceded portfolio.
    case "Surplus":
      return n(terms.premium);
    // Rate on line applied to the layer limit.
    case "Excess of Loss":
      return n(terms.limit) * n(terms.rol) / 100;
    default:
      return 0;
  }
}

/** "30 days" — payment warranty as it reads on a slip; structured days, never free text. */
export function paymentWarrantyLine(days) {
  const d = Number(days);
  return d > 0 ? `${d} days` : "Not set";
}

/** "USD 10.00m xs USD 5.00m" per layer, joined for a structure line. */
export function towerLine(layers = []) {
  return layers.map((l) => `${fmt(Number(l.limit) || 0)} xs ${fmt(Number(l.attachment) || 0)}`).join(" · ");
}

/** The ceded share of that premium, where the form cedes a proportion. */
export function estimatedCededPremium(type, terms = {}) {
  const gross = estimatedGrossPremium(type, terms);
  if (type === "Quota Share") return gross * (Number(terms.cession) || 0) / 100;
  return gross;
}

/** One-line description of the structure, as it reads on a slip. */
export function structureLine(type, terms = {}, layers = null) {
  const n = (v, fallback = 0) => Number(v) || fallback;
  // New facultative placements describe the insured risk and, for XoL, the tower.
  if (terms.insured && terms.sumInsured) {
    const risk = `${terms.insured} · ${fmt(n(terms.sumInsured))} SI`;
    if (type === "Excess of Loss" && Array.isArray(layers) && layers.length) {
      return `${risk} · ${layers.length}-layer tower: ${towerLine(layers)}`;
    }
    if (type === "Quota Share") return `${risk} · quota share${terms.rate != null && terms.rate !== "" ? ` @ ${n(terms.rate)}%` : ""}`;
    return `${risk}${terms.rate != null && terms.rate !== "" ? ` @ ${n(terms.rate)}%` : ""}`;
  }
  switch (type) {
    case "Facultative":
      return `Single risk · ${fmt(n(terms.sumInsured))} SI @ ${n(terms.rate)}%`;
    case "Quota Share":
      return `${n(terms.cession)}% cession, ${n(terms.commission)}% commission`;
    case "Surplus":
      return `${n(terms.lines)} lines xs ${fmt(n(terms.retention))} retention`;
    case "Excess of Loss":
      return `${fmt(n(terms.limit))} xs ${fmt(n(terms.retention))}${terms.reinstatements ? `, ${terms.reinstatements}` : ""}`;
    default:
      return "Terms to be agreed";
  }
}
