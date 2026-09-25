# Parallel Production acceptance plan: Fax Sender v2 + v3

Status: preparation only. No Production deployment, migration, environment change,
provider setting change, menu change or real fax is authorized by this document.
This supersedes the separate-project recommendation in fax-v3-shared-testing.md.
Released Fax Sender remains v2.16.0; v3.0.0 requires explicit final-cutover approval.

## Decision and boundaries

Parallel staging is feasible after the gates below pass. It is NOT an isolated
non-Production environment: both pages share an origin, Toolkit authentication,
Production database capacity, Vercel project and RingCentral account. A deployment
replaces the whole Toolkit artifact, so preserving v2 requires artifact/regression
checks and a recorded prior deployment, not merely a different route.

Keep /fax-sender/ and every existing v2 API, JWT variable and old RingCentral app
unchanged. v2 has no dependency on toolkit_rc_v3 or on v3 OAuth. The implementation
now removes v3's legacy-history deletion: opening v3 does not read, write, import or
delete packard.faxHistory.v1. This was a real blocker to sharing the production origin.
No v2 source, shared navigation, homepage, Entra auth source or migration SQL changed.

Same-origin isolation is application authorization, NOT a browser security boundary.
An XSS in any same-origin module would affect this boundary; a separate project/origin
would contain that risk better. Shared RC account/provider quotas and database/hosting
capacity can also affect availability. Two-employee acceptance is reasonable with
these understood constraints, but there is no guarantee of zero shared-service impact.
Toolkit auth currently permits active identities in its configured tenant, subject
to Entra tenant policy (including guests). The planned menu label is not a tester
allowlist. If access must be restricted to exactly two employees, separately authorize
and implement a server-enforced immutable-user allowlist before opening the menu.

## Repository / live configuration audit

Worktree: development/fax-v3-phase1, starting checkpoint f33ae15. origin/main and the
Vercel project's current production deployment were inspected: both identify
71251e5f28f12e85b78bc14c9d7ea3b63d4332d2. Existing project packardtoolkit uses main as
its production branch and the repository root. Node is 24.x; framework, buildCommand,
outputDirectory and installCommand are unset in the live project record. The later
staging deployment must explicitly use npm run build and output dist (review these
overrides with the existing deployment process; do not assume automatic detection). Branch automatic deployments remain
disabled for development/fax-v3-phase1 in vercel.json.

Read-only Vercel API inspection confirmed these PRODUCTION variable entries exist:

| Name | Audit result |
| --- | --- |
| RC_OAUTH_CLIENT_ID | Configured; provider validity not exercised |
| RC_OAUTH_CLIENT_SECRET | Configured as Sensitive; value not readable |
| RC_TOKEN_ENCRYPTION_KEY_V1 | Configured as Sensitive; value not readable |
| RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID | Configured; expected value verified |
| RC_ALLOWED_ACCOUNT_ID | Configured; expected Packard restriction verified |
| TOOLKIT_ORIGIN | Configured; expected production origin verified |
| DATABASE_URL | Configured as Sensitive; endpoint not independently verified in this audit |
| ENTRA_TENANT_ID | Configured |
| ENTRA_CLIENT_ID | Configured |
| ENTRA_CLIENT_SECRET | Configured as Sensitive; value not readable |
| RC_USER_JWT | Configured as Sensitive; unchanged |
| RC_CLIENT_ID / RC_CLIENT_SECRET | Configured as Sensitive; unchanged |
| FAX_V3_PRODUCTION_ACCEPTANCE | Not configured; new explicit staging switch |

Sensitive values are non-readable through Vercel's configuration API. Initial list
responses also contain ciphertext for ordinary encrypted values, so they are not
valid inputs for plaintext comparison. Separate documented read endpoints verified
the non-secret restriction/origin/key-ID values. No sensitive values were displayed,
written to disk or changed. Production-vs-Development key inequality is NOT confirmed;
it remains a mandatory pre-staging gate. No Production DB connection was opened.
Production migration status is operator-reported, not independently queried here.

Before deployment, verify key inequality privately using the original approved key
provenance or a separately authorized in-environment verifier returning only PASS/FAIL.
Do not export sensitive variables, publish key hashes, or paste keys into chat. Verify
Production DATABASE_URL against the pinned endpoint in the guarded runtime and a
read-only ledger/schema preflight. Presence does not prove usable secrets, correct
OAuth app credentials, deployment-snapshot values, or database/schema permissions.
Never copy Development keys, connections, OAuth transactions, tokens or history.

## Exact database effects

002_ringcentral_v3.sql creates schema toolkit_rc_v3 and four initially empty tables:

