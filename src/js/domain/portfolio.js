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

/* ------------------------------------------------------------------ *
 * Concentration — who the book depends on, and who is carrying it.
 *
 * A broking desk's two largest commercial risks are a client that is too
 * big to lose and a market that is too big to fail. Both are invisible in
 * totals; they only appear once the book is split by counterparty.
 * ------------------------------------------------------------------ */

/** Bound premium grouped by cedant, base currency. */
export function premiumByCedant(programs) {
  const byCedant = {};
  programs.forEach((p) => {
    byCedant[p.cedant] = (byCedant[p.cedant] || 0) + toBase(p.premium, p.ccy);
  });
  return byCedant;
}

/**
 * Premium exposure per reinsurer, derived from the lines they actually signed.
 *
 * This is computed from the book rather than read from a stored figure: a
 * market's exposure is the sum of (programme premium × its signed line) across
 * every placement it is on, so it cannot drift away from the placements it is
 * supposed to describe.
 */
export function exposureByReinsurer(programs) {
  const byMarket = {};
  programs.forEach((p) => {
    const premium = toBase(p.premium, p.ccy);
    p.marketConfirmations.forEach((mc) => {
      byMarket[mc.m] = (byMarket[mc.m] || 0) + premium * (mc.line || 0) / 100;
    });
  });
  return byMarket;
}

/** Loss ratio per cedant, for the desk's least profitable relationships. */
export function lossRatioByCedant(programs) {
  const acc = {};
  programs.forEach((p) => {
    const row = acc[p.cedant] || (acc[p.cedant] = { cedant: p.cedant, loss: 0, earned: 0 });
    row.loss += toBase(p.loss, p.ccy);
    row.earned += toBase(p.earned, p.ccy);
  });
  return Object.values(acc)
    .map((r) => ({ ...r, lossRatio: r.earned ? (r.loss / r.earned * 100) : 0 }))
    .sort((a, b) => b.lossRatio - a.lossRatio);
}

/** Index programs by id so a claim's "P-1001 · ..." label can be resolved. */
const programIndex = (programs) => new Map(programs.map((p) => [p.id, p]));
const programOf = (index, claim) => index.get(String(claim.program || "").split(" ")[0]);

/** Open claims and reserve, grouped by the cedant that notified them. */
export function openClaimsByCedant(claims, programs) {
  const index = programIndex(programs);
  const acc = {};
  openClaims(claims).forEach((c) => {
    const program = programOf(index, c);
    const key = program ? program.cedant : "Unattributed";
    const row = acc[key] || (acc[key] = { cedant: key, count: 0, reserve: 0 });
    row.count += 1;
    row.reserve += program ? toBase(c.reserve, program.ccy) : c.reserve;
  });
  return Object.values(acc).sort((a, b) => b.reserve - a.reserve);
}

/**
 * Reserve on open claims apportioned to each reinsurer by its signed line —
 * what each market is on the hook for right now, rather than how many claims
 * happen to touch it.
 */
export function claimReserveByReinsurer(claims, programs) {
  const index = programIndex(programs);
  const byMarket = {};
  openClaims(claims).forEach((c) => {
    const program = programOf(index, c);
    if (!program) return;
    const reserve = toBase(c.reserve, program.ccy);
    program.marketConfirmations.forEach((mc) => {
      byMarket[mc.m] = (byMarket[mc.m] || 0) + reserve * (mc.line || 0) / 100;
    });
  });
  return byMarket;
}

/**
 * Turn a { name: amount } map into ranked shares, collapsing the tail.
 *
 * @param {Record<string, number>} totals
 * @param {{ top?: number, threshold?: number }} [options]
 * @returns {{ rows: object[], total: number, largest: object|null, flagged: object[] }}
 */
export function concentration(totals, { top = 5, threshold = 25 } = {}) {
  const ranked = Object.entries(totals)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  const share = (value) => (total ? value / total * 100 : 0);

  const rows = ranked.slice(0, top).map(([name, value]) => ({
    name, value, share: share(value),
  }));

  // The tail is collapsed rather than dropped, so the shares still sum to 100.
  const tail = ranked.slice(top);
  if (tail.length) {
    const value = tail.reduce((sum, [, v]) => sum + v, 0);
    rows.push({ name: `${tail.length} others`, value, share: share(value), isOther: true });
  }

  return {
    rows,
    total,
    largest: rows[0] || null,
    flagged: rows.filter((r) => !r.isOther && r.share >= threshold),
  };
}
