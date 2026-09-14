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

`fax-sender/` sends exactly one PDF to one number via `POST /api/send-fax`.
The request is multipart/form-data with `faxNumber` and `file` fields. Numbers
must include `+` and country code; spaces, parentheses, dots, and hyphens are accepted.
PDFs must be nonempty, named `.pdf`, have a PDF header, and be at most 4,000,000 bytes.
RingCentral performs document conversion; use a readable, unencrypted PDF.
The upload remains in server memory and is sent as one attachment with no automatic cover page.

### Local testing

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

1. Check that Send Fax is disabled with missing/invalid fields and rejects non-PDF files.
2. Enter a test fax number you control, including country code, and choose a small test PDF.
3. Click Send Fax once. Expect a message ID and initial status, often `Queued`.
4. Check RingCentral's sent faxes for final delivery and verify receipt of the document.
   Acceptance is not proof of delivery. If the connection fails, check RingCentral before retrying.

Automated verification (uses dummy credentials and mocked RingCentral calls; sends no faxes):

```sh
node --test tests/send-fax.test.js
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
There is no automatic retry, delivery polling, persistent history, client workspace, or batch sending.
Future batch work should invoke one fax submission per document and persist each returned message ID separately.

References: [RingCentral fax API guide](https://developers.ringcentral.com/guide/messaging/fax/sending-faxes),
[RingCentral permissions](https://developers.ringcentral.com/guide/basics/permissions),
[Vercel function limits](https://vercel.com/docs/functions/limitations).
