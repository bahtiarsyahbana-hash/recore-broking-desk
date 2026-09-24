import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, programById } from "../src/js/core/store.js";
import { USERS } from "../src/js/data/users.data.js";
import { paymentState, allocateReceipt } from "../src/js/domain/payments.js";
import * as placement from "../src/js/services/placement.service.js";
import * as billing from "../src/js/services/billing.service.js";
import * as pay from "../src/js/services/payments.service.js";
import * as reg from "../src/js/services/registry.service.js";
import * as treaty from "../src/js/services/treaty.service.js";

const seat = (id) => { state.session = USERS.find((u) => u.id === id); };
let usd, remitUsd;

beforeEach(() => {
  seat("vr");
  state.billing.taxRules = []; state.billing.brokerAccounts = [];
  usd = billing.addBrokerAccount({ bankName: "Citibank", accountName: "MBRB", accountNo: "0012345678", ccy: "USD", purpose: "Collection" }).account;
  remitUsd = billing.addBrokerAccount({ bankName: "HSBC", accountName: "MBRB", accountNo: "0099887766", ccy: "USD", purpose: "Remittance" }).account;
});

/** Bind a 60/40 placement, issue its billing (20% commission, 10% brokerage) and return the batch. */
function issuedBatch() {
  seat("vr");
  const id = placement.saveDraft({ cedant: "Meridian Mutual Insurance", cls: "Property", type: "Quota Share", ccy: "USD",
    terms: { insured: "Pay Co", sumInsured: 100e6, rate: 1, paymentWarrantyDays: 30 },
    markets: [{ m: "Helvetia Continental Re", line: 60 }, { m: "Comstock Re", line: 40 }] });
  placement.submitForApproval(id); seat("ml"); placement.releaseSlip(id); seat("vr");
  programById(id).marketConfirmations.forEach((mc) => placement.recordMarketResponse(id, mc.m, "Confirmed"));
  placement.recordProposalSent(id, "v1"); placement.recordCedantApproval(id, "ok"); placement.recordBindInstruction(id, { reference: "P/1" });
  placement.executeBinding(id, "s");
  const [b] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(b.ref, { commissionPct: 20, brokeragePct: 10 });
  billing.submitBatch(b.ref); seat("ml"); billing.issueBatch(b.ref); seat("vr");
  return b;
}


test("a part-payment splits pro rata: 400,000 of 800,000 → 210,000 / 140,000 remitted, 50,000 brokerage", () => {
  const b = issuedBatch();
  const r = pay.recordReceipt(b.ref, { amount: 400000, receivedDate: "2026-09-18", accountId: usd.id, bankRef: "CITI-1" });
  assert.ok(r.receipt, JSON.stringify(r.errors));
  assert.deepEqual(r.remittances.map((m) => [m.reinsurer, m.cents / 100, m.status]), [["Helvetia Continental Re", 210000, "Draft"], ["Comstock Re", 140000, "Draft"]]);
  assert.equal(r.receipt.brokerageCents / 100, 50000);
  const st = pay.paymentOf(b.ref);
  assert.equal(st.status, "Part paid");
  assert.equal(st.outstanding / 100, 400000);
});

test("uneven part-payments land every remittance exactly on its closing slip", () => {
  const b = issuedBatch();
  [123456.78, 400000, 276543.22].forEach((amount) => assert.ok(pay.recordReceipt(b.ref, { amount, receivedDate: "2026-09-18", accountId: usd.id }).receipt));
  const bySlip = (id) => state.billing.remittances.filter((m) => m.closingSlipId === id).reduce((s, m) => s + m.cents, 0);
  assert.equal(bySlip(b.documents[1].id), b.documents[1].total);
  assert.equal(bySlip(b.documents[2].id), b.documents[2].total);
  assert.equal(state.billing.receipts.filter((r) => r.batchRef === b.ref).reduce((s, r) => s + r.brokerageCents, 0), b.computed.brokerageRetained);
  assert.equal(pay.paymentOf(b.ref).status, "Paid");
});

