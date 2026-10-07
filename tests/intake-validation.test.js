import test from "node:test";
// All fixtures are synthetic and were not copied from real clients or intakes.
import assert from "node:assert/strict";
import { parseIntake } from "../intake-checker/parser.js";
import { intakeRules } from "../intake-checker/rules.js";
import { isMissing, parseCalendarDate, validateIntake } from "../intake-checker/validation.js";
import { syntheticValue } from './synthetic-intake-values.js';

const now = new Date(2031, 8, 16);
const check = text => validateIntake(parseIntake(text), intakeRules, { now }).issues;
const scoped = (text, section) => check(text).filter(issue => issue.section === section);
const fields = (labels, value) => labels.map(label => `**${label}:**${value ?? syntheticValue(label)}`).join("\n");
const record = (key, extra = "", omit = []) => `**${intakeRules.records[key].section}**\n#### ${ { providers: "Clinic 1", medications: "Medication 1", jobs: "Most Recent Job", children: "Person" }[key] }\n${fields(intakeRules.records[key].required.filter(label => !omit.includes(label)))}\n${key === "providers" ? "**Clinic Name:**Synthetic Clinic\n" : ""}${extra}`;

test("missing normalization preserves No, Yes, zero, and None", () => {
  for (const value of [null, undefined, "", " \n ", "Not provided", " *Not provided* "]) assert.equal(isMissing(value), true);
  for (const value of ["No", "Yes", "0", 0, "None", false, "*Not provided"]) assert.equal(isMissing(value), false);
});

test("completely absent required sections produce one grouped issue", () => {
  const issues = check("");
  for (const [section, config] of Object.entries(intakeRules.sections)) {
    assert.deepEqual(issues.filter(issue => issue.section === section).map(issue => issue.field), config.required.length ? [null] : []);
  }
  assert.equal(issues.filter(issue => issue.section === "MEDICAL PROBLEMS").length, 1);
  assert.equal(issues.length, Object.values(intakeRules.sections).filter(config => config.required.length).length + 1);
});

test("all configured required fields are independently required; optional fields stay optional", () => {
  for (const [section, config] of Object.entries(intakeRules.sections)) {
    const complete = `**${section}**\n${fields(config.required)}\n${fields(config.optional || [], "*Not provided*")}`;
    assert.equal(scoped(complete, section).length, 0, section);
    for (const field of config.required) {
      const issues = scoped(complete.replace(`**${field}:**${syntheticValue(field)}`, `**${field}:** `), section);
      assert.equal(issues.length, 1, `${section}: ${field}`);
      assert.equal(issues[0].field, config.required.length === 1 ? null : field);
    }
  }
  const optional = intakeRules.optionalSections.map(title => `**${title}**\n**Anything:**`).join("\n");
  assert.equal(check(optional).filter(issue => intakeRules.optionalSections.includes(issue.section)).length, 0);
  assert.equal(scoped("**OTHER NAMES**\n**Used other names in medical records:**Yes\n**Other first name:**\n**Other last name:**", "OTHER NAMES").length, 0);
});

test("each repeating record is independent and missing entire optional record groups are allowed", () => {
  for (const key of ["providers", "medications", "jobs", "children"]) {
    const config = intakeRules.records[key];
    const complete = record(key);
    const controlFields = intakeRules.sections[config.section]?.required || [];
    const withControls = complete.replace(`**${config.section}**`, `**${config.section}**\n${fields(controlFields)}`);
    assert.equal(scoped(withControls, config.section).length, 0, key);
    // Same name twice must still produce distinct record locations.
    const title = complete.split("\n")[1];
    const issues = scoped(withControls + `\n${title}\n**${config.required[0]}:**`, config.section);
    assert.equal(issues.filter(issue => issue.severity === "error").length, config.required.length + (key === "providers" ? 1 : 0), key);
    assert(issues.every(issue => issue.location.endsWith("/1")));
  }
  for (const title of ["MEDICAL PROVIDERS", "MEDICATIONS", "WORK HISTORY"]) assert.equal(scoped(`**${title}**`, title).length, 0);
});

