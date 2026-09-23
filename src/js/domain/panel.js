/**
 * Market panel — who is on a slip, what they were offered, what they signed and
 * how they have responded. Two shapes share one vocabulary:
 *
 *   Quota share (and every legacy placement): one horizontal panel
 *     program.marketConfirmations = [{ m, offered?, line, s }]
 *
 *   Excess of loss: a vertical tower, one panel per layer
 *     program.layers = [{ limit, attachment, markets: [{ m, offered?, line, s }] }]
 *     program.marketConfirmations is the same entries flattened with a `layer`
 *     index, so book-level analytics keep reading one array.
 *
 * `line` is the signed percentage. `s` is the market response status.
 * Pure: programs in, findings out.
 */

/** Response statuses, in the order a placement moves through them. */
export const MARKET_RESPONSES = ["Sent", "Reviewing", "Quoted", "Queried", "Confirmed", "Declined"];

/** Manual moves a broker may record against a market's current response. */
export const MARKET_RESPONSE_NEXT = {
  "Sent": ["Reviewing", "Quoted", "Queried", "Confirmed", "Declined"],
  "Reviewing": ["Quoted", "Queried", "Confirmed", "Declined"],
  "Quoted": ["Confirmed", "Queried", "Declined"],
  "Queried": ["Quoted", "Confirmed", "Declined"],
  "Confirmed": ["Declined"],
  "Declined": ["Reviewing"],
};

export const REQUIRED_SIGNED_LINES = 100;
/** Rounding tolerance, so 33.33 × 3 is not treated as a shortfall. */
export const TOLERANCE = 0.01;

export const isLayered = (program) => Array.isArray(program.layers) && program.layers.length > 0;

/** "USD 10.00m xs USD 5.00m" — a layer as it reads on a slip. `fmt` is injected so the domain stays format-free. */
export const layerLabel = (layer, fmt = String) => `${fmt(layer.limit)} xs ${fmt(layer.attachment)}`;

/**
 * Every allocation on the slip, whichever shape it is stored in. For a layered
 * program each entry carries `layer` (0-based index).
 */
export function panelEntries(program) {
  if (isLayered(program)) {
    return program.layers.flatMap((layer, i) => (layer.markets || []).map((mc) => ({ ...mc, layer: i })));
  }
  return program.marketConfirmations || [];
}

/** Distinct market names on the slip. */
export const panelMarkets = (program) => [...new Set(panelEntries(program).map((mc) => mc.m))];

/** Signed lines total for one list of allocations. */
export const signedTotal = (entries) => entries.reduce((sum, mc) => sum + (Number(mc.line) || 0), 0);

/** Confirmed signed lines total for one list of allocations. */
export const confirmedTotal = (entries) =>
  entries.filter((mc) => mc.s === "Confirmed").reduce((sum, mc) => sum + (Number(mc.line) || 0), 0);

const atHundred = (total) => Math.abs(REQUIRED_SIGNED_LINES - total) <= TOLERANCE;

/**
 * Capacity, per placing unit. A quota share has one unit; an excess-of-loss
 * tower has one per layer, and each must reach 100% on its own — one global
 * percentage across layers says nothing about whether any layer is placed.
 *
 * @returns {{ label: string, entries: object[], signed: number, confirmed: number,
 *             signedComplete: boolean, backupSecured: boolean }[]}
 */
export function capacityUnits(program, fmt = String) {
  const unit = (label, entries) => {
    const signed = signedTotal(entries);
    const confirmed = confirmedTotal(entries);
    return { label, entries, signed, confirmed, signedComplete: atHundred(signed), backupSecured: atHundred(confirmed) };
  };
  if (isLayered(program)) {
    return program.layers.map((layer, i) => unit(`Layer ${i + 1} · ${layerLabel(layer, fmt)}`, layer.markets || []));
  }
  return [unit("Panel", program.marketConfirmations || [])];
}

/**
 * Whether the slip is fully signed (100% on every unit) — the preparer's test
 * before submitting for approval.
 * @returns {{ complete: boolean, reason: string|null }}
 */
export function signedLinesComplete(program) {
  const units = capacityUnits(program);
  if (!panelEntries(program).length) return { complete: false, reason: "Name at least one market on the slip before submitting it." };
  if (isLayered(program) && program.layers.some((l) => !(l.markets || []).length)) {
    const i = program.layers.findIndex((l) => !(l.markets || []).length);
    return { complete: false, reason: `Layer ${i + 1} has no markets. Every layer needs its own panel.` };
  }
  const short = units.find((u) => !u.signedComplete);
  if (short) {
    const where = units.length > 1 ? `${short.label} is` : "Signed lines total";
    return { complete: false, reason: `${where} ${short.signed.toFixed(0)}%. Every ${units.length > 1 ? "layer" : "slip"} must be placed at exactly 100% before it goes for approval.` };
  }
  return { complete: true, reason: null };
}

/**
 * Backup secured: every unit has confirmed signed lines totalling exactly 100%.
 * Market capacity, not cedant approval — the cedant has not seen a proposal yet.
 */
export function backupSecured(program) {
  const units = capacityUnits(program);
  return units.length > 0 && panelEntries(program).length > 0 && units.every((u) => u.backupSecured);
}

/** True once at least one market has answered the slip. */
export const anyResponded = (program) =>
  panelEntries(program).some((mc) => mc.s && mc.s !== "Sent");

/** How the panel is responding, counted across every unit. */
export function responseProgress(program) {
  const entries = panelEntries(program);
  const by = (status) => entries.filter((mc) => mc.s === status);
  const names = (list) => [...new Set(list.map((mc) => mc.m))];
  const confirmed = by("Confirmed");
  const queried = by("Queried");
  const declined = by("Declined");
  const awaiting = entries.filter((mc) => !mc.s || mc.s === "Sent" || mc.s === "Reviewing" || mc.s === "Quoted");
  return {
    total: entries.length,
    confirmed: confirmed.length,
    queried: queried.length,
    declined: declined.length,
    awaiting: awaiting.length,
    queriedNames: names(queried),
    declinedNames: names(declined),
    awaitingNames: names(awaiting),
  };
}

/**
 * Whether a broker may record `next` against an allocation currently at `current`.
 * An unset response counts as Sent.
 */
export function canRecordResponse(current, next) {
  return (MARKET_RESPONSE_NEXT[current || "Sent"] || []).includes(next);
}
