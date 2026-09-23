import pg from 'pg';

let pool;
export function databaseOptions(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Database configuration unavailable');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database configuration');
  // Enforce certificate validation; URL sslmode must not override these TLS settings.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.href, ssl: { rejectUnauthorized: true }, enableChannelBinding: true,
    max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000, allowExitOnIdle: true };
}
export function getPool() {
  if (!pool) {
    pool = new pg.Pool(databaseOptions());
    // Never forward driver diagnostics: they can contain connection information.
    pool.on('error', () => {});
  }
  return pool;
}
