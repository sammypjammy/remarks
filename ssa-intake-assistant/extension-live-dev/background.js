import { OFFICIAL_START_URL, isSavedApplicationLanding } from './page-scope.js';
import { selectSavedControl } from './select-saved-control.js';
import { isToolkitLaunchRequest, isIdentityRequest, isIdentityControl } from './toolkit-launch.js';
import { inspectLivePage, selectReturnProcess, fillSavedIdentity } from './live-page-actions.js';

const pendingTabs = new Map();
let identitySession = null;
const IDENTITY_AGE_MS = 300000;

function clearIdentity() {
  if (identitySession?.timer) clearTimeout(identitySession.timer);
  identitySession = null;
}

async function inspectIdentity(tab) {
  const current = identitySession;
  if (!current || current.tabId !== tab?.id || tab.status !== 'complete'
      || current.busy || current.stage === 'filled') return;
  if (Date.now() >= current.expiresAt || Date.now() - current.lastHeartbeat > 15000) return clearIdentity();
  let url;
  try { url = new URL(tab.url); } catch { return; }
  if (url.protocol !== 'https:' || url.hostname !== 'secure.ssa.gov'
      || !/^\/iClaim(?:\/|$)/.test(url.pathname)) return clearIdentity();
  current.busy = true;
  try {
    const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectLivePage });
    if (identitySession !== current) return;
    if (page === 'choice' && current.stage === 'terms') {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectReturnProcess });
      current.stage = result === 'selected' ? 'choice-selected' : 'paused';
      if (current.stage === 'paused') { current.reason = result; current.ssn = null; current.reentry = null; }
    } else if (page === 'identity' && ['terms', 'choice-selected'].includes(current.stage)) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: fillSavedIdentity, args: [{ ssn: current.ssn, reentry: current.reentry }] });
      current.stage = result === 'filled' ? 'filled' : 'paused';
      if (current.stage === 'paused') current.reason = result;
      current.ssn = null; current.reentry = null;
    } else if (page === 'choice' && current.stage === 'choice-selected') {
      // The button may navigate after this inspection; never click it twice.
    } else if (page === 'terms' && current.stage === 'terms') {
      // Wait for the employee to review and continue.
    } else if (current.stage !== 'paused') {
      current.stage = 'paused'; current.reason = page; current.ssn = null; current.reentry = null;
    }
  } catch {
    if (identitySession === current) {
      current.stage = 'paused'; current.reason = 'inspection-failed'; current.ssn = null; current.reentry = null;
    }
  } finally { current.busy = false; }
}

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
  if (identitySession?.sourceTabId === tabId && changeInfo.status === 'loading') clearIdentity();
  if (changeInfo.status === 'complete' && identitySession?.tabId === tabId) void inspectIdentity(tab);
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (pendingTabs.has(tabId)) clearTimeout(pendingTabs.get(tabId));
  pendingTabs.delete(tabId);
  if (identitySession && [identitySession.tabId, identitySession.sourceTabId].includes(tabId)) clearIdentity();
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

// Only the identity request carries two bounded values; no intake or full profile is sent.
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (isIdentityControl(message, sender)) {
    const current = identitySession;
    if (!current || current.session !== message.session || current.sourceTabId !== sender.tab.id
        || Date.now() >= current.expiresAt) { clearIdentity(); respond({ alive: false }); return false; }
    if (message.type === 'clear-identity') { clearIdentity(); respond({ alive: false }); return false; }
    current.lastHeartbeat = Date.now(); respond({ alive: true, stage: current.stage,
      ...(current.stage === 'paused' ? { reason: current.reason } : {}) }); return false;
  }
  if (!isIdentityRequest(message, sender) && !isToolkitLaunchRequest(message, sender)) return false;
  clearIdentity();
  chrome.tabs.create({ url: OFFICIAL_START_URL, active: true }).then(tab => {
    if (message.type === 'start-identity') {
      const now = Date.now();
      identitySession = { sourceTabId: sender.tab.id, tabId: tab.id, session: message.session,
        ssn: message.ssn, reentry: message.reentry, stage: 'terms', busy: false,
        lastHeartbeat: now, expiresAt: now + IDENTITY_AGE_MS,
        timer: setTimeout(clearIdentity, IDENTITY_AGE_MS) };
      void chrome.tabs.get(tab.id).then(inspectIdentity).catch(() => {});
    }
    respond({ opened: true });
  }).catch(() => respond({ opened: false }));
  return true;
});
