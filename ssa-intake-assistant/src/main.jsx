import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

function AuthGate() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    let request = 0;
    async function check() {
      const current = ++request;
      try {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        const result = response.ok ? await response.json() : null;
        if (active && current === request) setAuthenticated(response.ok && result?.authenticated === true);
      } catch {
        if (active && current === request) setAuthenticated(false);
      } finally {
        if (active && current === request) setChecking(false);
      }
    }
    function accountChange() { setAuthenticated(false); setChecking(true); void check(); }
    function visible() { if (!document.hidden) void check(); }
    window.addEventListener('packardaccountchange', accountChange);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    void check();
    return () => {
      active = false;
      window.removeEventListener('packardaccountchange', accountChange);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  if (checking) return <section className="ssa-auth-state panel" role="status">Checking Toolkit access…</section>;
  if (!authenticated) return <section className="ssa-auth-state panel" role="status">Sign in to the Toolkit to use SSA Intake Assistant.</section>;
  return <App />;
}

createRoot(document.getElementById('root')).render(<StrictMode><AuthGate /></StrictMode>);
