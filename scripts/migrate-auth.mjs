import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validConnection, validProduction } from '../maintenance/verify-production/validate.mjs';

// Explicit operator action only. Never invoked by build or API handlers.
export async function runMigration({ args, env, openPool, readSql, log, error, expectedChecksum, assertAuthorized = () => {} }) {
  let pool, client;
  try {
    const production = args.includes('--production');
    if (!args.includes('--apply') || args.some(arg => !['--apply', '--production'].includes(arg))) throw new Error();
    if (production ? !validProduction(env) :
      (env.VERCEL_ENV === 'production' || env.TOOLKIT_ORIGIN !== 'http://localhost:5173' || !validConnection(env.DATABASE_URL))) throw new Error();
    assertAuthorized();
    const sql = await readSql();
    const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
    if (expectedChecksum !== undefined && checksum !== expectedChecksum) throw new Error();
    assertAuthorized();
    pool = await openPool();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(731942015)");
    assertAuthorized();
    await client.query('CREATE SCHEMA IF NOT EXISTS toolkit_auth');
    await client.query('CREATE TABLE IF NOT EXISTS toolkit_auth.migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const prior = await client.query('SELECT checksum FROM toolkit_auth.migrations WHERE name = $1', ['001_toolkit_auth']);
    if (prior.rows.length) {
      if (prior.rows[0].checksum !== checksum) throw new Error('Migration mismatch');
    } else {
      await client.query(sql);
      await client.query('INSERT INTO toolkit_auth.migrations (name, checksum) VALUES ($1,$2)', ['001_toolkit_auth', checksum]);
    }
    assertAuthorized();
    await client.query('COMMIT');
    log(prior.rows.length ? 'Authentication migration already applied; no changes.' : 'Authentication migration applied.');
    return 0;
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    error('Authentication migration failed. Diagnostics withheld to protect credentials.');
    return 1;
  } finally {
    try { client?.release(); await pool?.end(); } catch { /* Withhold driver diagnostics. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMigration({
    args: process.argv.slice(2), env: process.env,
    openPool: async () => (await import('../server/auth/database.js')).getPool(),
    readSql: () => readFile(new URL('../migrations/001_toolkit_auth.sql', import.meta.url), 'utf8'),
    log: message => console.log(message), error: message => console.error(message)
  });
}
