import { sourceRange } from "./parser.js";

export function issueSource(intake, issue) {
  let node;
  if (issue.location) {
    let nodes = intake.sections;
    for (const index of issue.location.split("/").slice(1)) {
      node = nodes[Number(index)];
      if (!node) return null;
      nodes = node.subsections;
    }
  } else {
    // Section-level issues (e.g. medical problems) have no record path.
    function find(nodes) {
      for (const candidate of nodes) {
        if (candidate.title === issue.section) return candidate;
        const nested = find(candidate.subsections);
        if (nested) return nested;
      }
    }
    node = find(intake.sections);
  }
  if (!node) return null;
  // A missing record may carry the parent's path: don't select a parent's same-name field.
  const field = (!issue.record || node.title === issue.record)
    ? node.fields.find(candidate => candidate.label === issue.field) : null;
  return sourceRange(field || node);
}

export function findInTextarea(input, range) {
  input.focus({ preventScroll: true });
  input.setSelectionRange(range.start, range.end);
  input.scrollIntoView({ block: "nearest" });
  // Native selection alone doesn't consistently scroll a textarea. Measure wrapped
  // text temporarily using the same typography, then discard the measuring element.
  const style = getComputedStyle(input);
  const measure = document.createElement("div");
  Object.assign(measure.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden", width: `${input.clientWidth}px`, boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "tabSize"]) measure.style[property] = style[property];
  measure.textContent = input.value.slice(0, range.start);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(range.start, range.start + 1) || " ";
  measure.append(marker);
  document.body.append(measure);
  try {
    input.scrollTop = Math.max(0, marker.getBoundingClientRect().top - measure.getBoundingClientRect().top - input.clientHeight / 3);
    input.scrollLeft = 0;
  } finally { measure.remove(); }
}
