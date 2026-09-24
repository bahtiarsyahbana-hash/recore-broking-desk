/**
 * Treaty administration — the rules for treaty agreements negotiated and
 * bound outside Recordes, then registered here as master records.
 *
 * An agreement is a contract between cedant and reinsurer(s); the broker is
 * the intermediary and administrator. Every operational record — premium
 * bordereau, claims bordereau, individual cession, technical account,
 * settlement — references an agreement and cannot exist without one.
 *
 * Pure: agreements and records in, findings out. The calculators reuse the
 * treaty maths in quota-share.js, surplus.js and xol.js.
 */
import { computeQuotaShare } from "./quota-share.js";
import { computeSurplus } from "./surplus.js";
import { rateOnLine, towerTop, baseRetention } from "./xol.js";

export const TREATY_TYPES = ["Quota Share", "Surplus", "Per Risk XoL", "Catastrophe XoL", "Stop Loss"];
export const AGREEMENT_STATUSES = ["Draft Setup", "Active", "Expiring", "Run-off", "Closed"];
export const AGREEMENT_SOURCES = ["Manual Registration", "Imported"];
export const FREQUENCIES = ["Monthly", "Quarterly", "Half-yearly", "Annual"];
export const PREMIUM_BASES = ["GNPI", "GWPI", "Original gross premium", "Subject premium", "Estimated premium income"];
export const LOSS_RATIO_BASES = ["Incurred / earned", "Paid / written", "Incurred / written"];
export const PANEL_ROLES = ["Lead", "Follow"];
export const TREATY_CLASSES = ["Property", "Casualty", "Marine", "Motor", "Engineering", "Life", "Multi-line"];
export const TREATY_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "SGD", "IDR", "MYR", "THB", "AUD", "JPY"];

/** Statuses of the operational records. Every move is an explicit user action. */
export const BORDEREAU_STATUSES = ["Received", "Under Review", "Matched", "Exception", "Posted"];
export const CESSION_STATUSES = ["Declared", "Accepted", "Queried", "Declined"];
export const ACCOUNT_STATUSES = ["Draft", "Issued", "Agreed", "Settled"];
export const SETTLEMENT_STATUSES = ["Pending", "Part paid", "Paid", "Overdue"];

/** Explicit status moves an administrator may make on an agreement. */
export const AGREEMENT_TRANSITIONS = {
  "Draft Setup": ["Active"],
  "Active": ["Expiring", "Run-off", "Closed"],
  "Expiring": ["Active", "Run-off", "Closed"],
  "Run-off": ["Closed"],
  "Closed": [],
};

export const isTreatyType = (type) => TREATY_TYPES.includes(type);
export const isLayered = (type) => type === "Per Risk XoL" || type === "Catastrophe XoL";

const num = (v) => (v === "" || v == null ? null : Number(v));
const positive = (v) => Number.isFinite(num(v)) && num(v) > 0;
const nonNegative = (v) => Number.isFinite(num(v)) && num(v) >= 0;
const pctRange = (v) => Number.isFinite(num(v)) && num(v) >= 0 && num(v) <= 100;

/* ---- structure ------------------------------------------------------- */

/**
 * Validate a treaty structure for its type. Returns field → message; empty
 * when valid. Layers report as `layers.<index>.<field>`.
 */
