import { createHash } from 'node:crypto';

export const MIGRATION = '001_toolkit_auth';
export const CHECKSUM = 'd25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605';
export const APPLY = 'APPLY_001_TOOLKIT_AUTH_TO_PRODUCTION_MAIN';
export const WINDOW_MS = 30 * 60 * 1000;
export const ACCOUNT_PREFERENCES_MIGRATION = Object.freeze({
  name: '004_account_preferences',
  checksum: 'd115d5b288190517cdf40826f85f29e44bfba42e37fd0d17bbea6ab0a563ae18',
  action: 'APPLY_004_ACCOUNT_PREFERENCES_TO_PRODUCTION_MAIN',
  flag: '--apply-004',
  prepareFlag: '--authorize-apply-004',
});

export function migrationForFlag(flag) {
  if (flag === '--apply-001') return { name: MIGRATION, checksum: CHECKSUM, action: APPLY, flag, prepareFlag: '--authorize-apply-001' };
  if (flag === ACCOUNT_PREFERENCES_MIGRATION.flag) return ACCOUNT_PREFERENCES_MIGRATION;
  return null;
}

export function checksum(sql) {
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
}

export function authorizationValid(authorization, now) {
  const spec = authorization?.migration === MIGRATION ? migrationForFlag('--apply-001') :
    authorization?.migration === ACCOUNT_PREFERENCES_MIGRATION.name ? ACCOUNT_PREFERENCES_MIGRATION : null;
  return Boolean(spec && authorization?.action === spec.action && authorization.checksum === spec.checksum &&
    Number.isSafeInteger(authorization.issuedAt) && Number.isSafeInteger(authorization.expiresAt) &&
    authorization.expiresAt - authorization.issuedAt === WINDOW_MS &&
    Number.isSafeInteger(now) && now >= authorization.issuedAt && now < authorization.expiresAt);
}
