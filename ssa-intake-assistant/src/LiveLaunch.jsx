import { useEffect, useRef, useState } from 'react';
import { LIVE_EXTENSION_ID } from './model/live-extension-id.js';

const sources = new Set([
  'https://packardtoolkit.vercel.app/intake-checker/',
  'http://localhost:5173/intake-checker/',
  'http://127.0.0.1:5173/intake-checker/',
]);

const send = message => new Promise(resolve => {
  try {
    chrome.runtime.sendMessage(LIVE_EXTENSION_ID, message, reply =>
      resolve(chrome.runtime.lastError ? null : reply));
  } catch { resolve(null); }
});

export default function LiveLaunch({ profile }) {
  const [status, setStatus] = useState('');
  const [reentry, setReentry] = useState('');
  const session = useRef(null);
  const ssnFields = profile?.fields?.filter(field => field.definitionId === 'personal.social-security-number'
    && field.recordId === null && field.readiness === 'ready' && field.blockingReasons?.length === 0
    && field.dataType === 'text' && /^\d{3}-\d{2}-\d{4}$/.test(field.value)) || [];
  const readySsn = ssnFields.length === 1 ? ssnFields[0].value : null;

  useEffect(() => {
    let stopped = false;
    const pulse = async () => {
      if (stopped || !session.current) return;
      try {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok || (await response.json()).authenticated !== true) throw Error('auth');
        const reply = await send({ type: 'identity-heartbeat', session: session.current });
        if (!reply?.alive) throw Error('extension');
        if (reply.stage === 'filled') setStatus('SSN and re-entry number were filled on SSA. Review them there before continuing.');
        if (reply.stage === 'paused') setStatus(reply.reason === 'unverified-controls'
          ? 'The identity inputs could not be matched one-to-one. Continue manually; no further fields were filled.'
          : 'The SSA page or saved-application control could not be verified. Continue manually; no further fields were filled.');
      } catch {
        const id = session.current; session.current = null;
        if (id) void send({ type: 'clear-identity', session: id });
        setStatus('Connection ended. The identity values were cleared; start again if needed.');
      }
    };
    const timer = setInterval(pulse, 5000);
    const clear = () => {
      stopped = true; clearInterval(timer);
      const id = session.current; session.current = null;
      if (id) void send({ type: 'clear-identity', session: id });
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('packard-ssa-revoke', clear);
    window.addEventListener('packardaccountchange', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('packard-ssa-revoke', clear);
      window.removeEventListener('packardaccountchange', clear);
      clear();
    };
  }, []);

  async function open() {
    if (!sources.has(location.href) || window.top !== window || !window.chrome?.runtime?.sendMessage) {
      setStatus('Open the supported Toolkit page in Chrome with the SSA Page Review extension installed.'); return;
    }
    setStatus('Opening SSA…');
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || (await response.json()).authenticated !== true) throw new Error('auth');
      if (!readySsn) { setStatus('The intake has no ready SSN. Resolve it in Intake Checker first.'); return; }
      if (!reentry.trim() || reentry.length > 64 || /[^\x20-\x7E]/.test(reentry)) {
        setStatus('Enter the re-entry number for this saved application.'); return;
      }
      const id = crypto.randomUUID();
      const reply = await send({ type: 'start-identity', session: id, ssn: readySsn, reentry });
      setReentry('');
      if (!reply?.opened) {
        setStatus('The development extension did not open SSA. Reload it in Chrome, then try again.'); return;
      }
      session.current = id;
      setStatus('SSA opened. Review the Terms of Service and click Next. The extension will look for the saved-application path and identity fields.');
    } catch { setStatus('Toolkit authentication could not be verified. Sign in and try again.'); }
  }
  return <div className="live-launch">
    <label htmlFor="ssa-reentry">Re-entry number (temporary)</label>
    <input id="ssa-reentry" type="password" value={reentry} onChange={event => setReentry(event.target.value)}
      autoComplete="off" spellCheck={false} maxLength={64} aria-describedby="ssa-reentry-note" />
    <span id="ssa-reentry-note">Cleared from this page after launch or reload. Never saved in Toolkit preferences.</span>
    <button type="button" className="button primary" onClick={open}>Open SSA application</button>
    {status && <p role="status" aria-live="polite">{status}</p>}
  </div>;
}