export function validateStructure(type, s = {}) {
  const errors = {};
  switch (type) {
    case "Quota Share":
      if (!pctRange(s.cessionPct) || !positive(s.cessionPct)) errors.cessionPct = "Cession must be between 0 and 100%.";
      if (s.retentionPct != null && s.retentionPct !== "" && !pctRange(s.retentionPct)) errors.retentionPct = "Retention must be between 0 and 100%.";
      if (pctRange(s.cessionPct) && pctRange(s.retentionPct) && Math.abs(num(s.cessionPct) + num(s.retentionPct) - 100) > 0.01) {
        errors.retentionPct = "Cession and cedant retention must total 100%.";
      }
      if (s.commissionPct != null && s.commissionPct !== "" && !pctRange(s.commissionPct)) errors.commissionPct = "Commission must be between 0 and 100%.";
      break;
    case "Surplus":
      if (!positive(s.retention)) errors.retention = "Enter the cedant's retention (one line).";
      if (!Number.isInteger(num(s.lines)) || num(s.lines) < 1) errors.lines = "Number of lines must be a whole number of at least 1.";
      if (s.capacity != null && s.capacity !== "" && !positive(s.capacity)) errors.capacity = "Treaty capacity must be greater than zero.";
      if (positive(s.retention) && Number.isInteger(num(s.lines)) && positive(s.capacity)
        && Math.abs(num(s.capacity) - num(s.retention) * num(s.lines)) > 0.5) {
        errors.capacity = `Capacity should equal retention × lines (${(num(s.retention) * num(s.lines)).toLocaleString("en-US")}).`;
      }
      if (s.commissionPct != null && s.commissionPct !== "" && !pctRange(s.commissionPct)) errors.commissionPct = "Commission must be between 0 and 100%.";
      break;
    case "Per Risk XoL":
    case "Catastrophe XoL": {
      const layers = Array.isArray(s.layers) ? s.layers : [];
      if (!layers.length) errors.layers = "Add at least one layer.";
      layers.forEach((l, i) => {
        if (!positive(l.limit)) errors[`layers.${i}.limit`] = `Layer ${i + 1}: limit must be greater than zero.`;
        if (!nonNegative(l.attachment)) errors[`layers.${i}.attachment`] = `Layer ${i + 1}: attachment must be zero or more.`;
        if (l.reinstatements != null && l.reinstatements !== "" && (!Number.isInteger(num(l.reinstatements)) || num(l.reinstatements) < 0)) {
          errors[`layers.${i}.reinstatements`] = `Layer ${i + 1}: reinstatements must be a whole number.`;
        }
        if (l.premium != null && l.premium !== "" && !nonNegative(l.premium)) errors[`layers.${i}.premium`] = `Layer ${i + 1}: premium must be zero or more.`;
      });
      if (type === "Catastrophe XoL" && !String(s.eventDefinition || "").trim()) errors.eventDefinition = "State the event definition or the clause it refers to.";
      break;
    }
    case "Stop Loss":
      if (!positive(s.attachmentRatio)) errors.attachmentRatio = "Attachment ratio must be greater than zero (a loss-ratio %).";
      if (!positive(s.limitRatio)) errors.limitRatio = "Limit ratio must be greater than zero (a loss-ratio %).";
      if (positive(s.attachmentRatio) && positive(s.limitRatio) && num(s.limitRatio) <= num(s.attachmentRatio)) {
        errors.limitRatio = "Limit ratio must exceed the attachment ratio.";
      }
      if (s.subjectPremium != null && s.subjectPremium !== "" && !positive(s.subjectPremium)) errors.subjectPremium = "Subject premium must be greater than zero.";
      break;
    default:
      errors.type = `Treaty type must be one of ${TREATY_TYPES.join(", ")}.`;
  }
  return errors;
}

/** Layers in the shape xol.js reads (`ret` for attachment). */
export const towerLayers = (layers = []) => layers.map((l) => ({
  limit: Number(l.limit) || 0, ret: Number(l.attachment) || 0,
  premium: l.premium == null || l.premium === "" ? undefined : Number(l.premium), rol: 0,
}));

/** Gaps and overlaps in a tower, sweeping every boundary. */
export function towerIssues(layers = []) {
  const tower = towerLayers(layers);
  if (!tower.length) return [];
  const retention = baseRetention(tower);
  const boundaries = [...new Set([retention, ...tower.flatMap((l) => [l.ret, l.ret + l.limit])])].sort((a, b) => a - b);
  const issues = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i]; const to = boundaries[i + 1];
    const covering = tower.flatMap((l, idx) => (l.ret <= from && l.ret + l.limit >= to ? [idx + 1] : []));
    if (covering.length !== 1) issues.push({ from, to, covering });
  }
  return issues;
}

/** "USD 10.00m xs USD 5.00m" per layer, format injected. */
export const layerLabel = (l, fmt = String) => `${fmt(Number(l.limit) || 0)} xs ${fmt(Number(l.attachment) || 0)}`;

