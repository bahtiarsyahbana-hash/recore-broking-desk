import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TREATY_TYPES, validateBasics, validateStructure, validatePanel, panelComplete, canActivate, activationBlockers,
  quotaShareResult, surplusResult, computeStopLoss, towerIssues, validateCession, validateRecordAgreement, filterAgreements, expiryIndicator, accountNet,
} from "../src/js/domain/treaty.js";
import { state, agreementById } from "../src/js/core/store.js";
import { USERS } from "../src/js/data/users.data.js";
import * as svc from "../src/js/services/treaty.service.js";
import { computeQuotaShare } from "../src/js/domain/quota-share.js";
import { computeSurplus } from "../src/js/domain/surplus.js";

state.session = USERS.find((u) => u.id === "vr");

const qsDraft = (over = {}) => ({
  id: "TA-TEST-QS", name: "Test QS", cedant: "Meridian Mutual Insurance", cls: "Property", inception: "2026-01-01", expiry: "2026-12-31", ccy: "USD",
  type: "Quota Share", source: "Manual Registration",
  structure: { cessionPct: 30, retentionPct: 70, commissionPct: 25, premiumBasis: "GNPI" },
  panel: [{ reinsurer: "Helvetia Continental Re", share: 60, role: "Lead", brokeragePct: 2.5 }, { reinsurer: "Comstock Re", share: 40, role: "Follow", brokeragePct: 2.5 }],
  reporting: { premiumBdxFrequency: "Quarterly", claimsBdxFrequency: "Quarterly", accountingFrequency: "Quarterly", declarationsRequired: false },
  ...over,
});

test("agreement numbers must be unique", () => {
  const first = svc.registerAgreement(qsDraft({ id: "TA-UNIQ-1" }));
  assert.ok(first.agreement);
  const dup = svc.registerAgreement(qsDraft({ id: "TA-UNIQ-1", name: "Another" }));
  assert.ok(dup.errors?.id, "duplicate refused");
  assert.match(dup.errors.id, /already registered/);
  assert.ok(validateBasics({ ...qsDraft(), id: "" }).id);
});

test("only the five supported treaty types are accepted", () => {
  assert.deepEqual(TREATY_TYPES, ["Quota Share", "Surplus", "Per Risk XoL", "Catastrophe XoL", "Stop Loss"]);
  for (const bad of ["Facultative", "Excess of Loss", "Aggregate XoL", ""]) {
    assert.ok(validateBasics({ ...qsDraft(), type: bad }).type, `rejects ${bad || "blank"}`);
    assert.ok(svc.registerAgreement(qsDraft({ id: `TA-T-${bad || "x"}`, type: bad })).errors?.type);
  }
});

test("an incomplete agreement may be saved as Draft Setup but cannot activate until the panel totals exactly 100%", () => {
  const res = svc.registerAgreement(qsDraft({ id: "TA-DRAFT-1", panel: [{ reinsurer: "Helvetia Continental Re", share: 60, role: "Lead" }] }));
  assert.ok(res.agreement);
  const a = res.agreement;
  assert.equal(a.status, "Draft Setup");
  assert.ok(!panelComplete(a.panel));
  assert.ok(!canActivate(a));
  assert.ok(activationBlockers(a).some((b) => b.key === "panel"));
  assert.equal(svc.activateAgreement(a.id), null, "activation refused at 60%");
  assert.equal(svc.setAgreementStatus(a.id, "Active"), null);
  // 99.99 is still not 100.
  svc.updateAgreement(a.id, { panel: [{ reinsurer: "Helvetia Continental Re", share: 60, role: "Lead" }, { reinsurer: "Comstock Re", share: 39.98, role: "Follow" }] });
  assert.equal(svc.activateAgreement(a.id), null);
  svc.updateAgreement(a.id, { panel: [{ reinsurer: "Helvetia Continental Re", share: 60, role: "Lead" }, { reinsurer: "Comstock Re", share: 40, role: "Follow" }] });
  assert.ok(svc.activateAgreement(a.id));
  assert.equal(a.status, "Active");
  assert.ok(a.audit.some((h) => h.action === "Agreement activated"));
  // Over-placed panels are refused outright, as are duplicate reinsurers.
  assert.ok(Object.keys(validatePanel([{ reinsurer: "A", share: 60 }, { reinsurer: "A", share: 40 }])).length);
  assert.ok(Object.keys(validatePanel([{ reinsurer: "A", share: 120 }])).length);
});

test("register with activate flag activates only when the gates hold", () => {
  const ok = svc.registerAgreement(qsDraft({ id: "TA-ACT-1" }), { activate: true });
  assert.equal(ok.agreement.status, "Active");
  const notOk = svc.registerAgreement(qsDraft({ id: "TA-ACT-2", inception: "", expiry: "" }), { activate: true });
  assert.equal(notOk.agreement.status, "Draft Setup");
  assert.equal(notOk.activationRefused, true);
});

