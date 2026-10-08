import { useEffect, useRef, useState } from 'react';
import { LIVE_EXTENSION_ID } from './model/live-extension-id.js';

const sources = new Set([
  'https://packardtoolkit.vercel.app/intake-checker/',
  'http://localhost:5173/intake-checker/',
  'http://127.0.0.1:5173/intake-checker/',
]);
const channel = 'ssa-identity-handoff';
const statuses = {
  selected: 'Selected the unique Return to Saved Application Process control. Continue manually if SSA asks; the identity page Next button is never clicked.',
  'wrong-page': 'The SSA page did not match the verified controls. No fields were filled, and the temporary handoff values were cleared.',
  'missing-controls': 'The identity page was recognized, but one or both expected fields were missing. No values were filled; the temporary handoff values were cleared.',
  'ambiguous-controls': 'The identity controls were duplicated or ambiguous. No values were filled; the temporary handoff values were cleared.',
  'missing-ssn-input': 'The identity page was recognized, but the SSN input was missing. No values were filled; the temporary handoff values were cleared.',
  'missing-reentry-input': 'The identity page was recognized, but the re-entry input was missing. No values were filled; the temporary handoff values were cleared.',
  'ambiguous-ssn-input': 'The SSN input was ambiguous. No values were filled; the temporary handoff values were cleared.',
  'ambiguous-reentry-input': 'The re-entry input was ambiguous. No values were filled; the temporary handoff values were cleared.',
  'unverified-controls': 'The identity values could not be verified. Both fields were cleared, and the temporary handoff values were cleared.',
  filled: 'The SSN and re-entry number were filled and verified. The extension cleared its temporary values. Review the page and continue manually; it did not click Next.',
};
const terminalReasons = new Set([
  'wrong-page', 'missing-controls', 'ambiguous-controls', 'missing-ssn-input', 'missing-reentry-input',
  'ambiguous-ssn-input', 'ambiguous-reentry-input', 'unverified-controls', 'filled',
]);

export default function LiveLaunch({ ssn }) {
  const [reentry, setReentry] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const portRef = useRef(null);
  const settledRef = useRef(false);

  function stop(clear = true) {
    const port = portRef.current;
    portRef.current = null;
    if (!port) return;
    settledRef.current = true;
    if (clear) {
      try { port.postMessage({ type: 'clear' }); } catch { /* Disconnect still clears the extension session. */ }
    }
    try { port.disconnect(); } catch { /* The extension may already have disconnected. */ }
  }

  useEffect(() => {
    function clearForAccountChange() {
      stop();
      setBusy(false);
      setStatus('Toolkit account changed. The extension handoff was cleared.');
    }
    function clearOnPageExit() { stop(); }
    window.addEventListener('packardaccountchange', clearForAccountChange);
    window.addEventListener('pagehide', clearOnPageExit);
    return () => {
      window.removeEventListener('packardaccountchange', clearForAccountChange);
      window.removeEventListener('pagehide', clearOnPageExit);
      stop();
    };
  }, []);

  async function open() {
    const reentryValue = reentry.trim();
    if (!ssn) {
      setStatus('A single valid, ready Social Security number is required. Review and correct it in Intake Checker first.');
      return;
    }
    if (!reentryValue) {
      setStatus('Enter the temporary SSA re-entry number. It stays in memory and is not saved.');
      return;
    }
    if (!sources.has(location.href) || window.top !== window || !window.chrome?.runtime?.connect) {
      setStatus('Open the supported Toolkit page in Chrome with the SSA Page Review extension installed.');
      return;
    }
    setBusy(true);
    setStatus('Verifying Toolkit authentication…');
    let authenticated = false;
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      authenticated = response.ok && (await response.json()).authenticated === true;
    } catch {
      authenticated = false;
    }
    if (!authenticated) {
      setBusy(false);
      setStatus('Toolkit authentication could not be verified. Sign in and try again.');
      return;
    }

    try {
      settledRef.current = false;
      const port = chrome.runtime.connect(LIVE_EXTENSION_ID, { name: channel });
      portRef.current = port;
      port.onMessage.addListener(packet => {
        if (packet?.type === 'opened') {
          setStatus('SSA opened. Review the Terms of Service and click Next manually. Only the ready SSN and entered re-entry number were shared.');
          return;
        }
        if (packet?.type !== 'status' || !Object.hasOwn(statuses, packet.reason)) return;
        setStatus(statuses[packet.reason]);
        if (terminalReasons.has(packet.reason)) {
          settledRef.current = true;
          portRef.current = null;
          setBusy(false);
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (settledRef.current) return;
        portRef.current = null;
        setBusy(false);
        setStatus('The extension disconnected. Its temporary values were cleared; reload the extension and try again.');
      });
      port.postMessage({ type: 'open-ssa-application', ssn, reentry: reentryValue });
      setReentry('');
    } catch {
      stop(false);
      setBusy(false);
      setStatus('The development extension could not be reached. Reload it in Chrome and try again.');
    }
  }

  return <div className="live-launch">
    <label htmlFor="ssaReentryNumber">Temporary SSA re-entry number</label>
    <input id="ssaReentryNumber" type="password" autoComplete="off" spellCheck={false}
      maxLength={128} value={reentry} disabled={busy} onChange={event => setReentry(event.target.value)}
      aria-describedby="ssaLivePrivacy" />
    <p id="ssaLivePrivacy">Used only with one ready SSN for this in-memory handoff. It is not saved.</p>
    <button type="button" className="button primary" onClick={open} disabled={busy}>
      {busy ? 'SSA handoff active…' : 'Open SSA application'}
    </button>
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
