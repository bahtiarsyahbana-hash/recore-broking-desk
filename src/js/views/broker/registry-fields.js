/**
 * Counterparty form schemas.
 *
 * What each category asks for, and why — split into what the desk genuinely
 * cannot operate without (required, always visible) and what it fills in over
 * time (optional, in collapsible sections).
 *
 * The required set is deliberately small. Every field here earns its place from
 * one of three things:
 *
 *  · Regulatory reporting. The PRA's IR.31.01 / Solvency II S.31.01 outwards
 *    reinsurance templates identify each reinsurer by a code in priority order
 *    — LEI (ISO 17442), then Lloyd's Syndicate Code, then an internal code —
 *    alongside its country, external rating and the collateral held against it.
 *  · Credit for reinsurance. Under the NAIC model law a reinsurer's domicile
 *    and certified / reciprocal-jurisdiction status determine how much
 *    collateral it must post, so domicile is required and security status is
 *    captured rather than assumed.
 *  · How a placement actually runs. A reinsurance counterparty does not have
 *    one contact: placement, claims and technical accounting are handled by
 *    different people, and a broker that only holds the underwriter's address
 *    cannot chase a claim or a settlement.
 */
import { todayISO } from "../../core/config.js";
import {
  isValidLEI, isValidSyndicateNumber, isValidEmail, isValidPhone,
} from "../../domain/counterparty.js";

/* ---------- shared vocabularies ---------- */

/** Security ratings the desk recognises, strongest first. */
export const RATINGS = [
  "AAA (S&P)", "AA+ (S&P)", "AA (S&P)", "AA- (S&P)",
  "A+ (S&P)", "A (S&P)", "A- (S&P)",
  "A++ (AM Best)", "A+ (AM Best)", "A (AM Best)", "A- (AM Best)",
  "B++ (AM Best)", "B+ (AM Best)", "B (AM Best)",
  "Not rated",
];

/** Panels a market can be placed on. */
export const PANELS = [
  "Property Cat", "Global Treaty", "LatAm Treaty", "SEA Treaty",
  "Marine & Cargo", "Energy & Property", "Regional Property", "Casualty Treaty",
];

/** Counterparty forms recognised by the PRA outwards reinsurance return. */
export const MARKET_FORMS = [
  "External / third party",
  "Intra-group / related party",
  "Special purpose vehicle",
  "Captive",
  "State reinsurer or pool",
];

/**
 * Collateral mitigating counterparty default risk — the categories the PRA
 * return splits out, and what NAIC credit-for-reinsurance turns on.
 */
export const COLLATERAL_TYPES = [
  "None — unsecured",
  "Trust fund",
  "Letter of credit",
  "Cash deposit",
  "Funds withheld",
];

export const SETTLEMENT_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "SGD", "IDR", "MYR", "THB", "AUD", "JPY"];
export const PAYMENT_TERMS = ["30 days", "45 days", "60 days", "90 days", "Quarterly in arrears", "At inception"];
export const KYC_STATUSES = ["Current", "Review due", "Not assessed"];
export const COUNTERPARTY_STATUSES = ["Active", "Review due", "Suspended"];

/* ---------- reusable field builders ---------- */

const emailField = (name, label, extra = {}) => ({
  name, label, type: "email", placeholder: "name@company.com",
  validate: (v) => isValidEmail(v) ? null : "Enter a valid email address.",
  ...extra,
});

const phoneField = (name, label, extra = {}) => ({
  name, label, type: "tel", placeholder: "+62 21 5555 0100",
  validate: (v) => isValidPhone(v) ? null : "Enter a valid phone number.",
  ...extra,
});

/** The referential key. Everything else in the system points here by name. */
const nameField = (placeholder, hint) => ({
  name: "name", label: "Legal name", type: "text", required: true,
  placeholder, hint: hint || "As it should appear on every slip, invoice and claim.",
});

const countryField = (suggestions, extra = {}) => ({
  name: "country", label: "Country of domicile", type: "text", required: true,
  placeholder: "e.g. Indonesia", suggestions,
  hint: "Drives regulatory treatment and collateral requirements.",
  ...extra,
});

