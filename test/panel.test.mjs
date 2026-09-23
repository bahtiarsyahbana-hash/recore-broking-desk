import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityUnits, backupSecured, signedLinesComplete, canRecordResponse, panelEntries } from "../src/js/domain/panel.js";
import { readyToSubmit } from "../src/js/domain/slip-approval.js";

test("quota share: one unit, exact 100% with rounding tolerance", () => {
  const p = { marketConfirmations: [{ m: "A", s: "Confirmed", line: 33.33 }, { m: "B", s: "Confirmed", line: 33.33 }, { m: "C", s: "Confirmed", line: 33.34 }] };
  assert.equal(capacityUnits(p).length, 1);
  assert.ok(backupSecured(p));
  assert.ok(signedLinesComplete(p).complete);
  p.marketConfirmations[2].line = 30;
  assert.ok(!signedLinesComplete(p).complete);
  assert.match(readyToSubmit(p).reason, /97%/);
});

test("excess of loss: every layer must independently reach 100%", () => {
  const p = {
    type: "Excess of Loss",
    layers: [
      { limit: 10e6, attachment: 5e6, markets: [{ m: "A", s: "Confirmed", line: 100 }] },
      { limit: 20e6, attachment: 15e6, markets: [{ m: "B", s: "Confirmed", line: 50 }, { m: "C", s: "Sent", line: 50 }] },
    ],
  };
  const units = capacityUnits(p, (n) => `${n / 1e6}m`);
  assert.equal(units.length, 2);
  assert.equal(units[1].label, "Layer 2 · 20m xs 15m");
  assert.ok(units[0].backupSecured);
  assert.ok(!units[1].backupSecured);
  assert.ok(!backupSecured(p), "one confirmed layer does not secure the tower");
  assert.ok(signedLinesComplete(p).complete, "signed lines are complete on both layers");
  p.layers[1].markets[1].s = "Confirmed";
  assert.ok(backupSecured(p));
  assert.equal(panelEntries(p).length, 3);
  assert.equal(panelEntries(p)[2].layer, 1);
  p.layers.push({ limit: 5e6, attachment: 35e6, markets: [] });
  assert.match(signedLinesComplete(p).reason, /Layer 3 has no markets/);
});

test("market responses move only along the allowed paths", () => {
  assert.ok(canRecordResponse("Sent", "Reviewing"));
  assert.ok(canRecordResponse(undefined, "Confirmed"));
  assert.ok(canRecordResponse("Quoted", "Confirmed"));
  assert.ok(!canRecordResponse("Confirmed", "Quoted"));
  assert.ok(canRecordResponse("Confirmed", "Declined"));
  assert.ok(!canRecordResponse("Declined", "Confirmed"));
});
