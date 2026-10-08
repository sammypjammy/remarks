# Chrome synthetic practice pilot 0.8.1

The SSA Intake Assistant filing preview includes the practice connection on the exact local development and hosted Toolkit URLs. It projects only mapped, valid, unique answers from the Checker-owned canonical data after every Checker issue and flag has been handled and the employee explicitly affirms the intake is fictional. No SSA access or new extension permission is added. Open client filing before using the connection controls below.

## Hosted Chrome pilot

In Chrome, open `chrome://extensions`, enable Developer mode, load this `extension-dev` folder as unpacked, or select Reload if it is already installed. Reopen the practice page after an update. Use the authenticated Toolkit at `https://packardtoolkit.vercel.app/intake-checker/`, check and acknowledge all intake notifications, continue to SSA Intake Assistant, and select **Open client filing**. Open the extension practice page, select **Receive from Toolkit**, then approve **Send to practice extension** in the Toolkit. Finally select **Fill received answers** in the extension.

The hosted Toolkit now sends eligible fields from the active intake only after the employee affirms it is entirely fictional. This declaration cannot verify whether pasted data is truly synthetic: **do not use client information in this pilot**. Both hosted and local flows use the same memory-only, short-lived channel. This unpacked package is for a Chrome pilot, not managed staff distribution; a Chrome Web Store or enterprise package needs a confirmed production extension ID and update plan.

The extension permits external messages from `https://packardtoolkit.vercel.app/*` plus the two loopback hosts. Application checks narrow this to the exact `/intake-checker/` URL with no query/hash, the correct origin, top frame, and source tab. The extension has no website, storage, network, cookie, or scripting permissions and cannot access SSA. Authentication stays in the Toolkit page; no credentials or cookies enter the extension.

This separate Manifest V3 package uses fictional data and simulated questions only. It cannot inspect or access live SSA pages. It has no host, tabs, storage, cookies or scripting permissions, no content scripts and no background service worker. Its external connection accepts an explicitly approved Toolkit page.

## Install / update

In Chrome `chrome://extensions`, enable Developer mode and **Load unpacked** this `extension-dev` directory. The fixed public package key keeps the unpacked pilot ID stable; it is not a credential. Later updates can use Reload in the extension manager. Reopen the practice page after updates. Keep only one practice page open.

If managed browser policy disables unpacked extensions, ask the administrator for an approved development profile; do not bypass policy. No staff deployment or store publishing is included. Original standalone extension files are untouched.

## Manual synthetic bridge test

1. Start the Toolkit's existing authenticated local development setup with `npm.cmd run dev -- --host 127.0.0.1`. For the existing local sign-in configuration use `http://localhost:5173/intake-checker/`. The exact loopback alternative `http://127.0.0.1:5173/intake-checker/` is also allowed when authentication is configured for that origin. Local login must use the existing Toolkit authentication; do not disable it or copy tokens into the extension. If local authentication is not configured, complete the existing local-auth setup before manual testing.
2. Paste a clearly synthetic intake, check it, resolve or ignore every Checker notification, Continue to SSA Intake Assistant, and select **Open client filing**. Existing parsing, edits and review rules are reused.
3. In the extension practice page select **Receive from Toolkit**. This arms one transfer; it does not request or retrieve a profile.
4. In the Toolkit development connection, select the synthetic-data approval checkbox and **Send to practice extension**.
5. The extension reports how many ready practice fields it received. Nothing fills automatically. Select **Fill received answers**.
   That button stays disabled until a Toolkit profile arrives. **Fill built-in example (not your intake)** uses fixed fictional answers for standalone demonstration and never uses Intake Checker data.
6. Verify missing/blocked answers stay blank; complete-date questions reject month-only answers. An ignored error is not permission to fill an invalid answer. Missing values do not create new Checker tasks.
7. Test editing an existing practice answer and filling again: the edit remains. Test Back, correction, Clear, reload of either page, disconnect, logout, and closing either tab: the transferred profile and practice answers clear. Back preserves the active Checker intake itself.
8. For a different intake, select Receive again and approve again. Old values must not carry over. Reload the source and confirm no profile restores.

The hard session limit is five minutes, with a fifteen-second receiver lease renewed after source-side authentication checks. Background-tab throttling or suspended pages may safely disconnect earlier. There is no reconnection or resend without new approval.

