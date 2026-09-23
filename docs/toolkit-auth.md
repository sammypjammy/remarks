# Shared Toolkit authentication

This foundation does not require sign-in for existing tools. Fax Sender remains on its
shared RingCentral JWT; Fax History is unchanged. Email Sender retains its separate
MSAL Browser/Graph authorization and `/auth/callback`. Signing out of Toolkit does
not sign out of Microsoft or revoke Email Sender's Graph authorization.

## Configuration

Server-only variables: `DATABASE_URL`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
`ENTRA_CLIENT_SECRET`, `TOOLKIT_ORIGIN`. Never use a `VITE_` prefix. The root
`.env.local` is gitignored and loaded by the development server. The development
server uses port 5173 and fails if that port is unavailable rather than changing
the registered redirect silently.

- Development origin: `http://localhost:5173`
- Production origin: `https://packardtoolkit.vercel.app`
- Web redirect: the exact origin plus `/api/auth/callback`
- Existing Email Sender redirect: `/auth/callback`, unchanged

Whole-tenant access is intentional: Assignment required remains No. Only a verified
interactive Entra identity in the configured tenant can create a Toolkit user. There
is no email-domain heuristic, employee allowlist, or app-role requirement. This also
means tenant guest users able to authenticate to this application are governed by
the firm's Entra tenant policy. Existing inactive users are never reactivated by login.

## Migration and deployment

Requires Node 22+ (development verified on Node 24) and `npm ci`.

Review `migrations/001_toolkit_auth.sql` before applying. It creates a separate
`toolkit_auth` schema, three application tables, indexes, and a migration ledger
managed by the runner. No RingCentral token/connection tables are created. No reset
or destructive migration is provided. The runner uses an advisory transaction lock,
checksums, and an atomic transaction; repeat runs do nothing if already applied.

Development, with the development Neon branch in the gitignored root file:

```powershell
node --env-file=.env.local scripts/migrate-auth.mjs --apply
npm run dev
```

Production target verification and migration 001 are complete, confirmed by the
operator's successful staged Production builds. Do not run or redeploy the
migration again for this release. Maintenance sources remain for audit and tests;
they are not application deployment entry points. Build/API requests never migrate
automatically. The actual authentication application deployment is still pending.

Deploy the repository's normal root configuration and build, never a maintenance
package or maintenance deployment. Do not promote a maintenance artifact. Keep
all five Production variables configured; no additional credential or provider is
required. Development continues to use its separate Neon branch through the
gitignored root .env.local. Never pull Production credentials into that file.
Rotate the existing Entra client secret before its expiry.

After deployment, manually sign in with two real firm users, verify the displayed
identity for each, sign out, and confirm protected session requests stop resolving.
The automated tests never sign in as a real employee or send a fax.

## Protocol and storage

`GET /api/auth/login` creates a 10-minute transaction with SHA-256 state, nonce,
and browser-binding hashes plus an S256 PKCE verifier. The verifier is transient
server-side database data, cleared atomically on consumption; it is not a long-lived
provider token. Keep the database private to the server and use TLS (certificate
verification is enforced by the PostgreSQL driver configuration).

The transaction is bound to a random HttpOnly cookie and the exact configured
callback. One atomic update consumes it across Vercel instances. Starting a new
login in the same browser supersedes the older binding. No return URL from a request
is trusted; success redirects to the configured home page and failure to a fixed
generic error marker. Only protocol-required parameters travel through the browser.

The callback exchanges the code with the confidential client secret and PKCE verifier.
`jose` verifies RS256 signature against Microsoft's tenant JWKS, exact issuer and
audience, token expiry/not-before, required identity claims, tenant and nonce. Identity
uses the `(tid, oid)` pair. Display names are length-limited, stripped of control
characters and rendered with `textContent`. Microsoft tokens are discarded after
verification. No access/refresh/ID token is stored in the database or session cookie.

A new random 256-bit session token is issued on success; only its SHA-256 hash is
stored. The prior presented session is revoked in the same transaction as user
resolution/session creation. Sessions expire absolutely after eight hours, without
sliding renewal. Session checks consult both the database record and current user
active status. Microsoft account revocation is not continuously synchronized;
Toolkit active status/session revocation provides immediate local offboarding,
and the next login rechecks Entra.

Production cookies use `__Host-` names, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`,
no Domain, and bounded Max-Age. Localhost alone permits non-Secure cookies with
different names. `POST /api/auth/logout` requires the exact Origin and rejects
cross-site Fetch Metadata; it revokes the session and clears both cookies. It is
idempotent. GET cannot sign out. Toolkit sign-in rejects cross-site initiation.

`GET /api/auth/session` returns only `{authenticated:true,user:{displayName}}`, or
a safe 401/403/503 response. All authentication responses use `Cache-Control: no-store`
and `Referrer-Policy: no-referrer`. Errors are generic; upstream errors and credentials
are never logged. Keep hosting/log-drain/analytics configuration from capturing OAuth
callback query strings. Auth routes have no application analytics.

## Future protected endpoints

```js
import { requireToolkitUser } from '../../server/auth/service.js';

// Inside a handler with safe error handling:
const user = await requireToolkitUser(req);
// user.id is the immutable internal owner key; never accept one from the browser.
```

Missing, invalid, expired and revoked sessions throw status 401. Inactive users or
a tenant mismatch throw 403. Database/configuration failures should produce a generic
503, never fallback credentials. The helper returns internal ID, immutable Entra
identity, and display name for server use; do not forward the object wholesale.
Future state-changing endpoints must also enforce same-origin/CSRF protection.

`oauth_transactions` includes nullable user/session ownership for future account
connections. Future RingCentral implementation must validate both against the current
session, encrypt long-lived provider tokens, and add its own ownership schema. None
of that is implemented by this foundation.

## Operations

Offboarding: set `toolkit_auth.users.active=false` for the employee's immutable
identity and revoke their sessions. Neither operation deletes the employee history.
Do not grant browser/public database access. Use a runtime role limited to the auth
tables and a migration role with schema privileges when separating credentials.

Periodically run this reviewed maintenance SQL with server credentials (no scheduler
has been deployed). It deletes only expired authentication records:

```sql
BEGIN;
DELETE FROM toolkit_auth.oauth_transactions WHERE expires_at <= now();
DELETE FROM toolkit_auth.sessions s WHERE s.expires_at <= now()
  AND NOT EXISTS (SELECT 1 FROM toolkit_auth.oauth_transactions t WHERE t.session_hash = s.token_hash);
COMMIT;
```

## Validation

```powershell
npm run test:auth
npm run test:auth:db
node --test --test-concurrency=1 tests/*.test.js intake-checker/*.test.js
npm run build
node tests/toolkit-auth-browser-check.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
node tests/navigation-browser-check.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
git diff --check
```

The database test requires development configuration. It creates and removes only
its own random synthetic schema; it does not alter real auth users or sessions.
Browser auth checks use synthetic session responses and test both 1280px and 390px.
Run browser suites sequentially to avoid shared clipboard/Vite cache interference.

Protocol references:
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
- https://github.com/panva/jose
- https://node-postgres.com/features/transactions
- https://node-postgres.com/features/ssl
