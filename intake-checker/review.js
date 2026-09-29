import { sourceRange } from "./parser.js";
import { intakeRules } from "./rules.js";
import { isMissing, parseCalendarDate } from "./validation.js";
import { incomeFields } from "./review-fields.js";

function descendants(nodes) {
  return nodes.flatMap(node => [node, ...descendants(node.subsections)]);
}
// Duplicate fields/sections are ambiguous; never silently select a client or date.
function field(nodes, label) {
  const found = nodes.flatMap(node => node.fields.filter(item => item.label === label));
  return found.length === 1 && !isMissing(found[0].value) ? found[0] : null;
}
const yes = item => /^(yes|true)$/i.test(item?.value?.trim() || "");
function date(item) {
  const parsed = parseCalendarDate(item?.value);
  // Month-only dates would require guessing a day at the onset/duration boundary.
  return parsed?.precision === "day" ? new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)) : null;
}
export function reviewIntake(intake) {
  const all = descendants(intake.sections);
  const sections = title => all.filter(node => node.title === title);
  const personal = sections("PERSONAL INFORMATION");
  const name = personal.length === 1
    ? ["First Name", "Last Name"].map(label => field(personal, label)?.value).filter(Boolean).join(" ") : "";
  const ssn = personal.length === 1 ? field(personal, "Social Security Number")?.value : null;
  const digits = ssn?.replace(/\D/g, "") || "";
  const lastFour = digits.length >= 4 ? digits.slice(-4) : "";
  const identifier = [name, lastFour].filter(Boolean).join(" ");
  const email = personal.length === 1 ? field(personal, "Email")?.value || "" : "";
  const items = [];
  const add = (message, source) => items.push({ message, range: sourceRange(source) });
  const problems = new Set(sections("MEDICAL PROBLEMS").flatMap(node => descendants([node])));
  if ([...problems].flatMap(node => node.fields).filter(item => intakeRules.medicalProblemLabel.test(item.label) && !isMissing(item.value)).length > 10) {
    add("More Than 10 Conditions");
  }
  const working = field(sections("EMPLOYMENT INFORMATION"), "Currently working");
  if (yes(working)) add("Currently Working", working);
  if (incomeFields.some(label => yes(field(sections("FINANCIAL SUPPORT"), label)))) add("Receiving income");
  const otherNames = field(sections("OTHER NAMES"), "Used other names in medical records");
  if (yes(otherNames)) add("Other Names", otherNames);
  const maritalStatus = field(sections("MARRIAGE INFORMATION"), "Marital Status");
  if (/^separated$/i.test(maritalStatus?.value?.trim() || "")) add("Separated", maritalStatus);
  // Amounts alone, housing/family support, part-time work and unspecified support are ambiguous.
  const jobs = [...new Set(sections("WORK HISTORY").flatMap(node => descendants(node.subsections)))].filter(job => intakeRules.records.jobs.heading.test(job.title));
  jobs.forEach((job, index) => {
    const start = date(field([job], "Start Date"));
    const end = date(field([job], "End Date"));
    if (!start || !end || end < start) return;
    // Add three calendar months, clamping to the target month's last day.
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 4, 0)).getUTCDate();
    const boundary = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, Math.min(start.getUTCDate(), lastDay)));
    if (end < boundary) add(`Failed Work Attempt — ${job.title}${jobs.length > 1 ? ` (record ${index + 1})` : ""}`, job);
  });
  return { identifier, email, items };
}
