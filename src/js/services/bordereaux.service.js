/**
 * Bordereaux service — receipt and matching of periodic premium and loss
 * bordereaux against treaty terms.
 */
import { state, sequences } from "../core/store.js";
import { emit, TOPICS } from "../core/events.js";

/** Programs that settle on a bordereau rather than a single premium. */
const BORDEREAU_PROGRAMS = [
  "P-1001 · Meridian Mutual",
  "P-1002 · Pacífico General",
  "P-1004 · Northwind",
  "P-1005 · Meridian Mutual",
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Receive a bordereau and run it against treaty terms. Anything that fails to
 * match — currency, period, or a risk outside the treaty — lands as an
 * Exception for the desk to work.
 */
export function receiveBordereau(entry = {}) {
  const record = {
    period: entry.period ?? "Q3 2026",
    program: entry.program ?? pick(BORDEREAU_PROGRAMS),
    type: entry.type ?? (Math.random() > 0.5 ? "Premium" : "Loss"),
    lines: entry.lines ?? Math.floor(20 + Math.random() * 180),
    amount: entry.amount ?? Math.floor(80_000 + Math.random() * 2_000_000),
    status: entry.status ?? (Math.random() > 0.25 ? "Matched" : "Exception"),
  };
  state.bordereaux.unshift(record);
  sequences.bordereau++;
  emit(TOPICS.BORDEREAUX, record);
  return record;
}
