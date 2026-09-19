/**
 * Desk-wide constants. Anything an operator would plausibly want to change per
 * installation (reporting currency, FX, watch lines, renewal horizon) lives here
 * rather than being scattered through the render code.
 */

/** Fixed "today" so the prototype's renewal maths is reproducible. */
export const TODAY = new Date("2026-09-18");

export const UNDERWRITING_YEAR = 2026;
export const BASE_CURRENCY = "USD";

/** Naive FX table into the base currency. A real desk would read live rates. */
export const FX_TO_BASE = { USD: 1, CAD: 0.73 };

/** Portfolio loss ratio above which the dashboard flags the book. */
export const LOSS_RATIO_WATCH_LINE = 70;

/** Renewals surface on the dashboard this many days before expiry. */
export const RENEWAL_HORIZON_DAYS = 60;

/** Renewals inside this many days are shown as urgent. */
export const RENEWAL_URGENT_DAYS = 30;

/**
 * Chart palette, drawn from the brand. Categorical, so the four are chosen to
 * separate by lightness as well as hue — they must still be tellable apart in
 * greyscale or for a colour-blind reader.
 */
export const CHART_COLORS = ["#0a369d", "#001233", "#4a73c8", "#8a93a5"];

/**
 * The XoL tower ramps navy → blue from the bottom up, so height itself carries
 * meaning: the dark, expensive working layers sit at the base and the cheap
 * catastrophe layers lighten towards the top.
 */
export const TOWER_COLORS = ["#001233", "#0a369d", "#2e5ac4", "#5b82db", "#93aee9"];

/** The cedant whose book the optional portal exposes. */
export const PORTAL_CEDANT = "Meridian Mutual Insurance";

/** Convert an amount in `ccy` to the base reporting currency. */
export function toBase(amount, ccy) {
  return amount * (FX_TO_BASE[ccy] ?? 1);
}

/** ISO date string for the desk's current date. */
export function todayISO() {
  return TODAY.toISOString().slice(0, 10);
}
