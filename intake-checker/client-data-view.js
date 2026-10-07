import { createClientData } from './client-data.js';

export function createClientDataView({ getSession, onLocate }) {
  const host = document.getElementById('clientDataInspector');
  const body = document.getElementById('clientDataFields');
  const json = document.getElementById('clientDataJson');
  const status = document.getElementById('clientDataStatus');
  let generation = 0;
  const snapshot = () => getSession() ? createClientData(getSession()) : null;
  function refresh() {
    generation++;
    status.textContent = '';
    body.replaceChildren(); json.textContent = '';
    const data = snapshot();
    host.hidden = !data;
    if (!data) { host.open = false; document.getElementById('clientDataCount').textContent = ''; return; }
    document.getElementById('clientDataCount').textContent = `${data.coverage.preservedOccurrences} parsed answers · ${data.coverage.unmappedFields} unmapped fields · ${data.coverage.unparsedLines} unparsed lines`;
    if (!host.open) return;
    const scopes = new Map(data.scopes.map(scope => [scope.id, scope]));
    for (const field of data.fields) {
      const row = document.createElement('tr');
      row.dataset.fieldId = field.id;
      const scope = scopes.get(field.scopeId);
      const label = document.createElement('th'); label.scope = 'row';
      label.textContent = `${scope.title} / ${field.label}`;
      const value = document.createElement('td');
      value.textContent = field.value === null ? '—' : String(field.value);
      const state = document.createElement('td');
      state.textContent = [field.valueStatus, field.origin === 'employee_entered' ? 'corrected' : '',
        field.validation.unresolvedIssueIds.length ? 'unresolved validation' : '',
        field.validation.dismissedIssueIds.length ? 'validation ignored' : '',
        field.review.reviewedIds.length ? 'reviewed' : ''].filter(Boolean).join(' · ');
      const sources = document.createElement('td');
      const ranges = field.occurrences.map(item => item.source).filter(Boolean);
      ranges.forEach((range, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn';
        button.textContent = ranges.length > 1 ? `Find ${index + 1}` : 'Find in Intake';
        button.setAttribute('aria-label', `Find structured source: ${scope.title} / ${field.label} / ${index + 1}`);
        button.addEventListener('click', () => onLocate(range)); sources.append(button);
      });
      row.append(label, value, state, sources); body.append(row);
    }
    json.textContent = JSON.stringify(data, null, 2);
  }
  host.addEventListener('toggle', refresh);
  document.getElementById('copyClientData').addEventListener('click', async () => {
    const data = snapshot(), current = generation;
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      if (generation === current) status.textContent = 'Complete JSON copied to your clipboard.';
    } catch { if (generation === current) status.textContent = 'Copy failed. You can select the JSON below or download it.'; }
  });
  document.getElementById('downloadClientData').addEventListener('click', () => {
    const data = snapshot();
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    try {
      link.href = url; link.download = 'intake-checker-client-data.json';
      document.body.append(link); link.click(); status.textContent = 'JSON download requested. The file contains the original intake and current results.';
    } finally { link.remove(); URL.revokeObjectURL(url); }
  });
  return { refresh };
}
