# Production target verification

This independent source directory is a verification-only Vercel remote build.
It has no dependencies, database driver, SQL, HTTP API, or migration entry point.
It never reads environment files. Its upload allowlist excludes everything except
the three JavaScript modules and deployment configuration.
Only `PASS` or `FAIL <fixed-category>` is printed by the verifier (Vercel has its own build logs).
Exit codes are 0 and 1 respectively. The static page contains no verification data.
The configured command is `node build.mjs`. From the deployment root it runs the
unchanged in-memory validator, then creates public/index.html with fixed harmless
HTML only if validation succeeds. It logs PASS only after the artifact is written.
Validation failure produces no output artifact; filesystem failures produce only
FAIL BUILD_OUTPUT_FAILED and a nonzero exit. No source public directory is needed.

The previous package copied public/index.html locally but its `*` / `!public/`
upload rules rejected the bare `public` directory path checked by CLI 59.25.4's
directory walker. The previous build verified configuration without creating
output. Generating the artifact during the build removes that upload dependency.

The validator requires VERCEL=1, VERCEL_ENV=production, the exact canonical Toolkit
origin, and a PostgreSQL URL for ep-young-dream-arkoh9e5, optionally pooled. Hosts
must have the form endpoint.region.aws.neon.tech or endpoint.region.azure.neon.tech,
with an optional c-N infrastructure cell immediately before the region.
Credentials and a single database path segment must be present; only default port
or 5432 is accepted. Whitespace, backslashes and fragments are rejected. The only
query keys permitted are sslmode (require, verify-ca, verify-full) and
channel_binding (require); duplicate keys and all other options are rejected.
Values are inspected in memory, never returned, serialized, or logged.

The endpoint was independently confirmed by the operator as main. This verifies
that association, not a fresh Neon metadata lookup. Reconfirm it if Neon endpoints
are reassigned. A local synthetic PASS is not production verification.

Do not deploy directly from this repository subdirectory. CLI 59.25.4 follows the
repository-wide .vercel/repo.json link back to the repository root, where
verify.mjs does not exist. Also, `vercel link` now downloads an OIDC token into
.env.local. Do not run `link`, `env pull`, `vercel pull`, `--prebuilt`, `--env`,
`--build-env`, or `promote` for this procedure.

From the repository root, the operator may later run the following commands.
The preparation script copies only the five reviewed upload files to a fresh
temporary directory outside all repositories. It writes a standard project link
using the existing repo.json project/org identifiers, without reading or copying
any environment files. It makes no network requests and performs no deployment.
The CLI version below is the already-used version, not an upgrade.

```powershell
$verificationStage = node .\scripts\prepare-auth-verification.mjs
if ($LASTEXITCODE -ne 0) { throw 'Verification preparation failed; stopped.' }
$verificationConfig = Join-Path $verificationStage 'vercel.json'
Push-Location -LiteralPath $verificationStage
try {
    npx.cmd vercel@59.25.4 deploy --local-config "$verificationConfig" --project packardtoolkit --scope sammypjammy1 --prod --skip-domain
} finally {
    Pop-Location
}
```

This is a real staged Production deployment, requiring operator authorization.
Both the shell working directory and explicit --local-config must select the
staged package. CLI 59.25.4 reads early configuration from process.cwd() before
applying --cwd; --cwd alone can therefore pair staged files with the application's
root vercel.json. This is local config selection, not project-level functions
merging. The preparation script rejects any extra configuration fields, including
functions, routes, rewrites and environment overrides, before and after copying.
Always retain --skip-domain. Never promote this maintenance artifact. It uses the
existing project's Production variables inside the remote build, not local files.
The package assumes the existing project's Root Directory is unset/repository
root; stop if Vercel reports a different root. Configuration overrides are scoped
to this deployment; the app's root vercel.json, build command, routes and versions
remain unchanged. No normal build invokes this verifier or a migration.

A successful remote PASS verifies the configured endpoint only. It does not
authorize or run a migration. The separate migration CLI now validates production
configuration again before importing the database driver or connecting, and only
logs success after commit. No migration maintenance deployment is included here.

Local checks (synthetic configuration and mocked migration client only):
`node --test tests/production-maintenance.test.mjs` from the repository root.

Failure categories: NOT_PRODUCTION, ORIGIN_MISMATCH, DATABASE_URL_MISSING,
DATABASE_PROTOCOL_INVALID, DATABASE_URL_INVALID, NEON_HOST_INVALID,
ENDPOINT_MISMATCH, DATABASE_OPTIONS_INVALID, BUILD_OUTPUT_FAILED. None includes the checked value.
VERIFIER_ENTRYPOINT_MISSING is a build packaging error, before these checks run.
No URL acceptance rules were relaxed to diagnose the failed build.
