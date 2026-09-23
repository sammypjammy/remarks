export const SESSION_SECONDS = 8 * 60 * 60;
export const TRANSACTION_SECONDS = 10 * 60;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authConfig(env = process.env) {
  const { ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: clientSecret, TOOLKIT_ORIGIN: origin } = env;
  if (!uuidPattern.test(tenant || '') || !uuidPattern.test(clientId || '') || !clientSecret || !origin) throw new Error('Authentication configuration unavailable');
  const url = new URL(origin);
  const local = url.origin === 'http://localhost:5173';
  if (url.origin !== origin || url.username || url.password || (!local && url.protocol !== 'https:') ||
      (local && (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production'))) throw new Error('Invalid authentication origin');
  const authority = `https://login.microsoftonline.com/${tenant.toLowerCase()}`;
  return { tenant: tenant.toLowerCase(), clientId, clientSecret, origin, secure: !local,
    redirectUri: `${origin}/api/auth/callback`, authority, issuer: `${authority}/v2.0`,
    sessionCookie: local ? 'toolkit_session' : '__Host-toolkit_session',
    bindingCookie: local ? 'toolkit_login' : '__Host-toolkit_login' };
}
