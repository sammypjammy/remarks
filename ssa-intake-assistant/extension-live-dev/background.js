import { OFFICIAL_START_URL, isSavedApplicationLanding } from './page-scope.js';
import { selectSavedControl } from './select-saved-control.js';
import { isToolkitLaunchRequest } from './toolkit-launch.js';

const pendingTabs = new Map();

async function inspectLoadedTab(tab) {
  if (!pendingTabs.has(tab?.id) || tab.status !== 'complete') return;
  clearTimeout(pendingTabs.get(tab.id));
  pendingTabs.delete(tab.id);
  if (!isSavedApplicationLanding(tab.url)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectSavedControl });
  } catch { /* Leave the page untouched; the employee can select it manually. */ }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && pendingTabs.has(tabId)) void inspectLoadedTab(tab);
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (pendingTabs.has(tabId)) clearTimeout(pendingTabs.get(tabId));
  pendingTabs.delete(tabId);
});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'open-saved-application') return false;
  chrome.tabs.create({ url: OFFICIAL_START_URL, active: true }).then(tab => {
    pendingTabs.set(tab.id, setTimeout(() => pendingTabs.delete(tab.id), 30000));
    respond({ opened: true });
    void chrome.tabs.get(tab.id).then(inspectLoadedTab).catch(() => {});
  }).catch(() => respond({ opened: false }));
  return true;
});

// A Toolkit launch carries no profile, SSN, intake text, or credentials.
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isToolkitLaunchRequest(message, sender)) return false;
  chrome.tabs.create({ url: OFFICIAL_START_URL, active: true })
    .then(() => respond({ opened: true }))
    .catch(() => respond({ opened: false }));
  return true;
});
