# SSA Intake Assistant v1.7.0

Open `/ssa-intake-assistant/` from the Toolkit homepage or navigation. A current Toolkit session is required. Phase 1 reads a selected PDF in the browser and keeps the PDF bytes, extracted text, and reviewed profile in page memory only. Reloading, closing the page, clearing the profile, or signing out removes the active profile. The app makes no client-data API request and uses no client-data browser storage, database, analytics, or logging.

From the Toolkit root, run `npm install`, then `npm run dev`. `predev` and `build` copy OCR worker, WASM, and English model files from installed npm packages into this tool's ignored `public/ocr/` directory. The Vite server and production build serve them from `/ssa-intake-assistant/ocr/`; no OCR CDN is used. Run `npm run build` for production output and `npm run preview` to check `/ssa-intake-assistant/`.

The standalone PDF workflow uses PDF.js for text and form-field extraction. If no Phase 1 answers are found in a PDF with little direct text, it renders pages locally and runs Tesseract OCR. It extracts basic names, suffix, SSN, birth date, phone, email, and mailing address. Every answer shows a status, confidence, and source PDF page when available. Missing and conflicting values require employee review. Editing an answer resets its confirmation and profile readiness. Required Phase 1 answers must be employee-confirmed before **Mark profile ready** is enabled. The broader PDF profile schema is a draft for later phases, not a claim of complete intake coverage.

Only synthetic data belongs in tests and development screenshots. Do not copy the standalone project's named PDF or HTML files. Do not log PDF contents or extracted answers. The extension has not been migrated or connected: this release does not transfer a profile, fill SSA pages, navigate SSA pages, or submit anything. Login.gov, ID.me, credentials, MFA, CAPTCHA, attestations, signatures, and final submission are outside scope.

## Intake Checker handoff

Intake Checker v1.8.0 passes its existing parsed results, validation and review decisions to a versioned in-memory profile. SSA Intake Assistant summarizes ready/blocked fields and exact reasons without asking employees to reconfirm ready answers. Corrections update the Checker session and rerun its existing validation; Back retains that state. Editing or rechecking the original pasted text resets corrections.

See [PROFILE-CONTRACT.md](PROFILE-CONTRACT.md) for the complete 119-definition catalog, repeating medical problems, schema 3.0.0, readiness rules, source provenance, types, unmapped fields and future extension requirements. Every parsed field is retained; unsupported meanings are blocked. The standalone direct-PDF workflow remains separate and unchanged. No extension connection is included.

Run focused tests with node --test --test-isolation=none tests/intake-*.test.js ssa-intake-assistant/src/model/*.test.js ssa-intake-assistant/src/pdf/*.test.js. After the production build, run node ssa-intake-assistant/tests/workflow-browser-check.mjs followed by the Chrome executable path for desktop/mobile, correction, privacy, PDF and OCR checks.

SSA Intake Assistant v1.7.0 uses contract 3.0.0 scoped parsing requirements. Its open Unrecognized intake text panel lists each unresolved line and links directly to that text in Intake Checker. Valid unrelated answers can stay ready, but ready-field counts never imply that unresolved parsing requirements are cleared.

Unsupported questions retained from standalone plain labels remain in the profile without creating attention cards. These are separate from parsing failures: their answers are preserved, but cannot be filled until an exact mapping is implemented. Supported neighboring answers are not blocked just because another question is unsupported. Contract 3.0.0 rules and types are unchanged; this fixes input recognition.

The presentation filters acknowledged validation reasons, parsing notices and general review notifications from active lists. Ignored fields are hidden from attention counts but are not promoted to ready. Profile answers, original blocking reasons, schema 3.0.0 and readyFields() remain unchanged. Unresolved Intake Checker issues still appear. Back/Continue uses the same page-memory session.

The attention list follows unresolved Intake Checker validation only. Optional missing answers and unsupported mappings create no additional employee tasks. Once Checker issues are resolved or ignored, the handoff needs no further review. Technical fillability is unchanged: missing or unsupported answers are never invented or promoted to ready.
