import { intakeRules } from './rules.js';
import { resolveAnswers } from './answers.js';
import { isMissing } from './values.js';

// Exact text only: no diagnosis inference, case folding, or fuzzy matching.
export function medicalProblemGroups(intake) {
  const groups = [], byValue = new Map();
  let ordinal = 0;
  function visit(nodes, parentPath = '', active = false) {
    nodes.forEach((node, index) => {
      const entry = { node, path: parentPath + '/' + index };
      const medical = active || node.title === 'MEDICAL PROBLEMS';
      if (medical) for (const label of new Set(node.fields.filter(field => intakeRules.medicalProblemLabel.test(field.label)).map(field => field.label))) {
        const recordId = "problem-" + (++ordinal);
        const candidates = node.fields.filter(field => field.label === label).map(field => ({ entry, field }));
        const answer = resolveAnswers(candidates.map(candidate => candidate.field));
        const key = answer.field ? String(answer.value).trim() : null;
        const existing = key === null ? null : byValue.get(key);
        if (existing) existing.candidates.push(...candidates);
        else {
          const group = { label, candidates, recordId };
          groups.push(group);
          if (key !== null) byValue.set(key, group);
        }
      }
      visit(node.subsections, entry.path, medical);
    });
  }
  visit(intake.sections);
  return groups;
}

export function distinctMedicalProblemCount(intake) {
  return new Set(medicalProblemGroups(intake).flatMap(group => group.candidates)
    .filter(({ field }) => !isMissing(field.value)).map(({ field }) => String(field.value).trim())).size;
}
