/**
 * Billing — the premium documents a broker issues once risk is bound.
 *
 * Money flows cedant → broker → reinsurers. So one billing event produces:
 *   - one document to the cedant: an Invoice (or, for an endorsement, a Debit
 *     Note or Credit Note; for a treaty account in the cedant's favour, a
 *     Credit Note) for gross premium less commission, plus any tax the cedant
 *     bears;
 *   - one Closing Slip per reinsurer: its share of gross premium less its share
 *     of commission, less brokerage (deducted from the remittance — the broker
 *     keeps it), less any tax withheld from it.
 *
 * The whole event is a batch. It is prepared as a Draft, submitted, and issued
 * by a second authorised person (four-eyes); every document in it is numbered
 * at issue and never before. Issued documents are frozen — a correction is a
 * reversing credit note, never an edit.
 *
 * Pure: amounts in integer cents so shares always add back to the whole.
 */
import { isValidPaymentWarranty } from "./intake.js";
import { validateBankAccount } from "./counterparty-profile.js";

export const BATCH_STATUSES = ["Draft", "Pending Approval", "Issued", "Cancelled"];
export const DOC_TYPES = ["Invoice", "Debit Note", "Credit Note", "Closing Slip"];
export const DELIVERY = ["Issued", "Sent"];
export const SOURCE_KINDS = { bind: "Placement bind", endorsement: "Placement endorsement", treaty: "Treaty technical account", reversal: "Cancellation" };

/* ---- tax rules ----------------------------------------------------------- */

export const TAX_BASES = ["Gross premium", "Net premium", "Brokerage"];
export const TAX_BEARERS = ["Cedant", "Reinsurer", "Broker"];
export const TAX_APPLIES = ["Placement", "Treaty", "Both"];
export const TAX_JURISDICTION_OF = ["Cedant country", "Reinsurer country"];

/**
 * Validate a custom tax or levy rule. Nothing is seeded: the desk configures
 * the rules its tax adviser confirms.
 */
export function validateTaxRule(r = {}) {
  const errors = {};
  if (!String(r.name || "").trim()) errors.name = "Name the tax or levy.";
  const rate = Number(r.rate);
  if (r.rate === "" || r.rate == null || !Number.isFinite(rate) || rate < 0 || rate > 100) errors.rate = "Rate must be between 0 and 100%.";
  if (!TAX_BASES.includes(r.basis)) errors.basis = `Basis is one of ${TAX_BASES.join(", ")}.`;
  if (!TAX_BEARERS.includes(r.bearer)) errors.bearer = `Borne by ${TAX_BEARERS.join(", ")}.`;
  if (!TAX_APPLIES.includes(r.appliesTo)) errors.appliesTo = `Applies to ${TAX_APPLIES.join(", ")}.`;
  if (!TAX_JURISDICTION_OF.includes(r.jurisdictionOf)) errors.jurisdictionOf = "Choose whose country the rule follows.";
  return errors;
}

/** Whether a rule applies to this document context. `country` "" or "Any" matches everywhere. */
export function taxRuleApplies(rule, { sourceKind, cedantCountry, reinsurerCountry }) {
  if (!rule.active) return false;
  const line = sourceKind === "treaty" ? "Treaty" : "Placement";
  if (rule.appliesTo !== "Both" && rule.appliesTo !== line) return false;
  const want = String(rule.country || "").trim().toLowerCase();
  if (!want || want === "any") return true;
  const have = String(rule.jurisdictionOf === "Reinsurer country" ? reinsurerCountry : cedantCountry || "").trim().toLowerCase();
  return have === want;
}

/* ---- the broker's own bank accounts --------------------------------------- */

/**
 * What an account is used for. Collection: where cedants pay premium.
 * Remittance: what the broker pays reinsurers from. Both: either.
 */
export const ACCOUNT_PURPOSES = ["Collection", "Remittance", "Both"];

/** Validate one of the broker's accounts: the registry bank rules plus a purpose. */
export function validateBrokerAccount(a = {}) {
  const errors = validateBankAccount(a);
  if (!ACCOUNT_PURPOSES.includes(a.purpose)) errors.purpose = `Purpose is ${ACCOUNT_PURPOSES.join(", ")}.`;
  return errors;
}

