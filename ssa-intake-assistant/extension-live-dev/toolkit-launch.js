export const TOOLKIT_SOURCES = Object.freeze([
  'https://packardtoolkit.vercel.app/intake-checker/',
  'http://localhost:5173/intake-checker/',
  'http://127.0.0.1:5173/intake-checker/',
]);

export function isToolkitSource(sender) {
  if (!Number.isInteger(sender?.tab?.id) || sender.frameId !== 0
      || !TOOLKIT_SOURCES.includes(sender.url)) return false;
  try {
    const source = new URL(sender.url);
    return !sender.origin || sender.origin === source.origin;
  } catch { return false; }
}

export function isToolkitLaunchRequest(message, sender) {
  return isToolkitSource(sender) && message?.type === 'open-ssa-application'
    && Object.keys(message).length === 1;
}

export function isIdentityRequest(message, sender) {
  return isToolkitSource(sender) && message?.type === 'start-identity'
    && Object.keys(message).sort().join(',') === 'reentry,session,ssn,type'
    && typeof message.session === 'string' && /^[0-9a-f-]{36}$/i.test(message.session)
    && typeof message.ssn === 'string' && /^\d{3}-\d{2}-\d{4}$/.test(message.ssn)
    && typeof message.reentry === 'string' && message.reentry.length >= 1
    && message.reentry.length <= 64 && /^[\x20-\x7e]+$/.test(message.reentry);
}

export function isIdentityControl(message, sender) {
  return isToolkitSource(sender) && ['identity-heartbeat', 'clear-identity'].includes(message?.type)
    && Object.keys(message).sort().join(',') === 'session,type'
    && typeof message.session === 'string' && /^[0-9a-f-]{36}$/i.test(message.session);
}
