/**
 * In-memory application state.
 *
 * The seed arrays under js/data/ are the fixtures; this module owns the live,
 * mutable copies plus the document-numbering sequences. Views read from the
 * store, services write to it — nothing else mutates these arrays.
 *
 * Swapping the prototype for a real backend means replacing this module's
 * getters with fetches; no view or domain module changes.
 */
import { programs as seedPrograms } from "../data/programs.data.js";
import { bordereaux as seedBordereaux } from "../data/bordereaux.data.js";
import { claims as seedClaims } from "../data/claims.data.js";
import { financeDocs as seedFinanceDocs } from "../data/finance.data.js";
import { intakes as seedIntakes } from "../data/intakes.data.js";
import {
  treatyAgreements as seedAgreements, premiumBordereaux as seedPremiumBdx, claimsBordereaux as seedClaimsBdx,
  treatyCessions as seedCessions, technicalAccounts as seedAccounts, treatySettlements as seedSettlements,
} from "../data/treaty.data.js";
import { PORTAL_CEDANT } from "./config.js";
import {
  cedants as seedCedants, markets as seedMarkets,
  brokers as seedBrokers, others as seedOthers,
} from "../data/counterparties.data.js";
import {
  referenceCedants, referenceReinsurers, referenceSyndicates,
  referenceBrokers, referenceOthers,
} from "../data/reference.data.js";


/**
 * Build a registry category from the demo book plus imported reference data.
 *
 * The demo entries come first and win any name clash: the placements, claims
 * and finance documents all point at them by name, so an import must never
 * displace one. Everything is then sorted so the list reads as a directory —
 * with 400+ cedants, alphabetical order plus search is the only usable shape.
 */
function register(...sources) {
  const byName = new Map();
  sources.flat().forEach((entry) => {
    const key = entry.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { ...entry });
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const state = {
  programs: seedPrograms.map((p) => ({ ...p })),
  bordereaux: seedBordereaux.map((b) => ({ ...b })),
  claims: seedClaims.map((c) => ({ ...c })),
  financeDocs: seedFinanceDocs.map((f) => ({ ...f })),
  /**
   * Counterparty registry. Names are referential keys across programs, claims
   * and finance documents, so entries are added but never renamed in place.
   */
  cedants: register(seedCedants, referenceCedants),
  markets: register(seedMarkets, referenceReinsurers, referenceSyndicates),
  brokers: register(seedBrokers, referenceBrokers),
  others: register(seedOthers, referenceOthers),
  /**
   * The broker intake queue — every request for cover before it is a
   * placement, whatever channel it arrived by. Mutated only through
   * services/intake.service.js.
   */
  intakes: seedIntakes.map((i) => ({ ...i, history: [...(i.history || [])] })),
  /** Risks the cedant portal has sent that the desk has not yet picked up. */
  pendingSubmissions: [],
  /**
   * Treaty administration: agreements registered as master records and the
   * operational workstreams that reference them. Mutated only through
   * services/treaty.service.js.
   */
  /**
   * Billing: batches of premium documents (one cedant document plus a Closing
   * Slip per reinsurer) and the custom tax and levy rules applied to them.
   * Mutated only through services/billing.service.js. Nothing is seeded.
   */
  billing: { batches: [], taxRules: [], brokerAccounts: [] },
  treaty: {
    agreements: seedAgreements.map((a) => JSON.parse(JSON.stringify(a))),
    premiumBordereaux: seedPremiumBdx.map((b) => ({ ...b })),
    claimsBordereaux: seedClaimsBdx.map((b) => ({ ...b })),
    cessions: seedCessions.map((c) => ({ ...c })),
    technicalAccounts: seedAccounts.map((t) => ({ ...t })),
    settlements: seedSettlements.map((s) => ({ ...s })),
  },
  /**
   * The signed-in user, or null before sign-in. Identity is no longer a
   * dropdown: whose authority applies, and which portal opens, both follow
   * from who signed in.
   */
  session: null,
};

/** The signed-in user. Null until sign-in completes. */
export const currentUser = () => state.session;

/** Which workspace the signed-in user belongs to: "broker" | "cedant". */
export const currentPortal = () => state.session?.portal ?? "broker";

/**
 * Whose book the cedant portal shows — the signed-in cedant, falling back to
 * the configured default so the portal still renders if opened without one.
 */
export const currentCedant = () => state.session?.cedant ?? PORTAL_CEDANT;

/** Document and program numbering, continuing from the seeded data. */
export const sequences = {
  invoice: 2033,
  creditNote: 115,
  debitNote: 88,
  claim: 5,
  bordereau: 5,
  program: 1008,
  intake: 1003,
  premiumBdx: 36, claimsBdx: 22, cession: 110, account: 15, settlement: 226,
  billingBatch: 1, closingSlip: 1,
};
export const nextBillingBatchRef = () => "BB-" + String(sequences.billingBatch++).padStart(4, "0");
export const nextClosingSlipNo = () => "CS-" + String(sequences.closingSlip++).padStart(4, "0");
export const nextTreatyRef = (kind) => ({
  premiumBdx: () => "PB-" + String(sequences.premiumBdx++).padStart(4, "0"),
  claimsBdx: () => "CB-" + String(sequences.claimsBdx++).padStart(4, "0"),
  cession: () => "DC-" + String(sequences.cession++).padStart(4, "0"),
  account: () => "TAC-2026-" + String(sequences.account++).padStart(3, "0"),
  settlement: () => "ST-" + String(sequences.settlement++).padStart(4, "0"),
}[kind]());

/** A treaty agreement by its agreement number. */
export const agreementById = (id) => state.treaty.agreements.find((a) => a.id === id);

export const nextInvoiceNo = () => "INV-" + sequences.invoice++;
export const nextCreditNoteNo = () => "CN-" + String(sequences.creditNote++).padStart(4, "0");
export const nextDebitNoteNo = () => "DN-" + String(sequences.debitNote++).padStart(4, "0");
export const nextProgramId = () => "P-" + sequences.program++;
export const nextIntakeId = () => "IN-" + sequences.intake++;

/** Look an intake up by its id. */
export const intakeById = (id) => state.intakes.find((i) => i.id === id);

/** A cedant's registry record, by the name a program refers to it by. */
export const cedantNamed = (name) =>
  state.cedants.find((c) => c.name === name);

/** Look a program up by its id. */
export const programById = (id) => state.programs.find((p) => p.id === id);

/** "P-1002 · Pacífico General QS" → "P-1002". */
export const programIdFromLabel = (label) => (label || "").split(" ")[0];

/** Every program placed for one cedant — the portal's read-only slice. */
export const programsForCedant = (cedant) =>
  state.programs.filter((p) => p.cedant === cedant);

/**
 * Underwriting markets split by form. These are functions, not cached arrays,
 * so a market added to the registry shows up everywhere immediately.
 */
export const reinsuranceCompanies = () =>
  state.markets.filter((m) => m.type === "Reinsurance");
export const lloydsSyndicates = () =>
  state.markets.filter((m) => m.type === "Lloyds Syndicate");

/** Every counterparty the desk knows, across all categories. */
export const allCounterparties = () =>
  [...state.cedants, ...state.markets, ...state.brokers, ...state.others];

/** Case-insensitive name lookup — names must be unique across the registry. */
export const counterpartyNamed = (name) =>
  allCounterparties().find((c) => c.name.toLowerCase() === String(name).trim().toLowerCase());
