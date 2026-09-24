# Fax Sender v3: isolated Phase 1

This is backend infrastructure only. Fax Sender v2.16.0, its APIs, JWT credentials,
localStorage history, homepage/navigation and shared Entra authentication are unchanged.
No existing tracked source file is modified. No version bump is made.

## Parallel structure

- `server/ringcentral-v3/`: config, encryption, provider, SQL store, service, handlers.
- `/api/ringcentral/connect` (POST), `/callback` (GET), `/connection` (GET), `/disconnect` (POST).
- `migrations/002_ringcentral_v3.sql`: separate RC schema; 001 remains immutable.
- `scripts/migrate-rc-v3.mjs`: explicit Development-only migration runner.
- `vite.rc-v3.config.js`: opt-in local backend harness, not used by normal builds.
- `development/fax-sender-v3/`: minimal connection-test HTML/JS, exposed only by
  the opt-in Development harness at `/fax-sender-v3/`; absent from production output.
- Phase 2 reserves `/api/fax-v3/*`. No fax operations or employee navigation links
  are implemented. The test page is only for sign-in/connection/disconnection.

OAuth callback in the opt-in Development harness redirects to `/fax-sender-v3/`
with a fixed success/failure flag. The page verifies success through the authenticated
connection endpoint; URL flags cannot establish connected state. Outside this harness,
the callback still redirects to `/api/ringcentral/connection`. That endpoint returns
only state and (when connected) verified display name, account ID and extension ID.
No endpoint accepts client-supplied Toolkit user, account, extension or token values.

Open `http://localhost:5173/fax-sender-v3/` for the first real OAuth test. Sign in with
the existing Microsoft link if needed; Entra returns to the home page, so reopen this
direct URL afterward. Click Connect RingCentral, use your own Packard RC login and
consent, then verify account ID `827653020` and your own extension ID. Click Disconnect
and verify disconnected state; reconnect to test the full cycle. Account and extension
IDs identify different resources even when their numeric values happen to match.
Toolkit sign-out is separate from provider disconnect. No local/session storage is
used. Error text is fixed, identities use textContent, and focus/visibility refreshes
discard previous responses and clear identity details. No fax/contact/history APIs
are called. No tokens or private PKCE verifiers are returned to the page.
The test document uses `Referrer-Policy: same-origin` (header and meta), so native
Connect POST requests retain the origin required by the unchanged CSRF check.
`no-referrer` on this document would make the native POST origin opaque and fail
before any OAuth transaction is created. Cross-origin referrers remain suppressed;
the OAuth endpoints themselves retain `no-referrer` for redirects/callbacks.

## Security and lifecycle

Every HTTP operation requires `requireToolkitUser`. POST operations require exact
origin and same-origin fetch metadata. OAuth transactions are single-use, ten-minute,
session/user/browser-bound records. Separate binding cookies prevent collisions with
Entra login. The verifier is AES-GCM encrypted in the RC transaction table, erased on
consumption, and never sent to the browser. State/browser values are stored as hashes.
Expired transaction rows remain unusable; scheduled cleanup is not implemented here.

Production and Development origins are fixed. Preview fails closed. New RC variables
are read server-side only; the old `RC_USER_JWT` is not read by any new module.
Account and extension identity are obtained from fixed RingCentral API paths and
canonical identity URIs, including token owner ID when supplied. Account restrictions
are checked before installation and token use. A disabled/non-user extension is refused.
Actual fax entitlement is still a Phase 2 acceptance check; no fax is sent in Phase 1.

One connection row per environment/user is enforced in PostgreSQL. An identity ledger
reserves each account/extension for its first Toolkit owner even after disconnect.
There is no automatic ownership transfer; extension reassignment needs a separately
reviewed administrative procedure. A reconnect can claim a new unused extension for
the same employee; previous fax rows retain their original identity.

AES-256-GCM envelopes contain version, key ID, random 96-bit IV, 128-bit tag and
ciphertext. Token AAD includes purpose, environment, Toolkit owner, connection UUID,
RC account/extension and envelope key/version. PKCE uses separate transaction AAD.
Keys are canonical base64-encoded 32-byte values. Read keys can include v1/v2/etc.;
only the configured active key is used for new writes. Old envelopes remain readable
until rewritten during refresh/reconnection. Do not remove decrypt-only keys while
live or revocation-pending envelopes still reference them. Missing/tampered keys
disable authorization rather than falling back to plaintext or JWT.

