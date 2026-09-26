# Production preflight and migrations 002/003 (PREPARATION ONLY)

The first operator preflight attempt stopped at identity validation before SQL.
No Production migration has been executed. This tooling is operator-only
and is not imported by the application/build. There is no deployment, acceptance,
menu, environment or version change. Migration execution requires separate approval.

## Identity assurance: deliberate replacement of live API checks

Identity now uses a fresh HUMAN Neon dashboard attestation. No Neon CLI, API key,
OAuth flow, credential store, session, or control-plane request is involved. The
obsolete maintenance-only CLI package and its exclusive helpers/tests were removed;
other workflows and the private encryption-key comparator are unchanged.

The removed assurance is automatic, current endpoint/project/branch ownership,
full endpoint hostname and read-write type verification via three live API records.
The replacement is operator review of those SAME properties and a commitment to
pause endpoint reassignment, branch restore/reset and related Neon administrative
work from review through completion of the migration (or abandonment of the attempt).
Endpoint IDs are stable but endpoint-to-branch associations can change. SQL schema
checks cannot distinguish a compatible clone. A local attestation is not a signed
Neon assertion and cannot prove the operator actually reviewed the dashboard or
that another administrator honored the pause. Use this for supervised execution;
stop if there is uncertainty or competing administrative work.

## 1. Fresh dashboard verification and local identity record (NO database access)

Do this immediately before an authorized preflight, and repeat it immediately before
separately authorized migration execution. Do not create a record hours in advance.

1. Open the official Neon dashboard with your existing account. Select project
   fragrant-block-21191473. Check IDs, not just display names.
2. On branch main, verify branch ID br-silent-lab-arnl9ia9, database neondb,
   and that its primary/read-write compute is ep-young-dream-arkoh9e5.
   Copy/verify the full DIRECT endpoint hostname from the dashboard's connection
   details with pooling disabled. Copy only the hostname: no scheme, username,
   password, port, database path or query string. Do not derive it from DATABASE_URL.
   The actual regional/cell hostname must come from the dashboard, not an example.
3. On branch development, verify branch ID br-morning-heart-ar9vtw8o and compute
   ep-jolly-lake-ar7x7r37. Confirm Production and Development are distinct and both
   are in the project above.
4. Ensure no endpoint reassignment, branch restore/reset or related Neon administrative
   work will occur between this verification and the end of migration execution.
   If any such work occurs, abandon the record and repeat dashboard verification.
5. In a private interactive PowerShell window, run ONLY the local record helper:

```powershell
Set-Location "$env:LOCALAPPDATA\Temp\packard-fax-v3-phase1"
node .\maintenance\fax-v3-production\attest-identity.mjs --out "$env:LOCALAPPDATA\Temp\fax-v3-production-target.json"
```

Paste the full DIRECT hostname at the hostname-only prompt. After verifying each
statement in the dashboard, type MAIN, DEVELOPMENT, READ_WRITE, DISTINCT, and
NO_ADMIN_CHANGES at their respective prompts. These are explicit attestations,
not defaults. Any wrong answer aborts. The helper rejects redirected/noninteractive
input, never asks for a secret, and makes no network/SQL request. It writes only the
nonsecret record and prints DASHBOARD_ATTESTATION_RECORDED_NO_PREFLIGHT_RUN with its
UTC expiry. A failure is not authorization to reuse an earlier file.

The window begins when the hostname is entered and lasts at most 15 minutes.
Future, expired, malformed or longer windows fail closed. Every pinned ID, exact
confirmation and the full hostname are mandatory; extra fields are rejected.
The target.example.json file is deliberately invalid until a fresh review is done.
Do not hand-edit timestamps to refresh an old attestation. If approval/execution is
delayed, repeat the review and helper. Keep the record outside Git; it contains no
DATABASE_URL or credentials. It does not authorize SQL or migration execution.

**Stop here unless separately authorized to run Production preflight.**

## 2. Read-only Production preflight (NOT authorized now)

