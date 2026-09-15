import test from "node:test";
import assert from "node:assert/strict";
import { formatFaxNumber, manualFaxNumber } from "../fax-sender/contacts.js";

test("manual destination detection supports local +1 entry and explicit international E.164", () => {
  for (const input of ["8335551234", "(833) 555-1234", "18335551234", "+1 (833) 555-1234"]) {
    assert.equal(manualFaxNumber(input), "+18335551234");
  }
  assert.equal(manualFaxNumber("+44 20 7946 0958"), "+442079460958");
  for (const input of ["San Antonio", "", "5551234", "8335551234 ext 5", "++18335551234", "00442079460958"]) {
    assert.equal(manualFaxNumber(input), "");
  }
});

test("display formatting never rewrites international or nonstandard numbers", () => {
  assert.equal(formatFaxNumber("+18335150518"), "(833) 515-0518");
  for (const number of ["+442079460958", "+33123456789", "8335551234", "not-a-number"]) {
    assert.equal(formatFaxNumber(number), number);
  }
});
