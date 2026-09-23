import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validProduction, productionCheck } from '../maintenance/verify-production/validate.mjs';
import { prepareVerification, assertVerificationConfig } from '../scripts/prepare-auth-verification.mjs';
import { runMigration } from '../scripts/migrate-auth.mjs';

// Entirely synthetic: no inherited connection configuration or database driver.
const endpoint = 'ep-young-dream-arkoh9e5';
const origin = 'https://packardtoolkit.vercel.app';
const connection = `postgresql://synthetic_user:synthetic_password@${endpoint}.us-east-2.aws.neon.tech/synthetic_db?sslmode=require&channel_binding=require`;
const good = { VERCEL: '1', VERCEL_ENV: 'production', TOOLKIT_ORIGIN: origin, DATABASE_URL: connection };
const cases = [
  ['main', good, true],
  ['postgres scheme', { ...good, DATABASE_URL: connection.replace('postgresql:', 'postgres:') }, true],
  ['pooled main', { ...good, DATABASE_URL: connection.replace(endpoint, `${endpoint}-pooler`) }, true],
  ['Neon cell', { ...good, DATABASE_URL: connection.replace('.us-east-2', '.c-2.us-east-2') }, true],
  ['pooled Neon cell', { ...good, DATABASE_URL: connection.replace(endpoint, `${endpoint}-pooler`).replace('.us-east-2', '.c-3.us-east-2') }, true],
  ['unsupported extra label', { ...good, DATABASE_URL: connection.replace('.us-east-2', '.arbitrary.us-east-2') }, false],
  ['wrong endpoint', { ...good, DATABASE_URL: connection.replace(endpoint, 'ep-wrong-endpoint') }, false],
  ['wrong origin', { ...good, TOOLKIT_ORIGIN: `${origin}/` }, false],
  ['non-Neon', { ...good, DATABASE_URL: connection.replace('.neon.tech', '.example.com') }, false],
  ['suffix spoof', { ...good, DATABASE_URL: connection.replace('.neon.tech', '.neon.tech.example.com') }, false],
  ['routing option', { ...good, DATABASE_URL: `${connection}&host=example.com` }, false],
  ['options', { ...good, DATABASE_URL: `${connection}&options=anything` }, false],
  ['duplicate option', { ...good, DATABASE_URL: `${connection}&sslmode=require` }, false],
  ['disabled TLS', { ...good, DATABASE_URL: connection.replace('sslmode=require', 'sslmode=disable') }, false],
  ['port override', { ...good, DATABASE_URL: connection.replace('/synthetic_db', ':5433/synthetic_db') }, false],
  ['fragment', { ...good, DATABASE_URL: `${connection}#fragment` }, false],
  ['bad scheme', { ...good, DATABASE_URL: connection.replace('postgresql:', 'https:') }, false],
  ['malformed', { ...good, DATABASE_URL: 'synthetic_password' }, false],
  ['preview', { ...good, VERCEL_ENV: 'preview' }, false],
  ...Object.keys(good).map(key => [`missing ${key}`, { ...good, [key]: undefined }, false])
];
for (const [name, env, expected] of cases) {
  test(`validation: ${name}`, () => assert.equal(validProduction(env), expected));
}

