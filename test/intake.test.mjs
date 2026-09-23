import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionIntake, intakeReadiness, intakeToDraft, intakeEditable,
  PAYMENT_WARRANTY_DAYS, PLACEMENT_TYPES, EDITABLE_PLACEMENT_TYPES,
} from "../src/js/domain/intake.js";

const good = { id: "IN-1", cedant: "X", insuredName: "Y", cls: "Property", requestedType: "Quota Share", sumInsured: 1e6, ccy: "USD", rate: 0.5, paymentWarrantyDays: 30 };

test("intake lifecycle transitions", () => {
  assert.ok(canTransitionIntake("Received", "Under Review"));
  assert.ok(canTransitionIntake("Under Review", "Accepted"));
  assert.ok(canTransitionIntake("Under Review", "Revision Requested"));
  assert.ok(canTransitionIntake("Revision Requested", "Under Review"));
  assert.ok(!canTransitionIntake("Received", "Accepted"), "no skipping review");
  assert.ok(!canTransitionIntake("Declined", "Under Review"));
  assert.ok(!intakeEditable({ status: "Converted to Placement" }));
});

test("readiness and the copy handed to the placement draft", () => {
  assert.deepEqual(intakeReadiness(good), []);
  assert.ok(intakeReadiness({ ...good, requestedType: "Surplus" }).length, "new placements are QS or XoL only");
  assert.ok(intakeReadiness({ ...good, paymentWarrantyDays: 20 }).length);
  assert.deepEqual(PAYMENT_WARRANTY_DAYS, [15, 30, 45, 60, 90]);
  const d = intakeToDraft(good);
  assert.equal(d.type, "Quota Share");
  assert.equal(d.terms.insured, "Y");
  assert.equal(d.terms.paymentWarrantyDays, 30);
  assert.equal(d.intakeRef, "IN-1");
});

import { isValidPaymentWarranty, boardIntakes } from "../src/js/domain/intake.js";
import { paymentWarrantyCheck, readyToSubmit } from "../src/js/domain/slip-approval.js";

test("payment warranty: null, blank, unsupported and invalid values are rejected; nothing is defaulted", () => {
  for (const bad of [null, undefined, "", " ", 0, 20, "20", 30.5, "thirty", true, NaN]) {
    assert.ok(!isValidPaymentWarranty(bad), `rejects ${String(bad)}`);
    assert.ok(intakeReadiness({ ...good, paymentWarrantyDays: bad }).length > 0, `intake with ${String(bad)} is not ready`);
    assert.ok(!paymentWarrantyCheck({ terms: { paymentWarrantyDays: bad } }).ok);
  }
  for (const ok of [15, 30, 45, 60, 90, "60"]) assert.ok(isValidPaymentWarranty(ok), `accepts ${ok}`);
  assert.equal(intakeToDraft({ ...good, paymentWarrantyDays: null }).terms.paymentWarrantyDays, null);
  const placed = { marketConfirmations: [{ m: "A", line: 100 }], terms: {} };
  assert.ok(!readyToSubmit(placed).ready);
  assert.match(readyToSubmit(placed).reason, /Payment warranty is not set/);
  placed.terms.paymentWarrantyDays = 30;
  assert.ok(readyToSubmit(placed).ready);
});

test("board intakes: open only, narrowed by the type filter", () => {
  const list = [
    { id: "IN-1", status: "Received", requestedType: "Quota Share" },
    { id: "IN-2", status: "Under Review", requestedType: "Excess of Loss" },
    { id: "IN-3", status: "Converted to Placement", requestedType: "Quota Share" },
    { id: "IN-4", status: "Declined", requestedType: "Excess of Loss" },
    { id: "IN-5", status: "Revision Requested", requestedType: "Quota Share" },
  ];
  assert.deepEqual(boardIntakes(list).map((i) => i.id), ["IN-1", "IN-2", "IN-5"]);
  assert.deepEqual(boardIntakes(list, "Quota Share").map((i) => i.id), ["IN-1", "IN-5"]);
  assert.deepEqual(boardIntakes(list, "Excess of Loss").map((i) => i.id), ["IN-2"]);
  assert.deepEqual(boardIntakes(list, "Facultative"), []);
});

test("new placement types stay restricted while historical forms remain editable", () => {
  assert.deepEqual(PLACEMENT_TYPES, ["Quota Share", "Excess of Loss"]);
  assert.deepEqual(EDITABLE_PLACEMENT_TYPES, ["Quota Share", "Excess of Loss", "Facultative", "Surplus"]);
});
