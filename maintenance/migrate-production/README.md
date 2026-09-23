# One-time authentication migration maintenance build

Production target verification is complete. This separate package performs the
reviewed 001_toolkit_auth migration only when an operator explicitly prepares and
deploys it. Nothing invokes it from the normal Toolkit build, API, or Git workflow.
Do not deploy this source subdirectory directly: the preparer assembles its
reviewed dependencies into an isolated temporary deployment root.

## Guards

- Preparation requires `--authorize-apply-001`. It writes a non-secret
  authorization.json with a specific action, migration name, pinned checksum,
  issuance time and a deadline exactly 30 minutes later. No credential is copied.
- The build requires `--apply-001` and that authorization file. It rejects missing,
  future-dated, expired, mismatched or extended-window authorization. The deadline
  includes upload, queue and dependency-install time. Reprepare explicitly if it
  expires; do not edit the authorization file or extend the window.
- The unchanged shared validator requires VERCEL=1, VERCEL_ENV=production,
  TOOLKIT_ORIGIN=https://packardtoolkit.vercel.app, and the exact Neon endpoint
  ep-young-dream-arkoh9e5, allowing the supported pooled/cell hostname forms.
  PostgreSQL protocol, credential/path structure, port, and strict URL-option
  rules are identical to the successful verification package.
- Both the wrapper and existing migration runner check the target independently.
  Authorization is checked before connecting, after the transaction advisory
  lock, and immediately before COMMIT. Expiry during work causes rollback.
- SHA-256 is pinned to
  `d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605`.
  SQL is normalized from CRLF to LF before hashing, matching the existing ledger.
  The preparer checks the source and copied SQL; the runner checks again before
  connecting. Changed SQL requires a new review, not automatic checksum updates.
- The existing transaction, advisory lock, ledger and checksum checks prevent
  concurrent/repeated schema application. A matching ledger entry skips the SQL;
  a mismatched ledger checksum rolls back. Authorization is time-limited operator
  intent, not a bearer secret or a cryptographic defense against source edits by
  someone already authorized to deploy arbitrary code to this project.

## Package and dependencies

The preparer copies only the maintenance build/policy/configuration, a minimal
package manifest and lockfile, the existing hardened runner and database adapter,
the shared production validator, and the reviewed migration. It creates a local
project link from the existing repo metadata; it never invokes `vercel link`.
No .env file, application API, HTTP maintenance endpoint, application routes or
local node_modules are copied. Production secrets are supplied only by Vercel
during the remote build. The static artifact contains only fixed harmless HTML.

The standalone manifest pins pg to the existing 8.23.0 version. Its lockfile is
the dependency subset from the existing root lockfile, with the same versions and
integrity hashes. The remote install uses npm ci with lifecycle scripts disabled.
Normal app configuration, dependencies, versions and deployment behavior remain
unchanged. The migration package necessarily has PostgreSQL capability; the
verification-only package remains free of a database driver and SQL capability.

## Operator command

Run from the repository root only when ready to apply the production migration.
Preparation is local and does not connect to a database. The deploy command below
WILL run the migration in the remote Production build. Use it within 30 minutes.

```powershell
$migrationStage = node .\scripts\prepare-auth-migration.mjs --authorize-apply-001
if ($LASTEXITCODE -ne 0) { throw 'Migration preparation failed; stopped.' }
$migrationConfig = Join-Path $migrationStage 'vercel.json'
Push-Location -LiteralPath $migrationStage
try {
    npx.cmd vercel@59.25.4 deploy --local-config "$migrationConfig" --project packardtoolkit --scope sammypjammy1 --prod --skip-domain
} finally {
    Pop-Location
}
```

The isolated working directory and explicit configuration prevent the CLI from
selecting the Toolkit root configuration. Keep --skip-domain; never promote or
alias this maintenance deployment. No application deployment is included here.

First application emits these fixed build-log lines after successful COMMIT:

```text
Authentication migration applied.
PASS MIGRATION_MAINTENANCE_COMPLETE
```

A repeat within the window with an identical ledger checksum instead emits:

```text
Authentication migration already applied; no changes.
PASS MIGRATION_MAINTENANCE_COMPLETE
```

Vercel also emits installation/build logs and should finish Ready. A failure
after COMMIT cannot undo the migration. In particular FAIL ARTIFACT_AFTER_COMMIT
means the database commit succeeded but artifact creation failed. Treat
FAIL MIGRATION_NOT_CONFIRMED (including lost connection during COMMIT) as an
uncertain outcome until the ledger is checked or a reviewed idempotent retry
resolves it. Do not infer a database rollback solely from a failed deployment.

## Local validation

`node --test tests/migration-maintenance.test.mjs tests/production-maintenance.test.mjs tests/toolkit-auth.test.js`

Tests use synthetic configuration, mock clients and an expired-authorization
subprocess without an installed driver. No real database is contacted.