test("quota share and surplus structures: validation and calculations", () => {
  assert.deepEqual(validateStructure("Quota Share", { cessionPct: 30, retentionPct: 70, commissionPct: 25 }), {});
  assert.ok(validateStructure("Quota Share", { cessionPct: 30, retentionPct: 60 }).retentionPct, "must total 100");
  assert.ok(validateStructure("Quota Share", { cessionPct: 120 }).cessionPct);
  const qs = quotaShareResult({ cessionPct: 35, commissionPct: 28 }, 4600000, 2.5);
  assert.equal(qs.ceded, 1610000);
  assert.equal(qs.cedingCommission, 450800);
  assert.deepEqual(qs, computeQuotaShare({ gnpi: 4600000, cessionPct: 35, commissionPct: 28, brokeragePct: 2.5 }), "reuses the existing engine");

  assert.deepEqual(validateStructure("Surplus", { retention: 500000, lines: 9, capacity: 4500000, commissionPct: 25 }), {});
  assert.ok(validateStructure("Surplus", { retention: 500000, lines: 9, capacity: 4000000 }).capacity, "capacity must equal retention × lines");
  assert.ok(validateStructure("Surplus", { retention: 500000, lines: 0 }).lines);
  const sp = surplusResult({ retention: 500000, lines: 9 }, 4200000, 62000);
  assert.equal(sp.maxCapacity, 5000000);
  assert.equal(sp.cededSumInsured, 3700000);
  assert.deepEqual(sp, computeSurplus({ sumInsured: 4200000, retention: 500000, lines: 9, premium: 62000 }));
});

test("every Per Risk and Catastrophe XoL layer is validated", () => {
  const good = [{ limit: 5e6, attachment: 5e6, reinstatements: 2 }, { limit: 10e6, attachment: 10e6, reinstatements: 1 }];
  assert.deepEqual(validateStructure("Per Risk XoL", { layers: good }), {});
  const errs = validateStructure("Per Risk XoL", { layers: [{ limit: 5e6, attachment: 5e6 }, { limit: 0, attachment: -1, reinstatements: 1.5 }, { limit: 1e6, attachment: 20e6 }] });
  assert.ok(errs["layers.1.limit"] && errs["layers.1.attachment"] && errs["layers.1.reinstatements"], "second layer reported on every bad field");
  assert.ok(!errs["layers.0.limit"] && !errs["layers.2.limit"]);
  assert.ok(validateStructure("Per Risk XoL", { layers: [] }).layers);
  assert.ok(validateStructure("Catastrophe XoL", { layers: good }).eventDefinition, "cat XoL needs an event definition");
  assert.deepEqual(validateStructure("Catastrophe XoL", { layers: good, eventDefinition: "72 hours" }), {});
  assert.equal(towerIssues(good).length, 0);
  assert.equal(towerIssues([{ limit: 5e6, attachment: 5e6 }, { limit: 10e6, attachment: 12e6 }]).length, 1, "gap detected");
});

test("stop loss attachment and limit ratios are validated and computed", () => {
  assert.deepEqual(validateStructure("Stop Loss", { attachmentRatio: 85, limitRatio: 115, subjectPremium: 1e6 }), {});
  assert.ok(validateStructure("Stop Loss", { attachmentRatio: 115, limitRatio: 85 }).limitRatio, "limit must exceed attachment");
  assert.ok(validateStructure("Stop Loss", { attachmentRatio: 0, limitRatio: 100 }).attachmentRatio);
  const r = computeStopLoss({ subjectPremium: 1000000, attachmentRatio: 85, limitRatio: 115, lossRatio: 100 });
  assert.equal(r.attachment, 850000);
  assert.equal(r.limit, 300000);
  assert.equal(r.recovery, 150000);
  assert.equal(computeStopLoss({ subjectPremium: 1000000, attachmentRatio: 85, limitRatio: 115, lossRatio: 130 }).recovery, 300000, "capped at the limit");
});

test("every workstream record must reference a valid agreement", () => {
  assert.match(validateRecordAgreement({}, null), /must reference/);
  assert.match(validateRecordAgreement({ agreementId: "TA-NOPE" }, null), /not on the register/);
  for (const fn of [svc.addPremiumBordereau, svc.addClaimsBordereau, svc.addTechnicalAccount, svc.addSettlement]) {
    assert.ok(fn({ agreementId: "TA-NOPE", period: "Q3 2026", grossPremium: 1, cededPremium: 1, claimCount: 1, paid: 0, outstanding: 0, counterparty: "X", amount: 1, dueDate: "2026-10-01" }).errors?.agreementId);
    assert.ok(fn({ period: "Q3 2026", grossPremium: 1, cededPremium: 1, claimCount: 1, paid: 0, outstanding: 0, counterparty: "X", amount: 1, dueDate: "2026-10-01" }).errors?.agreementId);
  }
  const ok = svc.addPremiumBordereau({ agreementId: "TA-2026-002", period: "Q3 2026", grossPremium: 4800000, cededPremium: 1680000, commission: 470400 });
  assert.ok(ok.record?.ref.startsWith("PB-"));
  assert.equal(ok.record.ccy, "USD");
  assert.ok(agreementById("TA-2026-002").audit.at(-1).action.includes(ok.record.ref));
  assert.ok(svc.addPremiumBordereau({ agreementId: "TA-2026-002", period: "Q3 2026", grossPremium: 100, cededPremium: 200 }).errors.cededPremium, "ceded cannot exceed gross");
  assert.equal(accountNet({ premium: 1000, commission: 200, claims: 300, tax: 50 }), 450);
});