test("vehicles and their fields are entirely optional", () => {
  const text = "**VEHICLES**\n**Own any vehicles:**Yes\n#### Vehicle 1\n**Year:**0\n#### Vehicle 2\n**Make:**Example";
  assert.equal(scoped(text, "VEHICLES").length, 0);
  assert.equal(scoped(text.replace(":**Yes", ":**No"), "VEHICLES").length, 0);
  assert.equal(scoped("", "VEHICLES").length, 0);
  assert.equal(scoped("**VEHICLES**", "VEHICLES").length, 0);
  assert.equal(scoped("**VEHICLES**\n**Own any vehicles:**Yes", "VEHICLES").length, 0);
});

test("height inches is optional while feet and weight remain required", () => {
  const complete = "**VITALS**\n**Height (feet):**5\n**Height (inches):**0\n**Weight (pounds):**150";
  assert.equal(scoped(complete, "VITALS").length, 0);
  assert.equal(scoped(complete.replace("**Height (inches):**0", "**Height (inches):**"), "VITALS").length, 0);
  assert.deepEqual(scoped(complete.replace("**Height (feet):**5", "**Height (feet):**"), "VITALS").map(issue => issue.field), ["Height (feet)"]);
  assert.deepEqual(scoped(complete.replace("**Weight (pounds):**150", "**Weight (pounds):**"), "VITALS").map(issue => issue.field), ["Weight (pounds)"]);
});

test("medical problems require one nonmissing numbered field, not every field or arbitrary notes", () => {
  const empty = "**MEDICAL PROBLEMS**\n**Problem one:***Not provided*\n**Problem two:**\n**Notes:**Has a condition";
  assert.equal(scoped(empty, "MEDICAL PROBLEMS").length, 1);
  assert.equal(scoped(empty + "\n**Problem three:**None", "MEDICAL PROBLEMS").length, 0);
});

test("provider visit rules: optional dates, first-only, last-only, order, and month boundary", () => {
  const provider = extra => scoped(record("providers", extra), "MEDICAL PROVIDERS");
  assert.equal(provider("").length, 0);
  assert.equal(provider("**First Visit Date:**9/1/2031")[0].field, "Last Visit Date");
  assert.equal(provider("**Last Visit Date:**9/1/2031").length, 0);
  assert.equal(provider("**First Visit Date:**9/2/2031\n**Last Visit Date:**9/1/2031")[0].severity, "error");
  assert.equal(provider("**First Visit Date:**9/1/2031\n**Last Visit Date:**9/1/2031").length, 0);
  assert.equal(provider("**First Visit Date:**September 2031\n**Last Visit Date:**October 2031").length, 0);
  for (const value of ["September 1, 2031", "September 30, 2031", "October 2031", "2032-01"]) assert.equal(provider(`**Next Visit Date:**${value}`).length, 0);
  for (const value of ["August 2031", "2030-12-31"]) assert.equal(provider(`**Next Visit Date:**${value}`)[0].severity, "error");
  assert.equal(provider("**Next Visit Date:**not a date")[0].severity, "error");
  assert.equal(provider("**First Visit Date:**September 2031\n**Last Visit Date:**9/2/2031")[0].severity, "warning");
  const parsed = parseIntake(record("providers", "**Last Visit Date:**9/1/2031"));
  const before = JSON.stringify(parsed);
  validateIntake(parsed, intakeRules, { now });
  assert.equal(JSON.stringify(parsed), before);
});

test("provider name requires a clinic or doctor name, but not both", () => {
  const complete = record("providers");
  assert.equal(providerNameIssues(complete).length, 0);
  assert.equal(providerNameIssues(complete.replace("**Clinic Name:**Synthetic Clinic", "**Doctor First Name:**Alex\n**Doctor Last Name:**Example")).length, 0);
  const neither = complete.replace("**Clinic Name:**Synthetic Clinic", "");
  assert.deepEqual(providerNameIssues(neither).map(issue => issue.field), ["Clinic Name"]);
});

