import { useState } from 'react';
import { profileSummary } from './model/intake-contract.js';

const display = field => field.value === null ? 'No established answer' : typeof field.value === 'boolean' ? field.value ? 'Yes' : 'No' : field.value;

export default function ReadinessDashboard({ profile, onBack, onSource, onCorrect }) {
  const counts = profileSummary(profile);
  const blocked = profile.fields.filter(field => field.readiness === 'blocked');
  const ready = profile.fields.filter(field => field.readiness === 'ready');
  const [message, setMessage] = useState('');
  function correct(id, value) {
    const result = onCorrect(id, value);
    setMessage(result ? 'Correction applied to Intake Checker in memory. Readiness was recalculated using its existing validation.' : 'This source is ambiguous. Correct the pasted intake in Intake Checker.');
  }
  return <div className="ssa-workspace ssa-readiness">
    <section className="privacy-notice"><strong>Page memory only.</strong> Closing or reloading clears the intake and profile. Nothing is sent or saved.</section>
    <header className="readiness-header">
      <div><p className="eyebrow">SSA Intake Assistant v1.2.0</p><h2>Client profile readiness</h2>
        <p>Intake Checker is the source of truth. Ready fields need no additional confirmation.</p></div>
      <button className="button quiet" onClick={() => onBack()}>Back to Intake Checker</button>
    </header>
    <dl className="readiness-counts" aria-label="Profile readiness summary">
      {[["total", "Total fields"], ["ready", "Ready"], ["blocked", "Blocked"], ["missing", "Missing"], ["conflicts", "Conflicts"]].map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd data-count={key}>{counts[key]}</dd></div>)}
    </dl>
    <p className="notes">{counts.received} fields received from the active intake; {counts.total - counts.received} missing required fields included. Missing and conflict counts are subsets of blocked fields.</p>
    <p className="notes">Ready means an established intake answer, not that every SSA question has been answered. Future questions with no exact supported mapping must pause.</p>
    <p role="status" aria-live="polite">{message}</p>
    <section className="review-card blocked-fields" aria-labelledby="blocked-title">
      <h3 id="blocked-title">Blocked fields ({blocked.length})</h3>
      {!blocked.length && <p>No received fields are blocked.</p>}
      {blocked.map(field => <BlockedField key={field.id} field={field} onSource={onSource} onCorrect={correct} />)}
    </section>
    <details className="review-card ready-fields">
      <summary>Ready fields ({ready.length}) — no further confirmation</summary>
      <ul>{ready.map(field => <li key={field.id} data-field-id={field.id}><strong>{field.label}</strong> · {field.category}{field.recordId ? ` / ${field.recordId}` : ''}: {display(field)}{field.origin === 'employee_entered' && <span> · Employee-entered</span>}</li>)}</ul>
    </details>
    {(profile.requirements.length > 0 || profile.unparsed.length > 0) && <details className="review-card">
      <summary>Other Intake Checker requirements</summary>
      <ul>{profile.requirements.map(issue => <li key={issue.id}>{issue.section}{issue.record ? ` / ${issue.record}` : ''}: {issue.message}{issue.acknowledged ? ' (Reviewed in Intake Checker)' : ''}</li>)}</ul>
      {profile.unparsed.length > 0 && <p>Some source text was not parsed. Return to Intake Checker to resolve the source.</p>}
    </details>}
    <details className="review-card">
      <summary>Intake Checker review decisions ({profile.reviewDecisions.length})</summary>
      <p>General review flags do not change answers or automatically block valid fields.</p>
      <ul>{profile.reviewDecisions.map(item => <li key={item.id}>{item.message} — {item.acknowledged ? 'Reviewed / dismissed' : 'Not reviewed'}</li>)}</ul>
    </details>
  </div>;
}

function BlockedField({ field, onSource, onCorrect }) {
  const [value, setValue] = useState(field.employeeReview.edits.at(-1)?.value ?? field.sources[0]?.rawValue ?? '');
  return <details className="blocked-field" data-field-id={field.id}>
    <summary><strong>{field.label}</strong><span>{field.category}{field.recordId ? ` / ${field.recordId}` : ''}</span><span className="status-pill">{field.blockingReasons.some(reason => reason.code === 'conflict') ? 'Conflict' : field.blockingReasons.some(reason => reason.code === 'missing') ? 'Missing' : 'Blocked'}</span></summary>
    <ul>{field.blockingReasons.map((reason, index) => <li key={index}>{reason.message}</li>)}</ul>
    {field.sources.map((source, index) => <p key={index} className="notes">Source: {source.rawValue ?? 'Not provided'}{' '}
      {source.range && <button type="button" className="button quiet" onClick={() => onSource(source.range)}>Find in Intake</button>}</p>)}
    {field.origin === 'employee_entered' && <p className="notes">Current value was employee-entered.</p>}
    {field.correctionTarget ? <form onSubmit={event => { event.preventDefault(); onCorrect(field.id, value); }}>
      <label htmlFor={'correct-' + field.id}>Correct {field.label}</label>
      <input id={'correct-' + field.id} value={value} onChange={event => setValue(event.target.value)} autoComplete="off" />
      <button className="button primary" type="submit">Apply correction</button>
    </form> : <p>Resolve this field in the pasted intake. No answer will be guessed.</p>}
  </details>;
}