/** One line describing the structure, for lists. */
export function structureSummary(a, fmt = String) {
  const s = a.structure || {};
  switch (a.type) {
    case "Quota Share": return `${s.cessionPct ?? "—"}% cession${s.commissionPct != null ? ` · ${s.commissionPct}% commission` : ""}`;
    case "Surplus": return `${s.lines ?? "—"} lines · retention ${s.retention != null ? fmt(s.retention) : "—"}`;
    case "Per Risk XoL":
    case "Catastrophe XoL": {
      const layers = s.layers || [];
      const tower = towerLayers(layers);
      return layers.length ? `${layers.length} layer${layers.length === 1 ? "" : "s"} · ${fmt(towerTop(tower) - baseRetention(tower))} xs ${fmt(baseRetention(tower))}` : "No layers";
    }
    case "Stop Loss": return `${s.attachmentRatio ?? "—"}% xs → ${s.limitRatio ?? "—"}% loss ratio`;
    default: return "—";
  }
}

/* ---- calculators ------------------------------------------------------ */

/** Quota share worked on the agreement's terms and a premium figure. */
export const quotaShareResult = (s, gnpi, brokeragePct = 0) =>
  computeQuotaShare({ gnpi, cessionPct: Number(s.cessionPct) || 0, commissionPct: Number(s.commissionPct) || 0, brokeragePct: Number(brokeragePct) || 0 });

/** Surplus worked on one risk against the agreement's retention and lines. */
export const surplusResult = (s, sumInsured, premium) =>
  computeSurplus({ sumInsured, retention: Number(s.retention) || 1, lines: Number(s.lines) || 0, premium });

/**
 * Stop loss: the treaty pays the part of the cedant's loss ratio between the
 * attachment and limit ratios, applied to the subject premium.
 */
export function computeStopLoss({ subjectPremium = 0, attachmentRatio = 0, limitRatio = 0, lossRatio = 0 }) {
  const attachment = subjectPremium * attachmentRatio / 100;
  const limit = subjectPremium * (limitRatio - attachmentRatio) / 100;
  const loss = subjectPremium * lossRatio / 100;
  const recovery = Math.max(0, Math.min(loss - attachment, limit));
  return { attachment, limit, loss, recovery, cover: `${attachmentRatio}% to ${limitRatio}%` };
}

/** Rate on line per layer, for the structure view. */
export const layerRates = (layers = []) => towerLayers(layers).map((l) => ({ ...l, rol: l.premium != null ? rateOnLine(l.limit, l.premium) : null }));

/* ---- panel ------------------------------------------------------------- */

export const REQUIRED_SHARE = 100;
const TOLERANCE = 0.01;

export const panelTotal = (panel = []) => panel.reduce((s, p) => s + (Number(p.share) || 0), 0);
export const panelComplete = (panel = []) => panel.length > 0 && Math.abs(panelTotal(panel) - REQUIRED_SHARE) <= TOLERANCE;

/** Validate the reinsurer panel. Duplicates and out-of-range shares are refused. */
export function validatePanel(panel = []) {
  const errors = {};
  const seen = new Set();
  panel.forEach((p, i) => {
    if (!String(p.reinsurer || "").trim()) errors[`panel.${i}.reinsurer`] = `Line ${i + 1}: name the reinsurer.`;
    const key = String(p.reinsurer || "").trim().toLowerCase();
    if (key && seen.has(key)) errors[`panel.${i}.reinsurer`] = `Line ${i + 1}: ${p.reinsurer} appears twice.`;
    seen.add(key);
    if (!pctRange(p.share) || !positive(p.share)) errors[`panel.${i}.share`] = `Line ${i + 1}: share must be between 0 and 100%.`;
    if (p.role && !PANEL_ROLES.includes(p.role)) errors[`panel.${i}.role`] = `Line ${i + 1}: role is Lead or Follow.`;
    if (p.brokeragePct != null && p.brokeragePct !== "" && !pctRange(p.brokeragePct)) errors[`panel.${i}.brokeragePct`] = `Line ${i + 1}: brokerage must be 0–100%.`;
  });
  return errors;
}

/* ---- agreement ---------------------------------------------------------- */

