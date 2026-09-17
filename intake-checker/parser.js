// Ordered arrays preserve duplicate headings/labels without inventing field names.
export function parseIntake(rawText) {
  const result = { sections: [], unparsed: [] };
  let section = null;
  let stack = [];
  let field = null;
  let lines = [];
  function finishField() {
    if (!field) return;
    const value = lines.join("\n").trim();
    field.value = !value || /^(?:\*Not provided\*|Not provided)$/i.test(value) ? null : value;
    field = null;
    lines = [];
  }
  function node(title) { return { title, fields: [], subsections: [] }; }
  for (const [index, rawLine] of String(rawText).replace(/\r\n?/g, "\n").split("\n").entries()) {
    const line = rawLine.trim();
    const match = line.match(/^\*\*(.+?):\*\*(.*)$/) || line.match(/^\*\*(.+?)\*\*:(.*)$/);
    const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const boldHeading = !match && line.match(/^\*\*([^*]+)\*\*$/);
    if (heading || boldHeading) {
      finishField();
      const level = heading ? heading[1].length : 2;
      const title = (heading ? heading[2] : boldHeading[1]).replace(/^\*\*(.*?)\*\*$/, "$1");
      const next = node(title);
      if (level <= 3) {
        result.sections.push(next);
        section = next;
        stack = [];
      } else if (section) {
        while (stack.length && stack.at(-1).level >= level) stack.pop();
        (stack.at(-1)?.node || section).subsections.push(next);
        stack.push({ level, node: next });
      } else {
        result.unparsed.push({ line: index + 1, text: rawLine });
      }
    } else if (match) {
      finishField();
      const target = stack.at(-1)?.node || section;
      if (!target) result.unparsed.push({ line: index + 1, text: rawLine });
      else {
        field = { label: match[1], value: null };
        target.fields.push(field);
        lines = [match[2]];
      }
    } else if (field) {
      lines.push(rawLine);
    } else if (line) {
      result.unparsed.push({ line: index + 1, text: rawLine });
    }
  }
  finishField();
  return result;
}

export function summarizeIntake(parsed) {
  const summary = { sections: parsed.sections.length };
  const personal = parsed.sections.filter(section => section.title.toUpperCase() === "PERSONAL INFORMATION");
  if (personal.length === 1) {
    const names = ["First Name", "Last Name"].map(label => personal[0].fields.filter(field => field.label === label));
    // Ambiguous duplicate name fields must not silently select a client.
    if (names.every(matches => matches.length <= 1)) {
      const name = names.map(matches => matches[0]?.value).filter(Boolean).join(" ");
      if (name) summary.client = name;
    }
  }
  const counts = { providers: 0, medications: 0, jobs: 0 };
  function visit(nodes) {
    for (const node of nodes) {
      if (/^(?:Clinic|Hospital|Doctor|Medical Provider)\s+\d+$/i.test(node.title)) counts.providers++;
      if (/^Medication\s+\d+$/i.test(node.title)) counts.medications++;
      if (/^(?:(?:Most Recent|Previous) Job|Job\s+\d+)$/i.test(node.title)) counts.jobs++;
      visit(node.subsections);
    }
  }
  for (const section of parsed.sections) visit(section.subsections);
  // Omit unknown categories rather than interpreting unrecognized headings as zero.
  for (const [key, value] of Object.entries(counts)) if (value) summary[key] = value;
  return summary;
}