## Architecture and trust boundary

The Toolkit component uses Chrome's `runtime.connect` to the pinned unpacked extension ID. The receiving extension page uses `onConnectExternal`. `externally_connectable` allows the hosted Toolkit and the two loopback hosts; application checks additionally require the exact hosted URL or local port 5173, `/intake-checker/` path with no query/hash, top frame, matching browser-reported origin, and a source tab. Other extensions are not accepted. The source also checks its exact URL and existing Toolkit authentication before sending and on heartbeats.

Each connection binds a random receiver nonce and source session ID. One profile is accepted per armed connection. Replays, wrong-session messages and unsupported schemas close it. The port binds the originating tab/document. Back, corrections, account changes and page lifecycle revoke it. Disconnect, expiry, reload and pagehide clear all receiver values. Both hosted and local development require fictional intake input and explicit approval.

The projection contains only mapped ready fields with `id`, `definitionId`, `recordId`, `dataType`, `value`, `precision`, `readiness`, and empty `blockingReasons`, plus the contract name/version. It excludes source text, source locations, raw answers, edit/review history, credentials and account details. Profile values exist only in the source page, transient browser-native messages and receiving page memory. No database, browser storage, URLs, navigation history, analytics, logs, server upload or background cache is used. Authentication requests remain ordinary source-page same-origin requests; credentials never enter the extension. The extension CSP forbids network connections and form submission.

See Chrome's [message channel documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) and [externally connectable allowlist](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable). No website host permission is required for this direct channel.

## Mapping limits

The pilot maps exact Checker fields into a fictional practice page. Gender maps to Sex, and BlindOrHaveLowVision Yes maps to blindness Yes as approved by staff. One unambiguous Current Spouse supplies its exact mapped fields. Each actual numbered Previous Spouse supplies a separate section with all 18 listed rows; only unique ready values transfer, and missing or unsupported values stay blank. Each actual work-history record gets a separate conditional Employment section with Job Title, Employer, Business Type, Address, City, State, Zipcode, Hours per Day, Days per Week, Rate of Pay, Pay Frequency, Start Date and End Date. The exact EMPLOYMENT INFORMATION fields Worked outside United States, Eligible for foreign SSI and Foreign SSI country appear only when present in the Checker source; only individually ready values transfer. Complete day-precision dates alone split into month/year. No eligibility, country, self-employment, or spouse answer is inferred. Year-specific self-employment, Income greater than $400, benefit-application status, spouse foreign-work/benefit questions, earnings-history agreement, the three yearly-employment answers, Country, Street Line 2 and Employment has not ended remain blank and unmapped. Name at Birth is separate from Middle Name. Prior-spouse death status accepts only explicit Yes, No, or Unknown. Actual child records supply first and last names, capped at 30 records. Recent SGA, spouse DOB and unsupported child questions stay blank. These are fictional practice questions, not verified SSA questions or selectors. Existing values are not overwritten.

The visible form follows the staff-provided sequence from applicant name through Children. Exact full birth and marriage dates split after manual Fill; partial dates stay blank. Children receive separate first and last name rows for each ready child record. Unsupported questions remain empty and other mapped fields stay collapsed.

There is no automatic navigation, submission, credentials, MFA, CAPTCHA, attestation, signature, penalty-of-perjury confirmation or real SSA interaction. The standalone PDF/OCR workflow is not a transfer source.

## Automated verification

From the Toolkit root:

```powershell
node --test --test-isolation=none tests/ssa-development-bridge.test.mjs tests/ssa-extension-practice.test.mjs
node ssa-intake-assistant/tests/extension-practice-browser.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node ssa-intake-assistant/tests/development-bridge-browser.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The actual-extension harness requires port 5173 free. It creates an isolated local Vite instance with test-only authentication responses and a temporary Chrome profile, installs the unpacked package using Chrome's extension debugging support, and exercises the real Toolkit UI and native message channel. That authentication stub is confined to the test process, never a deployed or normal-development authentication bypass. Only generated synthetic fixtures are used.

## Remaining before staff rollout

Confirm Chrome policy, managed package distribution, the resulting production extension ID, staff access group, and update channel. Verify the hosted Toolkit authentication/session lifecycle with fictional data. Real SSA mappings and controlled live testing require separate approval; unsupported questions always pause. Nothing here authorizes a production or live-site rollout.
