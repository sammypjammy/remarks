// This function is injected as-is. Its return value is a reason code, never page
// text or an input value. Identity filling is the only live form action.
export function livePageAction(values) {
  const identityHeading = 'Return to Saved Application Process';
  const ssnLabel = "Applicant's Social Security Number (SSN):";
  const reentryLabel = 'Re-entry Number:';

  function normalizeText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true'
        || element instanceof HTMLInputElement && element.type.toLowerCase() === 'hidden'
        || !element.getClientRects().length) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function descendantInputs(element) {
    return [...element.querySelectorAll('input')];
  }

  function findLabelElements(labelText) {
    const elements = [...document.querySelectorAll('label, th, td, div, p, span')]
      .filter(element => isVisible(element) && normalizeText(element.textContent) === labelText);
    return elements.filter(element => !elements.some(other => other !== element
      && (other.tagName === 'LABEL' && other.contains(element)
        || element.tagName !== 'LABEL' && element.contains(other))));
  }

  function findAssociatedInputs(labelElement) {
    const forId = labelElement.getAttribute('for');
    if (forId) {
      const target = document.getElementById(forId);
      return target instanceof HTMLInputElement ? [target] : [];
    }
    if (labelElement.tagName === 'LABEL') return descendantInputs(labelElement);

    let branch = labelElement;
    for (let depth = 0; depth < 5 && branch.parentElement; depth += 1) {
      const parent = branch.parentElement;
      if (parent.tagName === 'TR' || parent.getAttribute('role') === 'row') {
        const cell = branch.closest('td, th');
        if (cell) {
          const inputs = [...parent.children]
            .filter(sibling => sibling !== cell)
            .flatMap(descendantInputs);
          if (inputs.length) return inputs;
        }
      }

      const branchIndex = [...parent.children].indexOf(branch);
      const ranked = [...parent.children].filter(sibling => sibling !== branch)
        .map(sibling => ({ sibling, index: [...parent.children].indexOf(sibling), inputs: descendantInputs(sibling) }))
        .filter(item => item.inputs.length);
      if (ranked.length) {
        const distance = Math.min(...ranked.map(item => Math.abs(item.index - branchIndex)));
        return ranked.filter(item => Math.abs(item.index - branchIndex) === distance)
          .flatMap(item => item.inputs);
      }
      branch = parent;
    }
    return [];
  }

  function eligibleInputs(elements) {
    return [...new Set(elements)].filter(input => input instanceof HTMLInputElement
      && isVisible(input) && !input.disabled && !input.readOnly);
  }

  function dispatchValueEvents(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearInput(input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return;
    setter.call(input, '');
    dispatchValueEvents(input);
  }

  function setInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter || !['text', 'password', 'tel'].includes(input.type.toLowerCase())) return false;
    setter.call(input, value);
    dispatchValueEvents(input);
    return input.value === value;
  }

  function visibleHeadingCount() {
    return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .filter(element => isVisible(element) && normalizeText(element.textContent) === identityHeading).length;
  }

  function clickReturnControl() {
    const expectedText = 'Return to Saved Application Process';
    const controls = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"]')]
      .filter(element => (element instanceof HTMLInputElement ? element.value : element.textContent)
        ?.trim().replace(/\s+/g, ' ') === expectedText)
      .filter(element => isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true')
      .filter(element => {
        const destination = element instanceof HTMLAnchorElement ? element.href : element.form?.action;
        if (!destination) return true;
        try {
          const url = new URL(destination, location.href);
          return url.origin === location.origin && url.pathname.startsWith('/iClaim/');
        } catch { return false; }
      });
    if (controls.length !== 1) return controls.length ? 'ambiguous-controls' : 'wrong-page';
    controls[0].click();
    return 'selected';
  }

  if (location.origin !== 'https://secure.ssa.gov' || !/^\/iClaim(?:\/|$)/.test(location.pathname))
    return 'wrong-page';

  const headings = visibleHeadingCount();
  if (headings > 1) return 'ambiguous-controls';
  if (!headings) {
    if (!values.allowReturnClick || location.pathname === '/iClaim/dib' || location.pathname === '/iClaim/dib/')
      return 'wrong-page';
    return clickReturnControl();
  }

  const ssnLabels = findLabelElements(ssnLabel);
  const reentryLabels = findLabelElements(reentryLabel);
  if (!ssnLabels.length || !reentryLabels.length) return 'missing-controls';
  if (ssnLabels.length !== 1 || reentryLabels.length !== 1) return 'ambiguous-controls';

  const ssnInputs = eligibleInputs(findAssociatedInputs(ssnLabels[0]));
  const reentryInputs = eligibleInputs(findAssociatedInputs(reentryLabels[0]));
  if (!ssnInputs.length || !reentryInputs.length) return 'missing-controls';
  if (ssnInputs.length !== 1 || reentryInputs.length !== 1 || ssnInputs[0] === reentryInputs[0])
    return 'ambiguous-controls';

  const ssnInput = ssnInputs[0];
  const reentryInput = reentryInputs[0];
  if (ssnInput.value || reentryInput.value) return 'unverified-controls';

  let verified = false;
  try {
    verified = setInput(ssnInput, values.ssn) && setInput(reentryInput, values.reentry)
      && ssnInput.value === values.ssn && reentryInput.value === values.reentry;
  } catch {
    verified = false;
  } finally {
    values.ssn = '';
    values.reentry = '';
  }
  if (!verified) {
    clearInput(ssnInput);
    clearInput(reentryInput);
    return 'unverified-controls';
  }
  return 'filled';
}
