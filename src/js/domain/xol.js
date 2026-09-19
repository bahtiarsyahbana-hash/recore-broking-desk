/**
 * Excess of loss — a tower of layers, each attaching above the one below.
 * Covers rate on line per layer and the reinstatement premium due after a loss.
 */

/** Rate on line: layer premium as a percentage of the limit it buys. */
export function rateOnLine(limit, premium) {
  return limit ? (premium / limit * 100) : 0;
}

/** Top of the tower — the highest point any layer reaches. */
export function towerTop(layers) {
  return layers.reduce((max, l) => Math.max(max, l.ret + l.limit), 0);
}

/** The cedant's own retention: the lowest attachment point in the tower. */
export function baseRetention(layers) {
  return layers.length ? Math.min(...layers.map((l) => l.ret)) : 0;
}

/** A layer's premium — explicit if entered, otherwise derived from its ROL. */
export function layerPremium(layer) {
  return layer.premium ?? Math.round(layer.limit * layer.rol / 100);
}

/**
 * Reinstatement premium, pro-rata as to amount and — where selected — as to time.
 *
 * @param {{limit:number, lossRecovered:number, layerPremium:number,
 *          reinstatementPct:number, timeRemainingPct:number}} terms
 */
export function computeReinstatement({
  limit = 1, lossRecovered = 0, layerPremium = 0,
  reinstatementPct = 0, timeRemainingPct = 0,
}) {
  const amountFraction = Math.min(1, lossRecovered / limit);
  return {
    amountFraction,
    timeFraction: timeRemainingPct / 100,
    premiumDue: amountFraction * (timeRemainingPct / 100) * (reinstatementPct / 100) * layerPremium,
  };
}
