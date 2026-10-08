export const IDENTITY_SESSION_TIMEOUT_MS = 300000;

export function createLiveIdentitySessionStore({
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const sessions = new Set();

  function clear(session) {
    if (!sessions.delete(session)) return false;
    cancel(session.timeout);
    session.ssn = '';
    session.reentry = '';
    session.onClear?.();
    return true;
  }

  function create({ tabId, sourceTabId, port, ssn, reentry, onTimeout, onClear }) {
    clearTab(tabId);
    const session = { tabId, sourceTabId, port, ssn, reentry, onClear, timeout: null };
    session.timeout = schedule(() => {
      if (clear(session)) onTimeout?.();
    }, IDENTITY_SESSION_TIMEOUT_MS);
    sessions.add(session);
    return session;
  }

  function clearTab(tabId) {
    return [...sessions].filter(session => session.tabId === tabId).map(clear).filter(Boolean);
  }

  function clearSource(sourceTabId) {
    return [...sessions].filter(session => session.sourceTabId === sourceTabId).map(clear).filter(Boolean);
  }

  function clearPort(port) {
    return [...sessions].filter(session => session.port === port).map(clear).filter(Boolean);
  }

  function forTab(tabId) {
    return [...sessions].find(session => session.tabId === tabId) ?? null;
  }

  return { create, forTab, clearTab, clearSource, clearPort };
}
