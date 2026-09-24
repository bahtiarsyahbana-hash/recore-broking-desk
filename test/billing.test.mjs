import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { computeBilling, allocate, dueDate, issueAuthority, cedantDocType, placementWeights, taxRuleApplies, validateTaxRule, issueBlockers } from "../src/js/domain/billing.js";
import { state, programById, sequences } from "../src/js/core/store.js";
import { USERS } from "../src/js/data/users.data.js";
import { STATUS } from "../src/js/domain/lifecycle.js";
import * as placement from "../src/js/services/placement.service.js";
import * as billing from "../src/js/services/billing.service.js";
import * as treaty from "../src/js/services/treaty.service.js";

const seat = (id) => { state.session = USERS.find((u) => u.id === id); };
beforeEach(() => { seat("vr"); state.billing.taxRules = []; });

/** A QS placement walked all the way to Bound, returning its id. */
function boundPlacement({ warranty = 30, markets = [{ m: "Zenith Re", line: 60 }, { m: "Baltic Re", line: 40 }] } = {}) {
  seat("vr");
  const id = placement.saveDraft({ cedant: "Meridian Mutual Insurance", cls: "Property", type: "Quota Share", ccy: "USD",
    terms: { insured: "Billing Co", sumInsured: 100e6, rate: 1, paymentWarrantyDays: warranty }, markets });
  placement.submitForApproval(id);
  seat("ml"); placement.releaseSlip(id); seat("vr");
  programById(id).marketConfirmations.forEach((mc) => placement.recordMarketResponse(id, mc.m, "Confirmed"));
  placement.recordProposalSent(id, "v1"); placement.recordCedantApproval(id, "ok"); placement.recordBindInstruction(id, { reference: "B/1" });
  assert.ok(placement.executeBinding(id, "settle"));
  return id;
}

test("worked example: 1,000,000 · 20% commission · 10% brokerage · 60/40 panel", () => {
  const r = computeBilling({ sourceKind: "bind", gross: 1000000, commissionPct: 20, brokeragePct: 10,
    panel: [{ reinsurer: "A", weight: 0.6 }, { reinsurer: "B", weight: 0.4 }] });
  assert.equal(r.cedant.total, 800000_00);
  assert.deepEqual(r.slips.map((s) => s.total), [420000_00, 280000_00]);
  assert.equal(r.brokerageRetained, 100000_00);
  assert.ok(r.balanced);
});

test("shares always add back to the whole, including odd splits and negatives", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(-1001, [0.333, 0.333, 0.334]).reduce((s, x) => s + x, 0), -1001);
  const r = computeBilling({ sourceKind: "bind", gross: 1000000.01, commissionPct: 27.5, brokeragePct: 12.5,
    panel: [{ reinsurer: "A", weight: 1 / 3 }, { reinsurer: "B", weight: 1 / 3 }, { reinsurer: "C", weight: 1 / 3 }] });
  assert.ok(r.balanced, `balance ${r.balance}`);
});

test("custom tax rules: bearer decides the document, jurisdiction and line filter apply", () => {
  const rules = [
    { id: "T1", name: "Stamp duty", rate: 0.1, basis: "Gross premium", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "Indonesia", active: true },
    { id: "T2", name: "Withholding", rate: 2, basis: "Gross premium", bearer: "Reinsurer", appliesTo: "Placement", jurisdictionOf: "Reinsurer country", country: "Any", active: true },
    { id: "T3", name: "VAT on brokerage", rate: 11, basis: "Brokerage", bearer: "Broker", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "", active: true },
    { id: "T4", name: "Inactive", rate: 50, basis: "Gross premium", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "", active: false },
  ];
  const r = computeBilling({ sourceKind: "bind", gross: 1000000, commissionPct: 20, brokeragePct: 10, cedantCountry: "United States",
    panel: [{ reinsurer: "A", weight: 1, country: "Singapore" }], taxRules: rules });
  assert.ok(!r.cedant.lines.some((l) => l.label.startsWith("Stamp duty")), "Indonesia-only rule does not hit a US cedant");
  assert.ok(r.slips[0].lines.some((l) => l.label.startsWith("Less Withholding") && l.cents === -20000_00), "reinsurer tax withheld on the closing slip");
  assert.equal(r.brokerTaxes[0].cents, 11000_00, "broker-borne tax is recorded, not billed");
  assert.ok(r.balanced);
  const id = computeBilling({ sourceKind: "treaty", gross: 1000000, commissionAmount: 0, brokeragePct: 0, cedantCountry: "Indonesia",
    panel: [{ reinsurer: "A", weight: 1 }], taxRules: rules });
  assert.ok(id.cedant.lines.some((l) => l.label.startsWith("Stamp duty") && l.cents === 1000_00), "cedant tax added to the cedant document");
  assert.ok(!id.slips[0].lines.some((l) => l.label.includes("Withholding")), "placement-only rule skipped on a treaty");
  assert.ok(id.balanced);
  assert.ok(Object.keys(validateTaxRule({ name: "", rate: 120, basis: "x", bearer: "y" })).length >= 4);
  assert.ok(taxRuleApplies({ ...rules[0], country: "any" }, { sourceKind: "bind", cedantCountry: "Chile" }));
});

