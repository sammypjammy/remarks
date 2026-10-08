// These functions run in the isolated extension world. They return status words only.
export function inspectLivePage() {
  if (location.origin !== 'https://secure.ssa.gov' || !/^\/iClaim(?:\/|$)/.test(location.pathname)) return 'outside';
  const exact = text => text?.trim().replace(/\s+/g, ' ');
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(node => node.getClientRects().length);
  const hasHeading = text => headings.some(node => exact(node.textContent) === text);
  if (hasHeading('Benefits Application Terms of Service')) return 'terms';
  if (hasHeading('Apply Online for Disability Benefits')
      && [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a[href]')]
        .some(node => node.getClientRects().length
          && exact(node instanceof HTMLInputElement ? node.value : node.textContent) === 'Return to Saved Application Process')) return 'choice';
  if (hasHeading('Return to Saved Application Process')
      && document.body.textContent.includes("Applicant's Social Security Number (SSN):")
      && document.body.textContent.includes('Re-entry Number:')) return 'identity';
  return 'unmapped';
}

export function selectReturnProcess() {
  if (location.origin !== 'https://secure.ssa.gov' || !/^\/iClaim(?:\/|$)/.test(location.pathname)) return 'outside';
  const exact = text => text?.trim().replace(/\s+/g, ' ');
  const heading = [...document.querySelectorAll('h1,h2,h3,h4')].filter(node => node.getClientRects().length)
    .some(node => exact(node.textContent) === 'Apply Online for Disability Benefits');
  if (!heading) return 'wrong-page';
  const controls = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a[href]')]
    .filter(node => node.getClientRects().length && !node.disabled && node.getAttribute('aria-disabled') !== 'true')
    .filter(node => exact(node instanceof HTMLInputElement ? node.value : node.textContent) === 'Return to Saved Application Process')
    .filter(node => {
      const destination = node instanceof HTMLAnchorElement ? node.href : node.form?.action;
      if (!destination) return true;
      try { const url = new URL(destination, location.href); return url.origin === location.origin && url.pathname.startsWith('/iClaim/'); }
      catch { return false; }
    });
  if (controls.length !== 1) return controls.length ? 'ambiguous' : 'not-found';
  controls[0].click();
  return 'selected';
}

export function fillSavedIdentity({ ssn, reentry }) {
  if (location.origin !== 'https://secure.ssa.gov' || !/^\/iClaim(?:\/|$)/.test(location.pathname)) return 'outside';
  if (typeof ssn !== 'string' || !/^\d{3}-\d{2}-\d{4}$/.test(ssn)
      || typeof reentry !== 'string' || !reentry || reentry.length > 64 || /[^\x20-\x7e]/.test(reentry)) return 'invalid';
  const exact = text => text?.trim().replace(/\s+/g, ' ');
  if (![...document.querySelectorAll('h1,h2,h3,h4')].some(node => node.getClientRects().length
      && exact(node.textContent) === 'Return to Saved Application Process')) return 'wrong-page';
  const find = labelText => {
    const matches = [...document.querySelectorAll('label,th,td,div,p,strong,b,span')]
      .filter(node => node.getClientRects().length && exact(node.textContent) === labelText)
      .map(node => {
        const explicit = node.control || (node.getAttribute('for') ? document.getElementById(node.getAttribute('for')) : null);
        if (explicit) return explicit;
        for (let container = node, depth = 0; container && depth < 5; container = container.parentElement, depth++) {
          if (['FORM', 'BODY', 'HTML'].includes(container.tagName)) break;
          const inputs = [...container.querySelectorAll('input')].filter(input => input.type !== 'hidden');
          if (inputs.length === 1) return inputs[0];
          if (inputs.length > 1) break;
          const next = container.nextElementSibling;
          const nextInputs = next instanceof HTMLInputElement ? [next]
            : next ? [...next.querySelectorAll('input')].filter(input => input.type !== 'hidden') : [];
          if (nextInputs.length === 1) return nextInputs[0];
        }
        return null;
      }).filter(Boolean);
    return [...new Set(matches)];
  };
  const social = find("Applicant's Social Security Number (SSN):");
  const number = find('Re-entry Number:');
  if (social.length !== 1 || number.length !== 1 || social[0] === number[0]
      || ![social[0], number[0]].every(input => input instanceof HTMLInputElement
        && input.getClientRects().length && !input.disabled && !input.readOnly
        && ['text', 'password', 'tel', ''].includes(input.type)
        && input.value === '')) return 'unverified-controls';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return 'unverified-controls';
  setter.call(social[0], ssn); setter.call(number[0], reentry);
  if (social[0].value !== ssn || number[0].value !== reentry) {
    setter.call(social[0], ''); setter.call(number[0], '');
    return 'unverified-controls';
  }
  for (const input of [social[0], number[0]]) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return 'filled';
}
