import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPLY, CHECKSUM, MIGRATION, WINDOW_MS, checksum } from '../maintenance/migrate-production/policy.mjs';

export async function prepareMigration(repoRoot, { authorize = false, temporaryRoot = tmpdir(), now = Date.now() } = {}) {
  if (!authorize || !Number.isSafeInteger(now)) throw new Error();
  const metadata = JSON.parse(await readFile(join(repoRoot, '.vercel/repo.json'), 'utf8'));
  const matches = metadata.projects.filter(project => project.name === 'packardtoolkit');
  if (matches.length !== 1) throw new Error();
  const project = matches[0];
  if (!/^prj_[A-Za-z0-9]+$/.test(project.id) || !/^(team_|user_)?[A-Za-z0-9]+$/.test(project.orgId)) throw new Error();
  for (let cursor = temporaryRoot; ; cursor = dirname(cursor)) {
    for (const marker of ['.git', '.vercel', 'vercel.json']) {
      try { await lstat(join(cursor, marker)); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error();
    }
    if (dirname(cursor) === cursor) break;
  }
  const packageRoot = join(repoRoot, 'maintenance/migrate-production');
  const config = JSON.parse(await readFile(join(packageRoot, 'vercel.json'), 'utf8'));
  const expected = { $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
    installCommand: 'npm ci --ignore-scripts --no-audit --no-fund', buildCommand: 'node build.mjs --apply-001', outputDirectory: 'public', public: false };
  if (Object.keys(config).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => config[key] !== value)) throw new Error();
  const sql = await readFile(join(repoRoot, 'migrations/001_toolkit_auth.sql'), 'utf8');
  if (checksum(sql) !== CHECKSUM) throw new Error();
  const entries = [
    ...['build.mjs', 'policy.mjs', 'vercel.json', 'package.json', 'package-lock.json', '.vercelignore'].map(file => [join(packageRoot, file), file]),
    ...['scripts/migrate-auth.mjs', 'server/auth/database.js', 'maintenance/verify-production/validate.mjs', 'migrations/001_toolkit_auth.sql'].map(file => [join(repoRoot, file), file])
  ];
  for (const [source] of entries) if (!(await lstat(source)).isFile()) throw new Error();
  const stage = await mkdtemp(join(temporaryRoot, 'packard-auth-migration-'));
  for (const [source, relative] of entries) {
    const target = join(stage, relative);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if (checksum(await readFile(join(stage, 'migrations/001_toolkit_auth.sql'), 'utf8')) !== CHECKSUM) throw new Error();
  await mkdir(join(stage, '.vercel'));
  await writeFile(join(stage, '.vercel/project.json'), JSON.stringify({ projectId: project.id, orgId: project.orgId, projectName: 'packardtoolkit' }));
  await writeFile(join(stage, 'authorization.json'), JSON.stringify({ action: APPLY, migration: MIGRATION, checksum: CHECKSUM, issuedAt: now, expiresAt: now + WINDOW_MS }));
  return stage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--authorize-apply-001') throw new Error();
    console.log(await prepareMigration(fileURLToPath(new URL('../', import.meta.url)), { authorize: true }));
  } catch { console.error('MIGRATION_PREPARATION_FAILED'); process.exitCode = 1; }
}
