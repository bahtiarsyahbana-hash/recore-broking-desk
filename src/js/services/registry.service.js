/**
 * Registry service — the only writer to the counterparty address book.
 *
 * Counterparty names are referential keys: a program's `cedant`, a market
 * confirmation's `m`, and a finance document's `counterparty` all point at a
 * registry entry by name and nothing else. So the one rule this service
 * enforces above all others is that a name is unique across every category —
 * two counterparties sharing a name would silently merge their placements,
 * confirmations and invoices.
 */
import { state, counterpartyNamed, allCounterparties } from "../core/store.js";
import { emit, TOPICS } from "../core/events.js";

/** Which state list each registry category writes to. */
const COLLECTIONS = {
  "reg-cedants":     "cedants",
  "reg-reinsurance": "markets",
  "reg-syndicates":  "markets",
  "reg-brokers":     "brokers",
  "reg-others":      "others",
};

/**
 * Cross-record validation: the checks that need to see the rest of the book,
 * rather than just the value in front of them.
 *
 * Per-field rules (required, LEI checksum, email format) run in the form layer
 * before this is reached.
 *
 * @returns {Record<string,string>} field name → error message; empty when valid
 */
export function validateCounterparty(categoryId, record) {
  const errors = {};

  const name = String(record.name ?? "").trim();
  if (name.length < 2) {
    errors.name = "Name is too short to identify a counterparty.";
  } else if (counterpartyNamed(name)) {
    // Checked across every category, not just this one.
    errors.name = `"${name}" is already on the registry. Names must be unique across all categories.`;
  }

  // An LEI identifies one legal entity — two records sharing one is a mistake,
  // even when the names differ.
  const lei = String(record.lei ?? "").trim().toUpperCase();
  if (lei) {
    const clash = allCounterparties().find(
      (c) => String(c.lei ?? "").trim().toUpperCase() === lei,
    );
    if (clash) errors.lei = `This LEI already identifies "${clash.name}".`;
  }

  // Likewise a Lloyd's syndicate number.
  const syndicateNo = String(record.syndicateNo ?? "").trim();
  if (syndicateNo) {
    const clash = allCounterparties().find(
      (c) => String(c.syndicateNo ?? "").trim() === syndicateNo,
    );
    if (clash) errors.syndicateNo = `Syndicate ${syndicateNo} is already on the registry as "${clash.name}".`;
  }

  return errors;
}

/**
 * Add a counterparty to its category.
 *
 * @param {string} categoryId  a REGISTRY_CATEGORIES id
 * @param {object} record      already-validated field values
 * @returns {object} the stored record
 * @throws when the category is unknown — a programming error, not user input
 */
export function addCounterparty(categoryId, record) {
  const collection = COLLECTIONS[categoryId];
  if (!collection) throw new Error(`Unknown registry category: ${categoryId}`);

  // Trim every string so a stray space cannot create a near-duplicate key, and
  // drop the blanks — an untouched optional field should leave no trace.
  const stored = Object.fromEntries(
    Object.entries(record)
      .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
      .filter(([, v]) => v !== "" && v != null),
  );
  if (stored.lei) stored.lei = stored.lei.toUpperCase();

  // Newest first, so an operator sees what they just added without scrolling.
  state[collection].unshift(stored);
  emit(TOPICS.REGISTRY, { categoryId, record: stored });
  return stored;
}
