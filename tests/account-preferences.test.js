import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createAuthHandler } from '../server/auth/service.js';
import { validatePreferences } from '../server/auth/preferences.js';
import { AuthStore } from '../server/auth/store.js';
import { hash } from '../server/auth/security.js';

const source = await readFile(new URL('../shared/settings-storage.js', import.meta.url), 'utf8');
const config = { tenant: 'test-tenant', sessionCookie: 'toolkit_session', origin: 'https://toolkit.example.test' };
const tokens = { A: 'A'.repeat(43), B: 'B'.repeat(43) };
function backend() {
  const rows = new Map();
  const store = {
    async resolveSession(tokenHash) {
      const id = Object.keys(tokens).find(key => hash(tokens[key]) === tokenHash);
      return id ? { id, active: true, entra_tenant_id: config.tenant, display_name: id } : null;
    },
    async getPreferences(id) { return rows.get(id) ?? null; },
    async savePreferences(id, values, migrate) {
      if (!migrate || !rows.has(id)) rows.set(id, { ...rows.get(id), ...structuredClone(values) });
      return rows.get(id);
    }
  };
  const handler = createAuthHandler('session', { config, store });
  async function call(user, options = {}) {
    const req = { url: '/api/auth/session?preferences=1', method: options.method || 'GET',
      headers: { cookie: user ? `toolkit_session=${tokens[user]}` : '', origin: config.origin,
        'content-type': 'application/json', ...options.headers }, body: options.body };
    const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler(req, res);
    return res;
  }
  return { rows, call };
}
function browser(api, legacy = {}, account = 'A') {
  const values = new Map(Object.entries(legacy));
  const session = new Map();
  const storage = map => ({ getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) });
  const events = new EventTarget();
  const window = { localStorage: storage(values), sessionStorage: storage(session),
    document: { documentElement: { dataset: {} }, querySelector: () => null },
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    async fetch(_url, options) {
      if (window.fail) throw new Error('offline');
      const response = await api.call(window.account, { ...options, body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: response.statusCode === 200, status: response.statusCode, json: async () => structuredClone(response.body) };
    }, account };
  vm.runInNewContext(source, { window, CustomEvent });
  return { window, settings: window.PackardSettings, values, session };
}

test('account API authenticates, isolates owners, rejects cross-origin writes and credentials', async () => {
  const api = backend();
  assert.equal((await api.call(null)).statusCode, 401);
  assert.equal((await api.call('A', { method: 'POST', body: { accountId: 'B', mode: 'patch', values: {} } })).statusCode, 409);
  assert.equal((await api.call('A', { method: 'POST', headers: { origin: 'https://attacker.test' }, body: {} })).statusCode, 403);
  for (const values of [{ token: 'secret' }, { homepage: { token: 'secret' } }, { theme: 'invalid' }, { emailSignature: 'x'.repeat(4001) }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => validatePreferences(values), { status: 400 });
  }
  await api.call('A', { method: 'POST', body: { accountId: 'A', mode: 'patch', values: { emailSignature: 'Synthetic A' } } });
  assert.equal((await api.call('B')).body.values, null);
  assert.equal((await api.call('A')).body.values.emailSignature, 'Synthetic A');
  assert.equal((await api.call('A')).headers['Cache-Control'], 'no-store');
});

test('first legacy import wins and normal writes preserve unrelated preferences', async () => {
  const api = backend();
  for (const name of ['first', 'second']) await api.call('A', { method: 'POST', body: {
    accountId: 'A', mode: 'migrate', values: { emailSignature: name, theme: 'forest' }
  } });
  assert.equal(api.rows.get('A').emailSignature, 'first');
  await api.call('A', { method: 'POST', body: { accountId: 'A', mode: 'patch', values: { density: 'compact' } } });
  assert.equal(api.rows.get('A').theme, 'forest');
});

test('preferences persist across pages and clean browsers, with no account preferences stored locally', async () => {
  const api = backend(), a = browser(api);
  await a.settings.refreshAccountPreferences();
  a.settings.setSetting('emailSignature', 'Synthetic signature');
  a.settings.setSetting('theme', 'forest');
  a.settings.saveHomepagePreferences({ ...a.settings.getHomepagePreferences(), name: 'Synthetic name',
    order: ['fax', 'remarks', 'med-tabs', 'email', 'intake'], hidden: ['fax'] });
  await a.settings.flushPreferences();
  assert.deepEqual(api.rows.get('A').homepage.hidden, ['fax']);
  for (let i = 0; i < 2; i++) {
    const other = browser(api);
    await other.settings.refreshAccountPreferences();
    assert.equal(other.settings.getEmailSignatureText(), 'Synthetic signature');
    assert.equal(other.settings.getHomepagePreferences().name, 'Synthetic name');
    assert.deepEqual(Array.from(other.settings.getHomepagePreferences().hidden), ['fax']);
    assert.equal(other.settings.getHomepagePreferences().order[0], 'fax');
    assert.equal(other.settings.getSetting('theme'), 'forest');
    assert.equal(other.values.has('packard-toolkit-settings'), false);
  }
});

