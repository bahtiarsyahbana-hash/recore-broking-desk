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
import { todayISO } from "../core/config.js";
import { validatePic, validateBankAccount } from "../domain/counterparty-profile.js";

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

/* ---- profile: edit, PICs, bank accounts ------------------------------- */

let profileSeq = 1;
const nextProfileId = (prefix) => `${prefix}-${Date.now().toString(36)}${(profileSeq++).toString(36)}`;

/** Which registry category a record sits in, from where the store holds it. */
export function categoryOf(record) {
  if (state.cedants.includes(record)) return "reg-cedants";
  if (state.markets.includes(record)) return record.type === "Lloyds Syndicate" ? "reg-syndicates" : "reg-reinsurance";
  if (state.brokers.includes(record)) return "reg-brokers";
  if (state.others.includes(record)) return "reg-others";
  return null;
}

function touch(record, what) {
  record.profileUpdated = todayISO();
  emit(TOPICS.REGISTRY, { categoryId: categoryOf(record), record, action: what });
  return record;
}

/**
 * Update a counterparty's company profile. The name is the referential key
 * every program, confirmation and invoice points at, so it cannot change here
 * — add a new record rather than rename. Blank strings clear a field.
 */
export function updateCounterparty(name, patch) {
  const record = counterpartyNamed(name);
  if (!record) return null;
  const { name: _ignored, pics, bankAccounts, ...fields } = patch || {};
  Object.entries(fields).forEach(([k, v]) => {
    const value = typeof v === "string" ? v.trim() : v;
    if (value === "" || value == null) delete record[k]; else record[k] = value;
  });
  if (record.lei) record.lei = String(record.lei).toUpperCase();
  return touch(record, "profile-updated");
}

/** Add a person in charge for a division. Several people may share a division. */
export function addPic(name, pic) {
  const record = counterpartyNamed(name);
  if (!record || Object.keys(validatePic(pic)).length) return null;
  record.pics = record.pics || [];
  const stored = { id: nextProfileId("pic"), ...clean(pic), primary: Boolean(pic.primary) };
  if (stored.primary) record.pics.forEach((p) => { if (p.division === stored.division) p.primary = false; });
  record.pics.push(stored);
  touch(record, "pic-added");
  return stored;
}

/**
 * Edit a PIC. Editing a legacy single-contact entry converts it into a
 * structured PIC and retires the old field from display.
 */
export function updatePic(name, picId, patch) {
  const record = counterpartyNamed(name);
  if (!record) return null;
  const merged = { ...(findPic(record, picId) || {}), ...clean(patch) };
  if (Object.keys(validatePic(merged)).length) return null;
  if (String(picId).startsWith("legacy:")) {
    retireLegacy(record, picId);
    record.pics = record.pics || [];
    const stored = { ...merged, id: nextProfileId("pic"), legacy: undefined };
    delete stored.legacy;
    record.pics.push(stored);
    touch(record, "pic-updated");
    return stored;
  }
  const pic = record.pics?.find((p) => p.id === picId);
  if (!pic) return null;
  Object.assign(pic, merged, { id: picId });
  if (pic.primary) record.pics.forEach((p) => { if (p !== pic && p.division === pic.division) p.primary = false; });
  touch(record, "pic-updated");
  return pic;
}

export function removePic(name, picId) {
  const record = counterpartyNamed(name);
  if (!record) return null;
  if (String(picId).startsWith("legacy:")) retireLegacy(record, picId);
  else record.pics = (record.pics || []).filter((p) => p.id !== picId);
  return touch(record, "pic-removed");
}

export function addBankAccount(name, account) {
  const record = counterpartyNamed(name);
  if (!record || Object.keys(validateBankAccount(account)).length) return null;
  record.bankAccounts = record.bankAccounts || [];
  const stored = normaliseBank({ id: nextProfileId("bank"), ...clean(account), primary: Boolean(account.primary) || record.bankAccounts.length === 0 });
  if (stored.primary) record.bankAccounts.forEach((b) => { b.primary = false; });
  record.bankAccounts.push(stored);
  touch(record, "bank-added");
  return stored;
}

export function updateBankAccount(name, accountId, patch) {
  const record = counterpartyNamed(name);
  const account = record?.bankAccounts?.find((b) => b.id === accountId);
  if (!account) return null;
  const merged = normaliseBank({ ...account, ...clean(patch), id: accountId });
  if (Object.keys(validateBankAccount(merged)).length) return null;
  Object.assign(account, merged);
  if (account.primary) record.bankAccounts.forEach((b) => { if (b !== account) b.primary = false; });
  touch(record, "bank-updated");
  return account;
}

export function removeBankAccount(name, accountId) {
  const record = counterpartyNamed(name);
  if (!record) return null;
  record.bankAccounts = (record.bankAccounts || []).filter((b) => b.id !== accountId);
  if (record.bankAccounts.length && !record.bankAccounts.some((b) => b.primary)) record.bankAccounts[0].primary = true;
  return touch(record, "bank-removed");
}

/* helpers */
const clean = (obj) => Object.fromEntries(
  Object.entries(obj || {}).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "" && v != null),
);
const normaliseBank = (b) => ({
  ...b,
  swift: b.swift ? String(b.swift).toUpperCase() : undefined,
  iban: b.iban ? String(b.iban).replace(/\s+/g, "").toUpperCase() : undefined,
  primary: b.primary === true || b.primary === "true" || b.primary === "on",
});
function findPic(record, picId) {
  if (String(picId).startsWith("legacy:")) {
    // Rebuild from the legacy fields the same way picsOf does.
    const field = picId.slice("legacy:".length);
    const map = {
      contactName: { title: record.contactTitle, email: record.contactEmail, phone: record.contactPhone, division: "Placement / Underwriting" },
      claimsContactName: { email: record.claimsContactEmail, division: "Claims" },
      accountsContactName: { email: record.accountsContactEmail, division: "Technical Accounting / Finance" },
    }[field];
    return map ? { name: record[field], ...map } : null;
  }
  return record.pics?.find((p) => p.id === picId) || null;
}
function retireLegacy(record, picId) {
  record.legacyContactsDropped = [...new Set([...(record.legacyContactsDropped || []), picId.slice("legacy:".length)])];
}
