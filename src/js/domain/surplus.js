/**
 * Surplus treaty — the cedant keeps one line (its retention) and cedes the
 * surplus above it, up to a maximum multiple of that line. Cession therefore
 * varies risk by risk, unlike quota share.
 */

/**
 * @param {{sumInsured:number, retention:number, lines:number, premium:number}} terms
 */
export function computeSurplus({ sumInsured = 0, retention = 1, lines = 0, premium = 0 }) {
  const maxCapacity = retention * (1 + lines);
  const cededSumInsured = Math.max(0, Math.min(sumInsured, maxCapacity) - retention);
  const cessionPct = sumInsured > 0 ? (cededSumInsured / sumInsured * 100) : 0;
  return {
    maxCapacity,
    cededSumInsured,
    cessionPct,
    cededPremium: premium * cessionPct / 100,
  };
}
