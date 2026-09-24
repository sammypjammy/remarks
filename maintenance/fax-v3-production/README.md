# Production preflight and migrations 002/003 (PREPARATION ONLY)

Neither entry point has been run against Production. No build/API imports this tooling.
Do not run the Production commands below until separately authorized. This package
supersedes the migration-runner TODO in docs/fax-v3-production-staging.md; it does not
authorize any staging step, acceptance switch, menu change, deployment or migration.

## Identity and read-only preflight

`preflight.mjs --read-only --production --target <reviewed JSON>` accepts no apply
arguments. It checks configuration and pinned SQL hashes before connecting to SQL.
It requires an independently reviewed, NONSECRET target file containing the expected
Neon project, Production branch ID, Development branch ID and database name.
Copy target.example.json outside the repository and replace placeholders with IDs
from Neon Console, not values inferred from an untrusted connection URL.

The fixed Production endpoint is ep-young-dream-arkoh9e5; the fixed Development
endpoint ep-jolly-lake-ar7x7r37 was identified from the existing local Development
configuration without printing its URL. The tool rejects every other endpoint and
all Development/Preview/unknown environment labels. It uses GET-only Neon metadata
requests to verify the Production endpoint's host/project/branch/read-write type,
the Development endpoint's actual branch, and the expected Production branch object.
Production and Development branch IDs must differ. API failure, redirects, metadata
mismatch or timeout abort before any database connection. A moved/replaced endpoint
requires separate review of the pins, never an operator bypass flag.

The SQL connection uses TLS certificate verification and bounded timeouts. Inside
REPEATABLE READ READ ONLY it checks current_database() against the independent target,
exact auth schema structure (including FK targets/primary keys), the immutable 001
ledger checksum, absence of 002/003 ledger records, and absence of the entire
`toolkit_rc_v3` namespace. Even an empty pre-existing namespace is a conflict. Unknown
ledger entries, extra/missing auth structure, disabled/missing constraints and schema
ambiguity fail closed. All SQL is SELECT/transaction-control/SET LOCAL; it ends with
ROLLBACK, never schema/data writes. No personal row contents are selected or logged.

Success is one sanitized JSON record: environment, project, branch, endpoint, database,
host and PREFLIGHT_PASS. No credential-bearing URL, username, password, API token,
upstream error, query parameters or key fingerprint is output.

`--inspect` is the separate READ-ONLY reconciliation mode. It verifies the exact
ledger + schema for CLEAN, 002_COMMITTED, or 002_003_COMMITTED. Staged v3 tables must
still be empty; this is pre-acceptance reconciliation, not a general live-history
inspection. Unexpected/nonempty states return failure and are never repaired/deleted.

## Exact safe operator DB process (later authorization required)

1. In Neon Console, independently record the project ID, database name, Production
   branch ID attached to the fixed Production endpoint, and Development branch ID
   attached to the fixed Development endpoint. No SQL operation is needed for this.
2. Copy `target.example.json` to a private local NONSECRET target file, for example
   `$env:LOCALAPPDATA\Temp\fax-v3-production-target.json`, fill those IDs, and review it.
3. In a private operator PowerShell window, outside Codex/terminal recording/transcript,
   run from the isolated worktree:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\maintenance\fax-v3-production\preflight-private.ps1 -TargetFile "$env:LOCALAPPDATA\Temp\fax-v3-production-target.json"
