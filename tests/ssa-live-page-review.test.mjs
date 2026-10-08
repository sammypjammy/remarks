import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyPage, OFFICIAL_START_URL, isSavedApplicationLanding } from '../ssa-intake-assistant/extension-live-dev/page-scope.js';
import { selectSavedControl } from '../ssa-intake-assistant/extension-live-dev/select-saved-control.js';
import { LIVE_PAGE_MAPPINGS, RESERVED_TARGETS, planLiveFields } from '../ssa-intake-assistant/extension-live-dev/live-mappings.js';
import { createLiveSession } from '../ssa-intake-assistant/extension-live-dev/live-session.js';
import { isToolkitLaunchRequest, isIdentityRequest, isIdentityControl } from '../ssa-intake-assistant/extension-live-dev/toolkit-launch.js';
import { inspectLivePage, selectReturnProcess, fillSavedIdentity } from '../ssa-intake-assistant/extension-live-dev/live-page-actions.js';
import { LIVE_EXTENSION_ID } from '../ssa-intake-assistant/src/model/live-extension-id.js';
import { createHash } from 'node:crypto';

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
  assert.match(popup, /No live SSA page fields have been verified/);
  assert.match(popup, /href="https:\/\/secure\.ssa\.gov\/iClaim\/dib"/);
  assert.match(popup, /Open and select saved application/);
  assert.match(popup, /Enter the applicant’s Social Security number and re-entry number directly on SSA/);
  assert.match(popup, /client-profile connection and live field mappings are not enabled yet/);
  assert.doesNotMatch(popup, /<form|<input/);
  const background = await readFile(new URL('background.js', root), 'utf8');
  assert.doesNotMatch(background, /fetch\(|storage|postMessage|connect\(/);
  assert.match(background, /isSavedApplicationLanding\(tab.url\)/);
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

test('temporary identity request requires a ready-shaped SSN, bounded re-entry and exact Toolkit source', () => {
  const sender = { tab: { id: 4 }, frameId: 0, url: 'http://localhost:5173/intake-checker/', origin: 'http://localhost:5173' };
  const request = { type: 'start-identity', session: '11111111-1111-4111-8111-111111111111',
    ssn: '000-12-3456', reentry: 'SYNTHETIC-REENTRY' };
  assert(isIdentityRequest(request, sender));
  assert(!isIdentityRequest({ ...request, ssn: '123' }, sender));
  assert(!isIdentityRequest({ ...request, reentry: '' }, sender));
  assert(!isIdentityRequest({ ...request, rawIntake: 'synthetic' }, sender));
  assert(!isIdentityRequest(request, { ...sender, frameId: 1 }));
  assert(isIdentityControl({ type: 'identity-heartbeat', session: request.session }, sender));
  assert(!isIdentityControl({ type: 'identity-heartbeat', session: request.session, ssn: request.ssn }, sender));
});

test('Intake Assistant uses a temporary re-entry input and checks authentication', async () => {
  const source = await readFile(new URL('../ssa-intake-assistant/src/LiveLaunch.jsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/api\/auth\/session'/);
  assert.match(source, /type: 'start-identity'/);
  assert.match(source, /personal\.social-security-number/);
  assert.match(source, /type="password"/);
  assert.match(source, /setReentry\(''\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\./i);
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

test('synthetic SSA page recognition waits at Terms, selects one saved path and fills only exact identity controls', () => {
  const original = { location: globalThis.location, document: globalThis.document,
    HTMLInputElement: globalThis.HTMLInputElement, HTMLAnchorElement: globalThis.HTMLAnchorElement };
  class Input {
    #current = '';
    get value() { return this.#current; }
    set value(value) { this.#current = value; }
    getClientRects() { return [1]; }
    dispatchEvent() { this.events = (this.events || 0) + 1; }
    type = 'text'; disabled = false; readOnly = false;
  }
  class Anchor {}
  const element = text => ({ textContent: text, getClientRects: () => [1], getAttribute: () => null });
  const social = new Input(), number = new Input();
  const socialLabel = { ...element("Applicant's Social Security Number (SSN):"), control: social };
  const numberLabel = { ...element('Re-entry Number:'), control: number };
  const choice = { ...element('Return to Saved Application Process'), disabled: false, click() { this.clicked = true; } };
  let heading = element('Benefits Application Terms of Service');
  try {
    globalThis.HTMLInputElement = Input; globalThis.HTMLAnchorElement = Anchor;
    globalThis.location = { origin: 'https://secure.ssa.gov', pathname: '/iClaim/synthetic', href: 'https://secure.ssa.gov/iClaim/synthetic' };
    globalThis.document = { body: { textContent: '' }, querySelectorAll: selector =>
      selector === 'h1,h2,h3,h4' ? [heading]
        : selector === 'label,strong,b,span' ? [socialLabel, numberLabel]
          : selector.includes('button') ? [choice] : [] };
    assert.equal(inspectLivePage(), 'terms');
    assert.equal(selectReturnProcess(), 'wrong-page');
    heading = element('Apply Online for Disability Benefits');
    assert.equal(inspectLivePage(), 'choice');
    assert.equal(selectReturnProcess(), 'selected'); assert.equal(choice.clicked, true);
    heading = element('Return to Saved Application Process');
    globalThis.document.body.textContent = "Applicant's Social Security Number (SSN): Re-entry Number:";
    assert.equal(inspectLivePage(), 'identity');
    assert.equal(fillSavedIdentity({ ssn: '000-12-3456', reentry: 'SYNTHETIC-REENTRY' }), 'filled');
    assert.equal(social.value, '000-12-3456'); assert.equal(number.value, 'SYNTHETIC-REENTRY');
    assert.equal(social.events, 2); assert.equal(number.events, 2);
    assert.equal(fillSavedIdentity({ ssn: '000-12-3456', reentry: 'SYNTHETIC-REENTRY' }), 'unverified-controls');
    assert.equal(inspectLivePage(), 'identity');
    social.value = ''; number.value = ''; social.type = 'number';
    assert.equal(fillSavedIdentity({ ssn: '000-12-3456', reentry: 'SYNTHETIC-REENTRY' }), 'unverified-controls');
    assert.equal(social.value, ''); assert.equal(number.value, '');
    globalThis.location.origin = 'https://secure.ssa.gov.evil.invalid';
    assert.equal(inspectLivePage(), 'outside');
  } finally { Object.assign(globalThis, original); }
});

test('background opens only the exact SSA URL and injects only after its landing page completes', async () => {
  const saved = globalThis.chrome;
  const hooks = {};
  const injected = [];
  let nextTab = 10;
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener: fn => { hooks.updated = fn; } },
      onRemoved: { addListener: fn => { hooks.removed = fn; } },
      create: async options => { assert.equal(options.url, OFFICIAL_START_URL); return { id: nextTab++, status: 'loading' }; },
      get: async id => ({ id, status: 'loading' }),
    },
    runtime: { onMessage: { addListener: fn => { hooks.message = fn; } },
      onMessageExternal: { addListener: fn => { hooks.external = fn; } } },
    scripting: { executeScript: async options => { injected.push(options); } },
  };
  try {
    await import(`../ssa-intake-assistant/extension-live-dev/background.js?synthetic=${Date.now()}`);
    let reply;
    assert.equal(hooks.message({ type: 'unknown' }, {}, value => { reply = value; }), false);
    assert.equal(reply, undefined);
    assert.equal(hooks.message({ type: 'open-saved-application' }, {}, value => { reply = value; }), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(reply, { opened: true });
    hooks.updated(10, { status: 'complete' }, { id: 10, status: 'complete', url: OFFICIAL_START_URL });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(injected.length, 1);
    assert.equal(injected[0].target.tabId, 10);
    hooks.updated(10, { status: 'complete' }, { id: 10, status: 'complete', url: OFFICIAL_START_URL });
    assert.equal(injected.length, 1);
    hooks.message({ type: 'open-saved-application' }, {}, () => {});
    await new Promise(resolve => setTimeout(resolve, 0));
    hooks.updated(11, { status: 'complete' }, { id: 11, status: 'complete', url: 'https://secure.ssa.gov.evil.invalid/iClaim/dib' });
    assert.equal(injected.length, 1);
    hooks.removed(11);
    let externalReply;
    assert.equal(hooks.external({ type: 'open-ssa-application' },
      { tab: { id: 3 }, frameId: 0, url: 'http://localhost:5173/intake-checker/', origin: 'http://localhost:5173' },
      value => { externalReply = value; }), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(externalReply, { opened: true });
    assert.equal(injected.length, 1, 'Toolkit launch never injects into the SSA page');
  } finally { globalThis.chrome = saved; }
});

test('synthetic extension session waits at Terms, selects the saved path, fills identity once and clears on request', async () => {
  const saved = globalThis.chrome, hooks = {}, calls = [];
  let page = 'terms';
  globalThis.chrome = {
    tabs: { onUpdated: { addListener: fn => { hooks.updated = fn; } },
      onRemoved: { addListener: fn => { hooks.removed = fn; } },
      create: async options => { assert.equal(options.url, OFFICIAL_START_URL); return { id: 20, status: 'loading' }; },
      get: async id => ({ id, status: 'loading' }) },
    runtime: { onMessage: { addListener: fn => { hooks.message = fn; } },
      onMessageExternal: { addListener: fn => { hooks.external = fn; } } },
    scripting: { executeScript: async options => {
      calls.push(options.func.name);
      return [{ result: options.func.name === 'inspectLivePage' ? page
        : options.func.name === 'selectReturnProcess' ? 'selected' : 'filled' }];
    } },
  };
  try {
    await import(`../ssa-intake-assistant/extension-live-dev/background.js?identity=${Date.now()}`);
    const sender = { tab: { id: 4 }, frameId: 0, url: 'http://localhost:5173/intake-checker/', origin: 'http://localhost:5173' };
    const session = '11111111-1111-4111-8111-111111111111';
    let reply;
    assert.equal(hooks.external({ type: 'start-identity', session, ssn: '000-12-3456', reentry: 'SYNTHETIC-REENTRY' },
      sender, value => { reply = value; }), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(reply, { opened: true });
    const complete = () => hooks.updated(20, { status: 'complete' },
      { id: 20, status: 'complete', url: 'https://secure.ssa.gov/iClaim/synthetic' });
    complete(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['inspectLivePage']);
    page = 'choice'; complete(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['inspectLivePage', 'inspectLivePage', 'selectReturnProcess']);
    page = 'identity'; complete(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['inspectLivePage', 'inspectLivePage', 'selectReturnProcess',
      'inspectLivePage', 'fillSavedIdentity']);
    complete(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(name => name === 'fillSavedIdentity').length, 1);
    hooks.external({ type: 'identity-heartbeat', session }, sender, value => { reply = value; });
    assert.deepEqual(reply, { alive: true, stage: 'filled' });
    hooks.external({ type: 'clear-identity', session }, sender, value => { reply = value; });
    assert.deepEqual(reply, { alive: false });
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
    const first = control('Return to a Saved Application');
    globalThis.document = { querySelectorAll: () => [first] };
    assert.equal(selectSavedControl(), 'selected'); assert.equal(first.clicked, true);
    first.clicked = false;
    globalThis.document.querySelectorAll = () => [first, control('Return to a Saved Application')];
    assert.equal(selectSavedControl(), 'ambiguous'); assert.equal(first.clicked, false);
    globalThis.document.querySelectorAll = () => [control('Return to a Saved Application', { disabled: true })];
    assert.equal(selectSavedControl(), 'not-found');
    const offsite = Object.assign(new Anchor(), control('Return to a Saved Application', { href: 'https://evil.invalid/' }));
    globalThis.document.querySelectorAll = () => [offsite];
    assert.equal(selectSavedControl(), 'not-found');
    globalThis.location.pathname = '/iClaim/other';
    globalThis.document.querySelectorAll = () => [first];
    assert.equal(selectSavedControl(), 'wrong-page'); assert.equal(first.clicked, false);
  } finally { Object.assign(globalThis, original); }
});
