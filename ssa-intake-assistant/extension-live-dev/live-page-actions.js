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

  function inputsWithin(element) {
    return [...(element instanceof HTMLInputElement ? [element] : []), ...descendantInputs(element)];
  }

  function labelTextWithoutLinks(element) {
    function collectText(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node !== element && (node instanceof HTMLAnchorElement || !isVisible(node))) return '';
      return [...node.childNodes].map(collectText).join(' ');
    }
    return normalizeText(collectText(element));
  }

  function findLabelElements(matchesText) {
    const elements = [...document.querySelectorAll('label, th, td, div, p, span')]
      .filter(element => isVisible(element) && matchesText(labelTextWithoutLinks(element)));
    return elements.filter(element => !elements.some(other => other !== element
      && (other.tagName === 'LABEL' && other.contains(element)
        || element.tagName !== 'LABEL' && element.contains(other))));
  }

  function inputsOutsideLinks(element) {
    return inputsWithin(element).filter(input => {
      for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement)
        if (ancestor instanceof HTMLAnchorElement) return false;
      return true;
    });
  }

  function eligibleInputs(elements) {
    return [...new Set(elements)].filter(input => input instanceof HTMLInputElement
      && isVisible(input) && !input.disabled && !input.readOnly
      && input.type.toLowerCase() === 'text');
  }

  function containsFieldLabel(element) {
    return [...element.querySelectorAll('label, th, td, div, p, span')].some(candidate => {
      const text = labelTextWithoutLinks(candidate);
      return text === ssnLabel || text.endsWith(ssnLabel) || text.startsWith(reentryLabel);
    });
  }

  function nextSiblingWithInputs(siblings, element) {
    const index = siblings.indexOf(element);
    if (index < 0 || index + 1 >= siblings.length) return [];
    const next = siblings[index + 1];
    return containsFieldLabel(next) ? [] : eligibleInputs(inputsOutsideLinks(next));
  }

  function findAssociatedInputs(labelElement) {
    const forId = labelElement.getAttribute('for');
    if (forId) {
      const targets = [...document.querySelectorAll('input')]
        .filter(input => input.getAttribute('id') === forId);
      if (targets.length) return targets;
    }

    const labelId = labelElement.getAttribute('id');
    if (labelId) {
      const labelledTargets = [...document.querySelectorAll('input')]
        .filter(input => (input.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/).includes(labelId));
      if (labelledTargets.length) return labelledTargets;
    }

    if (labelElement.tagName === 'LABEL') return inputsOutsideLinks(labelElement);

    const cell = labelElement.closest('td, th');
    if (cell) {
      const cellInputs = eligibleInputs(inputsOutsideLinks(cell));
      if (cellInputs.length) return cellInputs;

      const row = cell.closest('tr, [role="row"]');
      const cells = row ? [...row.children].filter(child => ['TD', 'TH'].includes(child.tagName)) : [];
      const adjacentCellInputs = nextSiblingWithInputs(cells, cell);
      if (adjacentCellInputs.length) return adjacentCellInputs;

      if (row?.parentElement) {
        const rows = [...row.parentElement.children].filter(child =>
          child.tagName === 'TR' || child.getAttribute('role') === 'row');
        const nextRowInputs = nextSiblingWithInputs(rows, row);
        if (nextRowInputs.length) return nextRowInputs;
      }
      return [];
    }

    let branch = labelElement;
    for (let depth = 0; depth < 3 && branch.parentElement
        && !['BODY', 'HTML', 'FORM'].includes(branch.parentElement.tagName); depth += 1) {
      const parent = branch.parentElement;
      if (depth === 0) {
        const siblings = [...parent.children];
        const branchIndex = siblings.indexOf(branch);
        const inContainer = eligibleInputs(siblings.slice(branchIndex + 1).flatMap(inputsOutsideLinks));
        if (inContainer.length) return inContainer;
      }
      const followingInputs = nextSiblingWithInputs([...parent.children], branch);
      if (followingInputs.length) return followingInputs;
      branch = parent;
    }
    return [];
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
    if (!setter || input.type.toLowerCase() !== 'text') return false;
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

  const ssnLabels = findLabelElements(text => text === ssnLabel || text.endsWith(ssnLabel));
  const reentryLabels = findLabelElements(text => text.startsWith(reentryLabel));
  if (!ssnLabels.length || !reentryLabels.length) return 'missing-controls';

  const ssnInputs = eligibleInputs(ssnLabels.flatMap(findAssociatedInputs));
  const reentryInputs = eligibleInputs(reentryLabels.flatMap(findAssociatedInputs));
  if (!ssnInputs.length) return 'missing-ssn-input';
  if (!reentryInputs.length) return 'missing-reentry-input';
  if (ssnInputs.length !== 1) return 'ambiguous-ssn-input';
  if (reentryInputs.length !== 1) return 'ambiguous-reentry-input';
  if (ssnInputs[0] === reentryInputs[0]) return 'ambiguous-ssn-input';

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
