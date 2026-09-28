// Runtime gate only. Migration runners retain their separate localhost-only gate.
import { rcConfig } from './config.js';
import { validConnection, validProduction } from '../../maintenance/verify-production/validate.mjs';
function productionDatabase(value) {
  try { return new URL(value).pathname === '/neondb'; }
  catch { return false; }
}
export function v3Runtime(env = process.env) {
  const config = rcConfig(env);
  if (config.accountId !== '827653020') throw new Error('V3 configuration unavailable');
  if (config.environment === 'production') {
    if (!validProduction(env) || !productionDatabase(env.DATABASE_URL)) throw new Error('V3 configuration unavailable');
  } else if (config.environment !== 'development' || !validConnection(env.DATABASE_URL)) {
    throw new Error('V3 configuration unavailable');
  }
  return config;
}
