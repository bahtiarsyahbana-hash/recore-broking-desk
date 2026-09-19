/**
 * Presentation-only number and date formatting. No module outside the UI layer
 * should format values; domain modules return raw numbers.
 */
import { BASE_CURRENCY } from "./config.js";

/** Compact money — "USD 4.65m", "USD 186k". */
export function fmt(n, ccy = BASE_CURRENCY) {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "m"
          : abs >= 1_000     ? (n / 1_000).toFixed(0) + "k"
          : n.toFixed(0);
  return (n < 0 ? "-" : "") + ccy + " " + s;
}

/** Full money — "USD 4,650,000". Used wherever a figure is auditable. */
export function fmtFull(n, ccy = BASE_CURRENCY) {
  return ccy + " " + Math.round(n).toLocaleString("en-US");
}

/** Percentage to one decimal. */
export function pct(n) {
  return n.toFixed(1) + "%";
}

/** Whole days between two dates. */
export function daysBetween(a, b) {
  return Math.round((b - a) / 86_400_000);
}