test("an individual cession is rejected when its agreement does not enable declarations", () => {
  const cession = { insured: "Risk A", cls: "Property", sumInsured: 1e6, retention: 2e5, ceded: 8e5, effectiveDate: "2026-09-01" };
  assert.ok(validateCession({ ...cession, agreementId: "TA-2026-002" }, agreementById("TA-2026-002")).agreementId);
  assert.ok(svc.addCession({ ...cession, agreementId: "TA-2026-002" }).errors.agreementId);
  const ok = svc.addCession({ ...cession, agreementId: "TA-2025-003" });
  assert.ok(ok.record, "surplus treaty with declarations accepts it");
  assert.equal(ok.record.status, "Declared");
  assert.ok(svc.addCession({ ...cession, ceded: 2e6, agreementId: "TA-2025-003" }).errors.ceded, "ceded cannot exceed sum insured");
});

test("a Closed agreement cannot receive new operational transactions", () => {
  const closed = agreementById("TA-2024-005");
  assert.equal(closed.status, "Closed");
  assert.ok(svc.addPremiumBordereau({ agreementId: closed.id, period: "Q1 2026", grossPremium: 1, cededPremium: 1 }).errors.agreementId);
  assert.ok(svc.addClaimsBordereau({ agreementId: closed.id, period: "Q1 2026", claimCount: 1, paid: 0, outstanding: 0 }).errors.agreementId);
  assert.ok(svc.addTechnicalAccount({ agreementId: closed.id, period: "Q1 2026" }).errors.agreementId);
  assert.ok(svc.addSettlement({ agreementId: closed.id, counterparty: "Nanyang Re", amount: 1, dueDate: "2026-10-01" }).errors.agreementId);
  assert.equal(svc.addAgreementDocument(closed.id, { name: "x.pdf", type: "Other" }), null);
  assert.equal(svc.updateAgreement(closed.id, { basics: { name: "renamed" } }), null);
  assert.equal(svc.setAgreementStatus(closed.id, "Active"), null, "closed is terminal");
});

test("status transitions are explicit and audited", () => {
  const a = agreementById("TA-2026-001");
  assert.equal(a.status, "Active");
  assert.equal(svc.setAgreementStatus(a.id, "Closed", ""), a);
  assert.equal(a.status, "Closed");
  assert.match(a.audit.at(-1).action, /Status → Closed/);
  // Restore for other tests.
  a.status = "Active";
  assert.equal(svc.setAgreementStatus("TA-2026-002", "Draft Setup"), null, "cannot go backwards");
  assert.equal(svc.setRecordStatus("premiumBordereaux", "PB-0033", "Matched"), state.treaty.premiumBordereaux.find((b) => b.ref === "PB-0033"));
  assert.equal(svc.setRecordStatus("premiumBordereaux", "PB-0033", "Nonsense"), null);
});

test("filters and expiry indicator", () => {
  const all = state.treaty.agreements;
  assert.ok(filterAgreements(all, { type: "Quota Share" }).every((a) => a.type === "Quota Share"));
  assert.ok(filterAgreements(all, { status: "Closed" }).every((a) => a.status === "Closed"));
  assert.ok(filterAgreements(all, { reinsurer: "Comstock Re" }).every((a) => a.panel.some((p) => p.reinsurer === "Comstock Re")));
  assert.ok(filterAgreements(all, { ccy: "CAD" }).every((a) => a.ccy === "CAD"));
  assert.ok(filterAgreements(all, { period: "2024" }).some((a) => a.id === "TA-2024-005"));
  assert.ok(!filterAgreements(all, { period: "2024" }).some((a) => a.id === "TA-2026-002"));
  assert.ok(filterAgreements(all, { q: "northwind motor" }).every((a) => a.cedant === "Northwind Assurance Co."));
  assert.equal(expiryIndicator({ expiry: "2026-10-31" }, "2026-09-18").tone, "warn");
  assert.equal(expiryIndicator({ expiry: "2027-03-31" }, "2026-09-18").tone, "good");
  assert.equal(expiryIndicator({ expiry: "2026-06-30" }, "2026-09-18").tone, "bad");
});
