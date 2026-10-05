import { useEffect, useMemo, useRef, useState } from 'react';
import { createClientProfile } from './model/client-schema.js';
import { profileCanBeMarkedReady } from './model/validation.js';
import { editAnswer, confirmAnswer, markProfileReady, phaseOneRequiredPaths } from './model/review.js';
import { extractPdfPages } from './pdf/extractPdf.js';
import { parseIntakePages } from './pdf/parseIntake.js';

const SECTIONS = [
  {
    title: 'Personal information',
    fields: [
      ['personal.firstName', 'First name', true],
      ['personal.middleName', 'Middle name', false],
      ['personal.lastName', 'Last name', true],
      ['personal.suffix', 'Suffix', false],
      ['personal.ssn', 'Social Security number', true],
      ['personal.dateOfBirth', 'Date of birth', true],
    ],
  },
  {
    title: 'Contact information',
    fields: [
      ['contact.phone', 'Primary phone', true],
      ['contact.alternatePhone', 'Alternate phone', false],
      ['contact.email', 'Email', false],
      ['contact.mailingAddress.street1', 'Mailing street', true],
      ['contact.mailingAddress.street2', 'Apartment / suite', false],
      ['contact.mailingAddress.city', 'City', true],
      ['contact.mailingAddress.state', 'State', true],
      ['contact.mailingAddress.zip', 'ZIP code', true],
    ],
  },
];

const STEPS = ['Upload intake PDF', 'Extract information', 'Review answers', 'Mark ready'];

