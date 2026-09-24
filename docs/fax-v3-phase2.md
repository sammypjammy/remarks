# Fax Sender Phase 2 — isolated Development operations

No normal navigation, v2 sources, v2 APIs, JWT configuration, root build input or
version changes. `/fax-sender-v3/` is served only by `vite.rc-v3.config.js`.
New `/api/fax-v3/{context,contacts,send,history,status,message,receipt}` handlers
reject environments other than Development and reject the Production Neon endpoint.
No build or API executes a migration. No real fax is part of automated tests.

## Authorization and lifecycle

Every operation requires the existing opaque Toolkit session and an active personal
RC connection. POST additionally requires same-origin CSRF validation. A keyed,
opaque context binds user, hashed session, connection, environment, generation,
account and extension; it is held in memory only and is not standalone authorization.
The server revalidates the session/connection under database share locks around
provider work. Logout/disconnect changes serialize behind already-authorized work;
they cannot undo a fax already submitted. Browser queues stop and discard late
results on context changes. Before publishing a response, the browser independently
rechecks the context using its current session cookie. No cache persists across users.

Refresh uses Phase 1 durable claims/rotation. A changed generation intentionally
stops the old batch rather than continuing it. If a send attempt was reserved before
that change, its result is Unknown and requires review even if no fax call was made.
This conservative interruption is expected after access-token refresh. Reload status,
review history, and explicitly select files again; never blindly resend Unknown rows.

## Durable send boundary

Migration 003 adds connection generation, normalized provider status and a unique,
owner-bound retry parent to the existing 002 fax-attempt infrastructure. 001 and 002
are unchanged. A reservation transaction validates session/context, serializes the
employee's idempotency keys and COMMITs a `submitting` row before provider send.
Only the request that created the reservation may call RingCentral; duplicates only
read the existing result. A request fingerprint includes PDF bytes and the payload,
but neither the PDF nor cover comment is stored. Retries require an owned, proven
SendingFailed parent with the same fingerprint; a parent can have only one child.
Intentional new independent sends have new keys. This is not content-based duplicate
detection across intentionally new batches.

Provider send executes once. Timeout, invalid acknowledgement, process interruption,
refresh uncertainty or database acknowledgement loss never retries the request.
Stale `submitting` rows are exposed as Unknown. A lost acknowledgement after a
successful COMMIT may display Unknown until history confirms the committed result.
Success is returned only after COMMIT. There is no background send/replay worker.

## Data and receipts

Only filename, four-digit Last 4, recipient name and E.164 destination are retained
as AES-256-GCM encrypted metadata bound to owner, environment, connection, RC
identity and faxId. Ciphertexts use the existing versioned server key ring.
The browser sees app-owned UUID faxIds, never provider message IDs or media URLs.
Newest 20 attempts are selected per employee; Clear All only resets the composer.
The v3 page deletes `packard.faxHistory.v1` without reading or importing it. This
intentionally removes that origin's old v2 history key when visiting v3; v2 code is
unchanged. Old attempts from a different RC identity are visible to their Toolkit
owner but cannot be polled or downloaded using the new identity.

Status polls start after 10 seconds, repeat after 30 seconds with a 5-second gap,
and stop at 15 minutes or a definitive terminal state. Errors never imply failed
transmission. Sent is transmission success, not recipient review.

Receipt authorization resolves the owned fax first, then checks outbound Fax, Sent,
and RenderedDocument/PDF attachment membership. The fixed platform content path is
constructed from verified IDs; provider-supplied URIs and redirects are never used.
See RingCentral's official message-store content path documentation:
https://developers.ringcentral.com/guide/messaging/message-store/working-with-message-store
PDF responses are bounded to 10 MiB and checked for type/header. Filenames preserve
Last 4 including leading zeros. Stored ZIP entries preserve duplicate filenames in
numbered folders. Download errors never update fax status or trigger sends.

## Development validation and manual acceptance

Run `node --test --test-concurrency=1 tests/*.test.js tests/*.test.mjs intake-checker/*.test.js`.
Database tests opt in with `RC_V3_DB_TEST=1` and a Development environment validated
by `assertDevelopment`, using disposable random schemas and mocked RC operations.
Use `node scripts/migrate-fax-v3.mjs --apply --development` only with the verified
Development environment injected in memory. It validates 002's ledger checksum,
checks 003's checksum on replay, uses an advisory lock and reports after COMMIT.
It never applies 001/002 or accepts Production.

Phase 2 validation completed: 225 local regression tests passed (three database
suites were opt-in skips), and all 23 separately enabled Development database
checks passed. Desktop/mobile browser checks, normal production build and in-memory
source/browser secret scans passed. Migration 003 was applied to Development only;
its ledger checksum was verified read-only afterward, along with unchanged 002.
Do not rerun a migration for the first manual test. The existing localhost harness
served the new page/assets and rejected unauthenticated v3 operations with no-store.
Real contacts, fax transmission, status and receipts still require manual acceptance;
all automated provider behavior was mocked and no real fax was sent.

Restart the existing Development harness using `vite.rc-v3.config.js` if necessary.
At `http://localhost:5173/fax-sender-v3/`, sign into Toolkit and connect your own RC.
First load/search contacts, verify your extension's entries, select a contact, test
manual international formatting, and optionally save one explicitly intended test
contact. Verify it appears in your own RC address book. Test a second Toolkit
employee in a separate browser profile to confirm distinct contacts/history.

Only after contacts pass, manually select ONE harmless PDF, an authorized controlled
fax destination, a four-digit test Last 4 (for example 0012), and optionally a Classic
cover comment. Click Send once. Never resend an Unknown outcome: inspect RingCentral.
Wait for Sent, download the receipt, verify filename/content, refresh, and download
again from history. Clear All must preserve history. Then sign out / switch employee
and verify no previous files, contacts or history remain visible. No automated real
fax or Production cutover is authorized by these instructions.
