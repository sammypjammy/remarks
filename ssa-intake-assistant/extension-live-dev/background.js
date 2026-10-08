import { isSavedApplicationLanding, isSsaApplicationPage, OFFICIAL_START_URL } from './page-scope.js';
import { livePageAction } from './live-page-actions.js';
import { createLiveIdentitySessionStore } from './live-identity-session.js';
import { selectSavedControl } from './select-saved-control.js';
import { isToolkitLaunchRequest } from './toolkit-launch.js';

const CHANNEL = 'ssa-identity-handoff';
const liveSessions = createLiveIdentitySessionStore();
const pollTimers = new Map();
const popupTabs = new Map();

async function inspectPopupTab(tab) {
  if (!popupTabs.has(tab?.id) || tab.status !== 'complete') return;
  clearTimeout(popupTabs.get(tab.id));
  popupTabs.delete(tab.id);
  if (!isSavedApplicationLanding(tab.url)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectSavedControl });
  } catch { /* Leave the page untouched; the popup offers a manual link. */ }
}

function notify(session, reason) {
  try { session.port.postMessage({ type: 'status', reason }); } catch { /* Disconnect cleanup handles failed delivery. */ }
}

function endSession(session, reason) {
  if (!session || !liveSessions.forTab(session.tabId)) return;
  if (reason) notify(session, reason);
  liveSessions.clearTab(session.tabId);
  try { session.port.disconnect(); } catch { /* The port may already be disconnected. */ }
}

function closeSourceSessions(sourceTabId) {
  for (const session of liveSessions.clearSource(sourceTabId)) {
    try { session.port.disconnect(); } catch { /* The Toolkit tab may already be gone. */ }
  }
}

async function inspectTab(tabId) {
  const session = liveSessions.forTab(tabId);
  if (!session || session.busy) return;
  session.busy = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') return;
    if (!isSsaApplicationPage(tab.url)) {
      endSession(session, 'wrong-page');
      return;
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: livePageAction,
      args: [{ ssn: session.ssn, reentry: session.reentry, allowReturnClick: !session.returnSelected }],
    });
    if (result === 'selected') {
      session.returnSelected = true;
      if (session.lastReason !== 'selected') notify(session, 'selected');
      session.lastReason = 'selected';
    } else if (result === 'filled') {
      endSession(session, 'filled');
    } else if (['missing-controls', 'ambiguous-controls', 'missing-ssn-input', 'missing-reentry-input',
      'ambiguous-ssn-input', 'ambiguous-reentry-input', 'unverified-controls'].includes(result)) {
      endSession(session, result);
    } else if (result === 'wrong-page' && !['/iClaim/dib', '/iClaim/dib/'].includes(new URL(tab.url).pathname)
        && !session.returnSelected) {
      endSession(session, 'wrong-page');
    }
  } catch {
    endSession(session, 'unverified-controls');
  } finally {
    session.busy = false;
  }
}

function validLaunch(message) {
  return message && Object.keys(message).length === 3
    && message.type === 'open-ssa-application'
    && typeof message.ssn === 'string' && /^\d{3}-\d{2}-\d{4}$/.test(message.ssn)
    && typeof message.reentry === 'string' && message.reentry.trim().length > 0
    && message.reentry.length <= 128;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') closeSourceSessions(tabId);
  if (changeInfo.status === 'complete' && popupTabs.has(tabId)) void inspectPopupTab(tab);
  if (changeInfo.status === 'complete' && liveSessions.forTab(tabId)) void inspectTab(tabId);
});

chrome.tabs.onRemoved.addListener(tabId => {
  const session = liveSessions.forTab(tabId);
  if (session) endSession(session, 'wrong-page');
  if (popupTabs.has(tabId)) clearTimeout(popupTabs.get(tabId));
  popupTabs.delete(tabId);
  closeSourceSessions(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'open-saved-application' || Object.keys(message).length !== 1) return false;
  chrome.tabs.create({ url: OFFICIAL_START_URL, active: true }).then(tab => {
    popupTabs.set(tab.id, setTimeout(() => popupTabs.delete(tab.id), 30000));
    respond({ opened: true });
    void chrome.tabs.get(tab.id).then(inspectPopupTab).catch(() => {});
  }).catch(() => respond({ opened: false }));
  return true;
});

chrome.runtime.onConnectExternal.addListener(port => {
  if (port.name !== CHANNEL || !isToolkitLaunchRequest({ type: 'open-ssa-application' }, port.sender)) {
    port.disconnect();
    return;
  }

  let handled = false;
  port.onMessage.addListener(message => {
    if (message?.type === 'clear' && Object.keys(message).length === 1) {
      closeSourceSessions(port.sender.tab.id);
      return;
    }
    if (handled) return;
    handled = true;
    if (!validLaunch(message)) {
      try { port.postMessage({ type: 'status', reason: 'unverified-controls' }); } finally { port.disconnect(); }
      return;
    }

    chrome.tabs.create({ url: OFFICIAL_START_URL, active: true }).then(tab => {
      if (!Number.isInteger(tab.id)) throw new Error('SSA tab was not created');
      const session = liveSessions.create({
        tabId: tab.id,
        sourceTabId: port.sender.tab.id,
        port,
        ssn: message.ssn,
        reentry: message.reentry.trim(),
        onClear: () => {
          clearInterval(pollTimers.get(tab.id));
          pollTimers.delete(tab.id);
        },
        onTimeout: () => {
          notify(session, 'wrong-page');
          try { port.disconnect(); } catch { /* The port may already be disconnected. */ }
        },
      });
      session.returnSelected = false;
      session.lastReason = '';
      session.busy = false;
      pollTimers.set(tab.id, setInterval(() => { void inspectTab(tab.id); }, 1000));
      port.postMessage({ type: 'opened' });
      void inspectTab(tab.id);
    }).catch(() => {
      try { port.postMessage({ type: 'status', reason: 'wrong-page' }); } finally { port.disconnect(); }
    });
  });

  port.onDisconnect.addListener(() => {
    liveSessions.clearPort(port);
  });
});