- identities: environment + RC account + extension primary key; immutable Toolkit
  user foreign key. Identity ownership survives disconnect; no automatic transfers.
- connections: one row per environment/Toolkit user, encrypted token envelope,
  connection generation/state, expiration and refresh coordination. Composite
  foreign keys bind a connection to the identity owner. Connected/refreshing states
  require token/identity/expiry fields; refresh state and claim/deadline agree.
- oauth_transactions: hashed state/browser binding, user + session foreign keys,
  connection/generation, encrypted PKCE verifier, redirect, expiry and consumed time.
  Adds an expiration index. No plaintext provider tokens or browser credentials.
- fax_attempts: owner/connection/environment/RC identity, unique employee idempotency
  keys and unique provider message identity, request hash, status, encrypted metadata,
  timestamps/tracking deadline; newest-user-history index.

003_fax_v3_operations.sql alters ONLY the newly created fax_attempts table. It adds
nullable connection_generation bigint, retry_of uuid, provider_status text with a
five-value check, UNIQUE(id,user_id,environment), owner-bound retry foreign key and
UNIQUE(retry_of). One definitive failed attempt can have only one retry child. Null
retry_of permits unrelated new attempts. Connection generation and retry legality
are also enforced by server code; SQL is not the sole authorization layer.

Neither SQL file drops/renames tables or columns, updates existing rows, changes
001 auth columns, imports data, or installs triggers modifying auth behavior. 003
has no data backfill/default. 002 references existing auth users/sessions and so
adds referential constraints: future DELETE of referenced users/sessions is blocked,
not cascaded. Existing login/session/logout code remains unchanged. Logout revokes
sessions rather than deleting them. Maintenance cleanup MUST remove eligible expired
RC OAuth transactions before deleting their referenced expired auth sessions, or
exclude those references. Retain identity ownership and audit history; do not delete
users merely to reassign an extension. Reassignment requires a separate reviewed
administrative workflow. These are operational effects despite additive SQL.

DDL takes locks, including locks related to referenced auth tables. Run in a quiet
window with bounded lock/statement timeouts; on contention abort and reschedule.
003 constraints scan its v3 table; on a fresh Production installation it is empty.
No existing business data is rewritten. A preflight must verify the new schema is
absent and 002/003 ledger entries absent. Unexpected pre-existing v3 tables/rows or
ledger mismatch mean STOP; never truncate them to achieve an empty history.

SQL is NOT standalone idempotent (CREATE SCHEMA/ADD COLUMN will fail on repetition).
The runners provide transaction + advisory lock 731942015 + normalized SHA-256 ledger
checks. 002 requires the exact known 001 ledger checksum, executes only 002 and records
only 002. 003 checks 002's checksum, executes only 003 and records only 003. Matching
ledger is a no-op; mismatch fails; success is logged after COMMIT. Neither reads or
executes 001 SQL as a migration. A lost COMMIT acknowledgement requires read-only
ledger reconciliation; never assume failure means no commit happened.

Neither migration SQL needs modification for fresh Production staging. Preserve its
applied Development checksum, including the historical Development comment in 003.
Both EXISTING runners intentionally reject Production. Do not repurpose --development,
spoof VERCEL_ENV, relax the migration guard, or use the 001 migration runner. The separate Production runner is prepared
in
[maintenance/fax-v3-production](../maintenance/fax-v3-production/README.md), but has
NOT been executed. Follow that operator guide: fresh dashboard identity attestation,
then separately authorized read-only preflight, then separate migration approval.
It verifies pinned Production/Development identifiers and the complete dashboard
hostname against the private URL, with a 15-minute human-attestation window. It does
not use Neon CLI/API authentication. The human review replaces automatic live
control-plane verification; endpoint reassignment remains an explicit review risk.
SQL/catalog/ledger checks, authorization expiry, direct-session advisory locking,
checksums and immutable 001 remain enforced. Migration 002 and 003 each have their
OWN transaction and post-commit verification; 002 may remain committed if 003 fails.
An ambiguous COMMIT is never automatically retried. This supersedes the earlier
proposal for a single transaction spanning both migrations.

After rollback of an uncommitted transaction, no DDL/ledger changes remain. After a
successful commit, application rollback should LEAVE the additive schema and ledger
in place. Dropping it would destroy tokens, history, retry/idempotency records and
identity reservations. Restore a database backup only under a separate incident plan:
whole-database restore would rewind unrelated Toolkit authentication too.

## Stageable code prepared

- server/ringcentral-v3/runtime.js validates canonical environment/origin, fixed Packard
  account, required OAuth/key configuration, Neon URL and exact Production endpoint.
  Production additionally requires VERCEL=1, VERCEL_ENV=production and the exact switch
  FAX_V3_PRODUCTION_ACCEPTANCE=enabled. Preview, wrong endpoint/origin/account, missing
  keys and disabled/missing switch fail closed. Development still rejects Production DB.