test("due date is the basis date plus the payment warranty, and nothing else", () => {
  assert.equal(dueDate("2026-09-18", 30), "2026-10-18");
  assert.equal(dueDate("2026-12-15", 45), "2027-01-29");
  assert.equal(dueDate("2026-09-18", null), null);
  assert.equal(dueDate("2026-09-18", 20), null, "unsupported warranty");
  assert.equal(dueDate(null, 30), null);
});

test("document types follow the event and the sign", () => {
  assert.equal(cedantDocType("bind", 1), "Invoice");
  assert.equal(cedantDocType("endorsement", 1), "Debit Note");
  assert.equal(cedantDocType("endorsement", -1), "Credit Note");
  assert.equal(cedantDocType("treaty", -1), "Credit Note");
  assert.equal(cedantDocType("reversal", -1), "Credit Note");
});

test("XoL weights apportion each layer's premium by limit, then by line", () => {
  const w = placementWeights({ layers: [
    { limit: 10, markets: [{ m: "A", line: 100 }] },
    { limit: 30, markets: [{ m: "A", line: 50 }, { m: "B", line: 50 }] },
  ] });
  assert.deepEqual(w, [{ reinsurer: "A", weight: 0.25 + 0.375 }, { reinsurer: "B", weight: 0.375 }]);
});

test("binding drafts billing — it does not issue it, and consumes no document number", () => {
  const invoiceSeq = sequences.invoice;
  const id = boundPlacement();
  const p = programById(id);
  assert.equal(p.status, STATUS.BOUND);
  const [batch] = billing.batchesForSource("bind", id);
  assert.equal(batch.status, "Draft");
  assert.equal(batch.documents.length, 0);
  assert.equal(sequences.invoice, invoiceSeq, "no invoice number taken by a draft");
  assert.equal(batch.basisDate, p.boundAt);
  assert.equal(batch.dueDate, dueDate(p.boundAt, 30));
  assert.equal(batch.computed.slips.length, 2);
  assert.ok(issueBlockers(batch).some((b) => b.key === "rates"), "commission and brokerage must be entered explicitly");
  assert.equal(billing.submitBatch(batch.ref), null);
});

test("four-eyes: the preparer cannot issue; a signatory can; numbers are sequential and documents frozen", () => {
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(batch.ref, { commissionPct: 20, brokeragePct: 10 });
  assert.ok(billing.submitBatch(batch.ref));
  assert.equal(billing.issueBatch(batch.ref), null, "preparer refused");
  seat("vr"); assert.ok(!issueAuthority(batch, state.session).allowed);
  const before = sequences.invoice; const beforeCs = sequences.closingSlip;
  seat("ml");
  assert.ok(billing.issueBatch(batch.ref));
  assert.equal(batch.status, "Issued");
  assert.equal(batch.approvedBy.name, "Maya Lindqvist");
  assert.equal(batch.documents[0].id, `INV-${before}`);
  assert.equal(batch.documents[0].docType, "Invoice");
  assert.equal(batch.documents[0].counterparty, "Meridian Mutual Insurance", "billed to the cedant");
  assert.deepEqual(batch.documents.slice(1).map((d) => d.id), [`CS-${String(beforeCs).padStart(4, "0")}`, `CS-${String(beforeCs + 1).padStart(4, "0")}`]);
  assert.ok(batch.documents.slice(1).every((d) => d.docType === "Closing Slip" && d.role === "Reinsurer"));
  assert.equal(batch.documents[0].dueDate, batch.dueDate);
  assert.equal(billing.updateBatchTerms(batch.ref, { commissionPct: 5 }), null, "issued batch is frozen");
  const total = batch.documents[0].total;
  billing.addTaxRule({ name: "Late levy", rate: 5, basis: "Gross premium", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "" });
  assert.equal(batch.documents[0].total, total, "a new tax rule does not touch an issued document");
  assert.ok(billing.markDocumentSent(batch.ref, batch.documents[0].id));
  assert.equal(batch.documents[0].delivery, "Sent");
});

