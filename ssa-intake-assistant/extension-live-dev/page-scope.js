// Recognition only. These paths are not verified form mappings or permission grants.
export const OFFICIAL_START_URL = 'https://secure.ssa.gov/iClaim/dib';
export const SAVED_APPLICATION_LABEL = 'Return to Saved Application Process';

export function isSavedApplicationLanding(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'secure.ssa.gov' && !url.username && !url.password
      && (url.pathname === '/iClaim/dib' || url.pathname === '/iClaim/dib/'
        || url.pathname === '/iClaim/Msg024View.action');
  } catch { return false; }
}

export function isSsaApplicationPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'secure.ssa.gov' && !url.username && !url.password
      && /^\/iClaim(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

export function classifyPage(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { kind: 'outside', label: 'No supported SSA page detected.' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { kind: 'outside', label: 'No supported SSA page detected.' };
  if (url.hostname === 'secure.ssa.gov' && (url.pathname === '/iClaim/dib' || url.pathname === '/iClaim/dib/'))
    return { kind: 'start', label: 'Official SSA disability application starting page.' };
  if (url.hostname === 'secure.ssa.gov' && /^\/iClaim(?:\/|$)/i.test(url.pathname))
    return { kind: 'application', label: 'Official SSA application domain. This page has no verified field mapping.' };
  if (url.hostname === 'www.ssa.gov' || url.hostname === 'secure.ssa.gov')
    return { kind: 'other-ssa', label: 'Official SSA domain. This page is outside the reviewed application scope.' };
  return { kind: 'outside', label: 'No supported SSA page detected.' };
}
