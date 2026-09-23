import { createHash } from 'node:crypto';

export const MIGRATION = '001_toolkit_auth';
export const CHECKSUM = 'd25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605';
export const APPLY = 'APPLY_001_TOOLKIT_AUTH_TO_PRODUCTION_MAIN';
export const WINDOW_MS = 30 * 60 * 1000;

export function checksum(sql) {
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
}

export function authorizationValid(authorization, now) {
  return authorization?.action === APPLY && authorization.migration === MIGRATION &&
    authorization.checksum === CHECKSUM &&
    Number.isSafeInteger(authorization.issuedAt) && Number.isSafeInteger(authorization.expiresAt) &&
    authorization.expiresAt - authorization.issuedAt === WINDOW_MS &&
    Number.isSafeInteger(now) && now >= authorization.issuedAt && now < authorization.expiresAt;
}