test('verifier subprocess output is exactly PASS/FAIL and never configuration', () => {
  for (const [, env, expected] of cases) {
    const cleanEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
    // Windows process startup requires SystemRoot; no application environment inherited.
    if (process.env.SystemRoot) cleanEnv.SystemRoot = process.env.SystemRoot;
    const child = spawnSync(process.execPath, ['maintenance/verify-production/verify.mjs'], { env: cleanEnv, encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.status, expected ? 0 : 1);
    assert.equal(child.stdout, expected ? 'PASS\n' : `FAIL ${productionCheck(env)}\n`);
    assert.match(child.stdout, /^(PASS|FAIL (NOT_PRODUCTION|ORIGIN_MISMATCH|DATABASE_URL_MISSING|DATABASE_PROTOCOL_INVALID|NEON_HOST_INVALID|ENDPOINT_MISMATCH|DATABASE_OPTIONS_INVALID|DATABASE_URL_INVALID))\n$/);
    assert.equal(child.stderr, '');
  }
});

test('diagnostics identify check categories using fixed literals', () => {
  for (const [change, expected] of [
    [{ VERCEL: undefined }, 'NOT_PRODUCTION'],
    [{ TOOLKIT_ORIGIN: 'synthetic_secret' }, 'ORIGIN_MISMATCH'],
    [{ DATABASE_URL: undefined }, 'DATABASE_URL_MISSING'],
    [{ DATABASE_URL: connection.replace('postgresql:', 'https:') }, 'DATABASE_PROTOCOL_INVALID'],
    [{ DATABASE_URL: connection.replace('.neon.tech', '.example.com') }, 'NEON_HOST_INVALID'],
    [{ DATABASE_URL: connection.replace(endpoint, 'ep-wrong-endpoint') }, 'ENDPOINT_MISMATCH'],
    [{ DATABASE_URL: `${connection}&host=synthetic_secret` }, 'DATABASE_OPTIONS_INVALID'],
    [{ DATABASE_URL: 'synthetic_secret' }, 'DATABASE_URL_INVALID']
  ]) assert.equal(productionCheck({ ...good, ...change }), expected);
});

test('exact staged build creates configured output after PASS only, without copied output or secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packard-verifier-test-'));
  try {
    const repo = join(root, 'repo');
    const stagingRoot = join(root, 'staging');
    await mkdir(join(repo, '.vercel'), { recursive: true });
    await mkdir(stagingRoot);
    await writeFile(join(repo, '.vercel/repo.json'), JSON.stringify({ projects: [{ name: 'packardtoolkit', id: 'prj_synthetic', orgId: 'team_synthetic', directory: '.' }] }));
    await cp('maintenance/verify-production', join(repo, 'maintenance/verify-production'), { recursive: true, filter: path => !path.includes('.env') });
    await writeFile(join(repo, 'maintenance/verify-production/.env.local'), 'SYNTHETIC_TOKEN=must_not_copy');
    const stage = await prepareVerification(repo, stagingRoot);
    assert.deepEqual((await readdir(stage)).sort(), ['.vercel', '.vercelignore', 'build.mjs', 'validate.mjs', 'vercel.json', 'verify.mjs'].sort());
    assert.deepEqual(await readdir(join(stage, '.vercel')), ['project.json']);
    const stagedConfig = JSON.parse(await readFile(join(stage, 'vercel.json'), 'utf8'));
    assertVerificationConfig(stagedConfig);
    assert.equal(Object.hasOwn(stagedConfig, 'functions'), false);
    assert.equal(Object.hasOwn(stagedConfig, 'routes'), false);
    const env = { ...good };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    // Execute the exact configured Node command from the deployment root.
    const [runtime, ...buildArgs] = stagedConfig.buildCommand.split(' ');
    assert.equal(runtime, 'node');
    const output = join(stage, stagedConfig.outputDirectory);
    await assert.rejects(() => readdir(output), { code: 'ENOENT' });
    const rejected = spawnSync(process.execPath, buildArgs, { cwd: stage, env: { ...env, TOOLKIT_ORIGIN: 'synthetic_wrong_origin' }, encoding: 'utf8' });
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, 'FAIL ORIGIN_MISMATCH\n');
    assert.equal(rejected.stderr, '');
    await assert.rejects(() => readdir(output), { code: 'ENOENT' });
    const child = spawnSync(process.execPath, buildArgs, { cwd: stage, env, encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, 'PASS\n');
    assert.equal(child.stderr, '');
    assert.deepEqual(await readdir(output), ['index.html']);
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Maintenance</title><p>Maintenance artifact.</p></html>\n');
    // A filesystem failure cannot yield PASS or leak raw diagnostics.
    await rm(output, { recursive: true });
    await writeFile(output, 'synthetic file blocks output directory');
    const blocked = spawnSync(process.execPath, buildArgs, { cwd: stage, env, encoding: 'utf8' });
    assert.ifError(blocked.error);
    assert.equal(blocked.status, 1);
    assert.equal(blocked.stdout, 'FAIL BUILD_OUTPUT_FAILED\n');
    assert.equal(blocked.stderr, '');
    await assert.rejects(() => prepareVerification(repo, repo), /Unsafe staging location/);
    await writeFile(join(repo, 'maintenance/verify-production/vercel.json'), JSON.stringify({ ...stagedConfig, functions: { 'api/send-fax.js': { maxDuration: 60 } } }));
    await assert.rejects(() => prepareVerification(repo, stagingRoot), /Invalid verification deployment configuration/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('maintenance configuration rejects application functions and all routing or environment overrides', async () => {
  const config = JSON.parse(await readFile('maintenance/verify-production/vercel.json', 'utf8'));
  assertVerificationConfig(config);
  for (const [key, value] of Object.entries({
    functions: { 'api/send-fax.js': { maxDuration: 60 } }, routes: [], rewrites: [],
    builds: [], env: {}, build: { env: {} }
  })) assert.throws(() => assertVerificationConfig({ ...config, [key]: value }), /Invalid verification deployment configuration/);
  assert.throws(() => assertVerificationConfig({ ...config, buildCommand: 'npm run build' }), /Invalid verification deployment configuration/);
});

function harness({ env = good, args = ['--apply', '--production'], commitFails = false, prior } = {}) {
  const events = [];
  const sql = 'synthetic migration payload';
  return { events, run: () => runMigration({ args, env,
    readSql: async () => sql,
    openPool: async () => {
      events.push('open');
      return { end: async () => {}, connect: async () => ({ release() {}, query: async statement => {
        events.push(statement);
        if (statement === 'COMMIT' && commitFails) throw new Error(connection);
        if (statement.startsWith('SELECT checksum')) return { rows: prior === undefined ? [] : [{ checksum: prior === 'matching' ? createHash('sha256').update(sql).digest('hex') : prior }] };
        return { rows: [] };
      } }) };
    }, log: message => events.push(`log:${message}`), error: message => events.push(`error:${message}`)
  }) };
}
test('all rejected configurations fail before opening migration connection', async () => {
  for (const [, env, accepted] of cases) {
    if (accepted) continue;
    const h = harness({ env });
    assert.equal(await h.run(), 1);
    assert.equal(h.events.includes('open'), false);
  }
});
test('main cannot be used through development mode or without apply', async () => {
  for (const options of [{ args: ['--production'] }, { args: ['--apply'], env: { ...good, VERCEL_ENV: undefined, TOOLKIT_ORIGIN: 'http://localhost:5173' } }]) {
    const h = harness(options);
    assert.equal(await h.run(), 1);
    assert.equal(h.events.includes('open'), false);
  }
});
test('migration success follows completed COMMIT, preserving lock and ledger', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  assert.ok(h.events.indexOf('COMMIT') < h.events.findIndex(value => value.startsWith('log:')));
  assert.ok(h.events.includes('SELECT pg_advisory_xact_lock(731942015)'));
  assert.ok(h.events.some(value => value.startsWith('INSERT INTO toolkit_auth.migrations')));
});
test('failed COMMIT produces no success or driver diagnostic and rolls back', async () => {
  const h = harness({ commitFails: true });
  assert.equal(await h.run(), 1);
  assert.equal(h.events.some(value => value.startsWith('log:')), false);
  assert.ok(h.events.includes('ROLLBACK'));
  assert.equal(h.events.some(value => value.includes('synthetic_password')), false);
});
test('existing matching ledger skips migration; checksum mismatch rolls back', async () => {
  for (const prior of ['matching', 'mismatch']) {
    const h = harness({ prior });
    assert.equal(await h.run(), prior === 'matching' ? 0 : 1);
    assert.equal(h.events.includes('synthetic migration payload'), false);
    assert.equal(h.events.includes('COMMIT'), prior === 'matching');
  }
});
test('maintenance build is dependency-free and has no API or migration entry point', async () => {
  const config = JSON.parse(await readFile('maintenance/verify-production/vercel.json', 'utf8'));
  assert.equal(config.buildCommand, 'node build.mjs');
  assert.equal(config.installCommand, '');
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'public');
  for (const name of ['verify.mjs', 'validate.mjs']) {
    const source = await readFile(`maintenance/verify-production/${name}`, 'utf8');
    assert.doesNotMatch(source, /\b(fetch|connect|query|writeFile|dotenv)\s*\(/);
  }
  const build = await readFile('maintenance/verify-production/build.mjs', 'utf8');
  assert.doesNotMatch(build, /\b(fetch|connect|query|dotenv)\s*\(/);
});
