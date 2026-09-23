import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIVISIONS, picsOf, picsByDivision, validatePic, validateBankAccount, bankAccountsOf, maskAccount, isValidSwift, isValidIban,
} from "../src/js/domain/counterparty-profile.js";
import { state, counterpartyNamed } from "../src/js/core/store.js";
import {
  addCounterparty, updateCounterparty, addPic, updatePic, removePic, addBankAccount, updateBankAccount, removeBankAccount, categoryOf,
} from "../src/js/services/registry.service.js";

test("legacy single-contact fields read as PICs by division without being rewritten", () => {
  const legacy = { name: "Old Co", contactName: "Rina", contactTitle: "Head of Treaty", contactEmail: "r@old.co", claimsContactName: "Budi", claimsContactEmail: "b@old.co" };
  const pics = picsOf(legacy);
  assert.equal(pics.length, 2);
  assert.ok(pics.every((p) => p.legacy));
  const groups = picsByDivision(legacy);
  assert.deepEqual(groups.map((g) => g.division), ["Placement / Underwriting", "Claims"]);
  assert.equal(legacy.pics, undefined, "record not mutated on read");
});

test("PIC and bank validation", () => {
  assert.deepEqual(validatePic({ name: "A", division: DIVISIONS[1], email: "a@b.co" }), {});
  assert.ok(validatePic({ name: "", division: "Claims", email: "a@b.co" }).name);
  assert.ok(validatePic({ name: "A", division: "Nope", email: "a@b.co" }).division);
  assert.ok(validatePic({ name: "A", division: "Claims" }).email, "needs email or phone");
  assert.ok(validatePic({ name: "A", division: "Claims", phone: "+62 21 555" }).email === undefined);
  assert.deepEqual(validateBankAccount({ bankName: "Mandiri", accountName: "PT X", accountNo: "1230004567", ccy: "IDR", swift: "BMRIIDJA" }), {});
  assert.ok(validateBankAccount({ bankName: "Mandiri", accountName: "PT X", ccy: "IDR" }).accountNo, "account or IBAN required");
  assert.ok(validateBankAccount({ bankName: "M", accountName: "X", accountNo: "123", ccy: "USD" }).accountNo, "too short");
  assert.ok(validateBankAccount({ bankName: "M", accountName: "X", accountNo: "1234567", ccy: "USD", swift: "BAD" }).swift);
  assert.ok(isValidSwift("DEUTDEFF500") && isValidSwift("bmriidja") && !isValidSwift("DEUTDEFF5"));
  assert.ok(isValidIban("GB82 WEST 1234 5698 7654 32") && !isValidIban("GB82"));
  assert.equal(maskAccount("1230004567"), "••••••4567");
});

test("service: profile edit keeps the name, PICs group by division with several per division, banks keep one primary", () => {
  const stored = addCounterparty("reg-others", { name: "Test Adjusters Ltd", country: "Singapore", role: "Loss adjuster", status: "Active" });
  assert.equal(categoryOf(stored), "reg-others");

  updateCounterparty(stored.name, { name: "Renamed", country: "Malaysia", notes: "  fast  ", regulator: "" });
  assert.equal(stored.name, "Test Adjusters Ltd", "name is immutable");
  assert.equal(stored.country, "Malaysia");
  assert.equal(stored.notes, "fast");
  assert.equal(stored.regulator, undefined);

  assert.equal(addPic(stored.name, { name: "", division: "Claims" }), null, "invalid PIC refused");
  const a = addPic(stored.name, { name: "Ana", division: "Claims", email: "ana@t.co", primary: true });
  const b = addPic(stored.name, { name: "Ben", division: "Claims", phone: "+65 6555 0100" });
  addPic(stored.name, { name: "Cal", division: "Technical Accounting / Finance", email: "cal@t.co" });
  const groups = picsByDivision(stored);
  assert.deepEqual(groups.map((g) => [g.division, g.pics.length]), [["Claims", 2], ["Technical Accounting / Finance", 1]]);
  updatePic(stored.name, b.id, { primary: true });
  assert.equal(stored.pics.find((p) => p.id === a.id).primary, false, "one primary per division");
  removePic(stored.name, a.id);
  assert.equal(picsOf(stored).length, 2);

  const first = addBankAccount(stored.name, { bankName: "DBS", accountName: "Test Adjusters Ltd", accountNo: "0123456789", ccy: "SGD", swift: "dbsssgsg" });
  assert.equal(first.primary, true, "first account becomes primary");
  assert.equal(first.swift, "DBSSSGSG");
  const second = addBankAccount(stored.name, { bankName: "HSBC", accountName: "Test Adjusters Ltd", iban: "GB82WEST12345698765432", ccy: "GBP", primary: true });
  assert.equal(second.primary, true);
  assert.equal(stored.bankAccounts.find((x) => x.id === first.id).primary, false);
  assert.equal(updateBankAccount(stored.name, first.id, { swift: "BAD" }), null, "invalid edit refused");
  removeBankAccount(stored.name, second.id);
  assert.equal(bankAccountsOf(stored)[0].primary, true, "primary falls back to the remaining account");
  assert.ok(stored.profileUpdated);
});

test("service: editing a legacy contact converts it into a structured PIC and retires the old field from display", () => {
  const legacy = addCounterparty("reg-brokers", { name: "Legacy Brokers Pte", country: "Singapore", role: "Co-broker", status: "Active", contactName: "Dewi", contactEmail: "dewi@lb.sg" });
  const [pic] = picsOf(legacy);
  assert.ok(pic.legacy);
  const converted = updatePic(legacy.name, pic.id, { title: "Director", division: "Management" });
  assert.ok(converted && !converted.legacy);
  const pics = picsOf(legacy);
  assert.equal(pics.length, 1, "no duplicate of the legacy contact");
  assert.equal(pics[0].division, "Management");
  assert.equal(legacy.contactName, "Dewi", "original field untouched");
  assert.ok(counterpartyNamed("Legacy Brokers Pte"));
  assert.ok(state.brokers.includes(legacy));
});