/**
 * The account a cedant pays into for a document in `ccy`: active, used for
 * collection, in that currency, the primary one first. Null when none exists —
 * the desk has to add one rather than have a different currency's account
 * printed on the invoice.
 */
export function collectionAccountFor(accounts = [], ccy) {
  const eligible = accounts.filter((a) => a.active !== false && (a.purpose === "Collection" || a.purpose === "Both") && a.ccy === ccy);
  return eligible.find((a) => a.primary) || eligible[0] || null;
}

/** Whether the cedant pays the broker on this document (so it needs a pay-to account). */
export const cedantPays = (docType, totalCents) => totalCents > 0 && docType !== "Closing Slip";

/* ---- arithmetic ------------------------------------------------------------ */

export const toCents = (n) => Math.round((Number(n) || 0) * 100);
export const fromCents = (c) => c / 100;

/**
 * Split `totalCents` across weights so the parts add back exactly (largest
 * remainder). Negative totals split the same way.
 */
export function allocate(totalCents, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length || sum <= 0) return weights.map(() => 0);
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const raw = weights.map((w) => (abs * w) / sum);
  const floors = raw.map(Math.floor);
  let left = abs - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k][1]] += 1;
  return floors.map((x) => sign * x);
}

const pctOf = (cents, pct) => Math.round(cents * (Number(pct) || 0) / 100);

/**
 * Reinsurer weights for a placement: signed line on a horizontal panel, or —
 * for a layered tower — each layer's share of premium (apportioned by limit)
 * times the line on that layer, summed per reinsurer.
 */
export function placementWeights(program) {
  const byName = new Map();
  const add = (m, w) => byName.set(m, (byName.get(m) || 0) + w);
  if (Array.isArray(program.layers) && program.layers.length) {
    const total = program.layers.reduce((s, l) => s + (Number(l.limit) || 0), 0);
    program.layers.forEach((l) => {
      const layerShare = total > 0 ? (Number(l.limit) || 0) / total : 1 / program.layers.length;
      (l.markets || []).forEach((mc) => add(mc.m, layerShare * (Number(mc.line) || 0) / 100));
    });
  } else {
    (program.marketConfirmations || []).forEach((mc) => add(mc.m, (Number(mc.line) || 0) / 100));
  }
  return [...byName.entries()].filter(([, w]) => w > 0).map(([reinsurer, weight]) => ({ reinsurer, weight }));
}

/**
 * Compute the cedant document and one Closing Slip per reinsurer.
 *
 * @param {object} input
 * @param {"bind"|"endorsement"|"treaty"|"reversal"} input.sourceKind
 * @param {number} input.gross           gross premium (signed; negative for a return)
 * @param {number|null} input.commissionPct
 * @param {number} [input.commissionAmount]  absolute commission, used instead of the % (treaty accounts)
 * @param {number|null} input.brokeragePct
 * @param {number} [input.claims]        treaty only: claims set off in the account
 * @param {number} [input.accountTax]    treaty only: tax already in the technical account
 * @param {{reinsurer:string, weight:number, country?:string}[]} input.panel
 * @param {object[]} [input.taxRules]
 * @param {string} [input.cedantCountry]
 */