- Both real v3 fax and RC handlers use this runtime gate. Injected test dependencies
  do not exist in HTTP input. Ownership, CSRF, session/context checks, encryption,
  OAuth binding, durable idempotency and Unknown handling are unchanged.
- With the switch enabled and runtime config validated, the normal build copies only
  the five candidate page/assets to dist/fax-sender-v3/. Without it, the normal build
  excludes v3. No server configuration enters browser assets. No migration is built in.
- Enabled Production OAuth callback returns to the fixed /fax-sender-v3/ success/fail
  destination, ignoring request return URLs; connection is confirmed server-side.
- v3 send/receipt functions receive 60-second limits; status 30 seconds. v2 limits
  and APIs remain unchanged. The switch is a deployment environment snapshot: editing
  a Vercel variable alone does NOT disable an already-running deployment.
- Removed v3 legacy history deletion and added browser proof of preservation through
  reload, sending mocks, Clear All and employee/session changes.

Runtime safety does not compare a Production key against an inaccessible Development
key; that is a separate mandatory provenance/verification gate described above.

## Provider callbacks / menu

RingCentral: https://packardtoolkit.vercel.app/api/ringcentral/callback is sufficient
for both the initial connect and callback; /fax-sender-v3/ is a post-callback page,
not another provider redirect URI. The operator reports this callback is already
registered on the NEW v3 app. Registration was not independently read from RingCentral.
Keep the old JWT app and localhost v3 callback. Both employees must be permitted to
use the v3 OAuth app and its required Faxes, ReadMessages, Contacts and ReadAccounts
scopes. Do not exchange a real authorization code or send a fax during preparation.

Microsoft: https://packardtoolkit.vercel.app/api/auth/callback is already the callback
constructed by the existing Production Web-auth code. Another page on the same origin
needs no new Entra redirect or SPA/CORS origin. Keep Email Sender's separate
/auth/callback unchanged. Provider registration was not independently read from Entra.
Toolkit login currently returns home; during acceptance the temporary menu gives a
path back to v3. No auth return-url behavior is changed.

Later-only shared menu edit: retain "Fax Sender" -> /fax-sender/ and add
"Fax Sender v3 - Testing" -> /fax-sender-v3/ immediately alongside it. Use an em dash
in the displayed label if preferred. No homepage change; no released version bump.
No menu implementation has been made in this checkpoint.

## Two-employee acceptance without new real faxes

1. Separate computers/profiles: A and B sign into Toolkit as themselves and connect
   fresh Production RC extensions A/B. Verify each name/extension and Packard account
   827653020. The immutable (Entra tid,oid) resolves to Toolkit user ID; browser user
   IDs are not accepted. Confirm one extension cannot be claimed by both Toolkit users
   using synthetic DB tests; avoid disrupting a real existing extension to test this.
2. In parallel load/search each personal address book; use unique harmless known
   contacts to distinguish ownership. Entries deliberately present in both address
   books are not evidence of leakage. Confirm manual destination/Last 4/PDF queues
   stay in their own browser. Do not click Send.
3. Both Production histories MUST initially be empty; no Development or v2 import.
   Empty history alone cannot prove row ownership. Run automated synthetic A/B DB
   tests covering foreign and nonexistent fax IDs (same safe 404 for valid contexts),
   status/message/receipt owner checks and zero provider work on foreign IDs.
4. In each authenticated Production profile, get its OWN /api/fax-v3/context and use
   that context with status/message/receipt requests for a random UUID: safe 404,
   no metadata/PDF. Missing session -> 401; stale/foreign context -> safe rejection.
   If existing legitimate Production v3 records later exist, exchange only app faxIds
   and repeat A->B/B->A requests using each caller's own cookie/context. No provider
   IDs, copied cookies, fabricated real attempts, or newly sent faxes are necessary.
   Record the foreign-existing-row Production test as pending while both histories
   are empty; synthetic integration coverage is the evidence meanwhile.
5. Disconnect A: A workspace/contacts/files clear, B remains usable. Reconnect A:
   A identity restored, B unchanged. Reverse. Ownership ledger survives disconnect.
6. Simultaneously search contacts/select harmless PDFs/change Last 4/Clear All without
   sending. Logout A and sign in as B in the same profile; no A files/contacts/history
   may return from old requests, on focus, reload or tab restoration. Test session
   expiry/revocation. B's separate session is unaffected. Toolkit logout keeps RC's
   persistent connection but requires a new valid Toolkit session for further use.
