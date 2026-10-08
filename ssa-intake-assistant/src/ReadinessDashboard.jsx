import { lazy, Suspense, useState } from 'react';
import { reviewPresentation } from './model/review-presentation.js';
import { profileSummary } from './model/intake-contract.js';

const display = field => field.value === null ? 'No established answer' : typeof field.value === 'boolean' ? field.value ? 'Yes' : 'No' : field.value;
const DevelopmentBridge = lazy(() => import('./DevelopmentBridge.jsx'));

export default function ReadinessDashboard({ profile, onBack, onSource, onCorrect }) {
  const { blocked, ignored, parsingIssues, requirements, reviews } = reviewPresentation(profile);
  const counts = { ...profileSummary(profile), blocked: blocked.length,
    missing: blocked.filter(field => field.blockingReasons.some(reason => reason.code === 'missing')).length,
    conflicts: blocked.filter(field => field.blockingReasons.some(reason => reason.code === 'conflict')).length };
  const ready = profile.fields.filter(field => field.readiness === 'ready');
  const priorSpouses = [...profile.fields.reduce((records, field) => {
    if (field.category === 'priorSpouses' && field.recordId) {
      const fields = records.get(field.recordId) || [];
      fields.push(field); records.set(field.recordId, fields);
    }
    return records;
  }, new Map()).entries()];
  const [message, setMessage] = useState('');
  function correct(id, value) {
    window.dispatchEvent(new Event('packard-ssa-revoke'));
    const result = onCorrect(id, value);
    setMessage(result ? 'Correction applied to Intake Checker in memory. Readiness was recalculated using its existing validation.' : 'This source is ambiguous. Correct the pasted intake in Intake Checker.');
  }
  return <div className="ssa-workspace ssa-readiness">
    <section className="privacy-notice"><strong>Page memory only.</strong> Closing or reloading clears the intake and profile. No client-data uploads or saved profiles.</section>
    <header className="readiness-header">
      <div><p className="eyebrow">SSA Intake Assistant v1.25.0</p><h2>Client profile readiness</h2>
        <p>Intake Checker is the source of truth. Only unresolved Intake Checker issues need attention here.</p></div>
      <button className="button quiet" onClick={() => onBack()}>Back to Intake Checker</button>
    </header>
    {['http://127.0.0.1:5173/intake-checker/', 'http://localhost:5173/intake-checker/'].includes(location.href) && import.meta.env.DEV && <Suspense fallback={<p>Loading development connection…</p>}><DevelopmentBridge profile={profile} /></Suspense>}
    {location.href === 'https://packardtoolkit.vercel.app/intake-checker/' && <Suspense fallback={<p>Loading Chrome practice pilot…</p>}><DevelopmentBridge hostedPilot /></Suspense>}
    <dl className="readiness-counts" aria-label="Profile readiness summary">
      {[["total", "Total fields"], ["ready", "Ready"], ["blocked", "Needs attention"], ["missing", "Missing"], ["conflicts", "Conflicts"]].map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd data-count={key}>{counts[key]}</dd></div>)}
    </dl>
    <p className="notes">{counts.received} fields received from the active intake; {counts.total - counts.received} missing required fields included. Missing and conflict counts refer to items still needing attention.</p>
    <p className="notes">Ready means an established intake answer, not that every SSA question has been answered. Optional blanks and unmapped information do not create additional review tasks. Future questions with no exact supported mapping must pause.</p>
    {ignored.length > 0 && <p className="notes ignored-summary">{ignored.length} fields hidden based on your Intake Checker review decisions. Ignoring does not change answers or mark them ready.</p>}
    {!blocked.length && !parsingIssues.length && !requirements.length && !reviews.length && <p role="status">Intake Checker review complete. No additional review needed here.</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {parsingIssues.length > 0 && <section className="review-card parsing-issues" aria-labelledby="parsing-title">
      <h3 id="parsing-title">Unrecognized intake text ({parsingIssues.length})</h3>
      <p>These lines still require correction. Only their affected sections or records are blocked; unrelated answers may remain ready.</p>
      <ul>{parsingIssues.map(issue => <li key={issue.id}>{issue.message}{issue.sources.map((range, index) =>
        <button key={index} type="button" className="button quiet" onClick={() => onSource(range)}>Find unrecognized text on line {issue.line}</button>)}</li>)}</ul>
    </section>}
    <section className="review-card blocked-fields" aria-labelledby="blocked-title">
      <h3 id="blocked-title">Fields needing attention ({blocked.length})</h3>
      {!blocked.length && <p>No additional fields need your attention.</p>}
      {blocked.map(field => <BlockedField key={field.id} field={field} onSource={onSource} onCorrect={correct} />)}
    </section>
    <details className="review-card ready-fields">
      <summary>Ready fields ({ready.length}) — no further confirmation</summary>
      <ul>{ready.map(field => <li key={field.id} data-field-id={field.id}><strong>{field.label}</strong> · {field.category}{field.recordId ? ` / ${field.recordId}` : ''}: {display(field)}{field.origin === 'employee_entered' && <span> · Employee-entered</span>}</li>)}</ul>
    </details>
    {requirements.length > 0 && <details className="review-card">
      <summary>Other Intake Checker requirements</summary>
      <ul>{requirements.map(issue => <li key={issue.id}>{issue.section}{issue.record ? ` / ${issue.record}` : ''}: {issue.message}{issue.acknowledged ? ' (Reviewed in Intake Checker)' : ''}</li>)}</ul>
    </details>}
    {priorSpouses.length > 0 && <section className="review-card prior-marriages" aria-labelledby="prior-marriages-title">
      <h3 id="prior-marriages-title">Previous marriages ({priorSpouses.length})</h3>
      <p>Each numbered prior-spouse record is separate from Current Spouse. Missing answers are not inferred.</p>
      {priorSpouses.map(([recordId, fields], index) => <article className="prior-spouse-record" key={recordId} data-prior-spouse-record={recordId}>
        <h4>Previous Spouse {index + 1}</h4>
        {fields[0]?.recordSource && <button type="button" className="button quiet" onClick={() => onSource(fields[0].recordSource)}>Find record heading in Intake</button>}
        <div className="prior-spouse-fields">{fields.map(field => <PriorSpouseField key={field.id} field={field} onSource={onSource} onCorrect={correct} />)}</div>
      </article>)}
    </section>}
    <details className="review-card">
      <summary>Remaining Intake Checker notices ({reviews.length})</summary>
      <p>General review flags do not change answers or automatically block valid fields.</p>
      <ul>{reviews.map(item => <li key={item.id}>{item.message} — {item.acknowledged ? 'Reviewed / dismissed' : 'Not reviewed'}</li>)}</ul>
    </details>
  </div>;
}

