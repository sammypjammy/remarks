import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyPage, OFFICIAL_START_URL, isSavedApplicationLanding, isSsaApplicationPage } from '../ssa-intake-assistant/extension-live-dev/page-scope.js';
import { selectSavedControl } from '../ssa-intake-assistant/extension-live-dev/select-saved-control.js';
import { livePageAction } from '../ssa-intake-assistant/extension-live-dev/live-page-actions.js';
import { createLiveIdentitySessionStore, IDENTITY_SESSION_TIMEOUT_MS } from '../ssa-intake-assistant/extension-live-dev/live-identity-session.js';
import { LIVE_PAGE_MAPPINGS, RESERVED_TARGETS, planLiveFields } from '../ssa-intake-assistant/extension-live-dev/live-mappings.js';
import { createLiveSession } from '../ssa-intake-assistant/extension-live-dev/live-session.js';
import { isToolkitLaunchRequest } from '../ssa-intake-assistant/extension-live-dev/toolkit-launch.js';
import { LIVE_EXTENSION_ID } from '../ssa-intake-assistant/src/model/live-extension-id.js';
import { createHash } from 'node:crypto';

const SYNTHETIC_SSN = '000-12-3456';
const SYNTHETIC_REENTRY = 'SYNTHETIC-REENTRY';

function syntheticPage(pathname, build) {
  const previous = {
    location: globalThis.location, document: globalThis.document, Event: globalThis.Event,
    HTMLInputElement: globalThis.HTMLInputElement, HTMLAnchorElement: globalThis.HTMLAnchorElement,
    Node: globalThis.Node,
  };
  const elements = [];
  const dispatched = [];
  const matches = (element, selector) => selector.split(',').some(raw => {
    const item = raw.trim();
    if (item === '[role="heading"]' || item === '[role=heading]') return element.getAttribute('role') === 'heading';
    if (item === '[role="row"]' || item === '[role=row]') return element.getAttribute('role') === 'row';
    if (item === '[role="button"]' || item === '[role=button]') return element.getAttribute('role') === 'button';
    if (item === 'a[href]') return element.tagName === 'A' && element.getAttribute('href') !== null;
    if (item === 'input[type="button"]' || item === 'input[type=button]') return element.tagName === 'INPUT' && element.type === 'button';
    if (item === 'input[type="submit"]' || item === 'input[type=submit]') return element.tagName === 'INPUT' && element.type === 'submit';
    return /^[a-z][a-z0-9]*$/i.test(item) && element.tagName.toLowerCase() === item.toLowerCase();
  });
  let documentObject;
  class Element {
    constructor(tagName, textContent = '', attributes = {}) {
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.childNodes = [];
      this.textContent = textContent;
      this.attributes = { ...attributes };
      this.children = [];
      this.parentElement = null;
      this.ownerDocument = documentObject;
      this.hidden = Boolean(attributes.hidden);
      this.disabled = Boolean(attributes.disabled);
      this.readOnly = Boolean(attributes.readOnly);
      this.style = {};
      this.events = [];
      elements.push(this);
    }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) {
      this.childNodes = value ? [{ nodeType: 3, textContent: String(value) }] : [];
    }
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? String(this.attributes[name]) : null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
        this.childNodes.push(child);
      }
      return this;
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      return this.descendants().filter(element => matches(element, selector));
    }
    closest(selector) {
      for (let current = this; current?.tagName; current = current.parentElement)
        if (matches(current, selector)) return current;
      return null;
    }
    dispatchEvent(event) { this.events.push(event.type); dispatched.push(event.type); return true; }
    click() { this.clicked = true; }
  }
  class Input extends Element {
    constructor(type = 'text', attributes = {}) {
      super('input', '', { ...attributes, type });
      this.type = type;
      this._value = '';
      this.rejectsValue = Boolean(attributes.rejectsValue);
    }
    get value() { return this._value; }
    set value(value) {
      const text = String(value);
      if (this.rejectsValue && text) this._value = '';
      else if (this.type === 'number' && text && !/^-?\d+(?:\.\d+)?$/.test(text)) this._value = '';
      else this._value = text;
    }
  }
  class Anchor extends Element {
    constructor(text, href = '') { super('a', text, href ? { href } : {}); this.href = href; }
  }
  class SyntheticEvent { constructor(type) { this.type = type; } }
  documentObject = {
    children: [],
    append(...children) {
      for (const child of children) {
        child.parentElement = documentObject;
        documentObject.children.push(child);
      }
    },
    querySelectorAll: selector => elements.filter(element => matches(element, selector)),
    getElementById: id => elements.find(element => element.getAttribute('id') === id) || null,
    defaultView: { getComputedStyle: element => element.style },
  };
  for (const element of elements) element.ownerDocument = documentObject;
  documentObject.defaultView = { getComputedStyle: element => element.style };
  globalThis.location = { origin: 'https://secure.ssa.gov', pathname, href: `https://secure.ssa.gov${pathname}` };
  globalThis.document = documentObject;
  globalThis.Event = SyntheticEvent;
  globalThis.HTMLInputElement = Input;
  globalThis.HTMLAnchorElement = Anchor;
  globalThis.Node = { TEXT_NODE: 3 };
  const api = {
    node: (tag, text = '', attrs = {}) => new Element(tag, text, attrs),
    input: (type = 'text', attrs = {}) => new Input(type, attrs),
    anchor: (text, href = '') => new Anchor(text, href),
    dispatched,
    restore: () => Object.assign(globalThis, previous),
  };
  build(api);
  for (const element of elements) element.ownerDocument = documentObject;
  return api;
}

