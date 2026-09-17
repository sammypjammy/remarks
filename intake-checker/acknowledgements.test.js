import test from "node:test";
import assert from "node:assert/strict";
import { createAcknowledgements, validationSummary } from "./acknowledgements.js";

test("acknowledgement leaves frozen validator output intact and distinguishes repeated fields", () => {
  const issues = Object.freeze([Object.freeze({ field: "Email", severity: "error" }), Object.freeze({ field: "Email", severity: "error" })]);
  const state = createAcknowledgements(issues);
  state.review(issues[0]);
  state.review(issues[0]);
  assert.deepEqual(state.remaining(), [issues[1]]);
  assert.equal(issues.length, 2);
  assert.equal(createAcknowledgements(issues).remaining().length, 2);
});
test("unknown acknowledgement does not hide an issue with the same values", () => {
  const state = createAcknowledgements([{ field: "Email" }]);
  state.review({ field: "Email" });
  assert.equal(state.remaining().length, 1);
});
test("visible counts track remaining error and warning severities", () => {
  const issues = [{ severity: "error" }, { severity: "warning" }];
  assert.equal(validationSummary(issues, issues, false).text, "2 issues requiring attention · 1 error · 1 warning");
  assert.equal(validationSummary(issues, [issues[1]], false).text, "1 issue requiring attention · 0 errors · 1 warning");
});
test("all reviewed differs from genuine validation success", () => {
  assert.deepEqual(validationSummary([{ severity: "error" }], [], false), { text: "All validation issues reviewed", success: false });
  assert.deepEqual(validationSummary([], [], false), { text: "No issues found under the active V1 rules.", success: true });
});
test("partial parsing never shows genuine success even after acknowledgement", () => {
  assert.deepEqual(validationSummary([], [], true), { text: "No issues found in the recognized data. Parsing needs review.", success: false });
  assert.equal(validationSummary([{ severity: "warning" }], [], true).success, false);
});
test("Review and Validation acknowledgements are independent and remain in memory", () => {
  const items = [{ message: "Synthetic" }];
  const review = createAcknowledgements(items);
  const validation = createAcknowledgements(items);
  review.review(items[0]);
  assert.equal(review.remaining().length, 0);
  assert.equal(validation.remaining().length, 1);
  assert.deepEqual(items, [{ message: "Synthetic" }]);
});
