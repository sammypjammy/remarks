export function isMissing(value) {
  return value == null || (typeof value === "string" && /^(?:\s*|\s*(?:Not provided|\*Not provided\*)\s*)$/i.test(value));
}

// Explicit calendar formats only. Never use Date.parse's locale-dependent guessing.
export function parseCalendarDate(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let year, month, day;
  let match;
  if ((match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
    [, year, month, day] = match;
  } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [, month, day, year] = match;
  } else if ((match = text.match(/^(\d{1,2})\/(\d{4})$/))) {
    [, month, year] = match;
  } else if ((match = text.match(/^([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/))) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    month = months.findIndex(name => name === match[1].toLowerCase() || name.slice(0, 3) === match[1].toLowerCase()) + 1;
    day = match[2]; year = match[3];
  } else return null;
  year = Number(year); month = Number(month);
  const precision = day === undefined ? "month" : "day";
  day = day === undefined ? 1 : Number(day);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return { year, month, day, precision };
}
