# Packard Toolkit

Run `npm install`, then `npm run dev` to start the toolkit. Use `npm run build` for a production build and `npm run preview` to preview it.

- `index.html` and `home.js`: toolkit homepage.
- `canned-remarks/`: remarks page and its JavaScript.
- `med-tabs-generator/`: medical tabs page, styles, parser, and JavaScript.
- `welcome-email-sender/`: email page, React components, Outlook integration, authentication callback, styles, and PDF attachments.
- `settings/`: settings page, styles, and JavaScript.
- `settings/shared/`: shared styles, navigation, favicon, and settings storage, including the React settings adapter.
- `pages/`: compatibility redirect for the old remarks URL.

The tools use common files from `settings/shared/`. Dependencies and build configuration are managed at the project root. Vite copies the standalone scripts and PDF attachments into `dist/` during builds. The `/auth/callback` URL is preserved by Vite and Vercel routing so the Microsoft redirect registration can remain unchanged.

## Email Sender

Single mode keeps the Outlook draft workflow. Bulk mode validates and deduplicates pasted recipients, then creates separate Outlook drafts sequentially with the existing templates, signatures, case-manager selection, and PDF attachments. Open each draft from the results or Outlook Drafts, review it, and click Send in Outlook yourself. The Toolkit does not send email.

Both modes request only delegated **Mail.ReadWrite**. No Mail.Send permission is requested. Failed draft preparations can be retried using the original content and PDFs; known draft IDs and completed attachments are retained during retries. If a network response is lost, inspect Outlook Drafts for partial or duplicate drafts before retrying.

Run `node --test tests/*.test.js intake-checker/*.test.js` for the complete suite. The Email Sender browser test uses mocked Outlook calls and a temporary headless Chrome/Edge profile; set `CHROME_BIN` to a browser executable if it is not installed in a standard Windows location. No test sends real email.

## Fax Sender

`fax-sender/` supports selecting multiple PDFs and sends **each PDF as its own fax**
to one fax destination. `batch.js` manages the tab's document list and sequential queue;
`main.js` renders the review, progress, per-document results, and retry controls.
Each document calls the existing `POST /api/send-fax` endpoint separately.
The request is multipart/form-data with `faxNumber`, `file`, and `includeCoverSheet` fields, plus optional `recipientName`. Numbers
must include `+` and country code; spaces, parentheses, dots, and hyphens are accepted.
PDFs must be nonempty, named `.pdf`, have a PDF header, and be at most 4,000,000 bytes.
RingCentral performs document conversion; use a readable, unencrypted PDF.
The upload remains in server memory and is sent as one unchanged attachment. The default-on Cover Sheet switch requests RingCentral's built-in Classic cover for each separate fax. OFF sends the document without a cover. The choice locks with the destination and resets ON after Clear All or a new page load; it is not persisted.

### Cover Sheet Comment

Fax Sender v2.15.0 adds an optional three-row textarea below the cover switch. Its value lives only in the current batch, locks with the destination after the first submission, and clears on Clear All or reload. It is never stored in browser storage or Fax History. Clear All retains its existing behavior of clearing both the batch and saved fax history.

