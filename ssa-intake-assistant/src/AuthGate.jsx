import { useEffect, useState } from 'react';

export default function AuthGate({ children, onAccessLost }) {
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
        if (active && current === request) {
          const allowed = response.ok && result?.authenticated === true;
          setAuthenticated(allowed);
          if (!allowed) onAccessLost?.();
        }
      } catch {
        if (active && current === request) {
          setAuthenticated(false);
          onAccessLost?.();
        }
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
  }, [onAccessLost]);

  if (checking) return <section className="ssa-auth-state panel" role="status">Checking Toolkit access…</section>;
  if (!authenticated) return <section className="ssa-auth-state panel" role="status">Sign in to the Toolkit to use SSA Intake Assistant.</section>;
  return children;
}
