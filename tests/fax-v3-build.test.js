import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { env } from './rc-v3-fixtures.js';

const production = () => ({
  ...env(),
  VERCEL: '1',
  VERCEL_ENV: 'production',
  TOOLKIT_ORIGIN: 'https://packardtoolkit.vercel.app',
  DATABASE_URL: 'postgresql://synthetic:synthetic@ep-young-dream-arkoh9e5-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

test('ordinary and Production builds make v3 canonical without the acceptance switch', async () => {
  const vars = { ...production(), FAX_V3_PRODUCTION_ACCEPTANCE: undefined };
  const before = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  const set = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const snapshot = async (directory = 'dist') => {
    const output = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) Object.assign(output, await snapshot(path));
      else output[path] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    return output;
  };
  try {
    set({ ...vars, VERCEL: undefined, VERCEL_ENV: undefined, TOOLKIT_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'postgresql://synthetic:synthetic@ep-test-branch.us-east-1.aws.neon.tech/test?sslmode=require' });
    await build({ envDir: false, logLevel: 'silent' });
    const ordinary = await snapshot();
    set(vars);
    await build({ envDir: false, logLevel: 'silent' });
    const release = await snapshot();
    assert.deepEqual(release, ordinary);
    const faxHtml = await readFile('dist/fax-sender/index.html', 'utf8');
    const shell = await readFile('dist/settings/shared/app-shell.js', 'utf8');
    const welcomeHtml = await readFile('dist/welcome-email-sender/index.html', 'utf8');
    const welcomeScript = `dist${welcomeHtml.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1]}`;
    const welcome = await readFile(welcomeScript, 'utf8');
    assert.match(faxHtml, /Connect RingCentral/);
    assert.match(faxHtml, /Fax Sender v3\.2\.0/);
    assert.match(faxHtml, /id="lastFour"[^>]*required/);
    assert.doesNotMatch(faxHtml, /Last 4 of SSN\s*<span>\(required\)<\/span>/);
    assert.doesNotMatch(faxHtml, /id="coverOptions"|id="commentField"|id="comment"/);
    assert.doesNotMatch(faxHtml, /Clearing the composer preserves this history\.|Used for history and receipt filenames only\./);
    assert.match(faxHtml, /id="loadContacts"[\s\S]*id="clearDestination"[\s\S]*id="cover"/);
    assert(!Object.keys(release).some(path => path.includes('fax-sender-v3')));
    assert.doesNotMatch(shell, /FAX_V3_PRODUCTION_ACCEPTANCE|faxV3ProductionAcceptance|Fax Sender v3 — Testing|fax-sender-v3/);
    assert.doesNotMatch(welcome, /FAX_V3_PRODUCTION_ACCEPTANCE|faxV3ProductionAcceptance|Fax Sender v3 — Testing|fax-sender-v3/);
    assert.match(welcome, /fax-sender\//);
    const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
    assert.deepEqual(vercel.redirects, [
      { source: '/fax-sender-v3', destination: '/fax-sender/', permanent: false },
      { source: '/fax-sender-v3/', destination: '/fax-sender/', permanent: false },
      { source: '/fax-sender-v3/:path*', destination: '/fax-sender/', permanent: false }
    ]);
    const redirect = path => vercel.redirects.find(rule => {
      const suffix = '/:path*';
      if (!rule.source.endsWith(suffix)) return rule.source === path;
      const prefix = rule.source.slice(0, -suffix.length);
      return path.startsWith(prefix + '/') && path.length > prefix.length + 1;
    });
    for (const path of ['/fax-sender-v3', '/fax-sender-v3/', '/fax-sender-v3/legacy/bookmark']) {
      assert.deepEqual(redirect(path), vercel.redirects[path === '/fax-sender-v3' ? 0 : path === '/fax-sender-v3/' ? 1 : 2]);
      assert.equal(redirect(path).destination, '/fax-sender/');
      assert.equal(redirect(path).permanent, false);
    }
    for (const path of ['/fax-sender/', '/api/ringcentral/callback', '/api/fax-v3/status']) assert.equal(redirect(path), undefined);
    assert(vercel.headers.some(rule => rule.source === '/fax-sender/:path*'));
    for (const path of Object.keys(release)) {
      if (!/\.(?:html|js|css|json)$/.test(path)) continue;
      const source = await readFile(path, 'utf8');
      assert(!/RC_USER_JWT|RC_OAUTH_CLIENT_SECRET|RC_TOKEN_ENCRYPTION_KEY|ENTRA_CLIENT_SECRET|postgres(?:ql)?:\/\//.test(source), path);
    }

    process.env.FAX_V3_PRODUCTION_ACCEPTANCE = 'unexpected-unused-value';
    await build({ envDir: false, logLevel: 'silent' });
    assert.deepEqual(await snapshot(), release);
  } finally {
    set(before);
  }
});
