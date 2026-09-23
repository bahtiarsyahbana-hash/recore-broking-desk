/**
 * Counterparty profile — the parts of a registry record that grow over time:
 * the people in charge (PICs) by the division they handle, and the bank
 * accounts money settles through.
 *
 * A reinsurance counterparty never has one contact. Placement, claims,
 * technical accounting and compliance are different desks with different
 * people, and more than one person can handle a division. So a record carries
 * `pics: [{ id, name, title, division, email, phone, primary, notes }]` and
 * `bankAccounts: [{ id, bankName, accountName, accountNo, swift, iban, ccy,
 * branch, primary, notes }]`.
 *
 * Records written before this existed carry single contact fields
 * (`contactName`, `claimsContactName`, `accountsContactName`, …). They are
 * folded into the PIC list on read, so nothing is migrated and nothing is lost.
 *
 * Pure functions — no DOM, no state.
 */
import { isValidEmail, isValidPhone } from "./counterparty.js";

/** Divisions a PIC can handle, in the order a profile lists them. */
export const DIVISIONS = [
  "Placement / Underwriting",
  "Claims",
  "Technical Accounting / Finance",
  "Compliance / KYC",
  "Management",
  "Other",
];

/** Legacy single-contact fields, and the division each one implied. */
const LEGACY_CONTACTS = [
  { name: "contactName", title: "contactTitle", email: "contactEmail", phone: "contactPhone", division: "Placement / Underwriting", primary: true },
  { name: "claimsContactName", email: "claimsContactEmail", division: "Claims" },
  { name: "accountsContactName", email: "accountsContactEmail", division: "Technical Accounting / Finance" },
];

/**
 * Every PIC on the record: the structured list plus any legacy contact fields
 * not already represented in it. Legacy entries carry `legacy: true` and an id
 * derived from their field, so the drawer can still edit or remove them (which
 * converts them into structured PICs).
 */
export function picsOf(entry) {
  const structured = Array.isArray(entry?.pics) ? entry.pics : [];
  const dropped = new Set(entry?.legacyContactsDropped || []);
  const known = new Set(structured.map((p) => `${p.name}`.toLowerCase()));
  const legacy = LEGACY_CONTACTS
    .filter((f) => entry?.[f.name] && !dropped.has(f.name) && !known.has(String(entry[f.name]).toLowerCase()))
    .map((f) => ({
      id: `legacy:${f.name}`, legacy: true,
      name: entry[f.name], title: f.title ? entry[f.title] || "" : "",
      division: f.division, email: f.email ? entry[f.email] || "" : "", phone: f.phone ? entry[f.phone] || "" : "",
      primary: Boolean(f.primary), notes: "",
    }));
  return [...structured, ...legacy];
}

/** PICs grouped by division, in DIVISIONS order; empty divisions are omitted. */
export function picsByDivision(entry) {
  const pics = picsOf(entry);
  return DIVISIONS
    .map((division) => ({ division, pics: pics.filter((p) => (p.division || "Other") === division) }))
    .filter((g) => g.pics.length);
}

/** Validation for one PIC. Returns field → message; empty when valid. */
export function validatePic(pic) {
  const errors = {};
  if (!String(pic.name || "").trim()) errors.name = "Name the person.";
  if (!DIVISIONS.includes(pic.division)) errors.division = "Choose the division they handle.";
  if (pic.email && !isValidEmail(pic.email)) errors.email = "Enter a valid email address.";
  if (pic.phone && !isValidPhone(pic.phone)) errors.phone = "Enter a valid phone number.";
  if (!pic.email && !pic.phone) errors.email = "Give at least one way to reach them — email or phone.";
  return errors;
}

/* ---- bank accounts --------------------------------------------------- */

/** SWIFT/BIC: 8 or 11 characters — bank, country, location, optional branch. */
export const isValidSwift = (value) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(value || "").trim().toUpperCase());

/** IBAN: country code, two check digits, up to 30 alphanumerics. Format only. */
export const isValidIban = (value) => /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(String(value || "").replace(/\s+/g, "").toUpperCase());

/** Account numbers vary by country; accept 6–34 alphanumerics. */
export const isValidAccountNo = (value) => /^[A-Z0-9-]{6,34}$/i.test(String(value || "").replace(/\s+/g, ""));

/** Validation for one bank account. Returns field → message; empty when valid. */
export function validateBankAccount(account) {
  const errors = {};
  if (!String(account.bankName || "").trim()) errors.bankName = "Name the bank.";
  if (!String(account.accountName || "").trim()) errors.accountName = "Name the account holder as the bank knows it.";
  if (!account.accountNo && !account.iban) errors.accountNo = "Give an account number or an IBAN.";
  if (account.accountNo && !isValidAccountNo(account.accountNo)) errors.accountNo = "Account number should be 6–34 letters or digits.";
  if (account.iban && !isValidIban(account.iban)) errors.iban = "Not a valid IBAN format.";
  if (account.swift && !isValidSwift(account.swift)) errors.swift = "SWIFT/BIC is 8 or 11 characters, e.g. BMRIIDJA.";
  if (!String(account.ccy || "").trim()) errors.ccy = "Choose the account currency.";
  return errors;
}

/** Accounts on the record, primary first. */
export function bankAccountsOf(entry) {
  const list = Array.isArray(entry?.bankAccounts) ? entry.bankAccounts : [];
  return [...list].sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

/** Account number masked for display: last four visible. */
export function maskAccount(value) {
  const s = String(value || "").replace(/\s+/g, "");
  return s.length <= 4 ? s : `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

/** A one-line reading of how complete a profile is, for the registry row. */
export function profileSummary(entry) {
  const pics = picsOf(entry);
  const banks = bankAccountsOf(entry);
  const divisions = new Set(pics.map((p) => p.division || "Other"));
  return {
    pics: pics.length, divisions: divisions.size, bankAccounts: banks.length,
    hasBank: banks.length > 0, hasPic: pics.length > 0,
  };
}
