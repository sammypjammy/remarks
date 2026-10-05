import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import { fromIntakeChecker } from './model/from-intake-checker.js';
import './styles.css';

// Both views live in one document. No URL, history, storage or message transport.
export function createIntakeHandoff({ onSource, onAccessLost }) {
  const checker = document.getElementById('intakeCheckerView');
  const host = document.getElementById('ssaIntakeView');
  let root = null;
  function back(range) {
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
      root.render(<AuthGate onAccessLost={onAccessLost}><App initialProfile={fromIntakeChecker(session)} onBack={back} onSource={back} /></AuthGate>);
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
