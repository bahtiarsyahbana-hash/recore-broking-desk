/**
 * Quota share — proportional cession of a fixed percentage of the cedant's
 * gross net premium income, less ceding commission and brokerage.
 *
 * Pure: takes terms, returns numbers. The same function backs the Treaty
 * Engine's what-if panel and anything that posts to a technical account.
 */

/**
 * @param {{gnpi:number, cessionPct:number, commissionPct:number, brokeragePct:number}} terms
 */
export function computeQuotaShare({ gnpi = 0, cessionPct = 0, commissionPct = 0, brokeragePct = 0 }) {
  const ceded = gnpi * cessionPct / 100;
  const cedingCommission = ceded * commissionPct / 100;
  const brokerage = ceded * brokeragePct / 100;
  return {
    ceded,
    cedingCommission,
    brokerage,
    netToReinsurers: ceded - cedingCommission - brokerage,
  };
}
