const origins = { production: 'https://packardtoolkit.vercel.app', development: 'http://localhost:5173' };
export const numericId = value => typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value);
export function rcConfig(env = process.env) {
  const environment = env.VERCEL_ENV || (env.VERCEL ? '' : 'development');
  if (!origins[environment] || env.TOOLKIT_ORIGIN !== origins[environment]) throw new Error('RC configuration unavailable');
  const keys = new Map();
  for (const [name, value] of Object.entries(env)) {
    const match = /^RC_TOKEN_ENCRYPTION_KEY_(V[1-9][0-9]*)$/.exec(name);
    if (!match) continue;
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('RC configuration unavailable');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new Error('RC configuration unavailable');
    keys.set(match[1].toLowerCase(), bytes);
  }
  const activeKey = env.RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID;
  if (!keys.has(activeKey) || !numericId(env.RC_ALLOWED_ACCOUNT_ID) ||
      !env.RC_OAUTH_CLIENT_ID?.trim() || !env.RC_OAUTH_CLIENT_SECRET?.trim()) throw new Error('RC configuration unavailable');
  return { environment, origin: origins[environment], redirectUri: origins[environment] + '/api/ringcentral/callback',
    clientId: env.RC_OAUTH_CLIENT_ID, clientSecret: env.RC_OAUTH_CLIENT_SECRET, accountId: env.RC_ALLOWED_ACCOUNT_ID,
    keys, activeKey, secure: environment === 'production',
    bindingCookie: environment === 'production' ? '__Host-toolkit_rc_binding' : 'toolkit_rc_binding' };
}
