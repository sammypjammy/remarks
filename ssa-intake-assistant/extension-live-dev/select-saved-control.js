// Runs only after a deliberate popup action and only on the exact SSA landing URL.
// Returns a status word, never page text, form values, credentials, or URLs.
export function selectSavedControl() {
  const allowedPath = ['/iClaim/dib', '/iClaim/dib/', '/iClaim/Msg024View.action'];
  if (location.origin !== 'https://secure.ssa.gov' || !allowedPath.includes(location.pathname)) return 'wrong-page';
  const label = 'Return to a Saved Application';
  const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"]')]
    .filter(element => (element instanceof HTMLInputElement ? element.value : element.textContent)?.trim().replace(/\s+/g, ' ') === label)
    .filter(element => element.getClientRects().length > 0 && !element.disabled && element.getAttribute('aria-disabled') !== 'true')
    .filter(element => {
      const destination = element instanceof HTMLAnchorElement ? element.href : element.form?.action;
      if (!destination) return true;
      try {
        const url = new URL(destination, location.href);
        return url.origin === location.origin && url.pathname.startsWith('/iClaim/');
      } catch { return false; }
    });
  if (candidates.length !== 1) return candidates.length ? 'ambiguous' : 'not-found';
  candidates[0].click();
  return 'selected';
}