/** Basics every agreement must carry to be saved at all, even as Draft Setup. */
export function validateBasics(a = {}) {
  const errors = {};
  if (!String(a.id || "").trim()) errors.id = "Enter the agreement number.";
  if (!String(a.name || "").trim()) errors.name = "Name the treaty.";
  if (!String(a.cedant || "").trim()) errors.cedant = "Name the cedant.";
  if (!isTreatyType(a.type)) errors.type = `Treaty type must be one of ${TREATY_TYPES.join(", ")}.`;
  if (!a.ccy) errors.ccy = "Choose the currency.";
  if (a.inception && a.expiry && a.expiry <= a.inception) errors.expiry = "Expiry must be after inception.";
  if (a.source && !AGREEMENT_SOURCES.includes(a.source)) errors.source = "Source is Manual Registration or Imported.";
  if (a.status && !AGREEMENT_STATUSES.includes(a.status)) errors.status = "Unknown status.";
  return errors;
}

/**
 * The hard gates on becoming Active, as a checklist an administrator can read.
 * `state`: done | blocking | optional.
 */
export function activationChecklist(a) {
  const structureErrors = validateStructure(a.type, a.structure);
  const panelErrors = validatePanel(a.panel);
  const complete = panelComplete(a.panel);
  const r = a.reporting || {};
  const docs = a.documents || [];
  const hasWording = docs.some((d) => d.type === "Signed treaty wording");
  return [
    { key: "basics", label: "Agreement basics complete", state: Object.keys(validateBasics(a)).length ? "blocking" : "done",
      detail: Object.values(validateBasics(a))[0] || `${a.id} · ${a.type} · ${a.ccy}` },
    { key: "period", label: "Contract period set", state: a.inception && a.expiry ? "done" : "blocking",
      detail: a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : "Inception and expiry are required to activate." },
    { key: "structure", label: "Treaty structure valid", state: Object.keys(structureErrors).length ? "blocking" : "done",
      detail: Object.values(structureErrors)[0] || "Structure passes its type's rules" },
    { key: "panel", label: "Reinsurer panel totals exactly 100%",
      state: Object.keys(panelErrors).length || !complete ? "blocking" : "done",
      detail: Object.values(panelErrors)[0] || (complete ? `${a.panel.length} reinsurer${a.panel.length === 1 ? "" : "s"} · 100%` : `Signed shares total ${panelTotal(a.panel).toFixed(2)}%`) },
    { key: "reporting", label: "Bordereau and accounting frequencies set", state: r.premiumBdxFrequency && r.claimsBdxFrequency && r.accountingFrequency ? "done" : "blocking",
      detail: r.premiumBdxFrequency && r.claimsBdxFrequency && r.accountingFrequency ? `${r.premiumBdxFrequency} premium · ${r.claimsBdxFrequency} claims · ${r.accountingFrequency} accounts` : "Set how often the cedant reports and accounts." },
    { key: "wording", label: "Signed treaty wording on file", state: hasWording ? "done" : "optional",
      detail: hasWording ? "Filed" : "Recommended before activation; not a hard gate." },
  ];
}

export const activationBlockers = (a) => activationChecklist(a).filter((c) => c.state === "blocking");
export const canActivate = (a) => activationBlockers(a).length === 0;

export const canTransitionAgreement = (from, to) => (AGREEMENT_TRANSITIONS[from] || []).includes(to);

/** Closed agreements take no new operational transactions. */
export const acceptsTransactions = (a) => Boolean(a) && a.status !== "Closed";

export const requiresDeclarations = (a) => Boolean(a?.reporting?.declarationsRequired);

/** Days until expiry (negative once past), or null without an expiry. */
export function daysToExpiry(a, today) {
  if (!a?.expiry) return null;
  const t = today instanceof Date ? today : new Date(today);
  return Math.round((new Date(a.expiry) - t) / 86_400_000);
}

/** Expiry indicator for the overview: text and tone, derived, never a status change. */
export function expiryIndicator(a, today) {
  const days = daysToExpiry(a, today);
  if (days == null) return { label: "No expiry set", tone: "neutral", days };
  if (days < 0) return { label: `Expired ${Math.abs(days)} days ago`, tone: "bad", days };
  if (days <= 60) return { label: `${days} days to expiry`, tone: "warn", days };
  return { label: `${days} days remaining`, tone: "good", days };
}

/**
 * The next thing the administrator should do on this agreement, or the setup
 * it still lacks. Derived from the same gates that govern activation.
 */