test('logout clears account state and local history/notes; another user receives defaults; login restores', async () => {
  const api = backend(), b = browser(api);
  await b.settings.refreshAccountPreferences();
  b.settings.setSetting('emailSignature', 'Synthetic A');
  b.settings.saveHomepagePreferences({ ...b.settings.getHomepagePreferences(), hidden: ['fax'] });
  await b.settings.flushPreferences();
  b.values.set('packard-welcome-email-history', '["synthetic"]');
  b.session.set('packard-short-term-remarks', 'synthetic');
  b.settings.clearAccountPreferences();
  assert.equal(b.settings.getEmailSignatureText(), '');
  assert.equal(b.settings.getSetting('theme'), 'system');
  assert.deepEqual(Array.from(b.settings.getHomepagePreferences().hidden), []);
  assert.equal(b.values.has('packard-welcome-email-history'), false);
  assert.equal(b.session.size, 0);
  b.window.account = 'B';
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getEmailSignatureText(), '');
  assert.deepEqual(Array.from(b.settings.getHomepagePreferences().hidden), []);
  b.window.account = 'A';
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getEmailSignatureText(), 'Synthetic A');
  assert.deepEqual(Array.from(b.settings.getHomepagePreferences().hidden), ['fax']);
});

test('legacy preferences import once, exclude unknown/auth keys, and cannot leak to the next account', async () => {
  const api = backend(), b = browser(api, {
    'packard-toolkit-settings': JSON.stringify({ theme: 'sepia', token: 'DO NOT IMPORT' }),
    'packard-toolkit-email-signature': JSON.stringify({ name: 'Synthetic', position: 'Tester', phone: '555-0100' }),
    'packard-toolkit-homepage': JSON.stringify({ version: 1, order: ['email'], hidden: [], name: 'Home name' }),
    'packard-selected-case-manager': 'Synthetic Manager', 'packard-welcome-email-language': 'spanish'
  });
  assert.equal(b.settings.getHomepagePreferences().name, '', 'legacy data is hidden before authentication');
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getHomepagePreferences().name, 'Home name');
  assert.equal(b.settings.getSetting('emailManager'), 'Synthetic Manager');
  assert.equal(b.settings.getSetting('emailLanguage'), 'spanish');
  assert.match(b.settings.getEmailSignatureText(), /^Synthetic/);
  assert.equal(api.rows.get('A').token, undefined);
  assert.equal(b.values.has('packard-toolkit-homepage'), false);
  b.settings.clearAccountPreferences(); b.window.account = 'B';
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getHomepagePreferences().name, '');
});

test('existing account wins over legacy settings on another device; failed import keeps legacy data', async () => {
  const api = backend(); api.rows.set('A', { emailSignature: 'Account signature' });
  const b = browser(api, { 'packard-toolkit-settings': JSON.stringify({ emailSignature: 'Legacy signature' }) });
  b.window.fail = true;
  await b.settings.refreshAccountPreferences();
  assert.ok(b.values.has('packard-toolkit-settings'));
  assert.equal(b.settings.accountPreferencesStatus(), 'error');
  b.window.fail = false;
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getEmailSignatureText(), 'Account signature');
  assert.equal(b.values.has('packard-toolkit-settings'), false);
});

test('opening a clean browser first leaves migration available to a browser with legacy preferences', async () => {
  const api = backend(), clean = browser(api);
  await clean.settings.refreshAccountPreferences();
  assert.equal(api.rows.has('A'), false);
  const legacy = browser(api, { 'packard-toolkit-settings': '{"emailSignature":"Legacy signature"}' });
  await legacy.settings.refreshAccountPreferences();
  await clean.settings.refreshAccountPreferences();
  assert.equal(clean.settings.getEmailSignatureText(), 'Legacy signature');
});

test('failed writes are retried and never sent to another account', async () => {
  const api = backend(), b = browser(api);
  await b.settings.refreshAccountPreferences();
  b.window.fail = true;
  b.settings.setSetting('emailSignature', 'Synthetic pending');
  await b.settings.flushPreferences();
  assert.equal(b.settings.accountPreferencesStatus(), 'error');
  b.window.fail = false;
  await b.settings.refreshAccountPreferences();
  assert.equal(api.rows.get('A').emailSignature, 'Synthetic pending');
  b.window.fail = true; b.settings.setSetting('emailSignature', 'Never send to B');
  await b.settings.flushPreferences();
  b.window.fail = false; b.window.account = 'B';
  await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getEmailSignatureText(), '');
  assert.equal(api.rows.get('B'), undefined);
});

test('stale responses after logout cannot repopulate preferences', async () => {
  const api = backend(); api.rows.set('A', { emailSignature: 'Synthetic A' });
  const b = browser(api);
  const original = b.window.fetch;
  let release;
  b.window.fetch = async (...args) => { const response = await original(...args); await new Promise(resolve => { release = resolve; }); return response; };
  const refresh = b.settings.refreshAccountPreferences();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  b.settings.clearAccountPreferences(); release(); await refresh;
  assert.equal(b.settings.getEmailSignatureText(), '');
  assert.equal(b.settings.accountPreferenceOwner(), null);
});