export function computeBilling({ sourceKind, gross, commissionPct, commissionAmount, brokeragePct, claims = 0, accountTax = 0, panel = [], taxRules = [], cedantCountry = "" }) {
  const G = toCents(gross);
  const C = commissionAmount != null ? toCents(commissionAmount) : pctOf(G, commissionPct);
  const B = pctOf(G, brokeragePct);
  const L = toCents(claims);
  const T = toCents(accountTax);
  const weights = panel.map((p) => p.weight);

  const gShares = allocate(G, weights);
  const cShares = allocate(C, weights);
  const bShares = allocate(B, weights);
  const lShares = allocate(L, weights);
  const tShares = allocate(T, weights);

  const baseCtx = { sourceKind, cedantCountry };
  const basisCents = (basis, g, c, b) => (basis === "Gross premium" ? g : basis === "Net premium" ? g - c : b);

  // Cedant-borne taxes are added to the cedant document; broker-borne are recorded only.
  const cedantTaxes = []; const brokerTaxes = [];
  taxRules.forEach((rule) => {
    if (!taxRuleApplies(rule, { ...baseCtx, reinsurerCountry: "" })) return;
    if (rule.bearer === "Cedant") cedantTaxes.push({ label: rule.name, rate: Number(rule.rate), basis: rule.basis, cents: pctOf(basisCents(rule.basis, G, C, B), rule.rate), ruleId: rule.id });
    if (rule.bearer === "Broker") brokerTaxes.push({ label: rule.name, rate: Number(rule.rate), basis: rule.basis, cents: pctOf(basisCents(rule.basis, G, C, B), rule.rate), ruleId: rule.id });
  });

  const cedantLines = [
    { kind: "premium", label: sourceKind === "treaty" ? "Premium" : "Gross premium", cents: G },
    ...(C ? [{ kind: "commission", label: commissionAmount != null ? "Less commission" : `Less commission (${Number(commissionPct)}%)`, cents: -C }] : []),
    ...(L ? [{ kind: "claims", label: "Less claims", cents: -L }] : []),
    ...(T ? [{ kind: "tax", label: "Less tax in account", cents: -T }] : []),
    ...cedantTaxes.map((t) => ({ kind: "tax", label: `${t.label} (${t.rate}% of ${t.basis.toLowerCase()})`, cents: t.cents, ruleId: t.ruleId })),
  ];
  const cedantTotal = cedantLines.reduce((s, l) => s + l.cents, 0);

  const slips = panel.map((p, i) => {
    const g = gShares[i], c = cShares[i], b = bShares[i], l = lShares[i], t = tShares[i];
    const withheld = taxRules
      .filter((rule) => rule.bearer === "Reinsurer" && taxRuleApplies(rule, { ...baseCtx, reinsurerCountry: p.country || "" }))
      .map((rule) => ({ kind: "tax", label: `Less ${rule.name} (${Number(rule.rate)}% of ${rule.basis.toLowerCase()})`, cents: -pctOf(basisCents(rule.basis, g, c, b), rule.rate), ruleId: rule.id }));
    const lines = [
      { kind: "premium", label: `${sourceKind === "treaty" ? "Premium" : "Gross premium"} — ${formatShare(p.weight)} share`, cents: g },
      ...(c ? [{ kind: "commission", label: "Less commission", cents: -c }] : []),
      ...(l ? [{ kind: "claims", label: "Less claims", cents: -l }] : []),
      ...(t ? [{ kind: "tax", label: "Less tax in account", cents: -t }] : []),
      ...(b ? [{ kind: "brokerage", label: `Less brokerage (${Number(brokeragePct)}%)`, cents: -b }] : []),
      ...withheld,
    ];
    return { reinsurer: p.reinsurer, weight: p.weight, lines, total: lines.reduce((s, x) => s + x.cents, 0) };
  });

  const reinsurerTaxes = slips.reduce((s, x) => s + x.lines.filter((l) => l.kind === "tax" && l.ruleId).reduce((a, l) => a + -l.cents, 0), 0);
  const cedantTaxTotal = cedantTaxes.reduce((s, t) => s + t.cents, 0);
  const slipsTotal = slips.reduce((s, x) => s + x.total, 0);
  const brokerageRetained = B;
  // Everything the cedant pays is accounted for: remitted to reinsurers, kept
  // as brokerage, or held to pay over to a tax authority.
  const balance = cedantTotal - (slipsTotal + brokerageRetained + reinsurerTaxes + cedantTaxTotal);

  return {
    cedant: { lines: cedantLines, total: cedantTotal },
    slips,
    brokerageRetained,
    taxesHeld: reinsurerTaxes + cedantTaxTotal,
    brokerTaxes,
    balanced: balance === 0,
    balance,
  };
}

export const formatShare = (w) => `${Math.round(w * 10000) / 100}%`;

