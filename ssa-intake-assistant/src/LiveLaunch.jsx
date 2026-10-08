import { useState } from 'react';
import { LIVE_EXTENSION_ID } from './model/live-extension-id.js';

const sources = new Set([
  'https://packardtoolkit.vercel.app/intake-checker/',
  'http://localhost:5173/intake-checker/',
  'http://127.0.0.1:5173/intake-checker/',
]);

export default function LiveLaunch() {
  const [status, setStatus] = useState('');
  async function open() {
    if (!sources.has(location.href) || window.top !== window || !window.chrome?.runtime?.sendMessage) {
      setStatus('Open the supported Toolkit page in Chrome with the SSA Page Review extension installed.'); return;
    }
    setStatus('Opening SSA…');
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || (await response.json()).authenticated !== true) throw new Error('auth');
      chrome.runtime.sendMessage(LIVE_EXTENSION_ID, { type: 'open-ssa-application' }, reply => {
        if (chrome.runtime.lastError || !reply?.opened) {
          setStatus('The development extension did not open SSA. Reload it in Chrome, then try again.'); return;
        }
        setStatus('SSA opened. Review the Terms of Service and continue there. No client answers were shared.');
      });
    } catch { setStatus('Toolkit authentication could not be verified. Sign in and try again.'); }
  }
  return <div className="live-launch">
    <button type="button" className="button primary" onClick={open}>Open SSA application</button>
    {status && <p role="status" aria-live="polite">{status}</p>}
  </div>;
}
