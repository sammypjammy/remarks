import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const challenge = value => createHash('sha256').update(value).digest('base64url');
export const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function equalHash(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function cookieValue(req, name) {
  const matches = String(req.headers?.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}
export function cookie(name, value, seconds, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
export function authError(status) { return Object.assign(new Error('Authentication request failed'), { status }); }
export function sameOrigin(req, config) {
  if (req.headers?.origin !== config.origin ||
      (req.headers?.['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) throw authError(403);
}
