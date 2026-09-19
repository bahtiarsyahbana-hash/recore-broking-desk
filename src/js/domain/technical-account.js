/**
 * The running technical account per program — the audited statement of what the
 * desk owes, and is owed, on a placement.
 *
 * Default cession and commission terms by treaty type. A real desk would read
 * these from the slip; the prototype derives them so every program has an
 * account without a full terms record.
 */
const CESSION_BY_TYPE = { "Quota Share": 0.35, "Surplus": 0.55 };
const COMMISSION_BY_TYPE = { "Facultative": 0.20, "Excess of Loss": 0 };
const DEFAULT_COMMISSION = 0.27;
const BROKERAGE = 0.025;

/** Proportion of the program's premium that is ceded to the market. */
export function cessionRate(type) {
  return CESSION_BY_TYPE[type] ?? 1;
}

/** Ceding commission rate allowed back to the cedant. */
export function commissionRate(type) {
  return COMMISSION_BY_TYPE[type] ?? DEFAULT_COMMISSION;
}

/**
 * Technical account for one program, in the program's own currency.
 * @param {object} program
 */
export function technicalAccount(program) {
  const ceded = program.premium * cessionRate(program.type);
  const cedingCommission = ceded * commissionRate(program.type);
  const brokerage = ceded * BROKERAGE;
  const claims = program.loss;
  return {
    ceded,
    cedingCommission,
    brokerage,
    claims,
    net: ceded - cedingCommission - brokerage - claims,
  };
}
