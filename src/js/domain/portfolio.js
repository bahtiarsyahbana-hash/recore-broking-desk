/**
 * Portfolio analytics — the book-level figures behind the dashboard and the
 * exposure report. All amounts are converted to the base reporting currency.
 */
import { toBase, RENEWAL_HORIZON_DAYS } from "../core/config.js";
import { daysBetween } from "../core/format.js";

/** Bound premium, incurred loss and earned premium across the whole book. */
export function portfolioTotals(programs) {
  const totals = programs.reduce((acc, p) => ({
    premium: acc.premium + toBase(p.premium, p.ccy),
    loss: acc.loss + toBase(p.loss, p.ccy),
    earned: acc.earned + toBase(p.earned, p.ccy),
  }), { premium: 0, loss: 0, earned: 0 });

  return {
    ...totals,
    lossRatio: totals.earned ? (totals.loss / totals.earned * 100) : 0,
  };
}

/** Bound premium grouped by class of business, base currency. */
export function premiumByClass(programs) {
  const byClass = {};
  programs.forEach((p) => {
    byClass[p.cls] = (byClass[p.cls] || 0) + toBase(p.premium, p.ccy);
  });
  return byClass;
}

/** Loss ratio per program, for the reports view. */
export function lossRatioByProgram(programs) {
  return programs.map((p) => ({
    id: p.id,
    lossRatio: p.earned ? (p.loss / p.earned * 100) : 0,
  }));
}

/** Claims not yet settled. */
export const openClaims = (claims) => claims.filter((c) => c.status !== "Paid");

/**
 * Programs expiring inside the renewal horizon, soonest first, each with the
 * number of days left to run.
 */
export function renewalsDue(programs, today, horizon = RENEWAL_HORIZON_DAYS) {
  return programs
    .map((p) => ({ program: p, days: daysBetween(today, new Date(p.expiry)) }))
    .filter((x) => x.days <= horizon)
    .sort((a, b) => a.days - b.days);
}