7. Open v2 before/after: same route/menu, contacts/manual workflow, PDF composer and
   legacy history remain intact. Clear All on v3 must not affect either history.
   Do not send extra real faxes merely for regression. If v3 ever shows Unknown,
   review RingCentral manually and never automatically resend it through either v3
   OR v2; reverting the UI does not undo provider transmission.

## Fallback and ordered actions requiring later approval

1. Review this checkpoint and resolve missing key-inequality, Production DB/ledger,
   provider-registration and any tester-access policy verification. Record the exact
   known-good production deployment ID and origin/main SHA; ensure Neon recovery is
   available. Read-only snapshot/ledger review only at this step.
2. Prepare/review/test the separate bounded Production migration runner described
   above. Ensure auth-session cleanup accounts for RC OAuth foreign keys. Reconfirm
   001 checksum; v3 schema/ledger absent; zero history/import. Authorize migrations
   separately from deployment. Do not use ordinary Preview with Production data.
3. In an approved quiet window execute 002+003 transactionally against the verified
   Production endpoint. Reconcile checksums/empty row counts read-only after COMMIT.
   Stop on contention, unexpected existing state or mismatch. v2 stays live throughout.
4. Authorize the exact temporary shared-menu diff separately. Revalidate all Toolkit
   modules and v2 artifact, preserving the five unrelated workspace modifications.
5. Authorize Production-only FAX_V3_PRODUCTION_ACCEPTANCE=enabled, then an explicit
   production build/deployment of the reviewed candidate on the existing project.
   Do not merge main or remove the development branch deployment block implicitly.
   A later deployment authorization must identify the commit and target explicitly.
   Explicitly use npm run build and dist output; verify function-count/duration quotas
   for the project plan before proceeding. Verify page/API no-store handling, provider callbacks, main v2 assets and environment
   snapshot before opening the candidate menu. Existing required secrets stay managed
   in Vercel. No automatic migrations, Development data imports or JWT changes.
6. Run the two-employee plan above. Inspect safe status/error diagnostics, not tokens,
   PDFs or callback query strings. No automatic fax. Record remaining empty-history
   authorization limitation explicitly. Final cutover/version 3.0.0 is a new decision.
7. On trouble: stop new v3 work; preserve Unknown records and reconcile in RingCentral.
   Roll back the WHOLE application alias to the recorded good deployment (restores v2
   menu/build and removes candidate endpoints). Alternatively deploy reviewed code
   with the acceptance switch disabled and candidate menu removed. Variable edits
   alone are not an immediate kill switch. Leave v3 tables/ledger/keys for recovery;
   do not revoke/delete the old JWT, drop schemas or replay outstanding sends.

Large receipt caveat: Vercel documents a 4.5 MB function payload ceiling, while the v3
provider accepts PDFs up to 10 MiB. A receipt above the hosting ceiling may not download
through this API despite Sent remaining correct. Use RingCentral directly for such
receipts during acceptance; solving larger receipt delivery needs a separately reviewed
transport change, never exposing tokens/provider media URLs. The 4 MB send upload is
below the ceiling with its bounded multipart envelope. This is an existing hosting
limitation, not an ownership bypass and not a reason to resend.

## Sources

- https://vercel.com/docs/environment-variables/sensitive-environment-variables
- https://vercel.com/docs/rest-api/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id
- https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
- https://developers.ringcentral.com/guide/authentication/auth-code-flow
- https://www.postgresql.org/docs/17/sql-altertable.html
- https://vercel.com/docs/functions/limitations

## Local validation and checkpoint note

228 regression checks passed (3 opt-in DB suites skipped there); all 23 Development
DB checks then passed separately. Desktop/mobile browser checks passed, now explicitly
seeding v2 legacy history and confirming preservation. A separate build test passed:
ordinary build has 49 files; opt-in adds exactly five candidate assets and leaves EVERY
existing output byte-for-byte unchanged; disabling returns to the identical ordinary
artifact. All provider calls in tests are mocked. Production build and source/browser
secret scans passed: 181 source files, 49 normal output files, four configured secret
values checked in memory, zero findings. Sensitive Production values were unavailable
for direct value scans; no Production secret was exported. Final diff inspected.

Unmodified normalized migration SHA-256 values:

- 001: d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605
- 002: 18c3b3e91394d0d14f859ddc8e15873d6eec1fd7bd5ef5bccf9fb00fd06c598b
- 003: f6a40bf340ec6d81a34fb7a4cd9035ddf6835bb7ce3c048694524e7ca0a9250e

Copyable checkpoint note: Fax Sender v2.16.0 remains released. Prepared opt-in
parallel v3 Production acceptance, preserved v2 browser history, and documented
migration, configuration, employee-isolation and fallback gates. Nothing deployed.