function identityPage(layout = 'table', { ssnType = 'text', reentryType = 'text', rejectReentry = false } = {}) {
  let page;
  const inputs = [];
  const unrelatedInputs = [];
  page = syntheticPage('/iClaim/Msg024View.action', ({ node, input, anchor }) => {
    const heading = node('h1', 'Return to Saved Application Process');
    const ssn = input(ssnType, { rejectsValue: false });
    const reentry = input(reentryType, { rejectsValue: rejectReentry });
    inputs.push(ssn, reentry);
    document.append(heading);
    if (layout === 'labels') {
      const ssnText = "Applicant's Social Security Number (SSN):";
      const ssnLabel = node('label', '', { for: 'ssn-field' }).append(node('span', ssnText));
      const reentryLabel = node('label', '', { for: 'reentry-field' }).append(node('span', 'Re-entry Number:'));
      ssn.attributes.id = 'ssn-field'; reentry.attributes.id = 'reentry-field';
      document.append(ssnLabel, ssn, reentryLabel, reentry);
    } else if (layout === 'aria-labelledby') {
      const ssnLabel = node('label', "Applicant's Social Security Number (SSN):", { id: 'ssn-label' });
      const reentryLabel = node('label', 'Re-entry Number:', { id: 'reentry-label' });
      ssn.attributes['aria-labelledby'] = 'ssn-label';
      reentry.attributes['aria-labelledby'] = 'reentry-label';
      document.append(ssnLabel, ssn, reentryLabel, reentry);
    } else if (layout === 'table-same-cell') {
      const ssnRow = node('tr');
      ssnRow.append(node('td').append(node('span', "Applicant's Social Security Number (SSN):"), ssn));
      const reentryRow = node('tr');
      reentryRow.append(node('td').append(node('span', 'Re-entry Number:'), reentry));
      document.append(ssnRow, reentryRow);
    } else if (layout === 'table') {
      const row = node('tr');
      row.append(node('td', "Applicant's Social Security Number (SSN):"), node('td').append(ssn));
      document.append(row);
      const secondRow = node('tr');
      secondRow.append(node('th', 'Re-entry Number:'), node('td').append(reentry));
      document.append(secondRow);
    } else if (layout === 'table-next-row') {
      const ssnLabelRow = node('tr').append(node('td', "Applicant's Social Security Number (SSN):"));
      const ssnInputRow = node('tr').append(node('td').append(ssn));
      const reentryLabelRow = node('tr').append(node('td', 'Re-entry Number:'));
      const reentryInputRow = node('tr').append(node('td').append(reentry));
      document.append(ssnLabelRow, ssnInputRow, reentryLabelRow, reentryInputRow);
    } else if (layout === 'div-same-container') {
      const priorSsn = input();
      const priorReentry = input();
      unrelatedInputs.push(priorSsn, priorReentry);
      const ssnGroup = node('div').append(priorSsn, node('p', "Applicant's Social Security Number (SSN):"), ssn);
      const reentryGroup = node('div').append(priorReentry, node('p', 'Re-entry Number:'), reentry);
      document.append(ssnGroup, reentryGroup);
    } else if (layout === 'div-next-container') {
      const ssnGroup = node('div').append(node('p', "Applicant's Social Security Number (SSN):"));
      const ssnInputs = node('div').append(ssn);
      const reentryGroup = node('div').append(node('p', 'Re-entry Number:'));
      const reentryInputs = node('div').append(reentry);
      document.append(node('section').append(ssnGroup, ssnInputs, reentryGroup, reentryInputs));
    } else if (layout === 'ssn-label-suffix') {
      const ssnRow = node('tr').append(node('td', `Applicant ID: ${"Applicant's Social Security Number (SSN):"}`), node('td').append(ssn));
      const reentryRow = node('tr').append(node('td', 'Re-entry Number:'), node('td').append(reentry));
      document.append(ssnRow, reentryRow);
    } else if (layout === 'spans') {
      const ssnGroup = node('div');
      ssnGroup.append(node('span', "Applicant's Social Security Number (SSN):"), node('span').append(ssn));
      const reentryGroup = node('div');
      reentryGroup.append(node('span', 'Re-entry Number:'), node('span').append(reentry));
      document.append(ssnGroup, reentryGroup);
    } else if (layout === 'reentry-help-link') {
      const ssnRow = node('tr');
      ssnRow.append(node('td', "Applicant's Social Security Number (SSN):"), node('td').append(ssn));
      const reentryGroup = node('div');
      const helpInput = input();
      unrelatedInputs.push(helpInput);
      reentryGroup.append(
        node('div', 'Re-entry Number:').append(anchor('Forgot or lost Re-entry Number', '/iClaim/forgot').append(helpInput)),
        node('div').append(reentry),
      );
      const unrelated = input();
      unrelatedInputs.push(unrelated);
      document.append(ssnRow, reentryGroup, unrelated);
    } else {
      const ssnGroup = node('div');
      ssnGroup.append(node('p', "Applicant's Social Security Number (SSN):"), node('div').append(node('span').append(ssn)));
      const reentryGroup = node('div');
      reentryGroup.append(node('p', 'Re-entry Number:'), node('div').append(node('span').append(reentry)));
      document.append(ssnGroup, reentryGroup);
    }
  });
  return { ...page, inputs, unrelatedInputs };
}