Refresh is demand-driven. An atomic database claim changes `connected` to `refreshing`
for 20 seconds before the network request. Other instances wait briefly or fail safely.
Successful refresh replaces the entire encrypted pair and increments the generation
only if claim/generation/deadline still match. Provider request timeout is ten seconds.
There is no open database transaction while waiting on RingCentral. Worker death,
expired claims, network uncertainty and rejected refreshes require reconnection;
old refresh tokens are never retried automatically. Provider grace periods are not used.

Disconnect during an active refresh returns unavailable; retry after the bounded
refresh completes/expires. Disconnect then advances the generation and enters
`disconnecting` before provider revocation. A failed revocation retains encrypted tokens
only for another disconnect attempt; refresh/use/connect are disabled. Successful
revocation deletes tokens. A missing encryption key must be restored before revocation.
No force-forget bypass is exposed. OAuth transactions started earlier are fenced out.
Reconnect from connected/needs_reconnect requires completing disconnect first.

Toolkit logout does not delete a persistent RC connection. Every subsequent HTTP request
still needs a valid Toolkit session. Phase 2 must clear client state on session changes,
bind operation contexts to user/session/connection generation, and recheck authorization
before sending. Internal `accessToken(userId)` is server-only and must only be used after
the future endpoint authenticates the request and verifies fax ownership. Phase 1 exposes
no token endpoint, send route, history route or receipt route.

The fax table reserves immutable ownership/idempotency infrastructure, not a working fax
workflow. Foreign keys bind owner+connection+environment and owner+RC identity. The later
send service must derive all IDs from authenticated server records and enforce state
transitions. Metadata envelopes are reserved for encrypted history details; PDFs and
cover comments are not stored. Latest-20 history, retention and legacy handling remain
Phase 2 work. The v2 localStorage key is deliberately untouched.

## Development setup

Use only a confirmed Development `.env.local`, never Production secrets. Required:
existing Toolkit/Entra Development variables plus `RC_OAUTH_CLIENT_ID`,
`RC_OAUTH_CLIENT_SECRET`, `RC_ALLOWED_ACCOUNT_ID=827653020`,
`RC_TOKEN_ENCRYPTION_KEY_V1` and `RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=v1`.
Do not use Preview: it is intentionally unconfigured and may have a Production DB URL.

From this clean worktree, with Node's `--env-file` pointing to that Development file:

```powershell
node --env-file="C:\Users\staff\Desktop\VS Code Projects\Packard Toolkit\.env.local" scripts/migrate-rc-v3.mjs --apply --development
node --env-file="C:\Users\staff\Desktop\VS Code Projects\Packard Toolkit\.env.local" node_modules/vite/bin/vite.js --config vite.rc-v3.config.js
```

The migration runner rejects the known Production endpoint (pooled and direct),
non-Neon/unsupported URL options, wrong origin and non-Development Vercel environments
before opening a connection. It requires the existing 001 ledger checksum; it never
creates/reapplies 001. If the Development database lacks that ledger, stop and plan its
foundation setup separately. Do not point this runner at Production. There is no
Production migration mode or maintenance deployment for 002.

002 uses a transaction, the existing migration advisory lock, and a checksum ledger.
A repeat matching migration is a no-op; changed SQL is refused. Success is logged only
after COMMIT. No migration runs in any application build or API handler.

For opt-in integration tests, validate Development first, then set `RC_V3_DB_TEST=1`
only in the test child process and run `tests/rc-v3-db.test.js`. Tests clone 001 and 002
into random disposable schemas, use synthetic users/tokens and mocked RingCentral,
and remove their schemas in `finally`. They never touch persistent Toolkit rows.

Before Phase 2: confirm real OAuth credentials in the local Development runtime,
exercise real consent/identity with two employee extensions, decide history retention,
and approve the future connection UI/parallel page. Real OAuth was not exercised by
the automated tests. No live fax or contact operation was performed. Production
migration, deployment, promotion and v2 retirement require separate authorization.