test("overpayment, wrong currency, wrong account purpose, future date and non-receivable documents are refused", () => {
  const b = issuedBatch();
  assert.ok(pay.checkReceipt(b.ref, { amount: 800000.01, receivedDate: "2026-09-18", accountId: usd.id }).amount, "overpayment");
  assert.ok(pay.checkReceipt(b.ref, { amount: 0, receivedDate: "2026-09-18", accountId: usd.id }).amount);
  const idr = billing.addBrokerAccount({ bankName: "Mandiri", accountName: "MBRB", accountNo: "1230004567", ccy: "IDR", purpose: "Collection" }).account;
  assert.match(pay.checkReceipt(b.ref, { amount: 1, receivedDate: "2026-09-18", accountId: idr.id }).accountId, /must be in USD/);
  assert.match(pay.checkReceipt(b.ref, { amount: 1, receivedDate: "2026-09-18", accountId: remitUsd.id }).accountId, /remittances/);
  assert.ok(pay.checkReceipt(b.ref, { amount: 1, receivedDate: "2027-01-01", accountId: usd.id }).receivedDate, "future date");
  assert.ok(pay.checkReceipt(b.ref, { amount: 1, receivedDate: "2026-09-18" }).accountId, "account required");
  const rev = billing.raiseCancellation(b.ref, "x");
  assert.ok(pay.checkReceipt(rev.ref, { amount: 1, receivedDate: "2026-09-18", accountId: usd.id }).doc, "a draft credit note takes no receipt");
});

test("remittance: four-eyes, destination account required, payment recorded from a remittance account", () => {
  const b = issuedBatch();
  const { remittances: [helv] } = pay.recordReceipt(b.ref, { amount: 800000, receivedDate: "2026-09-18", accountId: usd.id });
  assert.ok(pay.remittanceBlockers(helv).some((c) => c.key === "destination"), "no reinsurer bank account yet");
  assert.equal(pay.submitRemittance(helv.ref), null);
  reg.addBankAccount("Helvetia Continental Re", { bankName: "UBS", accountName: "Helvetia Continental Re", accountNo: "CH9300762011623852957", iban: "CH9300762011623852957", ccy: "USD" });
  assert.ok(pay.submitRemittance(helv.ref));
  assert.equal(pay.approveRemittance(helv.ref), null, "the preparer cannot approve");
  seat("ml");
  assert.ok(pay.approveRemittance(helv.ref));
  assert.equal(helv.payTo.bankName, "UBS");
  assert.equal(helv.approvedBy.name, "Maya Lindqvist");
  assert.ok(pay.checkRemittancePayment(helv.ref, { paidDate: "2026-09-18", accountId: usd.id, bankRef: "T1" }).accountId, "collection-only account refused");
  assert.ok(pay.checkRemittancePayment(helv.ref, { paidDate: "2026-09-18", accountId: remitUsd.id }).bankRef, "bank reference required");
  assert.ok(pay.recordRemittancePayment(helv.ref, { paidDate: "2026-09-18", accountId: remitUsd.id, bankRef: "HSBC-778" }).remittance);
  assert.equal(helv.status, "Paid");
  assert.equal(helv.fromAccount.bankName, "HSBC");
});