test('recognizes only exact HTTPS SSA application origins and never trusts lookalikes', () => {
  assert.equal(OFFICIAL_START_URL, 'https://secure.ssa.gov/iClaim/dib');
  assert.equal(classifyPage(OFFICIAL_START_URL).kind, 'start');
  assert.equal(classifyPage(`${OFFICIAL_START_URL}/`).kind, 'start');
  assert.equal(classifyPage('https://secure.ssa.gov/iClaim/Msg024View.action').kind, 'application');
  for (const url of [
    'http://secure.ssa.gov/iClaim/', 'https://secure.ssa.gov.evil.invalid/iClaim/',
    'https://ssa.gov.evil.invalid/apply', 'https://www.ssa.gov@evil.invalid/apply',
    'https://login.gov/', 'chrome://extensions', 'not-a-url',
  ]) assert.equal(classifyPage(url).kind, 'outside', url);
  assert.equal(classifyPage('https://www.ssa.gov/apply').kind, 'other-ssa');
  assert.equal(classifyPage('https://www.ssa.gov/disability').kind, 'other-ssa');
  assert.equal(classifyPage('https://secure.ssa.gov/other').kind, 'other-ssa');
  assert(isSavedApplicationLanding(OFFICIAL_START_URL));
  assert(isSavedApplicationLanding('https://secure.ssa.gov/iClaim/Msg024View.action'));
  assert(!isSavedApplicationLanding('https://secure.ssa.gov/iClaim/other'));
  assert(!isSavedApplicationLanding('https://secure.ssa.gov.evil.invalid/iClaim/dib'));
  assert(isSsaApplicationPage('https://secure.ssa.gov/iClaim/identity/step'));
  assert(!isSsaApplicationPage('https://secure.ssa.gov.evil.invalid/iClaim/identity/step'));
});