test("administrator may approve their own batch, and the override is recorded", () => {
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  seat("adm");
  batch.preparedBy = { id: "adm", name: "Desk Administrator", title: "Administrator" };
  billing.updateBatchTerms(batch.ref, { commissionPct: 0, brokeragePct: 0 });
  billing.submitBatch(batch.ref);
  assert.ok(billing.issueBatch(batch.ref));
  assert.equal(batch.overrideUsed, true);
});

test("a missing payment warranty blocks issue until it is chosen on the draft", () => {
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(batch.ref, { commissionPct: 20, brokeragePct: 10, paymentWarrantyDays: "" });
  assert.equal(batch.dueDate, null);
  assert.equal(billing.submitBatch(batch.ref), null);
  assert.equal(billing.updateBatchTerms(batch.ref, { paymentWarrantyDays: 20 }), null, "unsupported period refused");
  billing.updateBatchTerms(batch.ref, { paymentWarrantyDays: 60 });
  assert.ok(billing.submitBatch(batch.ref));
});

test("endorsement billing: dated from the endorsement, debit for additional and credit for return premium", () => {
  const id = boundPlacement();
  const p = programById(id);
  const add = placement.recordEndorsement(id, { ref: "E1", date: "2026-11-01", premium: 50000 });
  assert.ok(add.batch);
  assert.equal(add.batch.cedantDocType, "Debit Note");
  assert.equal(add.batch.basisDate, "2026-11-01");
  assert.equal(add.batch.dueDate, "2026-12-01");
  const ret = placement.recordEndorsement(id, { ref: "E2", date: "2026-12-01", premium: -20000 });
  assert.equal(ret.batch.cedantDocType, "Credit Note");
  assert.ok(placement.recordEndorsement(id, { ref: "E2", date: "2026-12-02", premium: 1 }).errors.ref, "duplicate reference");
  assert.ok(placement.recordEndorsement(id, { date: "", premium: 0 }).errors.premium);
  assert.equal(p.endorsements.length, 2);
  assert.ok(p.boundTerms, "bound terms stay frozen");
});

test("treaty technical account reaching Agreed drafts billing from that date with the agreement's warranty", () => {
  const acc = treaty.addTechnicalAccount({ agreementId: "TA-2026-002", period: "Q3 2026", premium: 1680000, commission: 470400, claims: 900000, tax: 0 }).record;
  treaty.setRecordStatus("technicalAccounts", acc.ref, "Agreed");
  const [batch] = billing.batchesForSource("treaty", acc.ref);
  assert.ok(batch);
  assert.equal(batch.basisDate, acc.agreedAt);
  assert.equal(batch.paymentWarrantyDays, 90);
  assert.equal(batch.cedantDocType, "Invoice");
  assert.equal(batch.computed.cedant.total, (1680000 - 470400 - 900000) * 100);
  assert.equal(batch.computed.slips.length, 2);
  assert.ok(batch.computed.balanced);
  treaty.setRecordStatus("technicalAccounts", acc.ref, "Issued");
  treaty.setRecordStatus("technicalAccounts", acc.ref, "Agreed");
  assert.equal(billing.batchesForSource("treaty", acc.ref).length, 1, "no duplicate draft");
  const inFavour = treaty.addTechnicalAccount({ agreementId: "TA-2026-002", period: "Q4 2026", premium: 100000, commission: 28000, claims: 400000 }).record;
  treaty.setRecordStatus("technicalAccounts", inFavour.ref, "Agreed");
  assert.equal(billing.batchesForSource("treaty", inFavour.ref)[0].cedantDocType, "Credit Note");
});

