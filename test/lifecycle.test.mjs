import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, normaliseStatus, stageOf, stepIndexFor, statusAfterMarketResponse,
  canSendProposal, canRecordBindInstruction, canBind, nextAction, bindChecklist, LIFECYCLE_STEPS,
} from "../src/js/domain/lifecycle.js";

const qs = (lines) => ({ status: STATUS.PLACED, type: "Quota Share", marketConfirmations: lines });

test("legacy statuses map onto the canonical vocabulary and Kanban columns", () => {
  assert.equal(normaliseStatus("Slip Issued"), STATUS.PLACED);
  assert.equal(normaliseStatus("Negotiating"), STATUS.NEGOTIATING);
  assert.equal(normaliseStatus("Cedant Approval"), STATUS.PROPOSAL_SENT);
  assert.equal(normaliseStatus("Bound"), STATUS.BOUND);
  assert.equal(stageOf({ status: "Slip Issued" }).column, "Market Negotiation");
  assert.equal(stageOf({ status: "Pending Approval" }).column, "Draft Slip");
  assert.equal(stageOf({ status: "Cedant Approval" }).column, "Proposal Sent");
  assert.equal(stageOf({ status: "Renewal Due" }).column, "Bound Issued");
  assert.equal(stageOf({ status: "Cedant Approved" }).substatus, "Awaiting instruction to bind");
  assert.equal(LIFECYCLE_STEPS.length, 6);
  assert.equal(stepIndexFor("Issue Slip"), 2);
  const legacyProposal = {
    status: "Cedant Approval",
    marketConfirmations: [{ m: "A", s: "Confirmed", line: 100 }],
  };
  const proposalItem = bindChecklist(legacyProposal).find((item) => item.label === "Proposal sent to cedant");
  assert.equal(proposalItem.state, "done");
  assert.equal(proposalItem.detail, "Recorded; date unavailable");
});

test("market stage follows the panel: sent → negotiation → backup secured → back on decline", () => {
  const p = qs([{ m: "A", s: "Sent", line: 60 }, { m: "B", s: "Sent", line: 40 }]);
  assert.equal(statusAfterMarketResponse(p), STATUS.PLACED);
  p.marketConfirmations[0].s = "Confirmed";
  assert.equal(statusAfterMarketResponse(p), STATUS.NEGOTIATING);
  p.marketConfirmations[1].s = "Confirmed";
  assert.equal(statusAfterMarketResponse(p), STATUS.BACKUP);
  p.status = STATUS.BACKUP;
  p.marketConfirmations[1].s = "Declined";
  assert.equal(statusAfterMarketResponse(p), STATUS.NEGOTIATING);
});

test("backup secured is not cedant approval; approval is not an instruction to bind", () => {
  const p = qs([{ m: "A", s: "Confirmed", line: 100 }]);
  p.status = STATUS.BACKUP;
  assert.ok(canSendProposal(p));
  assert.ok(!canBind(p));
  p.status = STATUS.CEDANT_APPROVED;
  assert.ok(!canRecordBindInstruction(p), "approval must be recorded, not implied by status");
  p.cedantApproval = { at: "2026-09-18", by: "VR", proposalVersion: 1 };
  assert.ok(canRecordBindInstruction(p));
  assert.ok(!canBind(p), "cedant approval alone cannot bind");
  p.status = STATUS.BIND_INSTRUCTED;
  p.bindInstruction = { at: "2026-09-18", reference: "MM/123" };
  assert.ok(canBind(p));
  p.marketConfirmations[0].s = "Declined";
  assert.ok(!canBind(p), "capacity must still be confirmed at bind");
});

test("renewal due never binds off the expiring panel", () => {
  const p = { status: "Renewal Due", marketConfirmations: [{ m: "A", s: "Confirmed", line: 100 }], bindInstruction: {} };
  assert.ok(!canBind(p));
  assert.equal(nextAction(p, {}).action, "start-renewal");
  assert.equal(bindChecklist(p)[0].state, "blocking");
});

test("next action names the explicit cedant steps", () => {
  const p = qs([{ m: "A", s: "Confirmed", line: 100 }]);
  p.status = STATUS.BACKUP;
  assert.equal(nextAction(p, {}).action, "proposal-sent");
  p.status = STATUS.PROPOSAL_SENT;
  assert.equal(nextAction(p, {}).action, "cedant-approved");
  p.status = STATUS.CEDANT_APPROVED; p.cedantApproval = { at: "x", by: "y" };
  assert.equal(nextAction(p, {}).action, "bind-instructed");
  p.status = STATUS.BIND_INSTRUCTED; p.bindInstruction = { at: "x" };
  const n = nextAction(p, {});
  assert.equal(n.action, "bind");
  assert.ok(!n.blocked);
});
