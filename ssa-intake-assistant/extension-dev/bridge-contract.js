import { mappings, schemaVersion } from './mapping.js';
export const BRIDGE_NAME = 'packard-synthetic-practice-v1';
export const SOURCE_URL = 'http://127.0.0.1:5173/intake-checker/';
export const HOSTED_PILOT_URL = 'https://packardtoolkit.vercel.app/intake-checker/';
export const SOURCE_URLS = Object.freeze([SOURCE_URL, 'http://localhost:5173/intake-checker/', HOSTED_PILOT_URL]);
export const isSourceUrl = url => SOURCE_URLS.includes(url);
export const LEASE_MS = 15000;
export const MAX_SESSION_MS = 300000;
export const tokenValid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

// A narrow projection: never copy original text, sources, notes, review logs or auth.
export function projectReady(profile) {
  if (profile?.schema !== 'packard.intake-client-profile' || profile.schemaVersion !== schemaVersion || !Array.isArray(profile.fields)) return null;
  const fields = [];
  for (const mapping of mappings.filter(item => item.definitionId)) {
    const matches = profile.fields.filter(field => field.definitionId === mapping.definitionId);
    if (matches.length !== 1) continue;
    const field = matches[0];
    if (field.recordId != null || field.id !== mapping.definitionId || field.readiness !== 'ready' || !Array.isArray(field.blockingReasons) || field.blockingReasons.length || field.dataType !== mapping.type || (mapping.type === 'boolean' ? typeof field.value !== 'boolean' : typeof field.value !== 'string' || !field.value.trim() || field.value.length > 500)) continue;
    fields.push({ id: field.id, definitionId: field.definitionId, recordId: null, dataType: field.dataType, value: field.value, precision: ['day','month'].includes(field.precision) ? field.precision : null, readiness: 'ready', blockingReasons: [] });
  }
  return { schema: profile.schema, schemaVersion, fields };
}

export function trustedSender(sender) {
  return !sender?.id && isSourceUrl(sender?.url) && sender?.origin === new URL(sender.url).origin && sender?.frameId === 0 && Number.isInteger(sender?.tab?.id);
}

// No retained profile here. The page owns the projection and clears it on release.
export function receiveBridge(port, { nonce, onProfile, onClear, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  if (port.name !== BRIDGE_NAME || !trustedSender(port.sender) || !tokenValid(nonce)) { port.disconnect(); return () => {}; }
  let session = null, closed = false, received = false, timer;
  const deadline = now() + MAX_SESSION_MS;
  function close() {
    if (closed) return;
    closed = true; cancel(timer); onClear();
    port.onMessage.removeListener(message); port.onDisconnect.removeListener(close);
    try { port.disconnect(); } catch { /* Closed channel. No payload diagnostics. */ }
  }
  function arm() { cancel(timer); timer = schedule(close, Math.max(0, Math.min(LEASE_MS, deadline - now()))); }
  function message(packet) {
    if (closed || packet?.receiver !== nonce) return;
    if (now() >= deadline || !tokenValid(packet?.session)) return close();
    if (packet.type === 'profile' && !received) {
      const profile = projectReady(packet.profile);
      if (!profile) return close();
      session = packet.session; received = true; onProfile(profile); arm();
      port.postMessage({ type: 'accepted', receiver: nonce, session });
    } else if (packet.session !== session || packet.type === 'profile' || packet.type === 'revoke') close();
    else if (packet.type === 'heartbeat' && received) arm();
    else close();
  }
  port.onMessage.addListener(message); port.onDisconnect.addListener(close);
  arm(); port.postMessage({ type: 'challenge', receiver: nonce });
  return close;
}
