import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function assertVerificationConfig(config) {
  const expected = {
    $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
    installCommand: '', buildCommand: 'node build.mjs', outputDirectory: 'public', public: false
  };
  // Reject every extra field, including functions, routes, rewrites, builds,
  // env and build.env. Never merge the application's deployment configuration.
  if (!config || Object.keys(config).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => config[key] !== value)) {
    throw new Error('Invalid verification deployment configuration');
  }
}

// Copies only reviewed source and non-secret project identifiers. No CLI, env
// loader, database driver, network requests or deployment action is used here.
export async function prepareVerification(repoRoot, temporaryRoot = tmpdir()) {
  const metadata = JSON.parse(await readFile(join(repoRoot, '.vercel/repo.json'), 'utf8'));
  const matches = metadata.projects.filter(project => project.name === 'packardtoolkit');
  if (matches.length !== 1) throw new Error('Invalid project metadata');
  const project = matches[0];
  if (!/^prj_[A-Za-z0-9]+$/.test(project.id) || !/^(team_|user_)?[A-Za-z0-9]+$/.test(project.orgId)) throw new Error('Invalid project metadata');
  // Never stage underneath another repository or Vercel project.
  for (let cursor = temporaryRoot; ; cursor = dirname(cursor)) {
    for (const marker of ['.git', '.vercel', 'vercel.json']) {
      try { await lstat(join(cursor, marker)); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error('Unsafe staging location');
    }
    if (dirname(cursor) === cursor) break;
  }
  const source = join(repoRoot, 'maintenance/verify-production');
  const files = ['verify.mjs', 'build.mjs', 'validate.mjs', 'vercel.json', '.vercelignore'];
  for (const file of files) {
    if (!(await lstat(join(source, file))).isFile()) throw new Error('Invalid source file');
  }
  assertVerificationConfig(JSON.parse(await readFile(join(source, 'vercel.json'), 'utf8')));
  const stage = await mkdtemp(join(temporaryRoot, 'packard-auth-verification-'));
  await mkdir(join(stage, '.vercel'));
  for (const file of files) await copyFile(join(source, file), join(stage, file));
  assertVerificationConfig(JSON.parse(await readFile(join(stage, 'vercel.json'), 'utf8')));
  // This is a standard local project link, not environment configuration.
  await writeFile(join(stage, '.vercel/project.json'), JSON.stringify({ projectId: project.id, orgId: project.orgId, projectName: 'packardtoolkit' }));
  return stage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await prepareVerification(fileURLToPath(new URL('../', import.meta.url))));
  } catch {
    console.error('PREPARATION_FAILED');
    process.exitCode = 1;
  }
}
