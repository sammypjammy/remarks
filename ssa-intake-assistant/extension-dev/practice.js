import { mappings, fillPractice } from './mapping.js';
import { formSections, employmentRows, employmentQuestionRows, previousApplicationRows, workConditionRows } from './practice-layout.js';
import { syntheticProfile } from './synthetic.js';
import { receiveBridge, trustedSender, BRIDGE_NAME } from './bridge-contract.js';
let received = null, waiting = false, disconnect = () => {};
const root = document.getElementById('practice');
const byTarget = new Map(mappings.map(mapping => [mapping.target, mapping]));
const shown = new Set();
function makeField(labelText, target = null, key = null, recordId = null, answerAvailable = false, showStatus = false, missing = false) {
  const mapping = target && byTarget.get(target);
  const label = document.createElement('label');
  const title = document.createElement('span'); title.textContent = labelText; label.append(title);
  const input = document.createElement(mapping?.type === 'boolean' || mapping?.allowedValues ? 'select' : 'input');
  if (mapping?.type === 'boolean' || mapping?.allowedValues) {
    const options = mapping.type === 'boolean' ? [['','Select an answer'],['yes','Yes'],['no','No']]
      : [['','Select an answer'], ...mapping.allowedValues.map(value => [value, value])];
    for (const [value, text] of options) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
    }
  } else input.type = 'text';
  input.autocomplete = 'off';
  if (mapping) {
    input.dataset.practiceField = target;
    shown.add(target);
  }
  else input.dataset.practicePlaceholder = key;
  if (recordId) input.dataset.practiceRecord = recordId;
  label.append(input);
  if (recordId || showStatus) {
    const status = document.createElement('span');
    status.className = 'record-field-status';
    status.textContent = answerAvailable ? 'Ready answer; Fill is required to enter it.'
      : showStatus ? missing ? 'Not provided' : 'Not transferred.' : 'Not provided';
    label.append(status);
  }
  return label;
}
const conditionalGroups = [
  { key: 'employment-questions', title: 'Employment — Foreign Work and Benefits', rows: employmentQuestionRows },
  { key: 'previous-application-questions', title: 'Previous Applications', rows: previousApplicationRows },
  { key: 'work-condition-questions', title: 'Work-Related Conditions and Employer Payments', rows: workConditionRows },
];
const conditionalTargets = new Set(conditionalGroups.flatMap(group => group.rows.map(row => row.target)));
function showConditionalQuestions(profile) {
  root.querySelectorAll('[data-conditional-question-group]').forEach(group => group.remove());
  if (!Array.isArray(profile.conditionalQuestionFields) || !profile.conditionalQuestionFields.length) return;
  for (const definition of conditionalGroups) {
    const rows = definition.rows.filter(row => profile.conditionalQuestionFields.includes(byTarget.get(row.target)?.definitionId));
    if (!rows.length) continue;
    const group = document.createElement('section');
    group.className = 'practice-section conditional-question-group';
    group.dataset.conditionalQuestionGroup = definition.key;
    const heading = document.createElement('h2');
    heading.textContent = definition.title;
    group.append(heading);
    const grid = document.createElement('div'); grid.className = 'practice-grid';
    for (const row of rows) {
      const mapping = byTarget.get(row.target);
      const answerAvailable = profile.fields?.some(field => field.definitionId === mapping.definitionId
        && field.recordId === null && field.id === mapping.definitionId
        && field.readiness === 'ready' && field.blockingReasons?.length === 0
        && (mapping.type === 'boolean' ? typeof field.value === 'boolean'
          : typeof field.value === 'string' && !!field.value.trim())) || false;
      grid.append(makeField(row.label, row.target, null, null, answerAvailable, true,
        profile.conditionalQuestionMissingFields.includes(mapping.definitionId)));
    }
    group.append(grid);
    root.append(group);
  }
}
for (const section of formSections) {
  if (section.title === 'Prior Marriages') continue;
  const group = document.createElement('section'); group.className = 'practice-section'; group.dataset.practiceSection = section.title;
  const heading = document.createElement('h2'); heading.textContent = section.title; group.append(heading);
  if (section.title === 'Children' || section.title !== 'Date of Birth' && section.rows.every(row => !row.target)) {
    const note = document.createElement('p'); note.className = 'mapping-note';
    note.textContent = section.title === 'Children' ? 'Only parsed child first and last names are available so far.'
      : 'No automatic mapping yet. These boxes remain empty.'; group.append(note);
  }
  const grid = document.createElement('div'); grid.className = 'practice-grid';
  for (const row of section.rows) grid.append(makeField(row.label, row.target, row.key));
  if (section.title === 'Date of Birth') {
    const source = makeField('Full date source', 'birth-date'); source.hidden = true; grid.append(source);
  }
  if (section.title === 'Marriage Information — Current Spouse') {
    const source = makeField('Full marriage date source', 'current-marriage-date'); source.hidden = true; grid.append(source);
  }
  group.append(grid); root.append(group);
}
function showPreviousSpouses(profile) {
  root.querySelectorAll('[data-prior-record]').forEach(section => section.remove());
  const recordIds = profile.priorSpouseRecords;
  if (!Array.isArray(recordIds)) return;
  const section = formSections.find(item => item.title === 'Prior Marriages');
  const before = root.querySelector('[data-practice-section="Children"]');
  for (const [index, recordId] of recordIds.entries()) {
    if (typeof recordId !== 'string' || !/^prior-spouse-[1-9]\d*$/.test(recordId) || recordIds.indexOf(recordId) !== index) continue;
    const group = document.createElement('section');
    group.className = 'practice-section prior-spouse-record';
    group.dataset.priorRecord = recordId;
    group.dataset.practiceRecord = recordId;
    const heading = document.createElement('h2');
    heading.textContent = `Previous Spouse ${index + 1}`;
    group.append(heading);
    const grid = document.createElement('div'); grid.className = 'practice-grid';
    for (const row of section.rows) {
      const mapping = byTarget.get(row.target);
      const answerAvailable = profile.fields?.some(field => field.definitionId === mapping.definitionId
        && field.recordId === recordId && field.id === `${field.definitionId}@${recordId}`
        && field.readiness === 'ready' && field.blockingReasons?.length === 0
        && typeof field.value === 'string' && !!field.value.trim()) || false;
      grid.append(makeField(row.label, row.target, null, recordId, answerAvailable));
    }
    group.append(grid);
    root.insertBefore(group, before);
  }
}
function showEmploymentRecords(profile) {
  root.querySelectorAll('[data-employment-record]').forEach(section => section.remove());
  root.querySelectorAll('[data-conditional-question-group]').forEach(section => section.remove());
  if (!Array.isArray(profile.jobRecords)) return;
  for (const [index, recordId] of profile.jobRecords.entries()) {
    if (typeof recordId !== 'string' || !/^job-[1-9]\d*$/.test(recordId) || profile.jobRecords.indexOf(recordId) !== index) continue;
    const group = document.createElement('section');
    group.className = 'practice-section employment-record';
    group.dataset.employmentRecord = recordId;
    group.dataset.practiceRecord = recordId;
    const heading = document.createElement('h2');
    heading.textContent = `Employment — Job ${index + 1}`;
    group.append(heading);
    const grid = document.createElement('div'); grid.className = 'practice-grid';
    for (const row of employmentRows) {
      const mapping = byTarget.get(row.target);
      const answerAvailable = !!mapping?.definitionId && profile.fields?.some(field => field.definitionId === mapping.definitionId
        && field.recordId === recordId && field.id === `${field.definitionId}@${recordId}`
        && field.readiness === 'ready' && field.blockingReasons?.length === 0
        && (mapping.type === 'date' ? field.precision === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(field.value)
          : typeof field.value === 'string' && !!field.value.trim())) || false;
      grid.append(makeField(row.label, row.target, row.key, recordId, answerAvailable));
    }
    for (const target of ['employment-start-date', 'employment-end-date']) {
      const source = makeField(`${target === 'employment-start-date' ? 'Start' : 'End'} Date source`, target, null, recordId);
      source.hidden = true; grid.append(source);
    }
    group.append(grid); root.append(group);
  }
}
const remaining = mappings.filter(mapping => !shown.has(mapping.target)
  && !conditionalTargets.has(mapping.target)
  && !['priorSpouses', 'jobs'].includes(mapping.recordCategory));
