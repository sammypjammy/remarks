import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareMigration } from '../scripts/prepare-auth-migration.mjs';
import { CHECKSUM, WINDOW_MS, authorizationValid, checksum } from '../maintenance/migrate-production/policy.mjs';

let root, repo, stage, sql, authorization, runMaintenance, writeArtifact;
const issuedAt = 1800000000000;
const env = { VERCEL: '1', VERCEL_ENV: 'production', TOOLKIT_ORIGIN: 'https://packardtoolkit.vercel.app',
  DATABASE_URL: 'postgresql://synthetic_user:synthetic_password@ep-young-dream-arkoh9e5-pooler.c-2.us-east-1.aws.neon.tech/synthetic?sslmode=require&channel_binding=require' };
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'packard-migration-test-'));
  repo = join(root, 'repo');
  await mkdir(join(repo, '.vercel'), { recursive: true });
  await mkdir(join(root, 'staging'));
  await writeFile(join(repo, '.vercel/repo.json'), JSON.stringify({ projects: [{ name: 'packardtoolkit', id: 'prj_synthetic', orgId: 'team_synthetic' }] }));
  for (const file of ['maintenance/migrate-production', 'maintenance/verify-production/validate.mjs', 'scripts/migrate-auth.mjs', 'server/auth/database.js', 'migrations/001_toolkit_auth.sql']) {
    await mkdir(join(repo, file, '..'), { recursive: true });
    await cp(file, join(repo, file), { recursive: true, filter: path => !path.includes('node_modules') && !path.includes('.env') });
  }
  await writeFile(join(repo, '.env.local'), 'SYNTHETIC_SECRET=must-not-copy');
  stage = await prepareMigration(repo, { authorize: true, temporaryRoot: join(root, 'staging'), now: issuedAt });
  sql = await readFile(join(stage, 'migrations/001_toolkit_auth.sql'), 'utf8');
  authorization = JSON.parse(await readFile(join(stage, 'authorization.json'), 'utf8'));
  ({ runMaintenance, writeArtifact } = await import(pathToFileURL(join(stage, 'build.mjs')).href));
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function harness(options = {}) {
  const events = [], logs = [];
  let now = issuedAt + 1000, committed = false;
  const run = () => runMaintenance({
    args: options.args ?? ['--apply-001'], env: options.env ?? env,
    readAuthorization: async () => options.authorization ?? authorization,
    readSql: async () => options.sql ?? sql, now: () => now,
    openPool: async () => {
      events.push('open');
      return { end: async () => {}, connect: async () => ({ release() {}, query: async statement => {
        events.push(statement);
        if (statement.includes('pg_advisory_xact_lock') && options.expireAtLock) now = issuedAt + WINDOW_MS;
        if (statement.startsWith('INSERT INTO') && options.expireBeforeCommit) now = issuedAt + WINDOW_MS;
        if (statement === 'COMMIT') {
          if (options.commitFails) throw new Error('synthetic_password');
          committed = true;
        }
        return { rows: statement.startsWith('SELECT checksum') && options.prior ? [{ checksum: options.prior }] : [] };
      } }) };
    },
    writeArtifact: async () => { assert.equal(committed, true); events.push('artifact'); if (options.artifactFails) throw new Error('synthetic_password'); },
    log: message => {
      if (message.startsWith('Authentication migration') || message.startsWith('PASS')) assert.equal(committed, true);
      logs.push(message);
      assert.equal(message.includes('synthetic_password'), false);
    }
  });
  return { run, events, logs };
}

