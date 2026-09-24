# Fax Sender v3 UI polish and shared testing preparation

Superseded by [parallel Production staging](fax-v3-production-staging.md). Retained
as historical analysis; the separate-project recommendation is no longer current.

Status: local Development only. No deployment or production migration authorized.
Fax Sender remains v2.16.0; no normal release-history entry or v3 navigation link.
Phase 2 real acceptance is recorded as passed by the operator (single and sequential
three-PDF sends, both cover options, contacts, polling, receipts and persistent history).
No further real fax is required for this phase.

## UI comparison

Preserved the v3 personal connection, server history, ownership checks, frozen batch
settings, conservative retries, polling and receipt implementations. Restored v2's
clear-destination action, PDF count, cover-comment hiding when OFF, explanatory
file-add/order and comment guidance. Reordering/removal now retains keyboard focus.
Styled the isolated page using the shared shell's light palette, typography, panels,
button sizing and mobile stacking without importing employee navigation. Connection
identity remains visible. Sent/Unknown warnings remain explicit. v2 sources/APIs,
JWT, browser credentials and localStorage history were not imported or changed.
The existing v3 legacy-history deletion behavior is unchanged.

## Architecture recommendation and evidence

Use a NEW Vercel project, proposed name `packard-toolkit-fax-test`, with a stable
project domain `https://packard-toolkit-fax-test.vercel.app`. This is a proposed
hostname, NOT provisioned or verified available. If Vercel assigns a different name,
use that exact origin consistently in all the configuration below.

Repository evidence: normal vite.config.js excludes the page; vite.rc-v3.config.js
serves it only locally. server/ringcentral-v3/config.js fixes Development to localhost;
server/fax-v3/handler.js rejects non-Development; scripts/rc-v3-development-guard.mjs
rejects the known production Neon endpoint ep-young-dream-arkoh9e5 (including pooler).
Toolkit auth already supports exact HTTPS origins and secure host-only cookies.
The local Vercel repository association is to project packardtoolkit. Live dashboard
variables, plan, integrations, deployment protection and automatic Git deployments
could not be inspected with available account tools. Treat ordinary Preview as unsafe.

Vercel Development is for local work; it is not a hosted Development deployment.
A custom environment in the existing project could work, but adds plan/environment
inheritance and domain-routing checks in the production project. A separate project
provides the clearest boundary with no inherited production resources or aliases.
Its Vercel `production` deployment target is only a hosting label: application data
must explicitly remain Development. Do NOT spoof VERCEL_ENV=development.

## Operator setup (preparation only; do not deploy this checkpoint)

1. Reserve the proposed test hostname in a separate project when deployment is
   authorized. Do not import/deploy through Vercel's automatic creation flow now.
   Do not attach the production domain, production Neon integration, or shared team
   environment variables. Disable automatic Git deployments until the isolation
   configuration and artifact are reviewed. Keep the existing project unchanged.
2. Use branch development/fax-v3-phase1 only. A later reviewed opt-in test build must
   include only the fax page/assets, an auth landing page and auth/RC/v3 APIs; exclude
   v2 pages/APIs and unrelated tools. Normal builds must continue excluding v3.
   Give send a 60-second function duration and status/receipt suitable bounded
   durations. No build command may run migrations.
3. Before hosting, implement and test an explicit shared-test mode pinned to the new
   Vercel project ID, exact HTTPS origin and exact verified Development Neon endpoint.
   Keep logical RC storage environment `development`; use Secure __Host- cookies
   over HTTPS. Keep localhost and production guards intact. Reject ordinary Preview,
   wrong project/origin/database and missing settings. Runtime validation must NOT
   reuse or relax the localhost migration guard. Migrations stay localhost-only.
   Existing handler/config/build are intentionally unchanged in this checkpoint;
   setting Vercel variables alone will NOT make this code remotely runnable.
4. Add server-only variables in the NEW project's chosen hosting target:
   DATABASE_URL from the existing Development Neon branch; TOOLKIT_ORIGIN equal to
   the exact test origin; ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET from
   the approved Toolkit Development configuration; RC_OAUTH_CLIENT_ID and
   RC_OAUTH_CLIENT_SECRET from the individual-user v3 OAuth app;
   RC_ALLOWED_ACCOUNT_ID=827653020; RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=v1 and
   RC_TOKEN_ENCRYPTION_KEY_V1 from the existing NON-PRODUCTION Development key ring.
   Preserve all Development decrypt keys if encrypted rows exist. A new unrelated
   key cannot decrypt existing Development connections. Never copy Production keys,
   RC_USER_JWT, production database credentials, or VITE_-prefixed secrets.
   Verify endpoint identity and key provenance privately in Vercel/Neon; never paste
   secrets into chat or commit environment files. No migrations 002/003 are needed:
   they are already applied to Development. Read-only ledger verification suffices.
