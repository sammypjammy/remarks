import test from "node:test";
// All fixtures are synthetic and were not copied from real clients or intakes.
import assert from "node:assert/strict";
import { parseIntake, summarizeIntake } from "./parser.js";

test("parses exact labels, normalizes missing values, and retains multiline text", () => {
  const parsed = parseIntake("**PERSONAL INFORMATION**\r\n**First Name:**Alex\r\n**Middle Name:***Not provided*\r\n**Last Name:**Rivera\r\n**Empty:**  \r\n**Other:**Not provided\r\n**Notes:**Line one\r\nLine two\r\n**Case-SENSITIVE label?**:yes");
  assert.deepEqual(parsed.sections[0].fields, [
    {label:"First Name",value:"Alex"}, {label:"Middle Name",value:null}, {label:"Last Name",value:"Rivera"},
    {label:"Empty",value:null}, {label:"Other",value:null}, {label:"Notes",value:"Line one\nLine two"},
    {label:"Case-SENSITIVE label?",value:"yes"}
  ]);
  assert.equal(summarizeIntake(parsed).client, "Alex Rivera");
});

test("preserves separate numbered and named records, nested headings, and duplicate labels", () => {
  const parsed = parseIntake(`**MEDICAL INFORMATION**
#### Clinic 1
**Clinic Name:**North
**Phone:**111
**Phone:**222
##### Visits
**Date:**Yesterday
#### Clinic 2
**Clinic Name:**South
#### Medication 1
**Medication Name:**Example
**WORK HISTORY**
#### Most Recent Job
**Employer:**Example Company
#### Most Recent Job
**Employer:**Another Company`);
  assert.equal(parsed.sections[0].subsections.length, 3);
  assert.equal(parsed.sections[0].subsections[0].fields.length, 3);
  assert.equal(parsed.sections[0].subsections[0].subsections[0].title, "Visits");
  assert.equal(parsed.sections[1].subsections.length, 2);
  assert.deepEqual(summarizeIntake(parsed), {sections:2,providers:2,medications:1,jobs:2});
});

test("keeps duplicate sections and prototype-like labels without overwriting or inferring", () => {
  const parsed = parseIntake("**PERSONAL INFORMATION**\n**First Name:**A\n**PERSONAL INFORMATION**\n**First Name:**B\n**__proto__:**literal");
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[1].fields[1].label, "__proto__");
  assert.equal(summarizeIntake(parsed).client, undefined);
  assert.deepEqual(summarizeIntake(parseIntake("**OTHER**\n#### An unusual record\n**X:**Y")), { sections: 1 });
});

test("empty or unrecognized input remains inspectable without invented sections", () => {
  assert.deepEqual(parseIntake("  \n"), {sections:[],unparsed:[]});
  const parsed = parseIntake("preamble\n**No section:**value\n#### Orphan record\n# Main\n**Field:**");
  assert.equal(parsed.unparsed.length, 3);
  assert.equal(parsed.sections[0].title, "Main");
  assert.equal(parsed.sections[0].fields[0].value, null);
});
