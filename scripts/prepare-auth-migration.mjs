import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrationForFlag, WINDOW_MS, checksum } from '../maintenance/migrate-production/policy.mjs';

export async function prepareMigration(repoRoot, { authorize = false, temporaryRoot = tmpdir(), now = Date.now(), migrationFlag = '--apply-001' } = {}) {
  const migration = migrationForFlag(migrationFlag);
  if (!authorize || !migration || !Number.isSafeInteger(now)) throw new Error();
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
    installCommand: 'npm ci --ignore-scripts --no-audit --no-fund', buildCommand: 'node build.mjs ${PACKARD_MIGRATION_FLAG}', outputDirectory: 'public', public: false };
  if (Object.keys(config).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => config[key] !== value)) throw new Error();
  const sqlPath = `migrations/${migration.name}.sql`;
  const sql = await readFile(join(repoRoot, sqlPath), 'utf8');
  if (checksum(sql) !== migration.checksum) throw new Error();
  const entries = [
    ...['build.mjs', 'policy.mjs', 'vercel.json', 'package.json', 'package-lock.json', '.vercelignore'].map(file => [join(packageRoot, file), file]),
    ...['scripts/migrate-auth.mjs', 'server/auth/database.js', 'maintenance/verify-production/validate.mjs', sqlPath].map(file => [join(repoRoot, file), file])
  ];
  for (const [source] of entries) if (!(await lstat(source)).isFile()) throw new Error();
  const stage = await mkdtemp(join(temporaryRoot, `packard-${migration.name}-migration-`));
  for (const [source, relative] of entries) {
    const target = join(stage, relative);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if (checksum(await readFile(join(stage, sqlPath), 'utf8')) !== migration.checksum) throw new Error();
  const vercelConfig = JSON.parse(await readFile(join(stage, 'vercel.json'), 'utf8'));
  vercelConfig.buildCommand = vercelConfig.buildCommand.replace('${PACKARD_MIGRATION_FLAG}', migration.flag);
  await writeFile(join(stage, 'vercel.json'), JSON.stringify(vercelConfig, null, 2) + '\n');
  await mkdir(join(stage, '.vercel'));
  await writeFile(join(stage, '.vercel/project.json'), JSON.stringify({ projectId: project.id, orgId: project.orgId, projectName: 'packardtoolkit' }));
  await writeFile(join(stage, 'authorization.json'), JSON.stringify({ action: migration.action, migration: migration.name, checksum: migration.checksum, issuedAt: now, expiresAt: now + WINDOW_MS }));
  return stage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const migration = process.argv.length === 3 ? migrationForFlag(process.argv[2].replace('--authorize-apply-', '--apply-')) : null;
    if (!migration) throw new Error();
    console.log(await prepareMigration(fileURLToPath(new URL('../', import.meta.url)), { authorize: true, migrationFlag: migration.flag }));
  } catch { console.error('MIGRATION_PREPARATION_FAILED'); process.exitCode = 1; }
}
