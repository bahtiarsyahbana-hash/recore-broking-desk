/**
 * Intake — a request for cover before it is a placement. One model for every
 * channel: a broker typing up a phone call today, the cedant portal, an email
 * integration later. All of them land in the same broker queue.
 *
 * Lifecycle: Draft → Received → Under Review → Accepted | Revision Requested |
 * Declined → Converted to Placement. Accepting freezes the intake; converting
 * links it to the placement it became. Pure rules; the service applies them.
 */

export const INTAKE_STATUSES = [
  "Draft", "Received", "Under Review", "Accepted", "Revision Requested", "Declined", "Converted to Placement",
];

export const INTAKE_SOURCES = ["manual", "portal", "email"];
export const INTAKE_CHANNELS = ["email", "phone", "WhatsApp", "meeting", "other"];
/** New placements offer only these forms. Historical Facultative and Surplus records stay readable. */
export const PLACEMENT_TYPES = ["Quota Share", "Excess of Loss"];
/** Existing records in these forms remain editable when a genuine revision is required. */
export const HISTORICAL_PLACEMENT_TYPES = ["Facultative", "Surplus"];
export const EDITABLE_PLACEMENT_TYPES = [...PLACEMENT_TYPES, ...HISTORICAL_PLACEMENT_TYPES];
/**
 * Payment warranty options, in days. Structured, not free text, and never
 * defaulted: a slip carries the period the parties agreed or it carries none.
 * The period's start date (inception, invoice, bind or other) is undecided
 * and is deliberately not modelled — only the number of days is stored.
 */
export const PAYMENT_WARRANTY_DAYS = [15, 30, 45, 60, 90];

/** True only for an explicit, supported number of days. Null, blank and anything else fail. */
export function isValidPaymentWarranty(days) {
  if (days == null || days === "" || typeof days === "boolean") return false;
  const n = typeof days === "number" ? days : Number(String(days).trim());
  return Number.isInteger(n) && PAYMENT_WARRANTY_DAYS.includes(n);
}

/** Where an intake may go next, by broker action. */
export const INTAKE_TRANSITIONS = {
  "Draft": ["Received"],
  "Received": ["Under Review"],
  "Under Review": ["Accepted", "Revision Requested", "Declined"],
  "Revision Requested": ["Under Review", "Declined"],
  "Accepted": ["Converted to Placement"],
  "Declined": [],
  "Converted to Placement": [],
};

export const canTransitionIntake = (from, to) => (INTAKE_TRANSITIONS[from] || []).includes(to);

/** Frozen once a decision is taken: the record is then an audit reference, not a working document. */
export const intakeEditable = (intake) => ["Draft", "Received", "Under Review", "Revision Requested"].includes(intake.status);

export const intakeOpen = (intake) => !["Declined", "Converted to Placement"].includes(intake.status);

/**
 * What must be true before an intake can be accepted and worked up into a
 * placement draft. Returns the blocking findings; empty means ready.
 */
export function intakeReadiness(intake) {
  const findings = [];
  if (!intake.cedant) findings.push("Name the cedant.");
  if (!intake.insuredName) findings.push("Name the insured.");
  if (!intake.cls) findings.push("Choose the class of business.");
  if (!PLACEMENT_TYPES.includes(intake.requestedType)) findings.push("Requested placement type must be Quota Share or Excess of Loss.");
  if (!(Number(intake.sumInsured) > 0)) findings.push("Enter a sum insured greater than zero.");
  if (!intake.ccy) findings.push("Choose the currency.");
  if (!isValidPaymentWarranty(intake.paymentWarrantyDays)) {
    findings.push(`Choose the agreed payment warranty: ${PAYMENT_WARRANTY_DAYS.join(", ")} days.`);
  }
  return findings;
}

/**
 * The structured data an accepted intake hands to the placement draft. Copying
 * rather than referencing keeps the intake immutable once the placement starts
 * changing.
 */
export function intakeToDraft(intake) {
  return {
    cedant: intake.cedant,
    cls: intake.cls,
    type: intake.requestedType,
    ccy: intake.ccy,
    terms: {
      insured: intake.insuredName,
      sumInsured: Number(intake.sumInsured) || 0,
      rate: intake.rate == null || intake.rate === "" ? null : Number(intake.rate),
      paymentWarrantyDays: isValidPaymentWarranty(intake.paymentWarrantyDays) ? Number(intake.paymentWarrantyDays) : null,
    },
    intakeRef: intake.id,
  };
}

/**
 * Intakes that belong on the Placements board's Intake column: open ones only
 * (converted and declined have left the queue), narrowed by the board's type
 * filter when one is set. Pure, so the board and its test share one rule.
 */
export function boardIntakes(intakes, typeFilter = "all") {
  return (intakes || [])
    .filter(intakeOpen)
    .filter((i) => typeFilter === "all" || i.requestedType === typeFilter);
}