export default function App({ initialProfile, onBack, onSource }) {
  const [profile, setProfile] = useState(() => initialProfile || createClientProfile());
  const [phase, setPhase] = useState(initialProfile ? 'review' : 'upload');
  const [message, setMessage] = useState('Choose a completed intake PDF. Processing stays in this browser tab.');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // Reopening the same intake updates acknowledgements, preserving SSA edits/confirmations.
  useEffect(() => {
    if (!initialProfile) return;
    setProfile(current => {
      const next = structuredClone(current);
      next.source = initialProfile.source;
      for (const section of SECTIONS) for (const [path] of section.fields) {
        getAtPath(next, path).intakeIssues = getAtPath(initialProfile, path).intakeIssues;
      }
      return next;
    });
  }, [initialProfile]);

  const requiredComplete = useMemo(
    () => profileCanBeMarkedReady(profile, phaseOneRequiredPaths),
    [profile],
  );
  const stats = useMemo(() => {
    const fields = SECTIONS.flatMap((section) => section.fields.map(([path]) => getAtPath(profile, path)));
    return {
      confirmed: fields.filter((field) => field.status === 'confirmed').length,
      attention: fields.filter((field) => ['missing', 'conflict', 'needs_review'].includes(field.status)).length,
      total: fields.length,
    };
  }, [profile]);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.');
      return;
    }
    setError('');
    setProfile(createClientProfile());
    setPhase('extracting');
    setMessage('Reading PDF text locally in this browser…');
    try {
      let extraction = await extractPdfPages(file);
      let nextProfile = parseIntakePages(
        extraction.pages,
        file.name,
        extraction.formFields,
        extraction.diagnostics,
      );
      let extractedCount = countExtractedAnswers(nextProfile);

      const appearsScanned = extraction.diagnostics.textItemCount < 20
        && extraction.diagnostics.completedFormFieldCount === 0;
      if (extractedCount === 0 && appearsScanned) {
        setMessage('No direct matches found. Starting local OCR…');
        extraction = await extractPdfPages(file, {
          useOcr: true,
          onProgress: updateOcrMessage,
        });
        nextProfile = parseIntakePages(
          extraction.pages,
          file.name,
          extraction.formFields,
          extraction.diagnostics,
        );
        extractedCount = countExtractedAnswers(nextProfile);
      }

      setProfile(nextProfile);
      setPhase('review');
      setMessage(
        extractedCount
          ? `Found ${extractedCount} Phase 1 answer${extractedCount === 1 ? '' : 's'}${extraction.diagnostics.ocrUsed ? ' using local OCR' : ''}. Review every answer before marking ready.`
          : 'OCR completed, but no Phase 1 answers matched. The scan may be low quality or use different labels.',
      );
    } catch {
      setPhase('upload');
      setError('The PDF or local OCR process could not be completed. Try a clearer scan or a smaller PDF.');
      setMessage('No client information was retained.');
    } finally {
      event.target.value = '';
    }
  }

  function handleValueChange(path, value) {
    setProfile((current) => editAnswer(current, path, value));
  }

  function handleConfirmation(path, confirmed) {
    setProfile((current) => confirmAnswer(current, path, confirmed));
  }

  function markReady() {
    if (!requiredComplete) return;
    setProfile((current) => markProfileReady(current));
    setMessage('Profile marked ready for a future assisted-filling phase. No information has been sent or saved.');
  }

  function clearProfile() {
    setProfile(createClientProfile());
    setPhase('upload');
    setError('');
    setMessage('Client information was cleared from this browser tab.');
    inputRef.current?.focus();
  }

  function updateOcrMessage(progress) {
    if (progress.stage === 'ocr_loading') {
      setMessage('Loading the bundled local OCR engine…');
      return;
    }
    const page = progress.pageNumber || 1;
    const percent = Math.round((progress.progress ?? 0) * 100);
    setMessage(`Running local OCR on page ${page} of ${progress.pageCount}${percent ? ` · ${percent}%` : ''}…`);
  }

  const activeStep = phase === 'upload' ? 0 : phase === 'extracting' ? 1 : profile.ready ? 3 : 2;

  return (
    <div className="ssa-workspace">
        <section className="privacy-notice" aria-label="Privacy notice">
          <strong>Local processing.</strong> Phase 1 keeps {initialProfile ? 'the intake and active profile' : 'the PDF and active profile'} in this browser tab’s memory. They are cleared when you close or reload the page. No answers are sent or saved.
        </section>

        {!initialProfile && <nav className="steps" aria-label="Workflow progress">
          {STEPS.map((step, index) => (
            <div className={`step ${index === activeStep ? 'active' : ''} ${index < activeStep ? 'done' : ''}`} key={step}>
              <span>{index + 1}</span><small>{step}</small>
            </div>
          ))}
        </nav>}

        {!initialProfile && <section className="upload-card">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Upload a completed intake</h2>
            <p>{message}</p>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
          <div className="upload-actions">
            <label className={`button primary ${phase === 'extracting' ? 'disabled' : ''}`}>
              {phase === 'extracting' ? 'Extracting…' : 'Choose PDF'}
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={handleUpload} disabled={phase === 'extracting'} />
            </label>
            {phase === 'review' && <button className="button quiet" onClick={clearProfile}>Clear profile</button>}
          </div>
        </section>}
        {initialProfile && <section className="upload-card">
          <div><h2>Prepare SSA answers</h2><p>{initialProfile.source.transferredCount} fields transferred from Intake Checker · {stats.attention} need attention.</p>
          <p>Reviewed issues are acknowledgements, not verified SSA answers. Confirm each answer for its SSA meaning.</p></div>
          <button className="button quiet" onClick={() => onBack()}>Back to Intake Checker</button>
        </section>}
        {phase === 'review' && (
          <>
            <section className="review-heading">
              <div>
                <p className="eyebrow">{initialProfile ? 'SSA review' : 'Step 3'}</p>
                <h2>Review extracted answers</h2>
                <p className="file-name">Source: {initialProfile ? "Intake Checker · current pasted intake" : `${profile.source.fileName} · ${profile.source.pageCount} pages`}</p>
                {!initialProfile && <ExtractionSummary diagnostics={profile.source.diagnostics} />}
                {initialProfile && profile.source.parsingNeedsReview && <p className="notes">Some source text was not recognized by Intake Checker. Check the source before confirming SSA answers.</p>}
              </div>
              <div className="summary" aria-label="Review summary">
                <strong>{stats.confirmed}/{stats.total}</strong>
                <span>answers confirmed</span>
                <small>{stats.attention} need attention</small>
              </div>
            </section>

            {SECTIONS.map((section) => (
              <section className="review-card" key={section.title}>
                <h3>{section.title}</h3>
                <div className="field-grid">
                  {section.fields.map(([path, label, required]) => (
                    <ReviewField
                      key={path}
                      field={getAtPath(profile, path)}
                      onSource={onSource}
                      label={label}
                      required={required}
                      onValue={(value) => handleValueChange(path, value)}
                      onConfirm={(confirmed) => handleConfirmation(path, confirmed)}
                    />
                  ))}
                </div>
              </section>
            ))}

            <section className="ready-card">
              <div>
                <h2>{profile.ready ? 'Profile ready' : 'Ready for assisted filling?'}</h2>
                <p>{requiredComplete ? 'All required Phase 1 answers are employee-confirmed.' : 'Confirm every required answer. Optional missing answers can remain blank for later review.'}</p>
              </div>
              <button className="button primary" disabled={!requiredComplete || profile.ready} onClick={markReady}>
                {profile.ready ? 'Ready' : 'Mark profile ready'}
              </button>
            </section>
          </>
        )}
    </div>
  );
}

