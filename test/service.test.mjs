/**
 * Placement service — the transitions that matter most are the ones that must
 * refuse. These run against the real store with the seat set to a broker.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, programById } from "../src/js/core/store.js";
import { USERS } from "../src/js/data/users.data.js";
import { STATUS, canBind, canSendProposal, canRecordCedantDecision } from "../src/js/domain/lifecycle.js";
import * as svc from "../src/js/services/placement.service.js";

const user = (id) => USERS.find((u) => u.id === id);
const asSeat = (id) => { state.session = user(id); };

/** A quota-share draft with a valid warranty and a two-market panel at 100%. */
function draft(overrides = {}) {
  asSeat("vr");
  return svc.saveDraft({
    cedant: "Meridian Mutual Insurance", cls: "Property", type: "Quota Share", ccy: "USD",
    terms: { insured: "Test Insured", sumInsured: 10e6, rate: 0.5, paymentWarrantyDays: 30, ...(overrides.terms || {}) },
    markets: overrides.markets || [{ m: "Zenith Re", offered: 60, line: 60 }, { m: "Baltic Re", offered: 40, line: 40 }],
  });
}

/** Walk a draft to Backup Secured: submit, release as a signatory, confirm every line. */
function toBackup(id) {
  asSeat("vr"); assert.ok(svc.submitForApproval(id), "submit");
  asSeat("ml"); assert.ok(svc.releaseSlip(id), "release");
  asSeat("vr");
  programById(id).marketConfirmations.forEach((mc) => svc.recordMarketResponse(id, mc.m, "Confirmed"));
  assert.equal(programById(id).status, STATUS.BACKUP);
  return programById(id);
}

function toApproved(id) {
  toBackup(id);
  assert.ok(svc.recordProposalSent(id, "v1"));
  assert.ok(svc.recordCedantApproval(id, "ok"));
  return programById(id);
}

beforeEach(() => asSeat("vr"));

test("1. a market decline after cedant approval voids the approval and the stale proposal", () => {
  const id = draft();
  const p = toApproved(id);
  assert.equal(p.status, STATUS.CEDANT_APPROVED);
  assert.ok(svc.recordMarketResponse(id, "Baltic Re", "Declined", { notes: "capacity withdrawn" }));
  assert.equal(p.status, STATUS.NEGOTIATING);
  assert.equal(p.cedantApproval, null);
  assert.equal(p.proposalStale, true);
  assert.ok(p.history.some((h) => h.action === "Cedant approval invalidated"));
  assert.ok(p.history.some((h) => h.action.startsWith("Proposal v1 marked stale")));
});

test("1. recovering the capacity does not restore the old approval; a new proposal and approval are required", () => {
  const id = draft();
  const p = toApproved(id);
  svc.recordMarketResponse(id, "Baltic Re", "Declined");
  svc.recordMarketResponse(id, "Baltic Re", "Reviewing");
  svc.recordMarketResponse(id, "Baltic Re", "Confirmed");
  assert.equal(p.status, STATUS.BACKUP, "capacity is back");
  assert.equal(p.cedantApproval, null, "old approval stays void");
  assert.ok(!canRecordCedantDecision(p), "no live proposal to approve");
  assert.ok(canSendProposal(p));
  svc.recordProposalSent(id, "v2");
  assert.equal(p.proposalVersion, 2);
  assert.ok(svc.recordCedantApproval(id, "ok v2"));
  assert.equal(p.cedantApproval.proposalVersion, 2);
});

test("1. an old bind instruction cannot bind after the panel changed", () => {
  const id = draft();
  const p = toApproved(id);
  assert.ok(svc.recordBindInstruction(id, { reference: "MM/1" }));
  assert.equal(p.status, STATUS.BIND_INSTRUCTED);
  svc.recordMarketResponse(id, "Zenith Re", "Declined");
  assert.equal(p.bindInstruction, null);
  assert.ok(p.history.some((h) => h.action === "Instruction to bind invalidated"));
  svc.recordMarketResponse(id, "Zenith Re", "Reviewing");
  svc.recordMarketResponse(id, "Zenith Re", "Confirmed");
  assert.ok(!canBind(p));
  assert.equal(svc.executeBinding(id), null, "binding on the void instruction is refused");
  assert.equal(p.status, STATUS.BACKUP);
});

