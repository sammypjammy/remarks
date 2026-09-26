import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { env } from './rc-v3-fixtures.js';

test('opt-in Production artifact adds v3 and its guarded navigation only', async () => {
  const vars = {
    ...env(),
    VERCEL: '1',
    VERCEL_ENV: 'production',
    TOOLKIT_ORIGIN: 'https://packardtoolkit.vercel.app',
    FAX_V3_PRODUCTION_ACCEPTANCE: undefined,
    DATABASE_URL: 'postgresql://synthetic:synthetic@ep-young-dream-arkoh9e5-pooler.us-east-1.aws.neon.tech/test?sslmode=require'
  };
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
  const entryScript = html => `dist${html.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1]}`;
  const changedPaths = (left, right) => [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(path => left[path] !== right[path]);

  try {
    set(vars);
    await build({ envDir: false, logLevel: 'silent' });
    const normal = await snapshot();
    const normalWelcomeHtml = await readFile('dist/welcome-email-sender/index.html', 'utf8');
    const normalWelcomeScript = entryScript(normalWelcomeHtml);
    assert(!Object.keys(normal).some(path => path.includes('fax-sender-v3')));
    assert.match(await readFile('dist/settings/shared/app-shell.js', 'utf8'), /const faxV3ProductionAcceptance = false;/);

    process.env.FAX_V3_PRODUCTION_ACCEPTANCE = 'enabled';
    await build({ envDir: false, logLevel: 'silent' });
    const staged = await snapshot();
    const stagedWelcomeHtml = await readFile('dist/welcome-email-sender/index.html', 'utf8');
    const stagedWelcomeScript = entryScript(stagedWelcomeHtml);
    const v3Assets = ['app.js', 'client.js', 'index.html', 'style.css', 'test.js'].map(file => `dist/fax-sender-v3/${file}`);
    const allowedChanges = new Set([
      ...v3Assets,
      'dist/settings/shared/app-shell.js',
      'dist/welcome-email-sender/index.html',
      normalWelcomeScript,
      stagedWelcomeScript
    ]);
    assert.deepEqual(changedPaths(normal, staged).filter(path => !allowedChanges.has(path)), []);
    assert.deepEqual(v3Assets.filter(path => !staged[path]), []);
    assert.match(await readFile('dist/settings/shared/app-shell.js', 'utf8'), /const faxV3ProductionAcceptance = true;/);
    assert.match(await readFile('dist/settings/shared/app-shell.js', 'utf8'), /Fax Sender v3 — Testing/);
    assert.match(await readFile(stagedWelcomeScript, 'utf8'), /Fax Sender v3 — Testing/);
    assert.match(await readFile(stagedWelcomeScript, 'utf8'), /\/fax-sender-v3\//);
    for (const path of allowedChanges) {
      if (!staged[path]) continue;
      const source = await readFile(path, 'utf8');
      assert(!/RC_USER_JWT|RC_OAUTH_CLIENT_SECRET|RC_TOKEN_ENCRYPTION_KEY|ENTRA_CLIENT_SECRET|postgres(?:ql)?:\/\//.test(source), path);
    }

    delete process.env.FAX_V3_PRODUCTION_ACCEPTANCE;
    await build({ envDir: false, logLevel: 'silent' });
    assert.deepEqual(await snapshot(), normal);
  } finally {
    set(before);
  }
});