test('saved-application extension exposes only the Toolkit launch message and no client-data storage', async () => {
  const root = new URL('../ssa-intake-assistant/extension-live-dev/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const popup = await readFile(new URL('popup.html', root), 'utf8');
  const script = await readFile(new URL('popup.js', root), 'utf8');
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://secure.ssa.gov/*']);
  assert.equal(manifest.background.service_worker, 'background.js');
  for (const key of ['optional_host_permissions', 'content_scripts'])
    assert.equal(key in manifest, false, key);
  assert.deepEqual(manifest.externally_connectable.matches,
    ['https://packardtoolkit.vercel.app/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16);
  const id = [...digest].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  assert.equal(id, LIVE_EXTENSION_ID);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(script, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.doesNotMatch(script, /fetch\(|postMessage|connect\(|storage|\.value\b|textContent\s*=\s*tab\?\.url\s*;/);
  assert.match(popup, /Identity matching is fail-closed/);
  assert.match(popup, /href="https:\/\/secure\.ssa\.gov\/iClaim\/dib"/);
  assert.match(popup, /Open and select saved application/);
  assert.match(popup, /fills and verifies only SSN and re-entry number/);
  assert.match(popup, /later application questions/);
  assert.doesNotMatch(popup, /<form|<input/);
  const background = await readFile(new URL('background.js', root), 'utf8');
  assert.doesNotMatch(background, /fetch\(|chrome\.storage|localStorage|sessionStorage|indexedDB/);
  assert.match(background, /livePageAction/);
  assert.match(background, /open-ssa-application/);
  assert.match(background, /isSsaApplicationPage/);
  assert.doesNotMatch(background, /console\.(?:log|warn|error|info|debug)/);
  const action = await readFile(new URL('live-page-actions.js', root), 'utf8');
  assert.doesNotMatch(action, /console\.|localStorage|sessionStorage|indexedDB|fetch\(|SYNTHETIC/);
});

test('Toolkit launch accepts only an exact top-level source tab and message without client data', () => {
  const sender = { tab: { id: 4 }, frameId: 0, url: 'http://localhost:5173/intake-checker/', origin: 'http://localhost:5173' };
  assert(isToolkitLaunchRequest({ type: 'open-ssa-application' }, sender));
  for (const bad of [
    { ...sender, url: 'http://localhost:5173/intake-checker/?ssn=123' },
    { ...sender, url: 'https://evil.invalid/intake-checker/' },
    { ...sender, origin: 'https://evil.invalid' },
    { ...sender, tab: undefined },
    { ...sender, frameId: 1 },
  ]) assert(!isToolkitLaunchRequest({ type: 'open-ssa-application' }, bad));
  assert(!isToolkitLaunchRequest({ type: 'open-ssa-application', ssn: 'synthetic' }, sender));
});

test('Intake Assistant launch sends only a ready SSN and temporary re-entry number after authentication', async () => {
  const source = await readFile(new URL('../ssa-intake-assistant/src/LiveLaunch.jsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/api\/auth\/session'/);
  assert.match(source, /chrome\.runtime\.connect\(LIVE_EXTENSION_ID, \{ name: channel \}\)/);
  assert.match(source, /type: 'open-ssa-application', ssn, reentry: reentryValue/);
  assert.doesNotMatch(source, /\bprofile\b|clientFilingText|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /console\.(?:log|warn|error|info|debug)/);
  assert.match(source, /packardaccountchange/);
  assert.match(source, /pagehide/);
});

test('identity-page action recognizes label/for, aria-labelledby, table-cell and separate div/paragraph layouts', () => {
  for (const layout of [
    'labels', 'aria-labelledby', 'table-same-cell', 'table', 'table-next-row', 'div-same-container',
    'div-next-container', 'ssn-label-suffix', 'divs', 'spans',
  ]) {
    const page = identityPage(layout);
    const values = { ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY, allowReturnClick: true };
    try {
      let result;
      try { result = livePageAction(values); } catch (error) { error.message += ` (${layout})`; throw error; }
      assert.equal(result, 'filled', layout);
      assert.deepEqual(page.inputs.map(input => input.value), [SYNTHETIC_SSN, SYNTHETIC_REENTRY], layout);
      assert.deepEqual(page.inputs.map(input => input.events), [['input', 'change'], ['input', 'change']], layout);
      assert(page.unrelatedInputs.every(input => input.value === ''), layout);
      assert.equal(values.ssn, '');
      assert.equal(values.reentry, '');
    } finally { page.restore(); }
  }
});

test('identity-page action supports text controls using the native setter', () => {
  const page = identityPage('table');
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'filled');
    assert.deepEqual(page.inputs.map(input => input.value), [SYNTHETIC_SSN, SYNTHETIC_REENTRY]);
    assert(page.inputs.every(input => input.events.join(',') === 'input,change'));
  } finally { page.restore(); }
});

test('identity-page action resolves the supplied SSA label/id markup and ignores its help link', () => {
  const page = syntheticPage('/iClaim/Msg024View.action', ({ node, input, anchor }) => {
    document.append(node('h1', 'Return to Saved Application Process'));
    const ssnLabel = node('label', "Applicant's Social Security Number (SSN):", {
      for: 'ssn', id: 'uef-ssn1PatternLabel',
    });
    const duplicateSsnLabel = node('label', "Applicant's Social Security Number (SSN):", {
      for: 'ssn', id: 'uef-ssn1PatternLabel-duplicate',
    });
    const ssn = input('text', {
      id: 'ssn', name: 'SSN', 'aria-labelledby': 'uef-ssn1PatternLabel',
      autocomplete: 'off', maxlength: '11',
    });
    const reentryHelp = anchor('Forgot or lost Re-entry Number');
    reentryHelp.attributes.title = 'Forgot or lost Re-entry Number';
    reentryHelp.attributes.id = 'uef-help0';
    const reentryLabel = node('label', 'Re-entry Number: Forgot or lost Re-entry Number', {
      for: 'reentrynum', id: 'uef-textBox1PatternLabel',
    }).append(reentryHelp);
    const reentry = input('text', {
      id: 'reentrynum', name: 'reentryNum', 'aria-labelledby': 'uef-textBox1PatternLabel',
      autocomplete: 'off', maxlength: '9',
    });
    const unrelated = input('text', { id: 'unrelated' });
    document.append(ssnLabel, duplicateSsnLabel, ssn, reentryLabel, reentry, unrelated);
  });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'filled');
    assert.equal(document.getElementById('ssn').value, SYNTHETIC_SSN);
    assert.equal(document.getElementById('reentrynum').value, SYNTHETIC_REENTRY);
    assert.equal(document.getElementById('unrelated').value, '');
    assert.deepEqual(document.querySelectorAll('input').map(field => field.events),
      [['input', 'change'], ['input', 'change'], []]);
  } finally { page.restore(); }
});

test('identity-page action ignores a re-entry help link and fills only its associated input', () => {
  const page = identityPage('reentry-help-link');
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'filled');
    assert.deepEqual(page.inputs.map(input => input.value), [SYNTHETIC_SSN, SYNTHETIC_REENTRY]);
    assert.deepEqual(page.unrelatedInputs.map(input => input.value), ['', '']);
    assert.deepEqual(page.inputs.map(input => input.events), [['input', 'change'], ['input', 'change']]);
  } finally { page.restore(); }
});

test('identity-page action returns field-specific missing and ambiguous input reasons without filling', () => {
  for (const [failure, expected] of [
    ['missing-ssn', 'missing-ssn-input'],
    ['missing-reentry', 'missing-reentry-input'],
    ['ambiguous-ssn', 'ambiguous-ssn-input'],
    ['ambiguous-reentry', 'ambiguous-reentry-input'],
  ]) {
    const inputs = [];
    const page = syntheticPage('/iClaim/Msg024View.action', ({ node, input }) => {
      document.append(node('h1', 'Return to Saved Application Process'));
      const ssnLabel = node('td', "Applicant's Social Security Number (SSN):");
      const reentryLabel = node('td', 'Re-entry Number:');
      const ssnCell = node('td');
      const reentryCell = node('td');
      if (failure !== 'missing-ssn') {
        const ssn = input();
        inputs.push(ssn);
        ssnCell.append(ssn);
        if (failure === 'ambiguous-ssn') {
          const duplicate = input();
          inputs.push(duplicate);
          ssnCell.append(duplicate);
        }
      }
      if (failure !== 'missing-reentry') {
        const reentry = input();
        inputs.push(reentry);
        reentryCell.append(reentry);
        if (failure === 'ambiguous-reentry') {
          const duplicate = input();
          inputs.push(duplicate);
          reentryCell.append(duplicate);
        }
      }
      document.append(node('tr').append(ssnLabel, ssnCell), node('tr').append(reentryLabel, reentryCell));
    });

    try {
      assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), expected, failure);
      assert(inputs.every(input => input.value === '' && input.events.length === 0), failure);
    } finally { page.restore(); }
  }
});

test('field-specific input diagnostics are status-only and terminal in the Toolkit flow', async () => {
  const source = await readFile(new URL('../ssa-intake-assistant/src/LiveLaunch.jsx', import.meta.url), 'utf8');
  const background = await readFile(new URL('../ssa-intake-assistant/extension-live-dev/background.js', import.meta.url), 'utf8');
  for (const reason of ['missing-ssn-input', 'missing-reentry-input', 'ambiguous-ssn-input', 'ambiguous-reentry-input']) {
    assert.match(source, new RegExp(`['"]${reason}['"]`));
    assert.match(background, new RegExp(`['"]${reason}['"]`));
  }
  assert.doesNotMatch(source, /000-12-3456|SYNTHETIC-REENTRY/);
  assert.doesNotMatch(background, /console\.(?:log|warn|error|info|debug)/);
});

test('identity-page action ignores hidden controls and safely rejects duplicate labels', () => {
  const hiddenPage = syntheticPage('/iClaim/Msg024View.action', ({ node, input }) => {
    document.append(node('h1', 'Return to Saved Application Process'));
    const row = node('tr');
    const hidden = input('hidden');
    const disabled = input('text', { disabled: true });
    const readOnly = input('text', { readOnly: true });
    const visible = input('text');
    row.append(node('td', "Applicant's Social Security Number (SSN):"), node('td').append(hidden, disabled, readOnly, visible));
    const second = node('tr');
    const reentry = input('text');
    second.append(node('td', 'Re-entry Number:'), node('td').append(reentry));
    document.append(row, second);
  });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'filled');
  } finally { hiddenPage.restore(); }

  const duplicatePage = syntheticPage('/iClaim/Msg024View.action', ({ node, input }) => {
    document.append(node('h1', 'Return to Saved Application Process'));
    for (const label of ["Applicant's Social Security Number (SSN):", "Applicant's Social Security Number (SSN):"])
      document.append(node('div').append(node('p', label), node('div').append(input())));
    document.append(node('div').append(node('p', 'Re-entry Number:'), node('div').append(input())));
  });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'ambiguous-ssn-input');
  } finally { duplicatePage.restore(); }
});