test("cancellation is a reversing credit note under four-eyes; the original is cancelled only when it issues", () => {
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(batch.ref, { commissionPct: 20, brokeragePct: 10 });
  billing.submitBatch(batch.ref); seat("ml"); billing.issueBatch(batch.ref); seat("vr");
  const rev = billing.raiseCancellation(batch.ref, "wrong commission");
  assert.equal(rev.cedantDocType, "Credit Note");
  assert.equal(rev.computed.cedant.total, -batch.documents[0].total);
  assert.equal(batch.status, "Issued", "still issued while the reversal is a draft");
  assert.equal(billing.raiseCancellation(batch.ref, "again"), null, "one reversal at a time");
  assert.ok(billing.submitBatch(rev.ref));
  assert.equal(billing.issueBatch(rev.ref), null, "preparer cannot issue the reversal either");
  seat("ao"); assert.ok(billing.issueBatch(rev.ref));
  assert.equal(batch.status, "Cancelled");
  assert.equal(batch.cancelledBy, rev.documents[0].id);
  assert.ok(rev.documents.slice(1).every((d) => d.total < 0), "closing slips reversed too");
});

import { collectionAccountFor, validateBrokerAccount, invoiceTable, validateBrokerProfile } from "../src/js/domain/billing.js";
import { documentHtml } from "../src/js/ui/print-document.js";

test("broker bank accounts: validation, one primary per currency, collection by currency", () => {
  state.billing.brokerAccounts = [];
  assert.ok(billing.addBrokerAccount({ bankName: "", accountName: "", ccy: "USD", purpose: "Collection" }).errors.bankName);
  assert.ok(Object.keys(validateBrokerAccount({ bankName: "B", accountName: "A", accountNo: "1234567", ccy: "USD", purpose: "Other" })).includes("purpose"));
  assert.ok(billing.addBrokerAccount({ bankName: "DBS", accountName: "MBRB", accountNo: "123", ccy: "USD" }).errors.accountNo, "registry rules apply");
  const first = billing.addBrokerAccount({ bankName: "Citibank", accountName: "Meridian Bridge Re Brokers", accountNo: "0012345678", swift: "citiidjx", ccy: "USD", purpose: "Collection" }).account;
  assert.equal(first.primary, true, "first account in a currency becomes primary");
  assert.equal(first.swift, "CITIIDJX");
  const second = billing.addBrokerAccount({ bankName: "HSBC", accountName: "Meridian Bridge Re Brokers", accountNo: "0098765432", ccy: "USD", purpose: "Both", primary: "Yes" }).account;
  assert.equal(first.primary, false, "the new primary replaces the old one");
  const remit = billing.addBrokerAccount({ bankName: "Mandiri", accountName: "Meridian Bridge Re Brokers", accountNo: "1230004567", ccy: "IDR", purpose: "Remittance" }).account;
  assert.equal(collectionAccountFor(state.billing.brokerAccounts, "USD").id, second.id);
  assert.equal(collectionAccountFor(state.billing.brokerAccounts, "IDR"), null, "a remittance-only account is not a collection account");
  assert.equal(collectionAccountFor(state.billing.brokerAccounts, "EUR"), null, "no other currency's account is substituted");
  billing.updateBrokerAccount(second.id, { active: "No" });
  assert.equal(collectionAccountFor(state.billing.brokerAccounts, "USD").id, first.id, "inactive accounts are skipped");
  assert.ok(billing.removeBrokerAccount(remit.id));
});

test("an issued invoice keeps the pay-to account it was issued with", () => {
  state.billing.brokerAccounts = [];
  const acct = billing.addBrokerAccount({ bankName: "Citibank", accountName: "Meridian Bridge Re Brokers", accountNo: "0012345678", ccy: "USD", purpose: "Collection" }).account;
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(batch.ref, { commissionPct: 20, brokeragePct: 10 });
  assert.equal(batch.payTo.accountNo, "0012345678");
  billing.submitBatch(batch.ref); seat("ml"); billing.issueBatch(batch.ref); seat("vr");
  const invoice = batch.documents[0];
  assert.equal(invoice.payTo.accountNo, "0012345678");
  billing.updateBrokerAccount(acct.id, { accountNo: "0099999999" });
  assert.equal(invoice.payTo.accountNo, "0012345678", "later edits never change an issued document");
  assert.match(documentHtml(batch, invoice), /Citibank.*0012345678/s);
  assert.ok(batch.documents.slice(1).every((d) => !d.payTo), "closing slips carry no collection account");
  state.billing.brokerAccounts = [];
  const id2 = boundPlacement();
  const [b2] = billing.batchesForSource("bind", id2);
  billing.updateBatchTerms(b2.ref, { commissionPct: 20, brokeragePct: 10 });
  assert.equal(b2.payTo, null);
  assert.ok(billing.submitBatch(b2.ref), "a missing collection account warns but does not block");
  seat("ml"); billing.issueBatch(b2.ref); seat("vr");
  assert.match(documentHtml(b2, b2.documents[0]), /No collection account in USD/);
});

