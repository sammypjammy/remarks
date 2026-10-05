import { createRoot } from 'react-dom/client';
import ReadinessDashboard from './ReadinessDashboard.jsx';
import AuthGate from './AuthGate.jsx';
import { fromIntakeChecker } from './model/from-intake-checker.js';
import './styles.css';

// Both views live in one document. No URL, history, storage or message transport.
export function createIntakeHandoff({ onSource, onAccessLost, onCorrect }) {
  const checker = document.getElementById('intakeCheckerView');
  const host = document.getElementById('ssaIntakeView');
  let root = null;
  function render(session) {
    const profile = fromIntakeChecker(session);
    function correct(id, value) {
      const field = profile.fields.find(item => item.id === id);
      if (!field || field.readiness !== 'blocked' || !field.correctionTarget) return false;
      if (!onCorrect(session, field.correctionTarget, value)) return false;
      render(session);
      return true;
    }
    root.render(<AuthGate onAccessLost={onAccessLost}><ReadinessDashboard profile={profile} onBack={back} onSource={back} onCorrect={correct} /></AuthGate>);
  }
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