test("1. a bound placement is never touched by a market response", () => {
  const id = draft();
  toApproved(id);
  svc.recordBindInstruction(id, { reference: "MM/2" });
  assert.ok(svc.executeBinding(id, "settle"));
  const p = programById(id);
  const historyLength = p.history.length;
  assert.equal(svc.recordMarketResponse(id, "Zenith Re", "Declined"), null);
  assert.equal(p.status, STATUS.BOUND);
  assert.equal(p.history.length, historyLength);
  assert.equal(p.marketConfirmations[0].s, "Confirmed");
});

test("2. a draft without a payment warranty cannot be submitted, and none is defaulted", () => {
  const id = draft({ terms: { paymentWarrantyDays: null } });
  const p = programById(id);
  assert.equal(p.terms.paymentWarrantyDays, null);
  assert.equal(svc.submitForApproval(id), null);
  assert.equal(p.status, STATUS.DRAFT);
  assert.equal(svc.setPaymentWarranty(id, 20), null, "unsupported period refused");
  assert.equal(svc.setPaymentWarranty(id, ""), null);
  assert.ok(svc.setPaymentWarranty(id, "45"));
  assert.equal(p.terms.paymentWarrantyDays, 45);
  assert.ok(svc.submitForApproval(id));
});

test("2. a renewal of a historical record without the field is blocked until it is completed", () => {
  const legacy = programById("P-1005");
  assert.equal(legacy.terms?.paymentWarrantyDays, undefined);
  asSeat("vr");
  svc.startRenewal("P-1005");
  assert.equal(legacy.status, STATUS.DRAFT);
  assert.equal(svc.submitForApproval("P-1005"), null, "legacy record cannot be re-submitted without a warranty");
});

test("4. a cedant revision forces a real slip revision before any new proposal", () => {
  const id = draft();
  const p = toApproved(id);
  assert.ok(svc.recordCedantRevision(id, "lower the rate"));
  assert.equal(p.status, STATUS.CEDANT_NEGOTIATION);
  assert.equal(p.cedantApproval, null);
  assert.equal(p.revisionRequired, true);
  assert.equal(svc.recordProposalSent(id, "same terms again"), null, "unchanged stale terms cannot be re-sent");
  assert.equal(svc.recordCedantApproval(id, "changed my mind"), null, "no live proposal to approve");
  // A panel change during negotiation still does not unlock a proposal.
  svc.recordMarketResponse(id, "Baltic Re", "Declined");
  svc.recordMarketResponse(id, "Baltic Re", "Reviewing");
  svc.recordMarketResponse(id, "Baltic Re", "Confirmed");
  assert.equal(p.status, STATUS.BACKUP);
  assert.ok(!canSendProposal(p), "revision still required");

  // The controlled path: revise → new slip version → approval → placement → backup → new proposal.
  const version = p.slipVersion;
  assert.ok(svc.reviseSlip(id, "rate 0.45"));
  assert.equal(p.status, STATUS.DRAFT);
  assert.equal(p.slipVersion, version + 1);
  assert.equal(p.revisionRequired, false);
  assert.ok(p.marketConfirmations.every((mc) => mc.s === "Sent"), "confirmations reset");
  assert.ok(svc.updateDraft(id, {
    cedant: p.cedant, cls: p.cls, type: p.type, ccy: p.ccy,
    terms: { ...p.terms, rate: 0.45 }, markets: p.marketConfirmations.map((mc) => ({ m: mc.m, line: mc.line })),
  }));
  assert.equal(p.slipVersion, version + 1, "updating the draft keeps the new version");
  toBackup(id);
  assert.ok(svc.recordProposalSent(id, "revised"));
  assert.equal(p.proposalVersion, 2);
  assert.equal(p.proposalSlipVersion, version + 1);
});

test("4. a historical Facultative placement can be revised without changing its form", () => {
  const p = programById("P-1007");
  assert.equal(p.type, "Facultative");
  assert.ok(svc.recordCedantRevision(p.id, "lower the rate"));
  assert.ok(svc.reviseSlip(p.id, "edit the historical slip"));
  assert.equal(p.status, STATUS.DRAFT);
  assert.ok(svc.updateDraft(p.id, {
    cedant: p.cedant, cls: p.cls, type: p.type, ccy: p.ccy,
    terms: { ...(p.terms || {}), insured: "Legacy Warehouse", sumInsured: 8e6, rate: 0.7, paymentWarrantyDays: 30 },
    markets: p.marketConfirmations.map((mc) => ({ m: mc.m, line: mc.line })),
  }));
  assert.equal(p.type, "Facultative");
  assert.equal(p.terms.rate, 0.7);
});