5. On the v3 RingCentral OAuth app ONLY, add this exact additional redirect URI:
   `https://packard-toolkit-fax-test.vercel.app/api/ringcentral/callback`
   Keep the localhost redirect. Do not change the old JWT app. Do not assume wildcard
   callbacks. The future hosted callback should redirect to the fixed fax page;
   currently only the local harness sets developmentTestPage=true.
6. On the Toolkit Entra registration matching ENTRA_CLIENT_ID, Authentication >
   Web > Redirect URIs: add
   `https://packard-toolkit-fax-test.vercel.app/api/auth/callback`
   Keep all existing redirects. This is confidential server Web auth, not SPA auth;
   no new SPA origin, CORS wildcard, implicit grant or Email Sender /auth/callback
   is needed. Keep tenant restrictions and employee assignment policy. Provide a
   test landing page after Microsoft login with a direct return-to-fax link.
7. If deployment protection is enabled, grant BOTH testers access and verify both
   provider redirects pass it. Do not put protection bypass tokens into callbacks.
   Keep callbacks out of analytics/query-string logging. After a separately reviewed
   deployment, use ONLY the explicit test URL:
   `https://packard-toolkit-fax-test.vercel.app/fax-sender-v3/`.

Isolation depends on separate project/environment credentials, exact database pinning,
non-Production encryption keys, scoped build/API allowlist and host-only sessions.
A test domain alone is insufficient. Existing production aliases, main, v2 and
production migrations remain untouched. No shared testing is possible until the
listed hosted-mode implementation and configuration checks are completed.

## Two-employee acceptance (no real sends)

Use separate computers/browser profiles. Do not share cookies or context headers.
Use only harmless test contact data. Record pass/fail and safe IDs, never tokens.

1. A signs into Toolkit as A, connects RC extension A; B independently signs in and
   connects extension B. Verify each displayed name/extension and account 827653020.
   Both remain signed in concurrently. A/B must not claim the same extension.
2. Refresh contacts and search known personal entries. A sees only A's address book,
   B only B's; shared contacts intentionally present in both books are not a failure.
   Search each other's unique harmless test entry. Manual-number and Clear All work.
3. Check history and refresh both pages. Each sees only their own attempts. Empty
   histories alone do not prove ownership: pair this with the database isolation
   suite using synthetic A/B records and mocked provider calls. Use existing owned
   Development attempts if available; do not send a fax just to populate history.
4. In A's authenticated browser, GET the context endpoint, then request status,
   message and receipt with A's own X-Toolkit-Fax-Context and B's existing app faxId;
   repeat with a random UUID and with roles reversed. Expect safe 404/no metadata,
   no PDF and no provider call (the latter is verified by the integration suite).
   A missing/expired session must return 401; stale/foreign context must reject.
   Never copy B's session or context to A. Do not invoke POST send for this test.
5. Disconnect A. A's workspace/files/contacts clear and operations stop; B can still
   refresh contacts/history and access an existing owned receipt. Reconnect A and
   confirm A's identity returns without changing B. Reverse roles.
6. In both browsers simultaneously search contacts, select harmless local PDFs,
   change Last 4, and Clear All WITHOUT Send. Confirm queues and inputs remain local
   and history persists. Logout A, then sign in as B in that same profile: no A
   contacts, files or history may remain or reappear from delayed requests. Repeat
   after tab hiding/restoring, refresh and session expiry. B's other profile remains
   independent. Automated browser tests cover delayed contacts and in-flight responses.
7. Stop if any cross-user data appears. Unknown attempts require RingCentral human
   review and must never be automatically resent. No additional real fax is required
   to prove these properties; use mocked integration records where needed.

## References

- Vercel environments: https://vercel.com/docs/deployments/environments
- Environment inheritance: https://vercel.com/docs/environment-variables
- Entra exact Web redirects: https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
- RingCentral redirect setup: https://developers.ringcentral.com/guide/authentication/quick-start

## Checkpoint validation

225 regression tests passed; 3 database suites skipped in that run and then all 23
opt-in Development database checks passed separately. Chrome desktop (1280px) and
mobile (390px) checks passed, including focus after reorder, destination clearing,
cover OFF hiding, batches, receipts, history, logout and delayed employee responses.
Screenshots inspected at both widths. Production build passed with existing classic
script bundling notices. Source/build scan checked 177 source files, 49 output files
and four configured secret values in memory: zero matches. Browser credential-name
scan passed and normal production output contains no v3 page. No real fax sent.

The first browser run found a test readiness race after reload: history appeared
before composer controls were enabled. The test now waits for both; the complete
suite passed afterward. No runtime authorization behavior changed for this fix.

vercel.json disables Git deployments for development/fax-v3-phase1 only, to allow
the requested checkpoint push without a Vercel Git deployment. No other branch rule,
function or rewrite changed. Before a future deployment, review this branch rule
with the separate project's configuration. Manual deployments are still prohibited
for this checkpoint. Reference: https://vercel.com/docs/project-configuration/git-configuration

Copyable checkpoint note (version unchanged): Fax Sender v2.16.0 - polished the
isolated v3 interface, restored destination/document conveniences, and documented
Production-isolated two-employee testing; no deployment or production cutover.
