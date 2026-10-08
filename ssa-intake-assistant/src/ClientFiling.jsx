import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { clientFilingText } from './model/client-filing-text.js';
import { canonicalPracticeProfile } from './model/canonical-practice-profile.js';

const DevelopmentBridge = lazy(() => import('./DevelopmentBridge.jsx'));
const LiveLaunch = lazy(() => import('./LiveLaunch.jsx'));

export default function ClientFiling({ data, onBack }) {
  const [open, setOpen] = useState(false);
  const textBox = useRef(null);
  const practiceProfile = useMemo(() => canonicalPracticeProfile(data), [data]);
  const localPractice = import.meta.env.DEV && ['http://127.0.0.1:5173/intake-checker/', 'http://localhost:5173/intake-checker/'].includes(location.href);
  const hostedPilot = location.href === 'https://packardtoolkit.vercel.app/intake-checker/';
  useEffect(() => { if (open) textBox.current?.focus(); }, [open]);
  return <section className="ssa-workspace ssa-client-filing">
    <header className="filing-header">
      <h2>SSA Intake Assistant</h2>
      <button type="button" className="button quiet" onClick={onBack}>Back to Intake Checker</button>
    </header>
    <div className="filing-actions">
      <button type="button" className="button primary" aria-expanded={open} aria-controls="clientFilingText" onClick={() => setOpen(true)}>Open client filing</button>
      <Suspense fallback={null}><LiveLaunch profile={practiceProfile} /></Suspense>
    </div>
    {open && <textarea ref={textBox} id="clientFilingText" aria-label="Client filing data" readOnly spellCheck={false} autoComplete="off" value={clientFilingText(data)} />}
    {open && (localPractice || hostedPilot) && <Suspense fallback={null}>
      <DevelopmentBridge profile={practiceProfile} />
    </Suspense>}
  </section>;
}
