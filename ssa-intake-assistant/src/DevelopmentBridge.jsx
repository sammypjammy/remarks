import { useEffect, useRef, useState } from 'react';
import { sendDevelopmentProfile } from './model/development-bridge.js';

export default function DevelopmentBridge({ profile, hostedPilot = false }) {
  const [approved, setApproved] = useState(false), [status, setStatus] = useState('No profile shared.');
  const stop = useRef(() => {});
  useEffect(() => { setApproved(false); return () => stop.current(); }, [profile]);
  async function checkAccess() {
    const response = await fetch('/api/auth/session', { credentials:'same-origin', cache:'no-store' });
    return response.ok && (await response.json()).authenticated === true;
  }
  function send() {
    stop.current();
    stop.current = sendDevelopmentProfile(profile, { runtime:window.chrome?.runtime, onStatus:setStatus, checkAccess });
    setApproved(false);
  }
  return <section className="practice-connection" aria-label="Synthetic extension connection">
    <label><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /> {hostedPilot ? 'I approve sending the built-in fictional practice profile.' : 'This intake is synthetic, and I approve sharing its ready practice fields.'}</label>
    <div className="upload-actions"><button type="button" className="button primary" disabled={!approved} onClick={send}>Send to practice extension</button><button type="button" className="button quiet" onClick={() => stop.current()}>Disconnect practice</button></div>
    <p role="status">{status === 'No profile shared.' ? 'Open the Chrome practice page and select Receive from Toolkit.' : status}</p>
  </section>;
}