/**
 * LEI is optional because not every counterparty has published one, but it is
 * checksum-validated when given — a mistyped LEI is worse than none at all,
 * since it will be reported as though it were real.
 */
const leiField = {
  name: "lei", label: "LEI", type: "text",
  placeholder: "20 characters, e.g. 529900T8BM49AURSDO55",
  hint: "ISO 17442 Legal Entity Identifier. The primary counterparty code on regulatory returns.",
  validate: (v) => isValidLEI(v)
    ? null
    : "Not a valid LEI — 20 alphanumeric characters with a correct ISO 7064 check.",
};

/** Contacts: who to call for placement, claims and money. */
const contactSection = (sectionName = "Primary contact (PIC)") => [
  { name: "contactName", label: "Contact name", type: "text", placeholder: "e.g. Rina Hartono", section: sectionName },
  { name: "contactTitle", label: "Job title", type: "text", placeholder: "e.g. Head of Treaty", section: sectionName, half: true },
  phoneField("contactPhone", "Phone", { section: sectionName, half: true }),
  emailField("contactEmail", "Email", { section: sectionName }),
  { name: "address", label: "Registered address", type: "textarea", rows: 2, placeholder: "Street, building, city", section: sectionName },
  { name: "postalCode", label: "Postal code", type: "text", placeholder: "e.g. 12190", section: sectionName, half: true,
    validate: (v) => (/^[A-Za-z0-9 -]{3,10}$/.test(v) ? null : "Postal code is 3–10 letters or digits.") },
];

/**
 * Claims and accounting run on different desks from placement, so they get
 * their own addresses rather than sharing the underwriter's.
 */
const functionalContactsSection = [
  { name: "claimsContactName", label: "Claims contact", type: "text", placeholder: "Name", section: "Claims & accounting contacts", half: true },
  emailField("claimsContactEmail", "Claims email", { section: "Claims & accounting contacts", half: true }),
  { name: "accountsContactName", label: "Technical accounting contact", type: "text", placeholder: "Name", section: "Claims & accounting contacts", half: true },
  emailField("accountsContactEmail", "Accounting email", { section: "Claims & accounting contacts", half: true }),
];

const settlementSection = (extra = []) => [
  {
    name: "settlementCurrency", label: "Settlement currency", type: "select",
    options: SETTLEMENT_CURRENCIES, value: "USD",
    section: "Settlement & security", half: true,
  },
  {
    name: "paymentTerms", label: "Payment terms", type: "select",
    options: PAYMENT_TERMS, value: "30 days",
    section: "Settlement & security", half: true,
  },
  ...extra,
  { name: "notes", label: "Notes", type: "textarea", rows: 2, placeholder: "Anything the desk should know — appetite, restrictions, history.", section: "Settlement & security" },
];

/* ---------- per-category schemas ---------- */

/**
 * Build the field list for one registry category.
 * @param {string} categoryId
 * @param {string[]} countrySuggestions countries already on the registry
 */