test("invoice table: taxes move into the Tax column of the line they are levied on, and Amount due equals the total", () => {
  const rules = [
    { id: "v", name: "VAT", rate: 11, basis: "Net premium", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "", active: true },
    { id: "s", name: "Stamp", rate: 0.1, basis: "Gross premium", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "", active: true },
    { id: "b", name: "Brokerage levy", rate: 1, basis: "Brokerage", bearer: "Cedant", appliesTo: "Both", jurisdictionOf: "Cedant country", country: "", active: true },
    { id: "w", name: "WHT", rate: 2, basis: "Net premium", bearer: "Reinsurer", appliesTo: "Both", jurisdictionOf: "Reinsurer country", country: "", active: true },
  ];
  for (const gross of [1000000, -250000]) {
    const r = computeBilling({ sourceKind: "bind", gross, commissionPct: 20, brokeragePct: 10, panel: [{ reinsurer: "A", weight: 0.6 }, { reinsurer: "B", weight: 0.4 }], taxRules: rules });
    const t = invoiceTable(r.cedant.lines);
    assert.equal(t.amountDue, r.cedant.total, `cedant amount due for ${gross}`);
    assert.equal(t.subtotal, r.cedant.lines.filter((l) => !l.ruleId).reduce((s, l) => s + l.cents, 0));
    assert.ok(!t.rows.some((row) => row.kind === "tax" && row.description.startsWith("VAT")), "rule taxes are not rows of their own");
    assert.ok(t.rows.some((row) => row.kind === "tax-row" && row.description === "Brokerage levy"), "tax on brokerage gets its own row");
    r.slips.forEach((slip) => assert.equal(invoiceTable(slip.lines).amountDue, slip.total, "closing slip amount due"));
    if (gross > 0) {
      const premium = t.rows.find((row) => row.kind === "premium");
      assert.equal(premium.tax, 110000_00 + 1000_00, "11% of the premium plus 0.1% stamp");
      assert.equal(t.rows.find((row) => row.kind === "commission").tax, -22000_00);
      assert.equal(t.discount, 0, "no discount line, so none is shown");
    }
  }
});

test("broker profile: legal name required, printed as From, frozen onto issued documents", () => {
  assert.ok(validateBrokerProfile({ legalName: "" }).legalName);
  assert.ok(validateBrokerProfile({ legalName: "X", email: "nope" }).email);
  assert.ok(billing.updateBrokerProfile({ legalName: "" }).errors.legalName);
  billing.updateBrokerProfile({ address: "Jl. Sudirman Kav. 52", postalCode: "12190", country: "Indonesia", email: "finance@mbrb.co.id" });
  assert.equal(state.billing.brokerProfile.postalCode, "12190");
  const id = boundPlacement();
  const [batch] = billing.batchesForSource("bind", id);
  billing.updateBatchTerms(batch.ref, { commissionPct: 20, brokeragePct: 10 });
  billing.submitBatch(batch.ref); seat("ml"); billing.issueBatch(batch.ref); seat("vr");
  const invoice = batch.documents[0];
  assert.equal(invoice.from.postalCode, "12190");
  assert.equal(invoice.billTo.legalName, "Meridian Mutual Insurance");
  billing.updateBrokerProfile({ postalCode: "10110" });
  assert.equal(invoice.from.postalCode, "12190", "issued document keeps its details");
  const html = documentHtml(batch, invoice);
  const order = ["<h1>Invoice</h1>", "Invoice number", "Date issued", "Date due", ">From<", "Jl. Sudirman Kav. 52", "12190", "finance@mbrb.co.id", ">Bill to<", "<th>Description</th>", ">Tax<", ">Amount<", ">Total<", "Subtotal", "VAT / Tax", "Amount due"];
  let at = -1;
  order.forEach((needle) => { const i = html.indexOf(needle, at + 1); assert.ok(i > at, `"${needle}" in order`); at = i; });
  assert.ok(!html.includes(">Discount<"), "discount row hidden when there is none");
});