const prior = document.createElement('details'); prior.className = 'prior-practice';
const priorHeading = document.createElement('summary'); priorHeading.textContent = `Earlier practice fields outside this list (${remaining.length})`;
const priorGrid = document.createElement('div'); priorGrid.className = 'practice-grid';
for (const mapping of remaining) priorGrid.append(makeField(mapping.label, mapping.target));
prior.append(priorHeading, priorGrid); root.append(prior);
function showDateParts(target, prefix, recordId = null, includeDay = true) {
  const selector = `[data-practice-field="${target}"]${recordId ? `[data-practice-record="${recordId}"]` : ''}`;
  const source = root.querySelector(selector)?.value || '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) return;
  const parts = [[`${prefix}month`, match[2]], ...(includeDay ? [[`${prefix}day`, match[3]]] : []), [`${prefix}year`, match[1]]];
  for (const [key, value] of parts) {
    const input = root.querySelector(`[data-practice-placeholder="${key}"]${recordId ? `[data-practice-record="${recordId}"]` : ''}`);
    if (input && !input.value) input.value = value;
  }
}
function showChildNames(profile) {
  const grid = root.querySelector('[data-practice-section="Children"] .practice-grid');
  if (!grid || grid.querySelector('[data-generated-child]')) return 0;
  const records = new Map();
  for (const field of profile.fields || []) {
    if (!/^child-([1-9]|[12]\d|30)$/.test(field.recordId) || !['children.first-name', 'children.last-name'].includes(field.definitionId)
      || field.id !== `${field.definitionId}@${field.recordId}` || field.readiness !== 'ready'
      || field.blockingReasons?.length || typeof field.value !== 'string' || !field.value.trim()) continue;
    const record = records.get(field.recordId) || new Map();
    record.set(field.definitionId, field.value); records.set(field.recordId, record);
  }
  if (!records.size) return 0;
  grid.querySelector('[data-practice-placeholder="children-not-mapped"]')?.closest('label')?.setAttribute('hidden', '');
  let filled = 0;
  for (const [recordId, values] of [...records].sort((a, b) => Number(a[0].slice(6)) - Number(b[0].slice(6)))) {
    const ordinal = Number(recordId.slice(6));
    for (const [definitionId, label] of [['children.first-name', 'First Name'], ['children.last-name', 'Last Name']]) {
      const control = makeField(`Child ${ordinal} — ${label}`, null, `${recordId}-${label.toLowerCase().replace(' ', '-')}`);
      control.dataset.generatedChild = recordId;
      const input = control.querySelector('input'); input.value = values.get(definitionId) || '';
      if (input.value) filled++;
      grid.append(control);
    }
  }
  return filled;
}
const results = document.getElementById('results');
const status = document.getElementById('status');
function fill(profile) {
  showEmploymentRecords(profile);
  showConditionalQuestions(profile);
  const plan = fillPractice(profile, root);
  if (plan.some(item => item.target === 'birth-date' && item.status === 'filled')) showDateParts('birth-date', 'birth-');
  if (plan.some(item => item.target === 'current-marriage-date' && item.status === 'filled')) showDateParts('current-marriage-date', 'current-marriage-');
  for (const recordId of profile.jobRecords || []) {
    if (plan.some(item => item.recordId === recordId && item.target === 'employment-start-date' && item.status === 'filled')) {
      showDateParts('employment-start-date', 'employment-start-', recordId, false);
    }
    if (plan.some(item => item.recordId === recordId && item.target === 'employment-end-date' && item.status === 'filled')) {
      showDateParts('employment-end-date', 'employment-end-', recordId, false);
    }
  }
  const childCount = showChildNames(profile);
  results.replaceChildren(...plan.map(item => {
    const li = document.createElement('li');
    li.textContent = `${item.label}: ${item.status === 'filled' ? 'Filled practice answer.' : item.reason}`;
    return li;
  }));
  status.textContent = `${plan.filter(item => item.status === 'filled').length + childCount} filled; ${plan.filter(item => item.status === 'pause').length} paused. No uploads or saved data.`;
}
document.getElementById('fill').addEventListener('click', () => { if (received) fill(received); });
document.getElementById('demo').addEventListener('click', () => {
  if (waiting || received) return;
  fill(syntheticProfile());
  document.getElementById('connection').textContent = 'Built-in example only. No Intake Checker profile received.';
});
function clear() {
  disconnect(); disconnect = () => {}; received = null; waiting = false;
  clearAnswers();
  document.getElementById('connection').textContent = 'Not connected. No profile received.';
  document.getElementById('fill').disabled = true;
  document.getElementById('demo').disabled = false;
}
function clearAnswers() {
  root.querySelectorAll('input,select').forEach(input => { input.value = ''; });
  root.querySelectorAll('[data-generated-child]').forEach(label => label.remove());
  root.querySelectorAll('[data-prior-record]').forEach(section => section.remove());
  root.querySelectorAll('[data-employment-record]').forEach(section => section.remove());
  root.querySelectorAll('[data-conditional-question-group]').forEach(section => section.remove());
  root.querySelector('[data-practice-placeholder="children-not-mapped"]')?.closest('label')?.removeAttribute('hidden');
  results.replaceChildren(); status.textContent = 'Practice cleared. Nothing saved.';
}
document.getElementById('receive').addEventListener('click', () => {
  clear();
  if (!globalThis.chrome?.runtime?.onConnectExternal) {
    document.getElementById('connection').textContent = 'Load this package as an unpacked extension to connect.'; return;
  }
  waiting = true;
  document.getElementById('demo').disabled = true;
  document.getElementById('connection').textContent = 'Waiting for your approved Toolkit transfer.';
});
globalThis.chrome?.runtime?.onConnectExternal?.addListener(port => {
  if (!waiting || port.name !== BRIDGE_NAME || !trustedSender(port.sender)) { port.disconnect(); return; }
  waiting = false;
  disconnect = receiveBridge(port, {
    nonce: crypto.randomUUID(),
    onProfile(profile) {
      clearAnswers(); received = profile; showPreviousSpouses(profile); showEmploymentRecords(profile);
      showConditionalQuestions(profile);
      document.getElementById('fill').disabled = false;
      document.getElementById('connection').textContent = `Received ${profile.fields.length} ready practice fields. Nothing filled until you select Fill.`;
    },
    onClear() {
      received = null; clearAnswers();
      document.getElementById('fill').disabled = true;
      document.getElementById('demo').disabled = false;
      document.getElementById('connection').textContent = 'Connection cleared. Receive and approve again to use a profile.';
    },
  });
});
document.getElementById('clear').addEventListener('click', clear);
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => { if (event.persisted) clear(); });
