# Account preferences

Preferences use the existing Toolkit session cookie and PostgreSQL pool. The
`toolkit_auth.user_preferences` row belongs to `toolkit_auth.users.id`; clients
cannot select a different owner. `GET /api/auth/session?preferences=1` reads the
current user's record. Same-origin JSON POSTs import once or merge changed keys.
The ordinary session response and the number of API entrypoints are unchanged.

Apply `migrations/004_account_preferences.sql` with the isolated, checksum-pinned
Production maintenance flow: run `node scripts/prepare-auth-migration.mjs
--authorize-apply-004`, then deploy the generated Vercel stage using
`vercel@59.25.4 deploy --prod --skip-domain`. Production credentials come from
Vercel's remote build environment; they are never copied to the checkout. The
flow requires 30-minute authorization, strict Production target checks, a
transaction, advisory lock, migration checksum ledger and rollback on failure.
Builds and API handlers never run DDL. The migration only adds the preferences
table; it does not modify existing user, session, fax, or RingCentral data.

Extend `server/auth/preferences.js`'s allowlist and the shared settings module
together. Only preference fields are accepted: appearance, tool options, homepage
name/order/visibility, email signature/language/manager/templates/resources,
custom case managers, and custom remarks. No tokens, cookies, OAuth state, email
history, fax history, or temporary remark content is uploaded to this store.

Legacy browser preferences are hidden until authentication and imported only
when the account has no preference record. The first browser's import wins
atomically. An existing account always wins over another device's old settings.
Legacy preference keys are deleted after acknowledgment, preventing migration to
a second account. Account preferences stay in memory in the browser; reloads read
the account record. Unsaved changes show a sync error and warn before leaving;
focus/visibility refresh retries them. Signed-out edits are temporary.

Logout clears preferences, local Email History and temporary remarks, notifies
other tabs, and restores defaults. Email History remains browser-local, bound to
the account, and is not a preference. A new account never inherits it. Shared
browser legacy preferences without a known owner are imported by the first
authenticated account; it is impossible to infer a historical owner safely.
