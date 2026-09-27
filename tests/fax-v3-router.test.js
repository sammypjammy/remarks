import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  createRingCentralRouter,
  ringCentralAction
} from '../api/ringcentral/[action].js';
import {
  config as faxRouterConfig,
  createFaxV3Router,
  faxV3Action
} from '../api/fax-v3/[action].js';
import { createRcHandler } from '../server/ringcentral-v3/handler.js';
import { createFaxHandler } from '../server/fax-v3/handler.js';
import { config as developmentConfig } from './rc-v3-fixtures.js';

const rcRoutes = new Map([
  ['/api/ringcentral/connect', 'connect'],
  ['/api/ringcentral/callback', 'callback'],
  ['/api/ringcentral/connection', 'connection'],
  ['/api/ringcentral/disconnect', 'disconnect']
]);
const faxRoutes = new Map([
  ['/api/fax-v3/contacts', 'contacts'],
  ['/api/fax-v3/context', 'context'],
  ['/api/fax-v3/history', 'history'],
  ['/api/fax-v3/message', 'message'],
  ['/api/fax-v3/receipt', 'receipt'],
  ['/api/fax-v3/send', 'send'],
  ['/api/fax-v3/status', 'status']
]);

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
    end(data) { this.body = data; return this; }
  };
}

test('v3 routers map only the exact public paths and preserve method/request identity', async () => {
  for (const [routes, actionFor, createRouter] of [
    [rcRoutes, ringCentralAction, createRingCentralRouter],
    [faxRoutes, faxV3Action, createFaxV3Router]
  ]) {
    const created = [];
    const seen = [];
    const router = createRouter(action => {
      created.push(action);
      return async (req, res) => { seen.push({ action, req, method: req.method, url: req.url }); return res.status(204).end(); };
    });
    assert.deepEqual(created.sort(), [...routes.values()].sort());
    for (const [path, action] of routes) {
      assert.equal(actionFor(path), action);
      assert.equal(actionFor(`${path}?safe=1`), action);
      const req = { method: action === 'send' || action === 'connect' || action === 'disconnect' ? 'POST' : 'GET', url: `${path}?safe=1`, headers: {} };
      const res = response();
      await router(req, res);
      assert.equal(res.code, 204);
      assert.deepEqual(seen.at(-1), { action, req, method: req.method, url: req.url });
    }
  }
});

test('v3 routers reject malformed, duplicate, extra and unknown path segments with 404', async () => {
  const malformed = [
    '', null, 'api/fax-v3/send', 'https://packardtoolkit.vercel.app/api/fax-v3/send',
    '/api/fax-v3', '/api/fax-v3/', '/api/fax-v3/send/', '/api/fax-v3/send/extra',
    '/api/fax-v3/send/send', '/api/fax-v3/%73end', '/api/fax-v3/send#fragment',
    '/api/ringcentral', '/api/ringcentral/', '/api/ringcentral/callback/',
    '/api/ringcentral/callback/extra', '/api/ringcentral/connect/connect',
    '/api/ringcentral/%63onnect', '/api/ringcentral/callback#fragment', '/api/unknown'
  ];
  let invoked = 0;
  const factory = () => async () => { invoked++; };
  const routers = [createRingCentralRouter(factory), createFaxV3Router(factory)];
  for (const url of malformed) {
    assert.equal(ringCentralAction(url), null);
    assert.equal(faxV3Action(url), null);
    for (const router of routers) {
      const res = response();
      await router({ method: 'GET', url, headers: {} }, res);
      assert.equal(res.code, 404, String(url));
      assert.deepEqual(res.data, { error: 'Not found' });
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  }
  assert.equal(invoked, 0);
});

test('routers preserve each existing handler method contract', async () => {
  const config = developmentConfig();
  const rcRouter = createRingCentralRouter(action => createRcHandler(action, { config }));
  const faxRouter = createFaxV3Router(action => createFaxHandler(action, { config }));
  for (const [router, method, url, allow] of [
    [rcRouter, 'GET', '/api/ringcentral/connect', 'POST'],
    [rcRouter, 'POST', '/api/ringcentral/callback', 'GET'],
    [rcRouter, 'POST', '/api/ringcentral/connection', 'GET'],
    [rcRouter, 'GET', '/api/ringcentral/disconnect', 'POST'],
    [faxRouter, 'GET', '/api/fax-v3/send', 'POST'],
    [faxRouter, 'POST', '/api/fax-v3/context', 'GET'],
    [faxRouter, 'DELETE', '/api/fax-v3/contacts', 'GET, POST'],
    [faxRouter, 'POST', '/api/fax-v3/receipt?faxId=synthetic', 'GET']
  ]) {
    const res = response();
    await router({ method, url, headers: {} }, res);
    assert.equal(res.code, 405, `${method} ${url}`);
    assert.equal(res.headers.Allow, allow);
  }
});

test('RingCentral callback router preserves the complete original request URL', async () => {
  const original = '/api/ringcentral/callback?state=synthetic-state&code=synthetic-code&code=duplicate';
  let observed;
  const router = createRingCentralRouter(action => async (req, res) => {
    if (action === 'callback') observed = { req, url: req.url };
    return res.status(204).end();
  });
  const req = { method: 'GET', url: original, headers: {} };
  const res = response();
  await router(req, res);
  assert.deepEqual(observed, { req, url: original });
});

test('fax router preserves raw multipart request streaming and disables body parsing', async () => {
  assert.deepEqual(faxRouterConfig, { api: { bodyParser: false } });
  const bytes = Buffer.from('synthetic multipart bytes');
  let observed;
  const router = createFaxV3Router(action => async (req, res) => {
    if (action === 'send') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      observed = { req, bytes: Buffer.concat(chunks), type: req.headers['content-type'] };
    }
    return res.status(204).end();
  });
  const req = Readable.from([bytes]);
  Object.assign(req, { method: 'POST', url: '/api/fax-v3/send', headers: { 'content-type': 'multipart/form-data; boundary=synthetic' } });
  const res = response();
  await router(req, res);
  assert.equal(observed.req, req);
  assert.deepEqual(observed.bytes, bytes);
  assert.equal(observed.type, 'multipart/form-data; boundary=synthetic');
});

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) output.push(...await files(path));
    else if (/\.(?:js|mjs|ts)$/.test(entry.name) && !basename(path).startsWith('_') && !entry.name.endsWith('.d.ts')) output.push(path.replaceAll('\\', '/'));
  }
  return output;
}

test('deployable Vercel API inventory is exactly twelve functions with two v3 routers', async () => {
  const entrypoints = (await files('api')).sort();
  assert.deepEqual(entrypoints, [
    'api/auth/callback.js', 'api/auth/login.js', 'api/auth/logout.js', 'api/auth/session.js',
    'api/fax-attachment.js', 'api/fax-message.js', 'api/fax-status.js', 'api/fax-v3/[action].js',
    'api/rc-auth-test.js', 'api/ringcentral-contacts.js', 'api/ringcentral/[action].js', 'api/send-fax.js'
  ].sort());
  const oldWrappers = [...rcRoutes.keys(), ...faxRoutes.keys()].map(path => `${path.slice(1)}.js`);
  assert(oldWrappers.every(path => !entrypoints.includes(path)));
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.deepEqual(vercel.functions['api/fax-v3/[action].js'], { maxDuration: 60 });
  assert(!Object.keys(vercel.functions).some(path => /^api\/(?:fax-v3|ringcentral)\/(?!\[action\])/.test(path)));
});