test("reversing a receipt cancels its unpaid remittances, and is refused once one is paid", () => {
  const b = issuedBatch();
  const first = pay.recordReceipt(b.ref, { amount: 400000, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(pay.reverseReceipt(first.receipt.ref, ""), null, "a reason is required");
  assert.ok(pay.reverseReceipt(first.receipt.ref, "posted to the wrong invoice").receipt);
  assert.ok(first.remittances.every((m) => m.status === "Cancelled"));
  assert.equal(pay.paymentOf(b.ref).status, "Unpaid");
  const second = pay.recordReceipt(b.ref, { amount: 400000, receivedDate: "2026-09-18", accountId: usd.id });
  const comstock = second.remittances.find((m) => m.reinsurer === "Comstock Re");
  reg.addBankAccount("Comstock Re", { bankName: "RBC", accountName: "Comstock Re", accountNo: "4445556667", ccy: "USD" });
  pay.submitRemittance(comstock.ref); seat("ao"); pay.approveRemittance(comstock.ref); seat("vr");
  pay.recordRemittancePayment(comstock.ref, { paidDate: "2026-09-18", accountId: remitUsd.id, bankRef: "HSBC-1" });
  assert.ok(pay.reverseReceipt(second.receipt.ref, "oops").errors, "money already out");
});

test("an invoice with receipts cannot be cancelled until they are reversed", () => {
  const b = issuedBatch();
  const r = pay.recordReceipt(b.ref, { amount: 100, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(billing.raiseCancellation(b.ref, "x"), null);
  pay.reverseReceipt(r.receipt.ref, "test");
  assert.ok(billing.raiseCancellation(b.ref, "x"));
});

test("credit control: premium is settled only when every invoice and debit note is paid in full", () => {
  const b = issuedBatch();
  const id = b.source.ref;
  assert.equal(programById(id).premiumPaid, false);
  const r1 = pay.recordReceipt(b.ref, { amount: 799999.99, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(programById(id).premiumPaid, false, "one cent short");
  pay.recordReceipt(b.ref, { amount: 0.01, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(programById(id).premiumPaid, true);
  const e = placement.recordEndorsement(id, { ref: "E1", date: "2026-10-01", premium: 10000 }).batch;
  billing.updateBatchTerms(e.ref, {}); billing.submitBatch(e.ref); seat("ml"); billing.issueBatch(e.ref); seat("vr");
  pay.recordReceipt(e.ref, { amount: 1, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(programById(id).premiumPaid, false, "an unpaid debit note reopens it");
  pay.reverseReceipt(r1.receipt.ref, "bounced");
  assert.equal(programById(id).premiumPaid, false);
});

test("overdue is derived from the due date", () => {
  const doc = { id: "INV-9", total: 100, dueDate: "2026-09-01" };
  assert.equal(paymentState(doc, [], "2026-09-18").label, "Overdue");
  assert.equal(paymentState(doc, [{ docId: "INV-9", cents: 100 }], "2026-09-18").label, "Paid");
  assert.equal(paymentState({ ...doc, dueDate: "2026-10-01" }, [], "2026-09-18").label, "Unpaid");
});

test("treaty: receipts drive remittances; manual settlements are refused for Finance-billed accounts", () => {
  const acc = treaty.addTechnicalAccount({ agreementId: "TA-2026-002", period: "Q1 2027", premium: 500000, commission: 140000, claims: 0 }).record;
  treaty.setRecordStatus("technicalAccounts", acc.ref, "Agreed");
  const [b] = billing.batchesForSource("treaty", acc.ref);
  billing.submitBatch(b.ref); seat("ml"); assert.ok(billing.issueBatch(b.ref)); seat("vr");
  const r = pay.recordReceipt(b.ref, { amount: b.documents[0].total / 100, receivedDate: "2026-09-18", accountId: usd.id });
  assert.equal(r.remittances.length, 2);
  assert.ok(pay.remittancesForAgreement("TA-2026-002").length >= 2);
  assert.match(treaty.addSettlement({ agreementId: "TA-2026-002", accountRef: acc.ref, counterparty: "Comstock Re", amount: 1, dueDate: "2026-10-01" }).errors.accountRef, /billed through Finance/);
  assert.ok(treaty.addSettlement({ agreementId: "TA-2026-002", accountRef: "", counterparty: "Comstock Re", amount: 1, dueDate: "2026-10-01" }).record, "manual settlement without a Finance-billed account still works");
});

test("cumulative split is exact even for one-cent receipts", () => {
  const batch = { documents: [{ id: "I", total: 1000 }, { id: "A", counterparty: "A", total: 333 }, { id: "B", counterparty: "B", total: 567 }], computed: { brokerageRetained: 100, taxesHeld: 0 } };
  let paid = 0; const sums = { A: 0, B: 0, brokerage: 0 };
  for (let i = 0; i < 1000; i++) { allocateReceipt(batch, paid, 1).forEach((x) => { sums[x.key] = (sums[x.key] || 0) + x.cents; }); paid += 1; }
  assert.deepEqual([sums.A, sums.B, sums.brokerage], [333, 567, 100]);
});
