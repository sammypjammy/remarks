import { mappings, fillPractice } from './mapping.js';
import { syntheticProfile } from './synthetic.js';
import { receiveBridge, trustedSender, BRIDGE_NAME } from './bridge-contract.js';
let received = null, waiting = false, disconnect = () => {};
const root = document.getElementById('practice');
for (const mapping of mappings) {
  const label = document.createElement('label');
  label.textContent = mapping.label;
  const input = document.createElement(mapping.type === 'boolean' ? 'select' : 'input');
  if (mapping.type === 'boolean') {
    for (const [value, text] of [['','Select an answer'],['yes','Yes'],['no','No']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
    }
  } else input.type = 'text';
  input.autocomplete = 'off'; input.dataset.practiceField = mapping.target;
  label.append(input); root.append(label);
}
const results = document.getElementById('results');
const status = document.getElementById('status');
document.getElementById('fill').addEventListener('click', () => {
  const plan = fillPractice(received || syntheticProfile(), root);
  results.replaceChildren(...plan.map(item => {
    const li = document.createElement('li');
    li.textContent = `${item.label}: ${item.status === 'filled' ? 'Filled synthetic answer.' : item.reason}`;
    return li;
  }));
  status.textContent = `${plan.filter(item => item.status === 'filled').length} filled; ${plan.filter(item => item.status === 'pause').length} paused. No uploads or saved data.`;
});
function clear() {
  disconnect(); disconnect = () => {}; received = null; waiting = false;
  clearAnswers();
  document.getElementById('connection').textContent = 'Not connected. No profile received.';
  document.getElementById('fill').textContent = 'Fill synthetic answers';
}
function clearAnswers() {
  root.querySelectorAll('input,select').forEach(input => { input.value = ''; });
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
