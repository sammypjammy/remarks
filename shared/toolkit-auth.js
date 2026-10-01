// This module sees only safe session display information, never provider/session tokens.
export function mountToolkitAuth(host) {
  if (!host || host.dataset.authMounted) return;
  host.dataset.authMounted = 'true';
  host.classList.add('toolkit-auth');
  const status = document.createElement('span');
  status.className = 'toolkit-auth-status';
  status.setAttribute('role', 'status');
  const name = document.createElement('span');
  name.className = 'toolkit-auth-name';
  const login = document.createElement('a');
  login.href = '/api/auth/login';
  login.textContent = 'Sign in with Microsoft';
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.textContent = 'Sign Out';
  logout.hidden = true;
  host.append(name, login, logout, status);
  const url = new URL(location.href);
  if (url.searchParams.get('toolkitAuth') === 'failed') {
    status.textContent = 'Sign-in could not be completed. Try again.';
    url.searchParams.delete('toolkitAuth');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  let request = 0;
  let loginFailed = status.textContent !== '';
  async function refresh() {
    const sequence = ++request;
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (![200, 401, 403].includes(response.status)) throw new Error();
      const data = await response.json();
      if (sequence !== request) return;
      const signedIn = response.ok && data.authenticated === true;
      name.textContent = signedIn ? data.user.displayName : '';
      name.title = name.textContent;
      login.hidden = signedIn;
      logout.hidden = !signedIn;
      if (signedIn) loginFailed = false;
      if (!loginFailed) status.textContent = '';
      if (response.status === 403) status.textContent = 'Toolkit access is unavailable for this account.';
    } catch {
      if (sequence !== request) return;
      name.textContent = '';
      login.hidden = false;
      logout.hidden = true;
      status.textContent = 'Toolkit sign-in is temporarily unavailable.';
    }
  }
  logout.addEventListener('click', async () => {
    ++request;
    logout.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error();
      ++request; // Discard any session refresh that raced with sign-out.
      loginFailed = false;
      name.textContent = '';
      name.title = '';
      login.hidden = false;
      logout.hidden = true;
      status.textContent = 'Signed out of the Toolkit.';
    } catch { status.textContent = 'Sign-out failed. Try again.'; }
    finally { logout.disabled = false; }
  });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
}
