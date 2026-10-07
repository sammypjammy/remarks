import { BRIDGE_NAME, isSourceUrl, MAX_SESSION_MS, projectReady, tokenValid } from '../../extension-dev/bridge-contract.js';
import { DEVELOPMENT_EXTENSION_ID } from './development-extension-id.js';

// Called only after visible approval for the synthetic practice pilot.
export function sendDevelopmentProfile(profile, { runtime, onStatus, checkAccess, windowObject = window }) {
  if (!isSourceUrl(windowObject.location.href) || windowObject.top !== windowObject || !runtime?.connect) {
    onStatus('Open the supported Toolkit page and the updated Chrome practice extension first.'); return () => {};
  }
  let port, receiver, timer, expiry, stopped = false, busy = false;
  let projected = projectReady(profile);
  const session = crypto.randomUUID();
  function stop() {
    if (stopped) return;
    stopped = true; projected = null; clearInterval(timer); clearTimeout(expiry);
    if (port && receiver) { try { port.postMessage({ type:'revoke', receiver, session }); } catch { /* Disconnected. */ } }
    try { port?.disconnect(); } catch { /* Disconnected. */ }
    windowObject.removeEventListener('pagehide', stop);
    windowObject.removeEventListener('packard-ssa-revoke', stop);
    windowObject.removeEventListener('packardaccountchange', stop);
    onStatus('Disconnected. Practice answers cleared; approve again to send.');
  }
  async function pulse() {
    if (busy || stopped) return;
    busy = true;
    try {
      if (!(await checkAccess()) || stopped) return stop();
      if (receiver) port.postMessage({ type:'heartbeat', receiver, session });
    } catch { stop(); } finally { busy = false; }
  }
  async function start() {
    try {
      if (!projected || !(await checkAccess()) || stopped) return stop();
      port = runtime.connect(DEVELOPMENT_EXTENSION_ID, { name: BRIDGE_NAME });
      port.onDisconnect.addListener(() => { void runtime.lastError; stop(); });
      port.onMessage.addListener(packet => {
        if (stopped) return;
        if (packet?.type === 'challenge' && tokenValid(packet.receiver) && !receiver) {
          receiver = packet.receiver;
          port.postMessage({ type:'profile', receiver, session, profile:projected });
          projected = null;
        } else if (packet?.type === 'accepted' && packet.receiver === receiver && packet.session === session) onStatus('Connected to practice. Use Fill received answers in the extension.');
      });
      timer = setInterval(pulse, 5000); expiry = setTimeout(stop, MAX_SESSION_MS);
      onStatus('Connecting. Keep the extension practice page open.');
    } catch { stop(); }
  }
  windowObject.addEventListener('pagehide', stop);
  windowObject.addEventListener('packard-ssa-revoke', stop);
  windowObject.addEventListener('packardaccountchange', stop);
  void start();
  return stop;
}