test('identity-page action returns distinct safe reasons for wrong page and missing controls', () => {
  const wrong = syntheticPage('/iClaim/Msg024View.action', ({ node }) => document.append(node('h1', 'A different SSA heading')));
  try { assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'wrong-page'); }
  finally { wrong.restore(); }
  const missing = syntheticPage('/iClaim/Msg024View.action', ({ node }) => document.append(node('h1', 'Return to Saved Application Process')));
  try { assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'missing-controls'); }
  finally { missing.restore(); }
  const terms = syntheticPage('/iClaim/dib', ({ node }) => {
    document.append(node('h1', 'Terms of Service'), node('button', 'Return to Saved Application Process'));
  });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY, allowReturnClick: true }), 'wrong-page');
  } finally { terms.restore(); }
});

test('identity-page action clicks only the exact unique saved-process control after Terms', () => {
  const page = syntheticPage('/iClaim/Msg024View.action', ({ node }) => {
    document.append(node('button', 'Return to Saved Application Process'));
  });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY, allowReturnClick: true }), 'selected');
    assert.equal(document.querySelectorAll('button')[0].clicked, true);
  } finally { page.restore(); }
});

test('identity-page action rejects numeric SSN inputs and clears both fields on failed verification', () => {
  const numeric = identityPage('table', { ssnType: 'number' });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'missing-ssn-input');
    assert.deepEqual(numeric.inputs.map(input => input.value), ['', '']);
  } finally { numeric.restore(); }
  const rejected = identityPage('table', { rejectReentry: true });
  try {
    assert.equal(livePageAction({ ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY }), 'unverified-controls');
    assert.deepEqual(rejected.inputs.map(input => input.value), ['', '']);
    assert(rejected.inputs.every(input => input.events.includes('input') && input.events.includes('change')));
  } finally { rejected.restore(); }
});

