import { mappings, fillPractice } from './mapping.js';
import { formSections } from './practice-layout.js';
import { syntheticProfile } from './synthetic.js';
import { receiveBridge, trustedSender, BRIDGE_NAME } from './bridge-contract.js';
let received = null, waiting = false, disconnect = () => {};
const root = document.getElementById('practice');
const byTarget = new Map(mappings.map(mapping => [mapping.target, mapping]));
const shown = new Set();
function makeField(labelText, target = null, key = null) {
  const mapping = target && byTarget.get(target);
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement(mapping?.type === 'boolean' ? 'select' : 'input');
  if (mapping?.type === 'boolean') {
    for (const [value, text] of [['','Select an answer'],['yes','Yes'],['no','No']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
    }
  } else input.type = 'text';
  input.autocomplete = 'off';
  if (mapping) { input.dataset.practiceField = target; shown.add(target); }
  else input.dataset.practicePlaceholder = key;
  label.append(input);
  return label;
}
for (const section of formSections) {
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
const remaining = mappings.filter(mapping => !shown.has(mapping.target));
const prior = document.createElement('details'); prior.className = 'prior-practice';
const priorHeading = document.createElement('summary'); priorHeading.textContent = `Earlier practice fields outside this list (${remaining.length})`;
const priorGrid = document.createElement('div'); priorGrid.className = 'practice-grid';
for (const mapping of remaining) priorGrid.append(makeField(mapping.label, mapping.target));
prior.append(priorHeading, priorGrid); root.append(prior);
function showDateParts(target, prefix) {
  const source = root.querySelector(`[data-practice-field="${target}"]`)?.value || '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) return;
  for (const [key, value] of [[`${prefix}month`, match[2]], [`${prefix}day`, match[3]], [`${prefix}year`, match[1]]]) {
    const input = root.querySelector(`[data-practice-placeholder="${key}"]`);
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
document.getElementById('fill').addEventListener('click', () => {
  const plan = fillPractice(received || syntheticProfile(), root);
  if (plan.some(item => item.target === 'birth-date' && item.status === 'filled')) showDateParts('birth-date', 'birth-');
  if (plan.some(item => item.target === 'current-marriage-date' && item.status === 'filled')) showDateParts('current-marriage-date', 'current-marriage-');
  const childCount = showChildNames(received || syntheticProfile());
  results.replaceChildren(...plan.map(item => {
    const li = document.createElement('li');
    li.textContent = `${item.label}: ${item.status === 'filled' ? 'Filled synthetic answer.' : item.reason}`;
    return li;
  }));
  status.textContent = `${plan.filter(item => item.status === 'filled').length + childCount} filled; ${plan.filter(item => item.status === 'pause').length} paused. No uploads or saved data.`;
});
function clear() {
  disconnect(); disconnect = () => {}; received = null; waiting = false;
  clearAnswers();
  document.getElementById('connection').textContent = 'Not connected. No profile received.';
  document.getElementById('fill').textContent = 'Fill synthetic answers';
}
function clearAnswers() {
  root.querySelectorAll('input,select').forEach(input => { input.value = ''; });
  root.querySelectorAll('[data-generated-child]').forEach(label => label.remove());
  root.querySelector('[data-practice-placeholder="children-not-mapped"]')?.closest('label')?.removeAttribute('hidden');
  results.replaceChildren(); status.textContent = 'Practice cleared. Nothing saved.';
}
document.getElementById('receive').addEventListener('click', () => {
  clear();
  if (!globalThis.chrome?.runtime?.onConnectExternal) {
    document.getElementById('connection').textContent = 'Load this package as an unpacked extension to connect.'; return;
  }
  waiting = true;
  document.getElementById('connection').textContent = 'Waiting for your approved Toolkit transfer.';
});
globalThis.chrome?.runtime?.onConnectExternal?.addListener(port => {
  if (!waiting || port.name !== BRIDGE_NAME || !trustedSender(port.sender)) { port.disconnect(); return; }
  waiting = false;
  disconnect = receiveBridge(port, {
    nonce: crypto.randomUUID(),
    onProfile(profile) {
      clearAnswers(); received = profile;
      document.getElementById('fill').textContent = 'Fill received answers';
      document.getElementById('connection').textContent = `Received ${profile.fields.length} ready practice fields. Nothing filled until you select Fill.`;
    },
    onClear() {
      received = null; clearAnswers();
      document.getElementById('fill').textContent = 'Fill synthetic answers';
      document.getElementById('connection').textContent = 'Connection cleared. Receive and approve again to use a profile.';
    },
  });
});
document.getElementById('clear').addEventListener('click', clear);
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => { if (event.persisted) clear(); });
