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

## Fax Sender

`fax-sender/` supports selecting multiple PDFs and sends **each PDF as its own fax**
to one LO fax number. `batch.js` manages the tab's document list and sequential queue;
`main.js` renders the review, progress, per-document results, and retry controls.
Each document calls the unchanged V1 `POST /api/send-fax` endpoint separately.
The request is multipart/form-data with `faxNumber` and `file` fields. Numbers
must include `+` and country code; spaces, parentheses, dots, and hyphens are accepted.
PDFs must be nonempty, named `.pdf`, have a PDF header, and be at most 4,000,000 bytes.
RingCentral performs document conversion; use a readable, unencrypted PDF.
The upload remains in server memory and is sent as one attachment with no automatic cover page.

### RingCentral contact destinations (v.2.4)

Focus **Search RingCentral contacts** to load the JWT user's personal address book.
Search by name, company, business city/state, or fax number. Select the labeled Business
fax or Other fax button to fill the existing LO Fax Number field. You may instead type
or edit that number manually. The batch's existing destination lock applies to both;
Clear All unlocks selection for the next batch. Enter in the search field does not send
faxes; Arrow Down moves to the first fax choice, and Tab navigates the other choices.

The page caches contacts only in memory and filters locally (no network request per
keystroke). **Refresh contacts** explicitly reloads changes from RingCentral. Results
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

1. Check that Send is hidden with no ready documents and disabled with an invalid LO fax number.
2. Enter a test fax number you control, including country code, and select several small PDFs.
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
There is no automatic fax resend, persistent history, or client workspace.
The V1 API still authenticates separately for each document; large batches can encounter
authentication or fax rate limits even with sequential requests. Failed rows retain errors
for review. Only definitive terminal fax failures can be retried. The existing RingCentral
authentication test and fax-send transport code were preserved for V2.1.

References: [RingCentral fax API guide](https://developers.ringcentral.com/guide/messaging/fax/sending-faxes),
[RingCentral permissions](https://developers.ringcentral.com/guide/basics/permissions),
[Vercel function limits](https://vercel.com/docs/functions/limitations).