test('live identity sessions clear on source reload/logout, tab close, timeout, and disconnect', () => {
  const timers = [];
  const store = createLiveIdentitySessionStore({
    schedule: callback => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; },
    cancel: timer => { if (timer) timer.cancelled = true; },
  });
  const make = (tabId, sourceTabId, port = {}) => store.create({
    tabId, sourceTabId, port, ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY,
  });
  assert.equal(IDENTITY_SESSION_TIMEOUT_MS, 300000);
  const reload = make(1, 10);
  assert.equal(store.clearSource(10).length, 1);
  assert.equal(reload.ssn, ''); assert.equal(reload.reentry, '');
  const logout = make(2, 11);
  assert.equal(store.clearSource(11).length, 1);
  assert.equal(logout.ssn, ''); assert.equal(logout.reentry, '');
  const tabClose = make(3, 12);
  assert.equal(store.clearTab(3).length, 1);
  assert.equal(tabClose.ssn, ''); assert.equal(tabClose.reentry, '');
  const disconnectPort = {};
  const disconnect = make(4, 13, disconnectPort);
  assert.equal(store.clearPort(disconnectPort).length, 1);
  assert.equal(disconnect.ssn, ''); assert.equal(disconnect.reentry, '');
  const timeout = make(5, 14);
  timers.at(-1).callback();
  assert.equal(store.forTab(5), null);
  assert.equal(timeout.ssn, ''); assert.equal(timeout.reentry, '');
  assert(timers.every(timer => timer.cancelled));
});

