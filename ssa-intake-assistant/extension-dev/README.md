# Synthetic extension development 0.2.0

This separate Manifest V3 package uses fictional data and simulated questions only. It cannot inspect or access live SSA pages. It has no host, tabs, storage, cookies or scripting permissions, no content scripts and no background service worker. Its only external connection is from an explicitly approved local Toolkit page to this open practice page.

## Install / update

For this update, remove the earlier 0.1.0 development extension, then use Chrome `chrome://extensions` or Edge `edge://extensions`: enable Developer mode, **Load unpacked**, choose this `extension-dev` directory. Version 0.2.0 introduces a fixed public package key so the Toolkit can address exactly this extension. The key is a public identity, not a credential. Later updates can use Reload in the extension manager. Reopen the practice page after updates. Keep only one practice page open.

If managed browser policy disables unpacked extensions, ask the administrator for an approved development profile; do not bypass policy. No staff deployment or store publishing is included. Original standalone extension files are untouched.

## Manual synthetic bridge test

1. Start the Toolkit's existing authenticated local development setup with `npm.cmd run dev -- --host 127.0.0.1`. For the existing local sign-in configuration use `http://localhost:5173/intake-checker/`. The exact loopback alternative `http://127.0.0.1:5173/intake-checker/` is also allowed when authentication is configured for that origin. Local login must use the existing Toolkit authentication; do not disable it or copy tokens into the extension. If local authentication is not configured, complete the existing local-auth setup before manual testing. The deployed Toolkit deliberately has no bridge button in this milestone.
2. Paste a clearly synthetic intake, check it, and Continue to SSA Intake Assistant. Existing parsing, edits and review rules are reused.
3. In the extension practice page select **Receive from local Toolkit**. This arms one transfer; it does not request or retrieve a profile.
4. In the Toolkit development connection, select the synthetic-data approval checkbox and **Send to practice extension**.
5. The extension reports how many ready practice fields it received. Nothing fills automatically. Select **Fill received answers**.
6. Verify missing/blocked answers stay blank; complete-date questions reject month-only answers. An ignored error is not permission to fill an invalid answer. Missing values do not create new Checker tasks.
7. Test editing an existing practice answer and filling again: the edit remains. Test Back, correction, Clear, reload of either page, disconnect, logout, and closing either tab: the transferred profile and practice answers clear. Back preserves the active Checker intake itself.
8. For a different intake, select Receive again and approve again. Old values must not carry over. Reload the source and confirm no profile restores.

The hard session limit is five minutes, with a fifteen-second receiver lease renewed after source-side authentication checks. Background-tab throttling or suspended pages may safely disconnect earlier. There is no reconnection or resend without new approval.

## Architecture and trust boundary

The Toolkit development-only component uses Chrome's `runtime.connect` to the pinned extension ID. The receiving extension page uses `onConnectExternal`. `externally_connectable` allows only the two loopback hosts localhost and 127.0.0.1; application checks additionally require the exact port 5173, `/intake-checker/` path with no query/hash, top frame, matching browser-reported origin, and a source tab. Other extensions are not accepted. The source also checks its exact URL and existing Toolkit authentication before sending and on heartbeats.

Each connection binds a random receiver nonce and source session ID. One profile is accepted per armed connection. Replays, wrong-session messages and unsupported schemas close it. The port binds the originating tab/document. Back, corrections, account changes and page lifecycle revoke it. Disconnect, expiry, reload and pagehide clear all receiver values. This is a development trust boundary: code running in the allowed local Toolkit origin is trusted. It is not a production attestation or proof that arbitrary input is synthetic.

The projection contains only mapped ready fields with `id`, `definitionId`, `recordId`, `dataType`, `value`, `precision`, `readiness`, and empty `blockingReasons`, plus the contract name/version. It excludes source text, source locations, raw answers, edit/review history, credentials and account details. Profile values exist only in the source page, transient browser-native messages and receiving page memory. No database, browser storage, URLs, navigation history, analytics, logs, server upload or background cache is used. Authentication requests remain ordinary source-page same-origin requests; credentials never enter the extension. The extension CSP forbids network connections and form submission.

See Chrome's [message channel documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) and [externally connectable allowlist](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable). No website host permission is required for this direct channel.

## Mapping limits

Eight mappings: first/last/optional middle name, phone, email, date of birth, disability onset and last day worked. Date work stopped is deliberately unsupported. No date is substituted for another. These are invented practice questions/selectors, **not verified SSA mappings**. Only contract 3.0.0, exact singleton IDs, correct types, ready fields with no blocking reasons and suitable precision are eligible. All other questions pause. Existing input values and changed/duplicate targets are not overwritten.

There is no automatic navigation, submission, credentials, MFA, CAPTCHA, attestation, signature, penalty-of-perjury confirmation or real SSA interaction. The standalone PDF/OCR workflow is not a transfer source.

## Automated verification

From the Toolkit root:

```powershell
node --test --test-isolation=none tests/ssa-development-bridge.test.mjs tests/ssa-extension-practice.test.mjs
node ssa-intake-assistant/tests/extension-practice-browser.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node ssa-intake-assistant/tests/development-bridge-browser.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The actual-extension harness requires port 5173 free. It creates an isolated local Vite instance with test-only authentication responses and a temporary Chrome profile, installs the unpacked package using Chrome's extension debugging support, and exercises the real Toolkit UI and native message channel. That authentication stub is confined to the test process, never a deployed or normal-development authentication bypass. Only generated synthetic fixtures are used.

## Next milestone

Review local results before enabling any production Toolkit origin. Production needs an approved extension distribution/ID and origin, staff policy checks, threat review and authentication/session lifecycle verification. Real SSA mappings and controlled live testing require separate approval; unsupported questions always pause. Nothing here authorizes a production or live-site rollout.
