// Pure validation only: never return or log parsed connection information.
export function connectionCheck(value, { production = false } = {}) {
  try {
    if (typeof value !== 'string' || !value) return 'DATABASE_URL_MISSING';
    if (/[\s\\#]/u.test(value)) return 'DATABASE_OPTIONS_INVALID';
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return 'DATABASE_PROTOCOL_INVALID';
    if (url.hash || !url.username || !url.password || !/^\/[^/]+$/.test(url.pathname)) return 'DATABASE_OPTIONS_INVALID';
    if (url.port && url.port !== '5432') return 'DATABASE_OPTIONS_INVALID';
    const seen = new Set();
    for (const [key, option] of url.searchParams) {
      if (seen.has(key)) return 'DATABASE_OPTIONS_INVALID';
      seen.add(key);
      if (key === 'sslmode' && ['require', 'verify-ca', 'verify-full'].includes(option)) continue;
      if (key === 'channel_binding' && option === 'require') continue;
      return 'DATABASE_OPTIONS_INVALID';
    }
    // Neon also uses an optional c-N infrastructure cell before the region.
    const match = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)*?)(-pooler)?\.(?:c-[1-9][0-9]*\.)?[a-z0-9]+(?:-[a-z0-9]+)*\.(aws|azure)\.neon\.tech$/.exec(url.hostname);
    if (!match) return 'NEON_HOST_INVALID';
    if (production && match[1] !== 'ep-young-dream-arkoh9e5') return 'ENDPOINT_MISMATCH';
    if (!production && match[1] === 'ep-young-dream-arkoh9e5') return 'ENDPOINT_MISMATCH';
    return 'PASS';
  } catch { return 'DATABASE_URL_INVALID'; }
}

export function productionCheck(env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production') return 'NOT_PRODUCTION';
  if (env.TOOLKIT_ORIGIN !== 'https://packardtoolkit.vercel.app') return 'ORIGIN_MISMATCH';
  return connectionCheck(env.DATABASE_URL, { production: true });
}

export function validConnection(value, options) {
  return connectionCheck(value, options) === 'PASS';
}

export function validProduction(env) {
  return productionCheck(env) === 'PASS';
}