function providerNameIssues(text) {
  return scoped(text, "MEDICAL PROVIDERS").filter(issue => issue.message.startsWith("Clinic Name or a doctor name"));
}

test("dates are strict calendar dates, not rolled-over or guessed values", () => {
  for (const text of ["2/29/2031", "2031-02-30", "13/2031", "2031-00-01", "September 31, 2031", "yesterday", "31/12/2031", "2031"]) assert.equal(parseCalendarDate(text), null, text);
  assert.equal(parseCalendarDate("2/29/2032").day, 29);
  assert.equal(parseCalendarDate("Sep 2031").precision, "month");
});

test("work addresses only apply in current local calendar year, not a rolling 12 months", () => {
  const job = value => scoped(record("jobs", `**End Date:**${value}`, ["End Date"]), "WORK HISTORY");
  assert.equal(job("2031-01-01").length, 4);
  assert.equal(job("December 2031").length, 4);
  assert.equal(job("2030-12-31").length, 0);
  assert.equal(job("2032-01-01").length, 0);
  assert.deepEqual(job("invalid").map(issue => [issue.field, issue.severity]), [["End Date", "error"]]);
  assert.deepEqual(job("").map(issue => issue.field), ["End Date"]);
  assert.equal(scoped("**EMPLOYMENT INFORMATION**\n**Have you ever worked:**No\n**Currently working:**No", "EMPLOYMENT INFORMATION").length, 0);
});

test("when last worked is required unless the claimant explicitly never worked", () => {
  assert.equal(scoped("**EMPLOYMENT INFORMATION**\n**Have you ever worked:**No\n**Currently working:**No", "EMPLOYMENT INFORMATION").some(issue => issue.field === "When did you last work"), false);
  for (const worked of ["Yes", "", "Not provided"]) {
    const issues = scoped(`**EMPLOYMENT INFORMATION**\n**Have you ever worked:**${worked}\n**Currently working:**No`, "EMPLOYMENT INFORMATION");
    assert.equal(issues.some(issue => issue.field === "When did you last work"), true, worked || "blank");
  }
});

test("Business Type is required by each applicable work-history record", () => {
  const complete = record("jobs");
  assert.equal(scoped(complete, "WORK HISTORY").length, 0);
  const issues = scoped(complete.replace("**Business Type:**No", "**Business Type:**"), "WORK HISTORY");
  assert.deepEqual(issues.map(issue => [issue.record, issue.field]), [["Most Recent Job", "Business Type"]]);
  assert.equal(scoped("**EMPLOYMENT INFORMATION**\n**Business Type:**Retail\n**Have you ever worked:**No\n**Currently working:**No", "WORK HISTORY").length, 0);
});

test("Married requires current spouse details, with optional identity fields", () => {
  const prefix = "**MARRIAGE INFORMATION**\n**Marital Status:**Married";
  assert.equal(scoped(prefix, "MARRIAGE INFORMATION").length, 1);
  assert.equal(scoped(prefix + "\n#### Current Spouse\n" + fields(intakeRules.records.spouse.required), "MARRIAGE INFORMATION").length, 0);
  assert.equal(scoped(prefix + "\n#### Current Spouse\n" + fields(intakeRules.records.spouse.required.filter(label => label !== "Marriage Date")), "MARRIAGE INFORMATION").map(issue => issue.field).includes("Marriage Date"), true);
  assert.equal(scoped(prefix + "\n#### Current Spouse\n" + fields(intakeRules.records.spouse.required) + "\n**Maiden Name:**\n**Social Security Number:**", "MARRIAGE INFORMATION").length, 0);
  assert.equal(scoped(prefix.replace("Married", "Single") + "\n#### Current Spouse\n" + fields(intakeRules.records.spouse.required), "MARRIAGE INFORMATION").length, 0);
  assert.equal(scoped(prefix.replace("Married", "Single") + "\n#### Prior Marriage 1\n**First Name:**Alex\n**Type of Marriage:**", "MARRIAGE INFORMATION").length, 1);
  assert.equal(validateIntake(parseIntake(prefix)).deferred.length, 2);
});