export function fieldsFor(categoryId, countrySuggestions = []) {
  const country = countryField(countrySuggestions);

  switch (categoryId) {
    case "reg-cedants":
      return [
        nameField("e.g. Sumatra Mutual Insurance"),
        country,
        { name: "kyc", label: "KYC status", type: "select", options: KYC_STATUSES, value: "Current", half: true },
        { name: "refreshed", label: "KYC last refreshed", type: "date", value: todayISO(), half: true },
        leiField,
        ...contactSection(),
        ...functionalContactsSection,
        ...settlementSection([
          { name: "regulator", label: "Home regulator", type: "text", placeholder: "e.g. OJK", section: "Settlement & security", half: true },
          { name: "licenceNo", label: "Licence number", type: "text", placeholder: "Optional", section: "Settlement & security", half: true },
        ]),
      ];

    case "reg-reinsurance":
      return [
        nameField("e.g. Andaman Continental Re"),
        country,
        { name: "rating", label: "Security rating", type: "select", options: RATINGS, value: "A (S&P)", half: true },
        { name: "panel", label: "Panel", type: "select", options: PANELS, value: "Global Treaty", half: true },
        leiField,
        ...contactSection(),
        ...functionalContactsSection,
        ...settlementSection([
          {
            name: "marketForm", label: "Counterparty form", type: "select",
            options: MARKET_FORMS, value: MARKET_FORMS[0],
            section: "Settlement & security",
            hint: "Reported on the outwards reinsurance return; intra-group and captive exposures are treated differently.",
          },
          {
            name: "collateral", label: "Collateral held", type: "select",
            options: COLLATERAL_TYPES, value: COLLATERAL_TYPES[0],
            section: "Settlement & security", half: true,
          },
          { name: "ratingAsAt", label: "Rating as at", type: "date", section: "Settlement & security", half: true },
        ]),
        // This page only ever writes company-form markets.
        { name: "type", label: "", type: "hidden", value: "Reinsurance" },
        { name: "capacity", label: "", type: "hidden", value: 0 },
      ];

    case "reg-syndicates":
      return [
        nameField("e.g. Harcourt Re · Syndicate 4242", "Managing agent, then the syndicate number."),
        {
          name: "syndicateNo", label: "Syndicate number", type: "text", required: true,
          placeholder: "4 digits, e.g. 1918", half: true,
          hint: "Reported as LSY/XXXX, which takes priority over an LEI.",
          validate: (v) => isValidSyndicateNumber(v) ? null : "A Lloyd's syndicate number is exactly four digits.",
        },
        { name: "rating", label: "Security rating", type: "select", options: RATINGS, value: "A+ (AM Best)", half: true },
        { name: "panel", label: "Panel", type: "select", options: PANELS, value: "Property Cat", half: true },
        { name: "managingAgent", label: "Managing agent", type: "text", placeholder: "e.g. Harcourt Underwriting Ltd", half: true },
        ...contactSection(),
        ...functionalContactsSection,
        ...settlementSection([
          { name: "ratingAsAt", label: "Rating as at", type: "date", section: "Settlement & security", half: true },
        ]),
        { name: "country", label: "", type: "hidden", value: "United Kingdom" },
        { name: "type", label: "", type: "hidden", value: "Lloyds Syndicate" },
        { name: "capacity", label: "", type: "hidden", value: 0 },
      ];

    case "reg-brokers":
      return [
        nameField("e.g. Palawan Re Brokers"),
        country,
        {
          name: "role", label: "Role", type: "select", half: true,
          options: ["Co-broker", "Local placement partner", "Wholesale broker"],
          value: "Co-broker",
        },
        { name: "status", label: "Status", type: "select", options: COUNTERPARTY_STATUSES, value: "Active", half: true },
        {
          name: "commissionSplit", label: "Default commission split %", type: "number",
          placeholder: "e.g. 30",
          hint: "Share of brokerage on a co-broked slip. Leave blank to agree per placement.",
          validate: (v) => (+v >= 0 && +v <= 100) ? null : "Enter a share between 0 and 100.",
        },
        leiField,
        ...contactSection(),
        ...settlementSection([
          { name: "regulator", label: "Home regulator", type: "text", placeholder: "e.g. FCA", section: "Settlement & security", half: true },
          { name: "licenceNo", label: "Broking licence number", type: "text", placeholder: "Optional", section: "Settlement & security", half: true },
        ]),
      ];

    case "reg-others":
      return [
        nameField("e.g. Coral Bay Loss Adjusters"),
        country,
        {
          name: "role", label: "Role", type: "select", half: true,
          options: [
            "Claims TPA", "Cat modeling vendor", "Actuarial consultancy",
            "Captive reinsurer", "Loss adjuster", "Legal adviser", "Auditor",
          ],
          value: "Claims TPA",
        },
        { name: "status", label: "Status", type: "select", options: COUNTERPARTY_STATUSES, value: "Active", half: true },
        ...contactSection(),
        ...settlementSection(),
      ];

    default:
      throw new Error(`No field schema for registry category: ${categoryId}`);
  }
}