export function nextTreatyAction(a, { today, records = {} } = {}) {
  if (a.status === "Draft Setup") {
    const blockers = activationBlockers(a);
    return blockers.length
      ? { title: "Complete the setup", detail: blockers.map((b) => b.detail).join(" "), action: "edit", actionLabel: "Continue setup" }
      : { title: "Ready to activate", detail: "Every hard gate is satisfied. Activation is an explicit act and is recorded.", action: "activate", actionLabel: "Activate Agreement" };
  }
  if (a.status === "Closed") return { title: "Closed", detail: "No new bordereaux, cessions, accounts or settlements may be recorded.", action: null };
  const indicator = expiryIndicator(a, today);
  const overdue = (records.settlements || []).filter((s) => s.paymentStatus !== "Paid" && s.dueDate && s.dueDate < (today instanceof Date ? today.toISOString().slice(0, 10) : today));
  if (overdue.length) return { title: `${overdue.length} settlement${overdue.length === 1 ? "" : "s"} past due`, detail: overdue.map((s) => `${s.ref} · ${s.counterparty} · due ${s.dueDate}`).join(" · "), action: "tab:settlements", actionLabel: "Open settlements" };
  const exceptions = [...(records.premiumBordereaux || []), ...(records.claimsBordereaux || [])].filter((b) => b.status === "Exception");
  if (exceptions.length) return { title: `${exceptions.length} bordereau${exceptions.length === 1 ? "" : "x"} in exception`, detail: exceptions.map((b) => `${b.ref} · ${b.period}`).join(" · "), action: "tab:bordereaux", actionLabel: "Review bordereaux" };
  if (a.status === "Active" && indicator.days != null && indicator.days <= 60) {
    return { title: "Renewal window", detail: `${indicator.label}. Mark the agreement Expiring, or register the renewal as a new agreement.`, action: "mark-expiring", actionLabel: "Mark Expiring" };
  }
  if (a.status === "Run-off") return { title: "Run-off", detail: "Claims bordereaux and settlements continue; no new premium is expected.", action: "tab:claims", actionLabel: "Open claims bordereaux" };
  return { title: "Up to date", detail: `Next premium bordereau expected ${a.reporting?.premiumBdxFrequency?.toLowerCase() || "per the treaty"}.`, action: "tab:bordereaux", actionLabel: "Open bordereaux" };
}

/* ---- operational records ------------------------------------------------- */

/** Every workstream record must point at a real agreement that still accepts transactions. */
export function validateRecordAgreement(record, agreement) {
  if (!record?.agreementId) return "Every record must reference a treaty agreement.";
  if (!agreement) return `Agreement ${record.agreementId} is not on the register.`;
  if (!acceptsTransactions(agreement)) return `${agreement.id} is Closed and cannot receive new transactions.`;
  return null;
}

export function validatePremiumBordereau(b, agreement) {
  const errors = {};
  const ref = validateRecordAgreement(b, agreement); if (ref) errors.agreementId = ref;
  if (!String(b.period || "").trim()) errors.period = "State the reporting period.";
  if (!nonNegative(b.grossPremium)) errors.grossPremium = "Gross premium must be zero or more.";
  if (!nonNegative(b.cededPremium)) errors.cededPremium = "Ceded premium must be zero or more.";
  if (nonNegative(b.grossPremium) && nonNegative(b.cededPremium) && num(b.cededPremium) > num(b.grossPremium)) errors.cededPremium = "Ceded premium cannot exceed gross premium.";
  if (b.commission != null && b.commission !== "" && !nonNegative(b.commission)) errors.commission = "Commission must be zero or more.";
  if (b.status && !BORDEREAU_STATUSES.includes(b.status)) errors.status = "Unknown status.";
  return errors;
}

export function validateClaimsBordereau(b, agreement) {
  const errors = {};
  const ref = validateRecordAgreement(b, agreement); if (ref) errors.agreementId = ref;
  if (!String(b.period || "").trim()) errors.period = "State the reporting period.";
  if (!Number.isInteger(num(b.claimCount)) || num(b.claimCount) < 0) errors.claimCount = "Claim count must be a whole number.";
  if (!nonNegative(b.paid)) errors.paid = "Paid must be zero or more.";
  if (!nonNegative(b.outstanding)) errors.outstanding = "Outstanding must be zero or more.";
  if (b.recoverable != null && b.recoverable !== "" && !nonNegative(b.recoverable)) errors.recoverable = "Recoverable must be zero or more.";
  if (b.status && !BORDEREAU_STATUSES.includes(b.status)) errors.status = "Unknown status.";
  return errors;
}

