import { fieldDefinitions } from '../src/model/intake-contract.js';
import { syntheticValue } from '../../tests/synthetic-intake-values.js';

// Entirely generated synthetic data, never copied from client records.
export function completeSyntheticIntake() {
  const sections = new Map();
  const headings = { vehicles: 'Vehicle 1', providers: 'Clinic 1', medications: 'Medication 1', jobs: 'Most Recent Job', spouse: 'Current Spouse', children: 'Child 1' };
  for (const definition of fieldDefinitions) {
    if (definition.category === 'priorSpouses') continue;
    const section = sections.get(definition.section) || new Map();
    const key = definition.record ? definition.category : '';
    const fields = section.get(key) || [];
    const value = definition.label === 'Worked outside United States' ? 'Yes'
      : definition.label === 'Eligible for foreign SSI' ? 'No'
      : definition.label === 'Foreign SSI country' ? 'Example Country'
      : definition.label === 'Previous Applications - Previously applied for Medicare/SS/SSI' ? 'Yes'
      : definition.label === 'Previous Applications - Medicare' ? 'Yes'
      : definition.label === 'Previous Applications - Social Security' ? 'No'
      : definition.label === 'Previous Applications - SSI' ? 'Yes'
      : definition.label === 'Illnesses/injuries work related' ? 'Yes'
      : definition.label === 'Expect money from employer in future' ? 'No'
      : definition.dataType === 'boolean' ? 'No' : definition.dataType === 'date'
      ? definition.label === 'Next Visit Date' ? '2099-01-01' : definition.label === 'Last Visit Date' || definition.label === 'End Date' ? '2001-01-01' : '2000-01-01'
      : syntheticValue(definition.label, 'Synthetic');
    fields.push(`**${definition.label}:** ${value}`);
    section.set(key, fields); sections.set(definition.section, section);
  }
  return [...sections].map(([title, groups]) => `## ${title}\n` + [...groups].map(([key, fields]) => (key ? `#### ${headings[key]}\n` : '') + fields.join('\n')).join('\n')).join('\n')
    + '\n## MEDICAL PROBLEMS\nProblem 1: Synthetic condition';
}
