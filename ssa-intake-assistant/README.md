# SSA Intake Assistant v1.11.0

## Intake Checker handoff

Check and review the intake in Intake Checker, then select **Continue to SSA Intake Assistant**. Continue remains disabled until every validation issue and review flag has been resolved or ignored in Intake Checker. The handoff has one primary action, **Open client filing**, which reveals a read-only text box below it. A Back button returns to Intake Checker. Each entry displays its field name and current value, such as `FirstName: Synthetic`. Sections and repeating records remain separate; duplicate occurrences retain numbered labels. Missing values display `Not provided`. Invalid and ambiguous inputs remain visible as entered, without being converted into validated answers. Unmapped text is preserved in its own group.

The preview consumes the Checker-owned canonical snapshot described in [CLIENT-DATA.md](../intake-checker/CLIENT-DATA.md). It does not reparse, validate, filter by SSA readiness, or ask employees to review results again. Employee corrections use the current Checker values. Back returns to the unchanged active intake and review decisions; reopening starts with the preview collapsed.

The preview opens no SSA page, browser tab, or extension connection. Earlier practice bridge controls are no longer mounted in this view. The existing bridge protocol and isolated extension practice code are retained separately; see [extension-dev/README.md](extension-dev/README.md). The legacy SSA projection contract remains documented in [PROFILE-CONTRACT.md](PROFILE-CONTRACT.md), but is not used to render the filing preview.

## Privacy

The intake, snapshot and preview stay in browser-page memory. No client data enters storage, URLs, navigation history, databases, logs, analytics or network requests. The existing Toolkit authentication request contains no intake values. Reload, page close, Clear, source edits and account loss clear the active session. Back clears the preview and preserves the Checker session. Selecting and manually copying text puts that selected text on the employee's clipboard.

## Standalone PDF backup

The `/ssa-intake-assistant/` route retains the separate authenticated PDF upload workflow. PDF.js extracts text and form fields locally. When little direct text yields no Phase 1 answers, locally bundled Tesseract OCR is used. Existing basic names, suffix, SSN, birth date, phone, email and mailing-address extraction, source pages, review, confirmation reset and readiness rules are unchanged. OCR is not expanded by the filing preview.

## Setup and verification

From the Toolkit root run `npm install`, then `npm run dev`. `predev` and `build` copy the OCR worker, WASM and English model from installed packages into the ignored `public/ocr/` directory. Assets are served locally at `/ssa-intake-assistant/ocr/`, without a CDN. Run `npm run build` for production output.

Focused tests: `node --test --test-isolation=none tests/ssa-client-filing.test.js tests/intake-*.test.js ssa-intake-assistant/src/model/*.test.js ssa-intake-assistant/src/pdf/*.test.js`.

After building, run `node ssa-intake-assistant/tests/workflow-browser-check.mjs` followed by the Chrome executable path for the filing preview, Back, memory lifecycle, authentication, desktop/mobile layout, direct PDF and synthetic scanned/OCR checks. The production navigation harness is `tests/navigation-browser-check.mjs`, also followed by the Chrome path.

Use only clearly synthetic fixtures and screenshots. Never log extracted contents or copy unverified named fixtures from the standalone project. Login.gov, ID.me, credentials, MFA, CAPTCHA, attestations, signatures and final submission remain outside scope.
