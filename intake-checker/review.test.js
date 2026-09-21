import test from "node:test";
import assert from "node:assert/strict";
import { parseIntake } from "./parser.js";
import { reviewIntake } from "./review.js";
import { validateIntake } from "./validation.js";
import { incomeFields } from "./review-fields.js";

const review = text => reviewIntake(parseIntake(text));
const messages = text => review(text).items.map(item => item.message);
const personal = "PERSONAL INFORMATION\nFirst Name: Synthetic\nLast Name: Example\nEmail: synthetic@example.test\nSocial Security Number: ";
test("summary returns only last four, preserving leading zeroes", () => {
  const result = review(personal + "900-00-0742");
  assert.equal(result.identifier, "Synthetic Example 0742");
  assert.equal(result.email, "synthetic@example.test");
  assert(!JSON.stringify(result).includes("900-00-0742"));
});
for (const value of ["", "Not provided", "abc", "123"]) test(`no fabricated SSN for ${value || 'empty'}`, () => {
  assert.equal(review(personal + value).identifier, "Synthetic Example");
});
test("missing and duplicate identity fields are safe", () => {
  assert.equal(review("PERSONAL INFORMATION").identifier, "");
  assert.equal(review("PERSONAL INFORMATION").email, "");
  assert.equal(review(personal + "900-00-0742\nSocial Security Number: 900-00-9999").identifier, "Synthetic Example");
  assert.equal(review(personal + "900-00-0742\nPERSONAL INFORMATION\nFirst Name: Other").identifier, "");
});
for (const count of [10, 11]) test(`${count} populated medical problems`, () => {
  const text = "MEDICAL PROBLEMS\n" + Array.from({ length: count }, (_, i) => `Problem ${i + 1}: Synthetic condition`).join("\n") + "\nProblem 20: Not provided\nProblem 21:";
  assert.equal(messages(text).includes("More than 10 medical conditions"), count > 10);
});
for (const [section, label, message] of [
  ["EMPLOYMENT INFORMATION", "Currently working", "Currently working"],
  ["OTHER NAMES", "Used other names in medical records", "Other names used"]
]) for (const value of ["Yes", "true", "No", "false", "Not provided", "Yes, previously"]) test(`${label}: ${value}`, () => {
  assert.equal(messages(`${section}\n${label}: ${value}`).includes(message), ["Yes", "true"].includes(value));
});
for (const label of incomeFields) test(`explicit income: ${label}`, () => {
  assert.deepEqual(messages(`FINANCIAL SUPPORT\n${label}: Yes`), ["Receiving income"]);
  assert.deepEqual(messages(`FINANCIAL SUPPORT\n${label}: No`), []);
});
test("income is consolidated and ambiguous support/amounts are ignored", () => {
  assert.deepEqual(messages("FINANCIAL SUPPORT\n" + incomeFields.map(label => `${label}: Yes`).join("\n")), ["Receiving income"]);
  assert.deepEqual(messages("**FINANCIAL SUPPORT**\n**Food Stamps - Receive Food Stamps:**Yes\n**Veteran Benefits - Monthly amount:**500\n**Other Support - Section 8 Housing:**Yes\n**Other Support - Stay with Family:**Yes\n**Other Support - Part Time Work:**Yes\n**Other Support - Other:**Yes"), []);
});
test("conflicting duplicate answers and unrelated sections do not trigger", () => {
  assert.deepEqual(messages("EMPLOYMENT INFORMATION\nCurrently working: Yes\nCurrently working: No"), []);
  assert.deepEqual(messages("REMARKS/COMMENTS\nCurrently working: Yes"), []);
  assert.deepEqual(messages("MARRIAGE INFORMATION\nMarital Status: Married\nCurrent Spouse\nFirst Name: Not provided"), []);
});
const work = (start, end, onset = "2025-01-01") => `DISABILITY INFORMATION\nOnset date of disability: ${onset}\nWORK HISTORY\nMost Recent Job\nStart Date: ${start}\nEnd Date: ${end}`;
for (const [start, end, onset, expected] of [
  ["2025-01-02", "2025-04-02", "2025-01-01", true],
  ["2025-01-02", "2025-04-03", "2025-01-01", false],
  ["2025-01-01", "2025-01-02", "2025-01-01", false],
  ["2024-12-31", "2025-01-02", "2025-01-01", false],
  ["2025-01-31", "2025-04-30", "2025-01-01", true],
  ["2025-01-31", "2025-05-01", "2025-01-01", false],
  ["2023-11-30", "2024-02-29", "2023-01-01", true],
  ["2024-11-30", "2025-02-28", "2024-01-01", true],
  ["2025-02-01", "2025-02-01", "2025-01-01", true],
  ["2025-02-01", "2025-01-31", "2025-01-01", false],
  ["2025-02", "2025-03-01", "2025-01-01", false],
  ["2025-02-01", "2025-03", "2025-01-01", false],
  ["2025-02-01", "2025-03-01", "2025-01", false],
  ["bad", "2025-03-01", "2025-01-01", false],
  ["2025-02-01", "2025-02-30", "2025-01-01", false],
  ["2025-02-01", "2025-03-01", "bad", false],
  ["", "2025-03-01", "2025-01-01", false],
  ["2025-02-01", "", "2025-01-01", false],
  ["2025-02-01", "2025-03-01", "", false],
  ["2/1/2025", "May 1, 2025", "January 1, 2025", true]
]) test(`work ${start} to ${end}, onset ${onset}`, () => {
  assert.equal(review(work(start, end, onset)).items.length, Number(expected));
});
test("only the Most Recent Job can create a failed-work-attempt review", () => {
  const text = work("2025-02-01", "2025-03-01") + "\nPrevious Job\nStart Date: 2025-02-02\nEnd Date: 2025-03-02\nPrevious Job\nStart Date: 2025-02-03\nEnd Date: 2025-03-03";
  const items = review(text).items;
  assert.equal(items.length, 1);
  assert(items[0].message.endsWith(text.slice(items[0].range.start, items[0].range.end)));
});
test("an End Date on or before onset does not create the after-onset review", () => {
  assert.deepEqual(messages(work("2025-02-01", "2024-12-31", "2025-01-01")), []);
});
test("ambiguous work dates are skipped", () => {
  assert.deepEqual(messages(work("2025-02-01", "2025-03-01") + "\nStart Date: 2025-01-01"), []);
});
test("plain and Markdown use the same parser metadata; review leaves validation/input untouched", () => {
  const plain = work("2025-02-01", "2025-03-01") + "\nEMPLOYMENT INFORMATION\nCurrently working: Yes\nOTHER NAMES\nUsed other names in medical records: Yes";
  for (const text of [plain, plain.split("\n").map(line => line.includes(":") ? line.replace(/^([^:]+):/, "**$1:**") : line === "Most Recent Job" ? `#### ${line}` : `**${line}**`).join("\r\n")]) {
    const parsed = parseIntake(text);
    const snapshot = JSON.stringify(parsed);
    const before = validateIntake(parsed);
    const result = reviewIntake(parsed);
    assert.equal(result.items.length, 3);
    for (const item of result.items) assert(text.slice(item.range.start, item.range.end).includes(item.message.includes("failed") ? "Most Recent Job" : item.message === "Currently working" ? "Currently working" : "Used other names in medical records"));
    assert.equal(JSON.stringify(parsed), snapshot);
    assert.deepEqual(validateIntake(parsed), before);
  }
});