```

The wrapper asks for the existing Production DATABASE_URL and Neon API credential via
concealed SecureString input. Paste directly from the approved secret manager without
revealing them; never put secrets in command arguments, shell assignments, an env file,
a Git file, chat, a screenshot or a transcript. Use the least-privileged available Neon
credential; tooling only calls GET. The child receives secrets in process memory,
with local maintenance environment labels; no parent/Vercel environment is changed.
Inherited Node debug/preload options are removed. The wrapper discards raw stderr and
forwards only the tool's fixed/sanitized stdout. Process memory is not protection from
an administrator/debugger; use a trusted private machine, no debug instrumentation.
Use `-Inspect` on the SAME wrapper for later read-only commit reconciliation.

Vercel Sensitive DATABASE_URL cannot be read back from its API. If the original
approved secret source is unavailable, do NOT unhide/export/rotate the variable to
run this. A separately authorized private execution in an environment already holding
that exact Production value is required. This preparation adds no such deployment.
Comparing/inspecting a source-of-truth copy does not independently attest the currently
injected Vercel snapshot; provenance or approved in-environment execution is necessary.

## Production runner (not executed; separate later approval)

`apply.mjs` requires all exact arguments below, a future expiry no more than 15 minutes
away, a direct NON-POOLER connection, and the same verified target/configuration:

```text
node maintenance/fax-v3-production/apply.mjs --apply --production --target <reviewed-target.json> --authorize APPLY_002_003_TO_PRODUCTION --expires-at <explicit-UTC-ISO-expiry>
```

This is not a currently authorized command. Supply DATABASE_URL and NEON_API_KEY only
through an approved protected process/secret-manager launch, never inline values.
TOOLKIT_ORIGIN must match the Production origin; VERCEL_ENV must be production. These
are maintenance process checks, not permission to modify Vercel variables. The checked
Production branch/endpoint, not an environment label alone, determines the SQL target.
No dynamic expiry generator or --force/--skip-preflight option is provided.

The runner performs its own fresh read-only preflight. It then takes the existing
advisory-lock key 731942015 with a direct-session pg_try_advisory_lock, holds it across
both commits, and repeats preflight under the lock. Session and transaction advisory
locks on that key conflict, coordinating with existing runners. A pooler is refused
because transaction pooling cannot preserve session-level lock ownership reliably.
Each migration has a transaction, 3-second lock timeout, 30-second SQL statement timeout,
35-second client query timeout and expiry checks before work/COMMIT. Only the two
pinned SQL files can execute. The runner never reads/executes 001 SQL, updates its ledger
entry, or changes auth tables. It inserts only 002 and 003 checksum ledger records.

Order: verify clean -> apply 002 + ledger -> verify 002 -> COMMIT -> read-only verify 002
-> apply 003 + ledger -> verify 003 -> COMMIT -> read-only verify 003. Thus 002 can remain
committed if 003 fails. This intentionally verifies every committed migration; it is
NOT an all-or-nothing transaction across both files. Successful messages occur only
after acknowledged COMMIT and post-commit schema verification. Expected catalog
snapshots include columns/types/defaults, constraints/validation, indexes/readiness,
relations/RLS, routines, types, user triggers and policies. Snapshots were generated
from pinned migrations in rolled-back random Development fixtures, never Production.
They fail closed on catalog-format/version differences; investigate rather than relax.

### Outcomes and recovery

- Exit 0: preflight/reconciliation passed, or both commits verified (see fixed messages).
- Exit 1 / PRECOMMIT_FAILED_NO_MIGRATION_COMMIT_ACKNOWLEDGED: no migration COMMIT was
  acknowledged in this run; stop and investigate. Rollback attempted on the connection.
- Exit 1 / 003_PRECOMMIT_FAILED_002_REMAINS_COMMITTED_STOP: 002 committed/verified;
  003 failed before COMMIT. Leave schema/ledger intact; do not run the pair again.
- Exit 2 / COMMIT_ACKNOWLEDGEMENT_UNKNOWN_STOP_NO_RETRY: COMMIT was sent but the response
  was lost/rejected/timed out. No rollback claim, reconnect, replay or automatic retry.
  Close the connection, then separately authorize --inspect reconciliation. The prior
  002_COMMITTED_VERIFIED message, if present, identifies the completed first step.
- Exit 3 / COMMITTED_BUT_VERIFICATION_FAILED_STOP_NO_RETRY: COMMIT acknowledged but
  later verification failed. Treat the migration as committed, stop and reconcile.

A normal rerun requires a clean first-application state and therefore refuses an
already-applied or partially applied pair. Matching checksum records are verified
by --inspect, never re-executed. A reviewed partial-completion recovery authorization
is required for 003-only continuation; there is deliberately no resume/repair bypass.
Do not drop v3 tables, edit checksums or delete ledger rows to make preflight pass.
Application rollback leaves these additive tables/ledger intact. No tool automatically
retries a network error or ambiguous migration.

## Exact private key comparison process (no rotation)

Use original approved secret-manager entries for Production and Development key V1.
Run in a PRIVATE operator console, never through Codex, tracing/debugger, terminal
recording or PowerShell transcript:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\maintenance\fax-v3-production\compare-keys.ps1
```

Paste each existing key directly into its concealed input prompt from the secret
manager; do not reveal the value or include it on a command line. Successful stdout
is ONLY `SAME` or `DIFFERENT`. The module checks canonical base64/32-byte keys, compares
all bytes without an early content-match exit, and clears temporary byte buffers and
unmanaged strings. Managed runtime copies cannot be guaranteed physically erased;
no values/hashes are written to files, browser code, logs or terminal output. Invalid
inputs return a fixed error on stderr with nonzero exit, never a misleading DIFFERENT.
The execution-policy override is process-scoped and changes no machine policy.

This compares the two supplied source values. It does NOT claim to read live Vercel
Sensitive values. Vercel does not provide a supported readback API for Sensitive keys.
If the original Production value is unavailable or its provenance to the current
Vercel value is uncertain, LIVE inequality remains UNVERIFIED. The only reliable
alternative is a separately authorized private, short-lived Vercel-side process
already receiving the Production key and a protected transient Development comparison
input, returning only SAME/DIFFERENT. Do not create a public diagnostic endpoint,
export either key, log hashes, add persistent comparison variables or rotate keys to
perform this check. No such process is deployed/created/executed by this preparation.

## Validation

Tests use synthetic Neon metadata and fake migration clients for every Production
runner invocation. Real SQL schema inspection tests run ONLY inside random disposable
Development schemas with rollback. Key-comparison tests use synthetic SecureStrings.
No real Production preflight, metadata verification or migration invocation is part
of the test suite. No real key comparison has been performed.

References:
- https://neon.com/docs/manage/endpoints/
- https://neon.com/docs/connect/connection-pooling
- https://vercel.com/docs/environment-variables/sensitive-environment-variables

Preparation validation: 238 regression checks passed (four database suites skipped
in that run); all 24 separately enabled Development database checks passed. Normal
and opt-in production artifact checks passed within regression. Source/browser scan:
196 source files, 49 normal output files, four configured secret values compared
in memory, zero findings. No Production value or real key was used in tests.