function ExtractionSummary({ diagnostics = {} }) {
  const textItems = diagnostics.textItemCount ?? 0;
  const formFields = diagnostics.completedFormFieldCount ?? 0;
  return (
    <p className={`extraction-summary ${diagnostics.hasExtractableContent === false ? 'warning' : ''}`}>
      PDF reader detected {textItems} text fragment{textItems === 1 ? '' : 's'} and {formFields} completed form field{formFields === 1 ? '' : 's'}.
      {diagnostics.ocrUsed && ` Local OCR recognized text on ${diagnostics.ocrPageCount ?? 0} page${diagnostics.ocrPageCount === 1 ? '' : 's'}.`}
      {' '}Parser accepted {diagnostics.parserCandidateCount ?? 0} candidate{diagnostics.parserCandidateCount === 1 ? '' : 's'} and rejected {diagnostics.parserRejectedCount ?? 0} placeholder or malformed candidate{diagnostics.parserRejectedCount === 1 ? '' : 's'}.
      {diagnostics.hasExtractableContent === false && ' No readable text was found, even with OCR.'}
    </p>
  );
}

function ReviewField({ field, label, required, onValue, onConfirm, onSource }) {
  const statusLabel = { confirmed: 'Confirmed by employee', needs_review: 'Needs SSA review', missing: 'Missing', conflict: 'Conflict', firm_standard: 'Firm standard' }[field.status];
  return (
    <article className={`review-field status-${field.status}`}>
      <div className="field-title">
        <label htmlFor={label.replace(/\s+/g, '-').toLowerCase()}>{label}{required && <span aria-label="required"> *</span>}</label>
        <span className="status-pill">{statusLabel}</span>
      </div>
      <input
        id={label.replace(/\s+/g, '-').toLowerCase()}
        value={field.value ?? ''}
        placeholder="Missing — enter an answer"
        onChange={(event) => onValue(event.target.value)}
        autoComplete="off"
      />
      <div className="field-meta">
        <span>{field.sourceLocations?.length ? 'Pasted intake source' : field.sourcePage ? `PDF page ${field.sourcePage}` : 'No source location'}</span>
        <span>Confidence {Math.round(field.confidence * 100)}%</span>
      </div>
      {field.sourceLocations?.map((source, index) => <button type="button" className="button quiet" key={index} onClick={() => onSource?.(source.range)}>Find in Intake: {source.label}{field.sourceLocations.length > 1 ? ` (${index + 1})` : ""}</button>)}
      {field.intakeIssues?.map((issue, index) => <p className="notes" key={index}>{issue.reviewed ? "Reviewed in Intake Checker: " : "Intake Checker issue: "}{issue.message}</p>)}
      {field.notes && <p className="notes">{field.notes}</p>}
      <label className="confirm-control">
        <input type="checkbox" checked={field.employeeConfirmed} disabled={!String(field.value).trim()} onChange={(event) => onConfirm(event.target.checked)} />
        Employee verified this answer
      </label>
    </article>
  );
}

function getAtPath(object, path) {
  return path.split('.').reduce((current, key) => current?.[key], object);
}

function countExtractedAnswers(profile) {
  return SECTIONS.flatMap((section) => section.fields)
    .filter(([path]) => String(getAtPath(profile, path)?.value ?? '').trim()).length;
}