The existing multipart request accepts optional string field `coverPageText`. The server rejects duplicate/file values, normalizes CRLF/CR to LF, trims surrounding whitespace, and rejects normalized values longer than 1024 JavaScript UTF-16 code units (a conservative interpretation of RingCentral's 1024-symbol limit). The textarea also has maxlength 1024. No text is echoed in responses, logged, or put in URLs. ON + nonblank adds `coverPageText` beside `coverIndex: 5`; ON + blank omits it; OFF always omits it beside `coverIndex: 0`, even with stale client text. Invalid provided values are rejected even when OFF.

Cover settings are snapshotted once per batch and reused for each independent PDF, later added PDFs, and explicit retries. The receipt, contact, history, and status paths are unchanged. The user has manually confirmed Classic covers working; comment rendering still needs a controlled manual check. No fax is sent by automated tests.

This checkout previously used global Toolkit version labels. Fax Sender's independent version is now set on its footer host in `fax-sender/index.html`; the shared shell honors that label while other tools and package metadata retain their versions. Fax release notes remain in centralized `version-history/index.html` as tool-specific entries.

Run the production fax/navigation browser checks with `node tests/navigation-browser-check.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe" --fax-only`. Omit the flag to include unrelated Intake browser checks.

### Built-in Classic cover: API contract and verification

The browser sends the multipart string `includeCoverSheet` as exactly `"true"` or `"false"`. The server maps true to root JSON `coverIndex: 5`, false to `coverIndex: 0`. Missing flags preserve older clients' no-cover behavior. Duplicate/malformed flags, arbitrary cover IDs/metadata, and invalid optional names are rejected before authentication. Only the server owns the template ID. No additional enable flag is required. Optional `coverPageText` is supplied only when covers are ON and the trimmed comment is nonblank. No cover PDF is generated, and no extra attachment, submission, or message is created.

Verified against [RingCentral's official OpenAPI](https://github.com/ringcentral/ringcentral-api-docs/blob/main/specs/ringcentral_openapi3.json): `GET /restapi/v1.0/dictionary/fax-cover-page`, the **Language Setting - US** response example explicitly identifies None as 0 and Classic as 5. This mapping is for **en-US**; other language dictionaries differ and are not supported by this release. The [official CreateFaxMessageRequest schema](https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/CreateFaxMessageRequest.cs) documents `coverIndex`, no-cover 0, optional text, and the account default when the index is omitted. We always explicitly send 5 or 0.

With covers ON, the existing selected contact name is supplied as `to[0].name` alongside `to[0].phoneNumber`, as supported by [FaxReceiver](https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/FaxReceiver.cs). Manual destinations work without a name. OFF retains the prior phone-number-only recipient payload. Recipient company/phone are not invented. No sender fields or from-number override are supplied. [RingCentral's sending guide](https://developers.ringcentral.com/guide/messaging/fax/sending-faxes) explains that the outgoing number is controlled by the extension's outbound fax settings. The exact sender and recipient fields printed by Classic must be observed in the controlled test.

Receipt downloads continue through the existing verified message/RenderedDocument endpoints, including bulk and history downloads. The schema describes `faxPageCount` as page count but does not explicitly promise cover inclusion. The user has manually confirmed Classic covers working. Exact page-count semantics and the new comment rendering across individual/bulk/history receipts have not been independently live-verified in this implementation. Tests mock transmission and never send a fax.

### Controlled live cover-sheet test (manual; not performed)

1. Confirm the authenticated extension uses the US English cover dictionary and review its outbound fax/cover sender settings without changing the configured number.
2. Select only the existing known-safe test destination, enter a synthetic four-digit test identifier, and attach one small known test PDF whose original page count is known. Leave Cover Sheet ON (RingCentral Classic).
3. Send once. Record its single message ID and wait for RingCentral's final Sent status. If the outcome is unknown, inspect RingCentral before any retry.
4. Download Fax Receipt. Check whether its first page is the built-in Classic cover and whether every original document page follows unchanged. Record the received copy's page count too.
5. Record exactly what is printed for recipient To, Company, Phone, Fax; sender From, Company, Phone, Fax; Date, Pages, and Comments. Note blank fields rather than assuming population.
6. Open transmission details and record `faxPageCount` and message ID (the existing `/api/fax-message?messageId=...` response exposes safe metadata). Compare the count with the original PDF and received/RenderedDocument pages to establish whether the cover is counted.
7. Download All Fax Receipts, then reload and re-download the same message from Fax History. Compare all copies to establish whether the cover is present through every receipt path.
8. Only if necessary, Clear All, select the same safe destination and PDF, turn Cover Sheet OFF, and send once more. Confirm the received/receipt document has only the original pages. Record observations before treating live behavior as verified.

### Unified fax destination (v.2.5)

Use **Fax Destination** to search by contact name, company, business city/state, or fax
number. The dropdown overlays the form without moving the PDF list. A contact with one
fax has a clickable row; multiple fax numbers share one heading with explicit Business
fax / Other fax choices. Contact names (including any LO suffix) are unchanged.

Manual numbers use the same control: type a number and select **Use fax number**.
Ten-digit entries are offered with country code +1; eleven-digit entries starting with
1 receive the + prefix. Other international entries require an explicit +country code.
Extensions and incomplete numbers are not accepted. These are UI entry conveniences;
the batch and API normalization are unchanged. +1 numbers display as (833) 555-1234;
other E.164 values display unchanged.

After selection, the field shows the contact name and formatted number (or just the
manual number). The original `faxNumber` input is now hidden and remains the single
normalized E.164 destination read by the batch. The X clears it before locking. After
the first batch attempt, contact selection, manual selection, and X cannot change the
destination. Clear All resets the batch and selector.

Outside clicks, focus leaving the component, Escape, and selection close the dropdown.
Arrow Down enters the choices; Up/Down move among them; Enter/Space activate focused
buttons. Enter in the search input never sends a fax. The overlay has a bounded height
and scrolls when needed. Long selected labels are truncated visually with full text
available in the field's title.

The page caches contacts only in memory and filters locally (no network request per
keystroke). The adjacent refresh icon explicitly reloads changes from RingCentral;
it spins while loading and disables repeated refresh clicks. Manual choices remain
available during loading or failure. Results
show at most 30 matching contacts at once; refine the search to find other matches.
Contacts without a usable fax are shown without a selection button. No mobile/home/
business phone field is ever substituted for a fax. Contact API errors leave manual
faxing available and offer an explicit load-again action.

`GET /api/ringcentral-contacts` authenticates using the same server-only JWT pattern and
reads `GET /restapi/v1.0/account/~/extension/~/address-book/contact?page=N&perPage=1000`.
Enable app permission **ReadContacts**; the JWT user needs **ReadPersonalContacts**.
No write permissions or new environment variables are required.

Schema verified against RingCentral's official SDK definitions:
[PersonalContactResource](https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/PersonalContactResource.cs),
[ContactList](https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/ContactList.cs),
[ListContactsParameters](https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/ListContactsParameters.cs).
Returned picker data includes `id`, a name built from `firstName`/`middleName`/`lastName`
(fallback `nickName`, company, or ID), `company`, business-address `city`/`state`, and
labeled `faxNumbers` from `businessFax` and `otherFax`. Identical fax values are deduplicated.
E.164 numbers with formatting punctuation are normalized; missing country codes or
extensions are not guessed. Emails, notes, street addresses, and non-fax phones are omitted.

All pages are requested sequentially using `paging.totalPages` / `navigation.nextPage`,
with page-size fallback when metadata is absent. Upstream next-page URLs are never followed.
The API returns the complete normalized list or a safe error, never a partial list marked
complete. Personal books support up to 10,000 contacts; no database caching is added.
The request has a 45-second deadline and a 4 MB normalized response guard. Excessive
size, malformed pagination, rate limits, or timeout fall back to manual entry.

Browser integration check (all contacts and fax submissions mocked):

```powershell
node tests/contacts-browser-check.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### Running locally

Use Node 22.12+ (or Node 24) and run from the project root:

```sh
npm install
npm run dev
```

Open the displayed local URL at `/fax-sender/`. Vite's server middleware runs the
same API handler locally. It reads only the three server-side `RC_` credentials
from the existing root environment files, with `fax-sender/.env.local` as a fallback;
process environment values take precedence. Restart after environment changes.
No credentials are passed to Vite's browser code. Never rename them with a `VITE_` prefix.
Environment files remain gitignored. `npm run preview` serves static output only;
use `npm run dev` or `npx vercel dev` to exercise the API.

1. Check that Send is hidden with no ready documents and disabled without a selected fax destination.
2. Select a contact or type a controlled test number and choose Use fax number, then select several small PDFs.
3. Review the list. Add more PDFs, remove a document, or use Clear All before sending.
4. Click **Send N Faxes** once. Each row moves from Ready to Submitting to Queued / Processing.
   Expect a separate message ID and initial RingCentral status for each submitted PDF.
5. Check RingCentral's sent faxes for final delivery and verify receipt of each separate document.
   Acceptance is not proof of delivery. If the connection fails, check RingCentral before retrying.
6. Status checks update each row independently to Delivered, Failed, or Status Unknown.
   **Retry Failed** and row **Retry** are available only after RingCentral reports
   `SendingFailed`. Submission errors, polling errors, and timeouts never enable Retry.
   Delivered and queued documents cannot be resent. A retry retains its old message ID
   under Previous attempts and tracks its new message ID independently.

Requests run one at a time with a one-second gap; failures are never retried automatically.
The destination is locked after the first attempt so retries and additional documents go
to the same number. Clear All starts a new batch and unlocks the number. File selections
are additive; matching name, size, and modification time are treated as an existing file
and skipped. This is accidental duplicate prevention, not a content comparison.

State is kept in memory in the current tab only. Clear All, reload, or leaving the page
discards files/results and resets duplicate protection. Keep the tab open during sending;
the browser is asked to warn before leaving an active batch. No background execution,
persistent history, or cross-tab duplicate protection is provided. Timeout/network failures
may already have been accepted upstream; check RingCentral. V2.1 intentionally does not
offer an in-tool retry for these uncertain outcomes.

### V2.1 delivery tracking

The new `GET /api/fax-status?messageId=...` endpoint validates a single numeric ID and
uses `GET /restapi/v1.0/account/~/extension/~/message-store/{messageId}` on the production
RingCentral platform. The response must match the ID, `type: Fax`, and `direction: Outbound`.
Only message ID, status, and a terminal flag are returned; raw message content and error
payloads are never forwarded. A definitive `SendingFailed` is preserved, but detailed
provider failure reasons are not reliably exposed here; consult the RingCentral app.

**Required RingCentral permission: ReadMessages**, in addition to Faxes. Enable it in
the app's Developer Console configuration, and ensure the JWT user can read messages.
No new environment variables are needed. The new route uses the existing JWT approach;
its tokens are cached only in server memory for at most five minutes (and less than
their remaining lifetime). Status 401/403 invalidates that cache. Fax sending is unchanged.

`tracking.js` starts checks about 10 seconds after acceptance, repeats no sooner than
30 seconds per document, and serializes all lookups with a minimum five-second gap.
Larger batches may have longer intervals. Tracking stops after 15 minutes per attempt;
an in-flight lookup can take up to 25 seconds, and browser background throttling can delay
updates. An unresolved outcome becomes **Status Unknown**, never a fax failure. Transient
lookup errors continue to be checked within the original window. Clearing/leaving stops
tracking and ignores any stale in-flight response. This is browser-tab tracking, not a
background service. Keep the tab open through completion.

Status interpretation follows the [RingCentral message status documentation](https://github.com/ringcentral/ringcentral-api-docs/blob/main/docs/messaging/message-store/messaging.md):

- `Queued`: pending fax transmission.
- `Sent`: terminal fax success, shown as **Delivered** (successful transmission, not proof of human review).
- `SendingFailed`: terminal fax failure, shown as **Failed**, eligible for explicit retry.
- `Delivered` and `DeliveryFailed`: documented for SMS, not used to infer fax outcomes.
- `Received`: inbound status, not used to infer outbound fax success.

The last three values, if unexpectedly returned for an outbound fax, remain Status Unknown
and are polled within the same bounded window. Unrecognized values fail safely without
inventing a RingCentral status. In particular, the existing sender's `Accepted` fallback
is not displayed as an actual RingCentral message-store status.

When no Ready documents remain, Send is hidden. The page shows tracking progress or a
terminal summary, with a positive completed state only when every document is Delivered.

Automated verification (uses dummy credentials and mocked RingCentral calls; sends no faxes):

```sh
node --test tests/*.test.js
npm run build
```

### Vercel

Deploy the root project as usual, using `npm run build` and output directory `dist`.
Keep `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, and `RC_USER_JWT` in Vercel's server environment
for the deployment being tested; redeploy after changing them. The root `api/` folder
provides `/api/send-fax`. Open `/fax-sender/` on the deployed URL and repeat the local
test with a controlled recipient. Browser network responses contain only safe results
or fixed error messages; authentication occurs on the server.

This repository has no toolkit-wide server authorization layer. Restrict the deployed
toolkit and `/api/*` to staff using your deployment's access protection before use;
the page's “Internal use only” label does not enforce access control.

### RingCentral errors and limits

- Authentication failure: check the client ID/secret, JWT validity, and that the JWT
  is authorized for the application and user in production.
- Fax HTTP 403: check the application's **Faxes** permission and whether the JWT user's
  extension has fax service enabled. Successful authentication alone does not grant fax access.
- Fax HTTP 401: RingCentral rejected the access token/application authorization.
- HTTP 400: check the destination and PDF; corrupted or password-protected files can fail conversion.
- HTTP 429: rate limit reached; wait before another submission.
- HTTP 502 or connection timeout: submission may be ambiguous. Check RingCentral before retrying.

The 4 MB PDF cap leaves multipart overhead below Vercel's 4.5 MB function request limit.
There is no automatic fax resend or persistent document workspace. Fax History saves
only the 10 newest attempt records in localStorage, including validated four-digit
SSN last four for identification and receipt filenames. Full SSN, receipt filenames,
PDFs, credentials, and authenticated media URLs are excluded. Restored
unfinished attempts show Status Unknown and are not automatically retried or polled.
The V1 API still authenticates separately for each document; large batches can encounter
authentication or fax rate limits even with sequential requests. Failed rows retain errors
for review. Only definitive terminal fax failures can be retried. The existing RingCentral
authentication test and fax-send transport code were preserved for V2.1.

References: [RingCentral fax API guide](https://developers.ringcentral.com/guide/messaging/fax/sending-faxes),
[RingCentral permissions](https://developers.ringcentral.com/guide/basics/permissions),
[Vercel function limits](https://vercel.com/docs/functions/limitations).

### Fax contacts and receipt downloads

`POST /api/ringcentral-contacts` accepts only `{ name, faxNumber }` and creates a
personal contact using `firstName` and `businessFax`. It uses the existing server
JWT authentication, checks the complete current address book for the fax number,
and returns only normalized picker data. Add **Contacts (CRUD)** to the RingCentral
application permissions in Developer Console; **ReadContacts** alone cannot create
contacts. The JWT user's role also needs **EditPersonalContacts**. A denied save
does not disable contact reads or manual faxing. Live app permissions have not been
verified by the mocked tests.

Download All requests separate receipt PDFs through the existing attachment proxy.
Browsers may require permission for multiple automatic downloads and cannot report
their completion to this page. The ZIP fallback provides one download, preserving
individual PDF filenames; same-named files use separate ZIP directories. Both paths
reuse successful attachment blobs in memory, and retrieval failures leave Sent
status unchanged. Clearing the batch releases its receipt cache references.

History receipt downloads reuse `/api/fax-message` and `/api/fax-attachment` with the
stored message ID. Older records without Last 4 use the original filename without
an SSN suffix. The active Last 4 input is not restored from history. Clear All clears
both visible and stored attempts. Last 4 is never sent to RingCentral or API URLs.