test('future live field registry starts empty and reserves identity and filing controls', () => {
  assert.deepEqual(LIVE_PAGE_MAPPINGS, []);
  for (const target of ['re-entry-number', 'password', 'mfa', 'captcha', 'attestation', 'signature', 'final-submission'])
    assert(RESERVED_TARGETS.includes(target));
  const profile = { schema: 'packard.intake-client-profile', schemaVersion: '3.5.0', fields: [{
    id: 'personal.first-name', definitionId: 'personal.first-name', recordId: null,
    readiness: 'ready', blockingReasons: [], dataType: 'text', value: 'Synthetic',
  }] };
  assert.deepEqual(planLiveFields(profile, 'unverified-page'), []);
  assert.deepEqual(planLiveFields({ ...profile, schemaVersion: 'old' }, 'unverified-page'), []);
});

test('future approved profile session is one-tab, short-lived and empty before mappings are verified', () => {
  let time = 1000;
  const session = createLiveSession({ now: () => time });
  const profile = { schema: 'packard.intake-client-profile', schemaVersion: '3.5.0', fields: [{
    id: 'personal.first-name', definitionId: 'personal.first-name', recordId: null,
    readiness: 'ready', blockingReasons: [], dataType: 'text', value: 'Synthetic',
  }] };
  const input = { approved: true, tabId: 3, url: OFFICIAL_START_URL, profile, pageKey: 'unverified' };
  assert.equal(session.begin({ ...input, approved: false }), false);
  assert.equal(session.begin({ ...input, url: 'https://evil.invalid/iClaim/dib' }), false);
  assert.equal(session.begin(input), true);
  assert.deepEqual(session.plannedFor({ tabId: 3, url: OFFICIAL_START_URL, pageKey: 'unverified' }), []);
  assert.deepEqual(session.plannedFor({ tabId: 4, url: OFFICIAL_START_URL, pageKey: 'unverified' }), []);
  assert.equal(session.begin(input), true);
  time += 300001;
  assert.deepEqual(session.plannedFor({ tabId: 3, url: OFFICIAL_START_URL, pageKey: 'unverified' }), []);
  session.clear();
});