function PriorSpouseField({ field, onSource, onCorrect }) {
  const [value, setValue] = useState(field.employeeReview.edits.at(-1)?.value ?? field.sources[0]?.rawValue ?? '');
  const currentValue = field.value !== null ? display(field)
    : field.blockingReasons.some(reason => reason.code === 'missing') ? 'Not provided' : 'No established answer';
  const status = field.readiness === 'ready' ? 'Ready'
    : field.blockingReasons.some(reason => reason.code === 'conflict') ? 'Conflict'
      : field.validation.status === 'unresolved' ? 'Needs correction' : 'Not provided / not ready';
  return <article className="prior-spouse-field" data-field-id={field.id}>
    <h5>{field.label}</h5>
    <p>Current value: <strong>{currentValue}</strong></p>
    <p>Validation: {field.validation.status} · {status}</p>
    {field.sources.map((source, index) => <p key={index}>Original value: {source.rawValue ?? 'Not provided'}{' '}
      {source.range && <button type="button" className="button quiet" onClick={() => onSource(source.range)}>Find value in Intake</button>}</p>)}
    {!field.sources.length && field.recordSource && <p>Field location: absent from this record.{' '}
      <button type="button" className="button quiet" onClick={() => onSource(field.recordSource)}>Find record heading</button></p>}
    {field.employeeReview.edits.map((edit, index) => <p className="notes" key={`${edit.revision}-${index}`}>Employee correction {index + 1}: {edit.value || 'Not provided'}</p>)}
    {field.validation.issues.map(issue => <p className="notes" key={issue.id}>{issue.message}</p>)}
    {field.correctionTarget && field.readiness === 'blocked' && <form onSubmit={event => { event.preventDefault(); onCorrect(field.id, value); }}>
      <label htmlFor={'prior-correct-' + field.id}>Correct {field.label}</label>
      <input id={'prior-correct-' + field.id} value={value} onChange={event => setValue(event.target.value)} autoComplete="off" />
      <button className="button primary" type="submit">Apply correction</button>
    </form>}
  </article>;
}

function BlockedField({ field, onSource, onCorrect }) {
  const [value, setValue] = useState(field.employeeReview.edits.at(-1)?.value ?? field.sources[0]?.rawValue ?? '');
  const warningOnly = field.blockingReasons.every(reason => reason.code === 'validation' && field.validation.issues.find(issue => issue.id === reason.issueId)?.severity === 'warning');
  return <details className="blocked-field" data-field-id={field.id} data-severity={warningOnly ? 'warning' : 'error'}>
    <summary><strong>{field.label}</strong><span>{field.category}{field.recordId ? ` / ${field.recordId}` : ''}</span><span className="status-pill">{field.category === 'unsupported' ? 'Not mapped yet' : field.blockingReasons.some(reason => reason.code === 'conflict') ? 'Conflict' : field.blockingReasons.some(reason => reason.code === 'missing') ? 'Missing' : 'Blocked'}</span></summary>
    <ul>{field.blockingReasons.map((reason, index) => <li key={index}>{reason.message}
      {field.validation.issues.find(issue => issue.id === reason.issueId && issue.code === 'parsing')?.sources.map((range, sourceIndex) =>
        <button key={sourceIndex} type="button" className="button quiet" onClick={() => onSource(range)}>Find unrecognized text</button>)}
    </li>)}</ul>
    {field.sources.map((source, index) => <p key={index} className="notes">Source: {source.rawValue ?? 'Not provided'}{' '}
      {source.range && <button type="button" className="button quiet" onClick={() => onSource(source.range)}>Find in Intake</button>}</p>)}
    {field.origin === 'employee_entered' && <p className="notes">Current value was employee-entered.</p>}
    {field.correctionTarget ? <form onSubmit={event => { event.preventDefault(); onCorrect(field.id, value); }}>
      <label htmlFor={'correct-' + field.id}>Correct {field.label}</label>
      <input id={'correct-' + field.id} value={value} onChange={event => setValue(event.target.value)} autoComplete="off" />
      <button className="button primary" type="submit">Apply correction</button>
    </form> : <p>{field.category === 'unsupported' ? 'No intake correction is required just because this question is not mapped yet. Its original answer is preserved.' : 'Resolve this field in the pasted intake. No answer will be guessed.'}</p>}
  </details>;
}
