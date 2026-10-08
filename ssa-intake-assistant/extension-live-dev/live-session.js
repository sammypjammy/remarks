import { PROFILE_SCHEMA, PROFILE_VERSION, planLiveFields } from './live-mappings.js';

const MAX_AGE_MS = 300000;
const isApplicationUrl = rawUrl => {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'secure.ssa.gov'
      && !url.username && !url.password && /^\/iClaim(?:\/|$)/.test(url.pathname);
  } catch { return false; }
};

// A future approved Toolkit receiver may use this in its page memory. It has
// no transport or page access, and currently plans zero fields because the
// live mapping registry is empty.
export function createLiveSession({ now = Date.now } = {}) {
  let current = null;
  function clear() { current = null; }
  function begin({ approved, tabId, url, profile, pageKey }) {
    clear();
    if (approved !== true || !Number.isInteger(tabId) || tabId < 0 || !isApplicationUrl(url)
        || profile?.schema !== PROFILE_SCHEMA || profile.schemaVersion !== PROFILE_VERSION
        || !Array.isArray(profile.fields) || typeof pageKey !== 'string' || !pageKey) return false;
    current = { tabId, pageKey, expiresAt: now() + MAX_AGE_MS,
      fields: planLiveFields(profile, pageKey) };
    return true;
  }
  function plannedFor({ tabId, url, pageKey }) {
    if (!current) return [];
    if (now() >= current.expiresAt || tabId !== current.tabId || !isApplicationUrl(url)
        || pageKey !== current.pageKey) { clear(); return []; }
    return current.fields.map(field => ({ ...field }));
  }
  return { begin, plannedFor, clear };
}
