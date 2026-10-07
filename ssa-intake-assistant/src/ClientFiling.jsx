import { useEffect, useRef, useState } from 'react';
import { clientFilingText } from './model/client-filing-text.js';

export default function ClientFiling({ data, onBack }) {
  const [open, setOpen] = useState(false);
  const textBox = useRef(null);
  useEffect(() => { if (open) textBox.current?.focus(); }, [open]);
  return <section className="ssa-workspace ssa-client-filing">
    <header className="filing-header">
      <h2>SSA Intake Assistant</h2>
      <button type="button" className="button quiet" onClick={onBack}>Back to Intake Checker</button>
    </header>
    <button type="button" className="button primary" aria-expanded={open} aria-controls="clientFilingText" onClick={() => setOpen(true)}>Open client filing</button>
    {open && <textarea ref={textBox} id="clientFilingText" aria-label="Client filing data" readOnly spellCheck={false} autoComplete="off" value={clientFilingText(data)} />}
  </section>;
}