/** Which document the cedant receives for this event. */
export function cedantDocType(sourceKind, totalCents) {
  if (sourceKind === "bind") return totalCents < 0 ? "Credit Note" : "Invoice";
  if (sourceKind === "endorsement" || sourceKind === "reversal") return totalCents < 0 ? "Credit Note" : "Debit Note";
  return totalCents < 0 ? "Credit Note" : "Invoice";
}

/* ---- due date ---------------------------------------------------------------- */

/** Due date = basis date + payment warranty days. Null when either is missing. */
export function dueDate(basisDate, warrantyDays) {
  if (!basisDate || !isValidPaymentWarranty(warrantyDays)) return null;
  const d = new Date(`${basisDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(warrantyDays));
  return d.toISOString().slice(0, 10);
}

/* ---- four-eyes ------------------------------------------------------------------ */

/**
 * Whether `user` may issue this batch. The preparer may not approve their own
 * batch; the approver needs signing authority. An administrator may approve
 * their own, and the record says so.
 */
export function issueAuthority(batch, user) {
  if (!user?.canReleaseSlips) return { allowed: false, reason: `${user?.name || "This seat"} does not hold signing authority and cannot issue finance documents.` };
  if (batch.preparedBy && batch.preparedBy.id === user.id && !user.bypassFourEyes) {
    return { allowed: false, reason: `${user.name} prepared this batch. A different authorised person must approve and issue it.` };
  }
  return { allowed: true, reason: null, override: Boolean(user.bypassFourEyes && batch.preparedBy?.id === user.id) };
}

/**
 * Everything that must hold before a batch can be submitted or issued, as a
 * checklist. `state`: done | blocking.
 */
export function issueChecklist(batch) {
  const set = (v) => v !== null && v !== undefined && v !== "";
  const c = batch.computed;
  return [
    { key: "rates", label: "Commission and brokerage set",
      state: batch.sourceKind === "treaty" || (set(batch.commissionPct) && set(batch.brokeragePct)) ? "done" : "blocking",
      detail: batch.sourceKind === "treaty" ? "Taken from the technical account and the agreement" : set(batch.commissionPct) && set(batch.brokeragePct) ? `${batch.commissionPct}% commission · ${batch.brokeragePct}% brokerage` : "Enter both rates — 0 is a valid choice, blank is not." },
    { key: "panel", label: "Reinsurer panel present", state: c?.slips?.length ? "done" : "blocking", detail: c?.slips?.length ? `${c.slips.length} closing slip${c.slips.length === 1 ? "" : "s"}` : "No reinsurers to close to." },
    { key: "warranty", label: "Due date set", state: batch.dueDate || batch.sourceKind === "reversal" ? "done" : "blocking",
      detail: batch.sourceKind === "reversal" ? "A cancellation carries no new due date" : batch.dueDate ? `${batch.basisDate} + ${batch.paymentWarrantyDays} days = ${batch.dueDate}` : "Payment warranty or its start date is missing." },
    { key: "balance", label: "Documents balance", state: c?.balanced ? "done" : "blocking",
      detail: c?.balanced ? "Cedant total = remittances + brokerage + taxes held" : `Out of balance by ${fromCents(c?.balance || 0)}` },
    { key: "amount", label: "Amount is not zero", state: c && c.cedant.total !== 0 ? "done" : "blocking", detail: c && c.cedant.total !== 0 ? "" : "Nothing to bill." },
    ...(c && cedantPays(batch.cedantDocType, c.cedant.total) ? [{
      key: "payto", label: `Collection account in ${batch.ccy}`,
      state: batch.payTo ? "done" : "optional",
      detail: batch.payTo ? `${batch.payTo.bankName} · ${batch.payTo.accountNo || batch.payTo.iban}` : `No active collection account in ${batch.ccy}. The invoice can issue, but it will carry no payment instructions — add one under Finance → Bank Accounts.`,
    }] : []),
  ];
}

export const issueBlockers = (batch) => issueChecklist(batch).filter((x) => x.state === "blocking");
export const canSubmitBatch = (batch) => batch.status === "Draft" && issueBlockers(batch).length === 0;
export const canIssueBatch = (batch, user) => batch.status === "Pending Approval" && issueBlockers(batch).length === 0 && issueAuthority(batch, user).allowed;