test('package pins reviewed normalized SQL and existing locked dependency versions', async () => {
  assert.equal(checksum(sql), CHECKSUM);
  assert.equal(checksum(sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')), CHECKSUM);
  const lock = JSON.parse(await readFile(join(stage, 'package-lock.json'), 'utf8'));
  const original = JSON.parse(await readFile('package-lock.json', 'utf8'));
  for (const [name, entry] of Object.entries(lock.packages)) if (name) assert.deepEqual(entry, original.packages[name]);
});
test('explicit apply flag and bounded authorization required before any connection', async () => {
  for (const options of [
    { args: [] }, { authorization: {} },
    { authorization: { ...authorization, issuedAt: issuedAt + 5000, expiresAt: issuedAt + 5000 + WINDOW_MS } },
    { authorization: { ...authorization, expiresAt: issuedAt + WINDOW_MS * 2 } },
    { authorization: { ...authorization, action: 'wrong' } },
    { authorization: { ...authorization, checksum: 'wrong' } }
  ]) {
    const h = harness(options); assert.equal(await h.run(), 1); assert.deepEqual(h.events, []);
  }
  assert.equal(authorizationValid(authorization, issuedAt + WINDOW_MS), false);
  await assert.rejects(() => prepareMigration(repo));
});
test('production, origin, endpoint and URL options independently checked before connection', async () => {
  for (const change of [{ VERCEL: undefined }, { VERCEL_ENV: 'preview' }, { TOOLKIT_ORIGIN: 'http://localhost:5173' },
    { DATABASE_URL: undefined }, { DATABASE_URL: env.DATABASE_URL.replace('ep-young-dream-arkoh9e5', 'ep-wrong-main') },
    { DATABASE_URL: env.DATABASE_URL + '&host=elsewhere' }]) {
    const h = harness({ env: { ...env, ...change } }); assert.equal(await h.run(), 1); assert.deepEqual(h.events, []);
  }
});
test('SQL checksum mismatch fails before any connection', async () => {
  const h = harness({ sql: sql + '\n-- changed' }); assert.equal(await h.run(), 1); assert.deepEqual(h.events, []);
});
test('successful commit precedes success log and static artifact', async () => {
  const h = harness(); assert.equal(await h.run(), 0);
  assert.deepEqual(h.logs, ['Authentication migration applied.', 'PASS MIGRATION_MAINTENANCE_COMPLETE']);
  assert.ok(h.events.includes('SELECT pg_advisory_xact_lock(731942015)'));
  assert.ok(h.events.indexOf('COMMIT') < h.events.indexOf('artifact'));
  const output = join(stage, 'public'); await writeArtifact(output);
  assert.deepEqual(await readdir(output), ['index.html']);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Maintenance</title><p>Maintenance artifact.</p></html>\n');
});
test('expiry after lock or before commit rolls back; failed commit reports no success', async () => {
  for (const options of [{ expireAtLock: true }, { expireBeforeCommit: true }, { commitFails: true }]) {
    const h = harness(options); assert.equal(await h.run(), 1); assert.ok(h.events.includes('ROLLBACK'));
    assert.deepEqual(h.logs, ['FAIL MIGRATION_NOT_CONFIRMED']); assert.equal(h.events.includes('artifact'), false);
  }
});
test('matching ledger prevents reapplication; mismatching ledger rolls back', async () => {
  const same = harness({ prior: CHECKSUM }); assert.equal(await same.run(), 0); assert.equal(same.events.includes(sql), false);
  assert.equal(same.logs[0], 'Authentication migration already applied; no changes.');
  const mismatch = harness({ prior: 'wrong' }); assert.equal(await mismatch.run(), 1);
  assert.ok(mismatch.events.includes('ROLLBACK')); assert.equal(mismatch.events.includes(sql), false);
});
test('artifact failure reports committed state without claiming a rollback', async () => {
  const h = harness({ artifactFails: true }); assert.equal(await h.run(), 1);
  assert.deepEqual(h.logs, ['Authentication migration applied.', 'FAIL ARTIFACT_AFTER_COMMIT']);
  assert.equal(h.events.includes('ROLLBACK'), false);
});
test('exact configured build refuses expired authorization without pg installed', async () => {
  const config = JSON.parse(await readFile(join(stage, 'vercel.json'), 'utf8'));
  assert.equal(config.installCommand, 'npm ci --ignore-scripts --no-audit --no-fund');
  assert.equal(config.functions, undefined); assert.equal(config.routes, undefined);
  const expired = { ...authorization, issuedAt: 0, expiresAt: WINDOW_MS };
  await writeFile(join(stage, 'authorization.json'), JSON.stringify(expired));
  const [runtime, ...args] = config.buildCommand.split(' '); assert.equal(runtime, 'node');
  const cleanEnv = { ...env }; if (process.env.SystemRoot) cleanEnv.SystemRoot = process.env.SystemRoot;
  const result = spawnSync(process.execPath, args, { cwd: stage, env: cleanEnv, encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 1);
  assert.equal(result.stdout, 'FAIL AUTHORIZATION_INVALID_OR_EXPIRED\n'); assert.equal(result.stderr, '');
  const files = await readdir(stage, { recursive: true });
  assert.equal(files.some(file => /(^|[\\/])(api|node_modules|\.env[^\\/]*)($|[\\/])/.test(file)), false);
});
