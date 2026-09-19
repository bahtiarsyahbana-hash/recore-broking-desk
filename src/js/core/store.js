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
import {
  cedants as seedCedants, markets as seedMarkets,
  brokers as seedBrokers, others as seedOthers,
} from "../data/counterparties.data.js";
import { userForSeat, DEFAULT_SEAT } from "../domain/authority.js";

export const state = {
  programs: seedPrograms.map((p) => ({ ...p })),
  bordereaux: seedBordereaux.map((b) => ({ ...b })),
  claims: seedClaims.map((c) => ({ ...c })),
  financeDocs: seedFinanceDocs.map((f) => ({ ...f })),
  /**
   * Counterparty registry. Names are referential keys across programs, claims
   * and finance documents, so entries are added but never renamed in place.
   */
  cedants: seedCedants.map((c) => ({ ...c })),
  markets: seedMarkets.map((m) => ({ ...m })),
  brokers: seedBrokers.map((b) => ({ ...b })),
  others: seedOthers.map((o) => ({ ...o })),
  /** Risks the cedant portal has sent that the desk has not yet picked up. */
  pendingSubmissions: [],
  /** Active role: "broker" | "cedant". */
  role: "broker",
  /**
   * Which seat at the broker desk is acting: "broker" | "signatory".
   * Four-eyes on slip release turns on this, so it is state, not a preference.
   */
  seat: DEFAULT_SEAT,
};

/** The person currently at the desk. */
export const currentUser = () => userForSeat(state.seat);

/** Document and program numbering, continuing from the seeded data. */
export const sequences = {
  invoice: 2033,
  creditNote: 115,
  debitNote: 88,
  claim: 5,
  bordereau: 5,
  program: 1008,
};

export const nextInvoiceNo = () => "INV-" + sequences.invoice++;
export const nextCreditNoteNo = () => "CN-" + String(sequences.creditNote++).padStart(4, "0");
export const nextDebitNoteNo = () => "DN-" + String(sequences.debitNote++).padStart(4, "0");
export const nextProgramId = () => "P-" + sequences.program++;

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
