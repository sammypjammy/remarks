import { createRoot } from 'react-dom/client';
import ClientFiling from './ClientFiling.jsx';
import AuthGate from './AuthGate.jsx';
import { createClientData } from '../../intake-checker/client-data.js';
import './styles.css';

// Both views live in one document; the filing preview never opens a site or bridge.
export function createIntakeHandoff({ onSource, onAccessLost }) {
  const checker = document.getElementById('intakeCheckerView');
  const host = document.getElementById('ssaIntakeView');
  let root = null;
  function render(session) {
    const data = createClientData(session);
    root.render(<AuthGate onAccessLost={onAccessLost}><ClientFiling data={data} onBack={back} /></AuthGate>);
  }
  function back(range) {
    window.dispatchEvent(new Event('packard-ssa-revoke'));
    root?.unmount();
    root = null;
    host.hidden = true;
    checker.hidden = false;
    if (range) onSource(range);
    else document.getElementById('continueToSsa').focus();
  }
  return {
    open(session) {
      if (!root) {
        root = createRoot(host);
      }
      render(session);
      checker.hidden = true;
      host.hidden = false;
      host.scrollIntoView({ block: 'start' });
    },
    clear() {
      root?.unmount();
      root = null;
      host.replaceChildren();
      host.hidden = true;
      checker.hidden = false;
    },
  };
}
