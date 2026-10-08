import { classifyPage } from './page-scope.js';
import { LIVE_PAGE_MAPPINGS } from './live-mappings.js';

const status = document.getElementById('page-status');
document.getElementById('mapping-status').textContent = `No later application fields are mapped (${LIVE_PAGE_MAPPINGS.length} mappings). Identity markup must match exactly or the handoff pauses.`;
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  status.textContent = classifyPage(tab?.url).label;
} catch {
  status.textContent = 'This tab could not be inspected. Continue manually.';
}

document.getElementById('open-saved').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  status.textContent = 'Opening the official SSA page…';
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'open-saved-application' });
    if (!reply?.opened) throw new Error('open failed');
  } catch {
    status.textContent = 'Could not open the page. Use the link below and select the button manually.';
    event.currentTarget.disabled = false;
  }
});
