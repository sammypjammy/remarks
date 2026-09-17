import test from "node:test";
import assert from "node:assert/strict";
import { parseIntake, sourceRange } from "./parser.js";
import { issueSource } from "./source-location.js";
import { validateIntake } from "./validation.js";

// Synthetic fixtures only; no real intake data.
for (const markdown of [false, true]) {
  test(`source mapping selects record-specific missing fields (${markdown ? "Markdown" : "plain"})`, () => {
    const section = name => markdown ? `**${name}**` : name;
    const record = name => markdown ? `#### ${name}` : name;
    const field = (name, value) => markdown ? `**${name}:**${value}` : `${name}:\n${value}`;
    const raw = [section("PERSONAL INFORMATION"), field("First Name", "Synthetic"), field("Phone Number", "Example"), field("Email", "Not provided"),
      section("MEDICAL PROVIDERS"), record("Clinic 1"), field("Phone Number", "Example"), record("Clinic 2"), field("Phone Number", "Not provided"),
      section("MARRIAGE INFORMATION"), field("Marital Status", "Married"), record("Current Spouse"), field("First Name", "*Not provided*")].join("\n");
    const parsed = parseIntake(raw);
    const issues = validateIntake(parsed).issues;
    for (const [sectionName, recordName, label, expected] of [
      ["PERSONAL INFORMATION", undefined, "Email", field("Email", "Not provided")],
      ["MEDICAL PROVIDERS", "Clinic 2", "Phone Number", field("Phone Number", "Not provided")],
      ["MARRIAGE INFORMATION", "Current Spouse", "First Name", field("First Name", "*Not provided*")]
    ]) {
      const issue = issues.find(issue => issue.section === sectionName && issue.record === recordName && issue.field === label);
      const range = issueSource(parsed, issue);
      assert.equal(raw.slice(range.start, range.end), expected);
      if (recordName) assert(range.start > raw.indexOf(recordName));
    }
    assert.equal(issueSource(parsed, issues.find(issue => issue.section === "BIRTH INFORMATION")), null);
    const missingClinicField = issues.find(issue => issue.record === "Clinic 2" && issue.field === "Address");
    const fallback = issueSource(parsed, missingClinicField);
    assert.equal(raw.slice(fallback.start, fallback.end), record("Clinic 2"));
  });
}

test("original offsets preserve CRLF, Unicode, multiline values, and validation shape", () => {
  const raw = "PERSONAL INFORMATION\r\nFirst Name:\r\nSynthetic 😀\r\nEmail:\r\nNot provided\r\n";
  const parsed = parseIntake(raw);
  const field = parsed.sections[0].fields[1];
  const range = sourceRange(field);
  assert.equal(raw.slice(range.start, range.end), "Email:\r\nNot provided");
  assert.deepEqual(field, { label: "Email", value: null });
  assert.equal(JSON.stringify(parsed).includes('"start"'), false);
});

test("section-level issues locate headings; duplicate record titles use indexed paths", () => {
  const raw = "MEDICAL PROBLEMS\nProblem one:\nNot provided\nMEDICATIONS\nMedication 1\nMedication Name:\nExample\nMedication 1\nMedication Name:\nNot provided";
  const parsed = parseIntake(raw);
  const issues = validateIntake(parsed).issues;
  const sectionRange = issueSource(parsed, issues.find(issue => issue.section === "MEDICAL PROBLEMS"));
  assert.equal(raw.slice(sectionRange.start, sectionRange.end), "MEDICAL PROBLEMS");
  const recordRange = issueSource(parsed, issues.find(issue => issue.section === "MEDICATIONS"));
  assert.equal(recordRange.start, raw.lastIndexOf("Medication Name:"));
});
