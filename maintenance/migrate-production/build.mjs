import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runMigration } from './scripts/migrate-auth.mjs';
import { productionCheck } from './maintenance/verify-production/validate.mjs';
import { CHECKSUM, authorizationValid } from './policy.mjs';

export async function writeArtifact(directory = 'public') {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Maintenance</title><p>Maintenance artifact.</p></html>\n');
}

// Tests inject mocks. The staged entry point has no HTTP route.
export async function runMaintenance({ args, env, readAuthorization, readSql, openPool, writeArtifact, log, now = Date.now }) {
  try {
    if (args.length !== 1 || args[0] !== '--apply-001') {
      log('FAIL APPLY_AUTHORIZATION_REQUIRED'); return 1;
    }
    const authorization = await readAuthorization();
    if (!authorizationValid(authorization, now())) {
      log('FAIL AUTHORIZATION_INVALID_OR_EXPIRED'); return 1;
    }
    const target = productionCheck(env);
    if (target !== 'PASS') { log(`FAIL ${target}`); return 1; }
    const assertAuthorized = () => {
      if (!authorizationValid(authorization, now()) || productionCheck(env) !== 'PASS') throw new Error();
    };
    const result = await runMigration({
      args: ['--apply', '--production'], env, readSql, openPool,
      expectedChecksum: CHECKSUM, assertAuthorized,
      log, error: () => log('FAIL MIGRATION_NOT_CONFIRMED')
    });
    if (result !== 0) return result;
    try { await writeArtifact(); } catch {
      // A later deployment failure cannot undo the database commit.
      log('FAIL ARTIFACT_AFTER_COMMIT'); return 1;
    }
    log('PASS MIGRATION_MAINTENANCE_COMPLETE');
    return 0;
  } catch {
    log('FAIL MAINTENANCE_CONFIGURATION'); return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMaintenance({
    args: process.argv.slice(2), env: process.env,
    readAuthorization: async () => JSON.parse(await readFile('authorization.json', 'utf8')),
    readSql: () => readFile('migrations/001_toolkit_auth.sql', 'utf8'),
    openPool: async () => (await import('./server/auth/database.js')).getPool(),
    writeArtifact,
    log: message => console.log(message)
  });
}
