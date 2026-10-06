# Synthetic extension development 0.1.0

This isolated Manifest V3 prototype opens its own practice page. It has **zero permissions**, no content script, service worker, Toolkit connection, external services, upload or profile import. It cannot inspect any website, obtain authentication cookies/tokens, or fill real SSA pages. The original standalone extension remains unchanged.

## Install locally

In Chrome open `chrome://extensions` (Edge: `edge://extensions`), enable Developer mode, select **Load unpacked**, and choose this `extension-dev` folder. Click its toolbar action, then **Open practice page**. Choose **Fill synthetic answers**: six fictional answers fill, three pause. Existing answers are preserved. Clear or reload to reset. Never enter client data.

If firm policy prevents Developer mode/unpacked extensions, stop and ask the administrator for an approved development browser profile. Do not bypass policy. No staff deployment or store publishing is included. Local updates use the extension page's Reload button, then reopen the practice tab. Remove this development extension when finished.

## Exact scope

Eight mappings: first name, last name, optional middle name, phone, email, date of birth, disability onset, last day worked. A ninth practice question, date work stopped, is deliberately unsupported and never substituted with onset or last worked. These invented questions/selectors are **not verified against SSA**. They are not evidence of live-site compatibility.

The consumer checks contract name and version 3.0.0, exact definition ID, one singleton field, type, ready state, empty blocking reasons and required date precision. Missing/blocked answers pause without becoming new Intake Checker errors. An ignored error still cannot produce a fabricated fill value. Changes to the page targets pause; existing employee answers are never overwritten. No automatic clicking, navigation or submission exists.

All code/assets ship inside the extension. CSP forbids network connections and form submission. Synthetic values are created in memory on an explicit click. Clear, pagehide and reload clear inputs. No storage, telemetry or console logging is used. The practice inputs are solely for fictional examples, with autocomplete disabled.

## Checks

From the Toolkit root:

```powershell
node --test --test-isolation=none tests/ssa-extension-practice.test.mjs
node ssa-intake-assistant/tests/extension-practice-browser.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The browser harness exercises the exact packaged practice files over loopback without loading any client data or visiting SSA. An actual unpacked install must additionally be verified in the firm's approved Chrome/Edge environment; browser policy cannot be established from repository code.

## Next decisions

After this prototype, design the explicit employee-approved, short-lived in-memory Toolkit bridge with strict origin/tab/session binding and clearing on disconnect. That bridge is not implemented here. Then verify each actual SSA question and page shape under a separately approved controlled testing plan. Unknown or unsupported questions must pause. Credentials, MFA, CAPTCHA, attestations, signatures, penalty-of-perjury confirmations and final submission remain manual.