test('background opens only the exact SSA URL and injects only after its landing page completes', async () => {
  const saved = globalThis.chrome;
  const hooks = {};
  const injected = [];
  const openedTabs = new Map();
  let nextTab = 20;
  let result = 'wrong-page';
  function event(name) { return { addListener: listener => { hooks[name] = listener; } }; }
  function portFor(sender) {
    const port = {
      name: 'ssa-identity-handoff', sender, messages: [], disconnected: false,
      onMessage: { addListener: listener => { port.messageListener = listener; } },
      onDisconnect: { addListener: listener => { port.disconnectListener = listener; } },
      postMessage(message) { this.messages.push(message); },
      disconnect() { this.disconnected = true; this.disconnectListener?.(); },
      send(message) { this.messageListener(message); },
    };
    return port;
  }
  globalThis.chrome = {
    tabs: {
      onUpdated: event('updated'),
      onRemoved: event('removed'),
      create: async options => {
        assert.equal(options.url, OFFICIAL_START_URL);
        const tab = { id: nextTab++, status: 'complete', url: OFFICIAL_START_URL };
        openedTabs.set(tab.id, tab);
        return tab;
      },
      get: async id => openedTabs.get(id),
    },
    runtime: {
      onMessage: event('message'),
      onConnectExternal: event('external'),
    },
    scripting: { executeScript: async options => { injected.push(options); return [{ result }]; } },
  };
  try {
    await import(`../ssa-intake-assistant/extension-live-dev/background.js?synthetic=${Date.now()}`);
    const sender = { tab: { id: 3 }, frameId: 0, url: 'http://localhost:5173/intake-checker/', origin: 'http://localhost:5173' };
    const port = portFor(sender);
    hooks.external(port);
    port.send({ type: 'open-ssa-application', ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(port.messages[0], { type: 'opened' });
    assert.equal(injected.length, 1);
    assert.equal(injected[0].target.tabId, 20);
    assert.deepEqual(Object.keys(injected[0].args[0]).sort(), ['allowReturnClick', 'reentry', 'ssn']);
    assert.equal(injected[0].args[0].ssn, SYNTHETIC_SSN);
    assert.equal(injected[0].args[0].reentry, SYNTHETIC_REENTRY);

    openedTabs.set(20, { id: 20, status: 'complete', url: 'https://secure.ssa.gov/iClaim/Msg024View.action' });
    result = 'selected';
    hooks.updated(20, { status: 'complete' }, openedTabs.get(20));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(port.messages.some(message => message.type === 'status' && message.reason === 'selected'));
    result = 'filled';
    hooks.updated(20, { status: 'complete' }, openedTabs.get(20));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(port.messages.some(message => message.type === 'status' && message.reason === 'filled'));
    assert(port.disconnected);
    for (const message of port.messages) {
      if (message.type === 'opened') assert.deepEqual(Object.keys(message), ['type']);
      else {
        assert.deepEqual(Object.keys(message), ['type', 'reason']);
        assert(['selected', 'wrong-page', 'missing-controls', 'ambiguous-controls', 'missing-ssn-input',
          'missing-reentry-input', 'ambiguous-ssn-input', 'ambiguous-reentry-input',
          'unverified-controls', 'filled'].includes(message.reason));
      }
    }
    assert.doesNotMatch(JSON.stringify(port.messages), /000-12-3456|SYNTHETIC-REENTRY/);

    const invalidPort = portFor(sender);
    hooks.external(invalidPort);
    invalidPort.send({ type: 'open-ssa-application', ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY, profile: {} });
    assert(invalidPort.disconnected);
    assert.deepEqual(invalidPort.messages, [{ type: 'status', reason: 'unverified-controls' }]);

    const reloadPort = portFor(sender);
    hooks.external(reloadPort);
    reloadPort.send({ type: 'open-ssa-application', ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY });
    await new Promise(resolve => setTimeout(resolve, 0));
    hooks.updated(3, { status: 'loading' }, { id: 3 });
    assert(reloadPort.disconnected);

    const logoutPort = portFor(sender);
    hooks.external(logoutPort);
    logoutPort.send({ type: 'open-ssa-application', ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY });
    await new Promise(resolve => setTimeout(resolve, 0));
    logoutPort.send({ type: 'clear' });
    assert(logoutPort.disconnected);

    const closedPort = portFor(sender);
    hooks.external(closedPort);
    closedPort.send({ type: 'open-ssa-application', ssn: SYNTHETIC_SSN, reentry: SYNTHETIC_REENTRY });
    await new Promise(resolve => setTimeout(resolve, 0));
    hooks.removed(23);
    assert(closedPort.disconnected);
  } finally { globalThis.chrome = saved; }
});

test('exact control selector clicks only one visible, enabled, same-origin saved-application control', () => {
  const original = { location: globalThis.location, document: globalThis.document,
    HTMLInputElement: globalThis.HTMLInputElement, HTMLAnchorElement: globalThis.HTMLAnchorElement };
  class Input {}
  class Anchor {}
  const control = (text, extra = {}) => ({ textContent: text, getClientRects: () => [1], disabled: false,
    getAttribute: () => null, click() { this.clicked = true; }, ...extra });
  try {
    globalThis.HTMLInputElement = Input; globalThis.HTMLAnchorElement = Anchor;
    globalThis.location = { origin: 'https://secure.ssa.gov', pathname: '/iClaim/dib', href: OFFICIAL_START_URL };
    const first = control('Return to Saved Application Process');
    globalThis.document = { querySelectorAll: () => [first] };
    assert.equal(selectSavedControl(), 'selected'); assert.equal(first.clicked, true);
    first.clicked = false;
    globalThis.document.querySelectorAll = () => [first, control('Return to Saved Application Process')];
    assert.equal(selectSavedControl(), 'ambiguous'); assert.equal(first.clicked, false);
    globalThis.document.querySelectorAll = () => [control('Return to Saved Application Process', { disabled: true })];
    assert.equal(selectSavedControl(), 'not-found');
    const offsite = Object.assign(new Anchor(), control('Return to Saved Application Process', { href: 'https://evil.invalid/' }));
    globalThis.document.querySelectorAll = () => [offsite];
    assert.equal(selectSavedControl(), 'not-found');
    globalThis.location.pathname = '/iClaim/other';
    globalThis.document.querySelectorAll = () => [first];
    assert.equal(selectSavedControl(), 'wrong-page'); assert.equal(first.clicked, false);
  } finally { Object.assign(globalThis, original); }
});
