import test from "node:test";
// All fixtures are synthetic and were not copied from real clients or intakes.
import assert from "node:assert/strict";
import { parseIntake } from "./parser.js";
import { intakeRules } from "./rules.js";
import { isMissing, parseCalendarDate, validateIntake } from "./validation.js";

const now = new Date(2031, 8, 16);
const check = text => validateIntake(parseIntake(text), intakeRules, { now }).issues;
const scoped = (text, section) => check(text).filter(issue => issue.section === section);
const fields = (labels, value = "No") => labels.map(label => `**${label}:**${value}`).join("\n");
const record = (key, extra = "", omit = []) => `**${intakeRules.records[key].section}**\n#### ${ { providers: "Clinic 1", medications: "Medication 1", jobs: "Most Recent Job", children: "Person" }[key] }\n${fields(intakeRules.records[key].required.filter(label => !omit.includes(label)))}\n${extra}`;

test("missing normalization preserves No, Yes, zero, and None", () => {
  for (const value of [null, undefined, "", " \n ", "Not provided", " *Not provided* "]) assert.equal(isMissing(value), true);
  for (const value of ["No", "Yes", "0", 0, "None", false, "*Not provided"]) assert.equal(isMissing(value), false);
});

test("every defined required field is reported when its section is absent", () => {
  const issues = check("");
  for (const [section, config] of Object.entries(intakeRules.sections)) {
    assert.deepEqual(issues.filter(issue => issue.section === section).map(issue => issue.field), config.required);
  }
  assert.equal(issues.filter(issue => issue.section === "MEDICAL PROBLEMS").length, 1);
  assert.equal(issues.length, Object.values(intakeRules.sections).reduce((sum, config) => sum + config.required.length, 0) + 1);
});

test("all configured required fields are independently required; optional fields stay optional", () => {
  for (const [section, config] of Object.entries(intakeRules.sections)) {
    const complete = `**${section}**\n${fields(config.required)}\n${fields(config.optional || [], "*Not provided*")}`;
    assert.equal(scoped(complete, section).length, 0, section);
    for (const field of config.required) {
      const issues = scoped(complete.replace(`**${field}:**No`, `**${field}:** `), section);
      assert.equal(issues.length, 1, `${section}: ${field}`);
      assert.equal(issues[0].field, field);
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
    assert.equal(issues.filter(issue => issue.severity === "error").length, config.required.length, key);
    assert(issues.every(issue => issue.location.endsWith("/1")));
  }
  for (const title of ["MEDICAL PROVIDERS", "MEDICATIONS", "WORK HISTORY"]) assert.equal(scoped(`**${title}**`, title).length, 0);
});

test("vehicles only validate existing records when answer is Yes; No creates no contradiction", () => {
  const text = "**VEHICLES**\n**Own any vehicles:**Yes\n#### Vehicle 1\n**Year:**0\n#### Vehicle 2\n**Make:**Example";
  const issues = scoped(text, "VEHICLES");
  assert.equal(issues.length, 6);
  assert.equal(scoped(text.replace(":**Yes", ":**No"), "VEHICLES").length, 0);
  assert.equal(scoped("**VEHICLES**\n**Own any vehicles:**Yes", "VEHICLES").length, 0);
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
  assert.equal(provider("**Next Visit Date:**not a date")[0].severity, "warning");
  assert.equal(provider("**First Visit Date:**September 2031\n**Last Visit Date:**9/2/2031")[0].severity, "warning");
  const parsed = parseIntake(record("providers", "**Last Visit Date:**9/1/2031"));
  const before = JSON.stringify(parsed);
  validateIntake(parsed, intakeRules, { now });
  assert.equal(JSON.stringify(parsed), before);
});

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
  assert.equal(job("invalid").length, 0);
  assert.deepEqual(job("").map(issue => issue.field), ["End Date"]);
  assert.equal(scoped("**EMPLOYMENT INFORMATION**\n**Have you ever worked:**No", "EMPLOYMENT INFORMATION").length, 2);
});

test("Married requires the current spouse and all known fields; prior marriages remain deferred", () => {
  const prefix = "**MARRIAGE INFORMATION**\n**Marital Status:**Married";
  assert.equal(scoped(prefix, "MARRIAGE INFORMATION").length, intakeRules.records.spouse.required.length + 1);
  assert.equal(scoped(prefix + "\n#### Current Spouse\n" + fields(intakeRules.records.spouse.required), "MARRIAGE INFORMATION").length, 0);
  assert.equal(scoped(prefix.replace("Married", "Single") + "\n#### Prior Marriage 1\n**Unknown:**", "MARRIAGE INFORMATION").length, 0);
  assert.equal(validateIntake(parseIntake(prefix)).deferred.length, 1);
});

test("nested school fields validate, training stays optional, labels match exactly", () => {
  const text = "**EDUCATION INFORMATION**\n#### SCHOOL INFORMATION\n" + fields(intakeRules.sections["SCHOOL INFORMATION"].required) + "\n#### SPECIALIZED TRAINING INFORMATION\n**Anything:**";
  assert.equal(scoped(text, "SCHOOL INFORMATION").length, 0);
  assert.equal(scoped(text.replace("Highest Grade Completed", "highest grade completed"), "SCHOOL INFORMATION").length, 1);
  assert.equal(scoped(text.replace("#### SCHOOL INFORMATION\n", ""), "SCHOOL INFORMATION").length, 0);
});

test("unknown child structure is a review warning, not invented child fields", () => {
  const text = "**CHILDREN INFORMATION**\n" + fields(intakeRules.sections["CHILDREN INFORMATION"].required) + "\n#### Unspecified record\n**Unknown field:**";
  const issues = scoped(text, "CHILDREN INFORMATION");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].field, null);
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