test("previous spouse records do not trigger current-spouse duplicate or type requirements", () => {
  const current = fields(intakeRules.records.spouse.required);
  const previousOnly = `MARRIAGE INFORMATION
Marital Status: Married
Current Spouse
${current}
Previous Spouse
First Name: Fictional Former
Last Name: Example Former`;
  const previousIssues = scoped(previousOnly, "MARRIAGE INFORMATION");
  assert(!previousIssues.some(issue => /Current Spouse record|Only one Current Spouse/.test(issue.message)));
  assert(!previousIssues.some(issue => issue.record === "Previous Spouse" && issue.field === "Type of Marriage"));

  const formerOnly = scoped(`MARRIAGE INFORMATION
Marital Status: Married
Previous Spouse
First Name: Fictional Former`, "MARRIAGE INFORMATION");
  assert(formerOnly.some(issue => issue.message === "Current Spouse record is required when Marital Status is Married."));
  assert(!formerOnly.some(issue => issue.message === "Only one Current Spouse record is supported."));

  const duplicate = previousOnly + `\nCurrent Spouse\n${current}`;
  const duplicateIssues = scoped(duplicate, "MARRIAGE INFORMATION").filter(issue => issue.message === "Only one Current Spouse record is supported.");
  assert.equal(duplicateIssues.length, 1);
  assert.equal(duplicateIssues[0].record, "Current Spouse");
});

test("blank marital status alone is optional", () => {
  assert.equal(scoped("**MARRIAGE INFORMATION**\n**Marital Status:**", "MARRIAGE INFORMATION").length, 0);
});

test("nested school fields validate, training stays optional, labels match exactly", () => {
  const text = "**EDUCATION INFORMATION**\n#### SCHOOL INFORMATION\n" + fields(intakeRules.sections["SCHOOL INFORMATION"].required) + "\n#### SPECIALIZED TRAINING INFORMATION\n**Anything:**";
  assert.equal(scoped(text, "SCHOOL INFORMATION").length, 0);
  assert.deepEqual(scoped(text.replace("**School City:**No", "**School City:**"), "SCHOOL INFORMATION").map(issue => issue.field), ["School City"]);
  assert.deepEqual(scoped(text.replace("**School State:**No", "**School State:**"), "SCHOOL INFORMATION").map(issue => issue.field), ["School State"]);
  const optionalBlank = intakeRules.sections["SCHOOL INFORMATION"].optional.map(label => `**${label}:**`).join("\n");
  assert.equal(scoped(`**SCHOOL INFORMATION**\n**School City:**Example\n**School State:**UT\n**School name where highest grade completed:**Synthetic School\n${optionalBlank}`, "SCHOOL INFORMATION").length, 0);
  assert.equal(scoped(text.replace("#### SCHOOL INFORMATION\n", ""), "SCHOOL INFORMATION").length, 0);
});

test("security-question parent names are optional", () => {
  assert.equal(scoped("", "SECURITY QUESTIONS").length, 0);
  assert.equal(scoped("**SECURITY QUESTIONS**\n**Mother - First Name:**\n**Mother - Maiden Name:**\n**Father - First Name:**\n**Father - Last Name:**", "SECURITY QUESTIONS").length, 0);
});