test('storage logout event clears another tab without rebroadcasting', async () => {
  const api = backend(), b = browser(api);
  await b.settings.refreshAccountPreferences();
  b.settings.setSetting('theme', 'forest'); await b.settings.flushPreferences();
  b.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'packard-account-change' }));
  assert.equal(b.settings.getSetting('theme'), 'system');
  assert.equal(b.settings.accountPreferenceOwner(), null);
});

test('SQL uses only server-bound ownership, parameterized values, and atomic merge/import', async () => {
  const queries = [];
  const store = new AuthStore({ query: async (sql, args) => { queries.push({ sql, args }); return { rows: [{ preferences: {} }] }; } });
  await store.getPreferences('A');
  await store.savePreferences('A', { emailSignature: 'Synthetic' }, true);
  await store.savePreferences('B', { theme: 'forest' });
  assert.match(queries[0].sql, /WHERE user_id = \$1/);
  assert.match(queries[1].sql, /ON CONFLICT \(user_id\)/);
  assert.doesNotMatch(queries[1].sql, /\|\|/);
  assert.match(queries[2].sql, /\|\| EXCLUDED.preferences/);
  assert.deepEqual(queries[2].args, ['B', '{"theme":"forest"}']);
});

test('custom remarks, templates, managers and tool options restore from one shared account record', async () => {
  const api = backend(), a = browser(api);
  await a.settings.refreshAccountPreferences();
  a.settings.saveCustomRemarks([{ id: 'custom-test', title: 'Synthetic title', text: 'Synthetic remark', group: 'Filing Remarks' }]);
  a.settings.saveEmailTemplates({ english: { subject: 'Synthetic subject', body: 'Synthetic template' } });
  a.settings.saveCustomCaseManagers([{ fullName: 'Synthetic Manager', phone: '555-0100', email: 'test@example.test' }]);
  for (const [key, value] of Object.entries({ emailManager: 'Synthetic Manager', emailLanguage: 'spanish', autoClearRemarksAfterCopy: true, confirmBeforeClearingMedTabs: false })) a.settings.setSetting(key, value);
  await a.settings.flushPreferences();
  const b = browser(api); await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getCustomRemarks()[0].text, 'Synthetic remark');
  assert.equal(b.settings.getEmailTemplates().english.body, 'Synthetic template');
  assert.equal(b.settings.getCustomCaseManagers()[0].fullName, 'Synthetic Manager');
  assert.equal(b.settings.getSetting('emailManager'), 'Synthetic Manager');
  assert.equal(b.settings.getSetting('emailLanguage'), 'spanish');
  assert.equal(b.settings.getSetting('autoClearRemarksAfterCopy'), true);
  assert.equal(b.settings.getSetting('confirmBeforeClearingMedTabs'), false);
  assert.equal(Object.hasOwn(api.rows.get('A'), 'history'), false);
});

test('a refresh cannot overwrite edits made while the request is in flight', async () => {
  const api = backend(), b = browser(api);
  await b.settings.refreshAccountPreferences();
  const original = b.window.fetch; let release;
  b.window.fetch = async (...args) => {
    const response = await original(...args);
    if (!args[1].method) await new Promise(resolve => { release = resolve; });
    return response;
  };
  const refresh = b.settings.refreshAccountPreferences();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.settings.setSetting('emailSignature', 'Typed during refresh'), true);
  await b.settings.flushPreferences();
  release(); await refresh;
  assert.equal(b.settings.getEmailSignatureText(), 'Typed during refresh');
});

test('signed-out changes are temporary and do not consume unclaimed legacy preferences', async () => {
  const api = backend(), b = browser(api, { 'packard-toolkit-settings': '{"theme":"forest"}' }, null);
  b.settings.sessionSignedOut();
  b.settings.setSetting('theme', 'sepia');
  assert.equal(b.settings.getSetting('theme'), 'sepia');
  assert.equal(api.rows.size, 0);
  assert.equal(b.values.get('packard-toolkit-settings'), '{"theme":"forest"}');
  b.window.account = 'A'; await b.settings.refreshAccountPreferences();
  assert.equal(b.settings.getSetting('theme'), 'forest');
});

test('unavailable browser storage does not prevent account saving or default restoration', async () => {
  const api = backend(), b = browser(api);
  Object.defineProperty(b.window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  await b.settings.refreshAccountPreferences();
  b.settings.setSetting('theme', 'forest'); await b.settings.flushPreferences();
  assert.equal(api.rows.get('A').theme, 'forest');
  b.session.set('packard-short-term-remarks', 'Synthetic note');
  b.settings.clearAccountPreferences();
  assert.equal(b.settings.getSetting('theme'), 'system');
  assert.equal(b.session.size, 0);
});