Once separately authorized, use a fresh record from step 1 and the existing approved
Production DATABASE_URL source. No Neon authentication or maintenance npm install is
required. Use the repository's normal locked Node dependencies (including pg).

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\maintenance\fax-v3-production\preflight-private.ps1 -TargetFile "$env:LOCALAPPDATA\Temp\fax-v3-production-target.json"
```

The wrapper prompts ONLY for Production DATABASE_URL with concealed SecureString
input, supplies it to the SQL child in memory, removes inherited Node debug/preload
options, and suppresses raw stderr. Never put the URL in command arguments, chat,
files, screenshots or a transcript. Parent/Vercel environment variables are not changed.
Use a trusted private machine; process memory is not protection from a debugger/admin.

Before opening SQL the tool validates the dashboard attestation and exact full host
against the private URL. Production endpoint is pinned; Development/Preview/unknown
targets and routing overrides are rejected. Only recognized URL options are accepted.
A pooler host is normalized solely for preflight; migrations require the direct host.
The database must be neondb in both URL and current_database(). The existing database
adapter enforces TLS certificate/hostname verification, unaffected by URL sslmode.

The preflight uses REPEATABLE READ READ ONLY, bounded query/lock timeouts, and ROLLBACK.
It checks the exact auth schema/catalog shape and foreign-key prerequisites, migration
001's expected checksum, absence of 002/003 and unexpected ledger entries, and absence
of the entire toolkit_rc_v3 namespace (even an empty conflicting schema fails).
It creates or changes no schema/data. Connecting may wake a suspended compute.
Attestation expiry is checked again before reporting success. The sanitized output
explicitly labels identityVerification as operator-dashboard-attestation; it does
not claim live API verification. No secret or credential fingerprint is output.

Use -Inspect on the SAME wrapper only for separately authorized, read-only commit
reconciliation. It verifies CLEAN, 002_COMMITTED or 002_003_COMMITTED schema/ledger
states; unexpected/nonempty v3 state fails closed and is never repaired automatically.
Reconciliation also requires a fresh dashboard record.

A successful preflight is NOT migration approval. The next stage has its own
explicit authorization and repeats preflight, including after taking the advisory lock.
Vercel Sensitive values cannot be read back by this workflow. A source copy does not
independently prove the currently injected Vercel snapshot; preserve approved secret
provenance. Do not rotate, unhide or export a variable just to perform verification.

## 3. Separate migration authorization and execution (NOT authorized now)

`apply.mjs` requires all exact arguments below, a future expiry no more than 15 minutes
away, a direct NON-POOLER connection, and the same verified target/configuration:

```text
node maintenance/fax-v3-production/apply.mjs --apply --production --target <reviewed-target.json> --authorize APPLY_002_003_TO_PRODUCTION --expires-at <explicit-UTC-ISO-expiry>
```

This is not a currently authorized command. Supply DATABASE_URL only through an
approved protected process/secret-manager launch, never inline values. The runner
requires the same dashboard-attested identity record. Perform a NEW dashboard review
and recreate the record immediately before this separately authorized execution.
The migration authorization expiry is independent of the attestation expiry; both
must remain valid before each migration and COMMIT. No earlier preflight report is trusted.
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
- Exit 1 / PRODUCTION_IDENTITY_VERIFICATION_FAILED_STOP_NO_DATABASE_CONNECTION:
  target/configuration, hostname or dashboard attestation is invalid, expired or
  unconfirmed. No SQL connection was opened. Recheck the dashboard; never edit
  timestamps alone to extend an old review. No API credential is accepted or needed.
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

## Validation and scope

Tests use synthetic dashboard attestations and fake SQL clients for Production
runner invocations. Optional real database suites remain Development-only and opt-in;
no Production check is a test. Tests cover identifier/hostname separation, strict URL
options, every confirmation, timestamp boundaries, expiry before commits, immutable
001/checksums, locking, ordered commits and ambiguous acknowledgements. Build checks
verify normal and opt-in browser artifacts without deploying or changing environments.

No old local CLI credential/profile is read, removed or revoked by this design.
Prior status checks found the dedicated local profile/keyring entry absent. Possible
remote OAuth grants are not treated as revoked, but absent local tokens with no
exposure evidence do not require support contact as a prerequisite to this workflow.

References:
- https://neon.com/docs/manage/endpoints/
- https://neon.com/docs/connect/connection-pooling
- https://vercel.com/docs/environment-variables/sensitive-environment-variables

## Offline identity diagnostics (NO connection, not Production preflight)

The earlier generic IDENTITY failure did not preserve which check rejected input.
The supplied c-4.us-west-2 direct hostname and synthetic URLs with sslmode=require
and channel_binding=require pass the existing rules. That does not prove the exact
operator input passed: its contents were neither retained nor inspected.

For diagnosis only, use the SAME concealed-input wrapper with -IdentityOnly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\maintenance\fax-v3-production\preflight-private.ps1 -TargetFile "$env:LOCALAPPDATA\Temp\fax-v3-production-target.json" -IdentityOnly
```

This selects identity-diagnostic.mjs, a separate entry with no SQL client, runner,
network or credential-service imports. It cannot perform preflight, authenticate
against SQL, check schema or apply a migration. -Inspect and -IdentityOnly together
are refused. Never omit -IdentityOnly when following these diagnostic instructions.

Output is a fixed-vocabulary JSON record. urlPolicy checks the original strict URL
policy independently, even when the attestation expired. preflightIdentity checks
attestation, environment, full hostname and database; migrationIdentity additionally
checks the direct/non-pooler rule when preflightIdentity passes. PASS means only
local validation passed; it proves neither working credentials nor live SQL state.
No raw input, hostname, path, query key/value, username, password or URL is printed.

Normal preflight identity failures retain the stop marker and append an
IDENTITY_REASON_* line. Reasons distinguish target schema/IDs/confirmations, invalid,
future or expired attestation, hostname/database/endpoint mismatch, malformed or
wrapped input, missing credential fields, forbidden port, duplicate/forbidden URL
parameters, invalid sslmode/channel_binding, and forbidden migration pooling.
Unexpected errors emit IDENTITY_CHECK_FAILED rather than raw exception text.

URL_COPY_FORMAT_INVALID can mean quotes, whitespace, a psql command, assignment,
or an unescaped fragment/backslash. Supply only the original URI, never a command
or surrounding quotes. No trimming, unquoting, parameter stripping or automatic
repair is performed. URL_PARAMETER_FORBIDDEN is intentionally generic: arbitrary
parameter names can themselves contain secrets. Do not remove a parameter blindly
or relax validation; review its intended purpose privately before any policy change.
Missing sslmode/channel_binding remains allowed because TLS is enforced by the SQL
adapter; unsupported supplied values still fail. The shared validator is unchanged.

If the record expired, repeat the dashboard review and record helper; never edit
an old timestamp. Run only the identity diagnostic and report its fixed output.
Stop before Production preflight regardless of diagnostic PASS.