test("configured names are normalized without changing original source fields", () => {
  const cases = [
    ["PERSONAL INFORMATION", "First Name", "J."],
    ["MEDICAL PROVIDERS", "Doctor First Name", "Robert Sr."],
    ["MEDICAL PROVIDERS", "Doctor Last Name", "Smith."],
    ["MARRIAGE INFORMATION", "First Name", "Alex Jr."],
    ["OTHER NAMES", "Other last name", "Example."],
    ["CHILDREN INFORMATION", "First Name", "Child."]
  ];
  for (const [section, label, value] of cases) {
    const recordHeading = section === "MEDICAL PROVIDERS" ? "\n#### Clinic 1" : section === "MARRIAGE INFORMATION" ? "\n#### Current Spouse" : section === "CHILDREN INFORMATION" ? "\n#### Child 1" : "";
    const parsed = parseIntake(`**${section}**${recordHeading}\n**${label}:**${value}`);
    const report = validateIntake(parsed);
    const entry = [...report.formats].find(([field]) => field.label === label);
    assert.equal(entry[0].value, value);
    assert(!entry[1].value.includes('.'));
    assert.equal(entry[1].error, null);
  }
  for (const [section, label] of [["MEDICAL PROVIDERS", "Clinic Name"], ["SCHOOL INFORMATION", "School name where highest grade completed"], ["WORK HISTORY", "Business Name"], ["WORK HISTORY", "Employer"], ["PERSONAL INFORMATION", "Email"]]) {
    const recordHeading = section === "MEDICAL PROVIDERS" ? "\n#### Clinic 1" : section === "WORK HISTORY" ? "\n#### Job 1" : "";
    assert.equal(scoped(`**${section}**${recordHeading}\n**${label}:**Example.Name`, section).some(issue => issue.message === "Periods are not allowed in person names."), false, `${section}: ${label}`);
  }
});

test("unknown child structure is a review warning, not invented child fields", () => {
  const text = "**CHILDREN INFORMATION**\n" + fields(intakeRules.sections["CHILDREN INFORMATION"].required) + "\n#### Unspecified record\n**Unknown field:**";
  const issues = scoped(text, "CHILDREN INFORMATION");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].field, null);
});

test("children information and child records have no required-field errors", () => {
  const text = "**CHILDREN INFORMATION**\n**Have any children:**\n#### Child 1\n**First Name:**\n**Last Name:**\n**Age:**";
  assert.equal(scoped(text, "CHILDREN INFORMATION").filter(issue => issue.severity === "error").length, 0);
});

test("a partially completed required section keeps individual missing fields", () => {
  const issues = scoped("**BIRTH INFORMATION**\n**Date of Birth:**2000-01-01", "BIRTH INFORMATION");
  assert.deepEqual(issues.map(issue => issue.field), ["City of Birth", "State of Birth", "Country of Birth"]);
});

test("a complete intake has no errors and results are deterministic without mutating input", () => {
  const text = Object.entries(intakeRules.sections).map(([title, config]) => `**${title}**\n${fields(config.required)}`).join("\n") + "\n**MEDICAL PROBLEMS**\n**Problem one:**Example condition";
  const parsed = parseIntake(text);
  const before = JSON.stringify(parsed);
  const result = validateIntake(parsed, intakeRules, { now });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result, validateIntake(parsed, intakeRules, { now }));
  assert.equal(JSON.stringify(parsed), before);
});

test("school requires exactly name, city and state in nested and parent layouts", () => {
  const labels = ["School name where highest grade completed", "School City", "School State"];
  assert.deepEqual([...intakeRules.sections["SCHOOL INFORMATION"].required].sort(), [...labels].sort());
  for (const heading of ["**SCHOOL INFORMATION**", "**EDUCATION INFORMATION**", "**EDUCATION INFORMATION**\n#### SCHOOL INFORMATION"]) {
    for (const missing of labels) {
      const text = heading + "\n" + labels.map(label => '**' + label + ':**' + (label === missing ? 'Not provided' : 'Synthetic')).join("\n");
      assert.deepEqual(scoped(text, "SCHOOL INFORMATION").map(issue => issue.field), [missing]);
    }
  }
});
