import { mappings, fillPractice } from './mapping.js';
import { syntheticProfile } from './synthetic.js';
const root = document.getElementById('practice');
for (const mapping of mappings) {
  const label = document.createElement('label');
  label.textContent = mapping.label;
  const input = document.createElement('input');
  input.type = 'text'; input.autocomplete = 'off'; input.dataset.practiceField = mapping.target;
  label.append(input); root.append(label);
}
const results = document.getElementById('results');
const status = document.getElementById('status');
document.getElementById('fill').addEventListener('click', () => {
  const plan = fillPractice(syntheticProfile(), root);
  results.replaceChildren(...plan.map(item => {
    const li = document.createElement('li');
    li.textContent = `${item.label}: ${item.status === 'filled' ? 'Filled synthetic answer.' : item.reason}`;
    return li;
  }));
  status.textContent = `${plan.filter(item => item.status === 'filled').length} filled; ${plan.filter(item => item.status === 'pause').length} paused. No data sent or saved.`;
});
function clear() {
  root.querySelectorAll('input').forEach(input => { input.value = ''; });
  results.replaceChildren(); status.textContent = 'Practice cleared. Nothing saved.';
}
document.getElementById('clear').addEventListener('click', clear);
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => { if (event.persisted) clear(); });