export function validateCession(c, agreement) {
  const errors = {};
  const ref = validateRecordAgreement(c, agreement); if (ref) errors.agreementId = ref;
  if (agreement && !requiresDeclarations(agreement)) errors.agreementId = `${agreement.id} does not require individual declarations.`;
  if (!String(c.insured || "").trim()) errors.insured = "Name the insured or risk.";
  if (!positive(c.sumInsured)) errors.sumInsured = "Sum insured must be greater than zero.";
  if (!nonNegative(c.retention)) errors.retention = "Cedant retention must be zero or more.";
  if (!nonNegative(c.ceded)) errors.ceded = "Ceded amount must be zero or more.";
  if (positive(c.sumInsured) && nonNegative(c.ceded) && num(c.ceded) > num(c.sumInsured)) errors.ceded = "Ceded amount cannot exceed the sum insured.";
  if (!c.effectiveDate) errors.effectiveDate = "Give the effective date.";
  if (c.status && !CESSION_STATUSES.includes(c.status)) errors.status = "Unknown status.";
  return errors;
}

/** Net balance of a technical account: premium less commission, claims and tax. Positive = due to reinsurers. */
export const accountNet = (t) => (Number(t.premium) || 0) - (Number(t.commission) || 0) - (Number(t.claims) || 0) - (Number(t.tax) || 0);

export function validateTechnicalAccount(t, agreement) {
  const errors = {};
  const ref = validateRecordAgreement(t, agreement); if (ref) errors.agreementId = ref;
  if (!String(t.period || "").trim()) errors.period = "State the accounting period.";
  ["premium", "commission", "claims", "tax"].forEach((k) => {
    if (t[k] != null && t[k] !== "" && !Number.isFinite(num(t[k]))) errors[k] = "Enter a number.";
  });
  if (t.status && !ACCOUNT_STATUSES.includes(t.status)) errors.status = "Unknown status.";
  return errors;
}

export function validateSettlement(s, agreement) {
  const errors = {};
  const ref = validateRecordAgreement(s, agreement); if (ref) errors.agreementId = ref;
  if (!String(s.counterparty || "").trim()) errors.counterparty = "Name the counterparty.";
  if (!Number.isFinite(num(s.amount)) || num(s.amount) === 0) errors.amount = "Amount must be a non-zero number.";
  if (!s.dueDate) errors.dueDate = "Give the due date.";
  if (s.paymentStatus && !SETTLEMENT_STATUSES.includes(s.paymentStatus)) errors.paymentStatus = "Unknown payment status.";
  return errors;
}

/* ---- list filtering ------------------------------------------------------ */

/**
 * Filter agreements for the register. `filters` keys: cedant, cls, period
 * (a year the contract is in force), status, type, reinsurer, ccy, q (text).
 * Pure so the view and its test share one rule.
 */
export function filterAgreements(agreements, filters = {}) {
  const q = String(filters.q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (agreements || []).filter((a) => {
    if (filters.cedant && filters.cedant !== "all" && a.cedant !== filters.cedant) return false;
    if (filters.cls && filters.cls !== "all" && a.cls !== filters.cls) return false;
    if (filters.status && filters.status !== "all" && a.status !== filters.status) return false;
    if (filters.type && filters.type !== "all" && a.type !== filters.type) return false;
    if (filters.ccy && filters.ccy !== "all" && a.ccy !== filters.ccy) return false;
    if (filters.reinsurer && filters.reinsurer !== "all" && !(a.panel || []).some((p) => p.reinsurer === filters.reinsurer)) return false;
    if (filters.period && filters.period !== "all") {
      const y = String(filters.period);
      const from = (a.inception || "").slice(0, 4); const to = (a.expiry || "").slice(0, 4);
      if (!(from && to ? from <= y && y <= to : from === y || to === y)) return false;
    }
    if (q.length) {
      const hay = [a.id, a.name, a.cedant, a.cls, a.type, a.status, a.ccy, ...(a.panel || []).map((p) => p.reinsurer)].join(" ").toLowerCase();
      if (!q.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}
