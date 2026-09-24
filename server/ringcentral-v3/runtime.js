// Runtime gate only. Migration runners retain their separate localhost-only gate.
import { rcConfig } from './config.js';
import { validConnection, validProduction } from '../../maintenance/verify-production/validate.mjs';
export function v3Runtime(env = process.env) {
  const config = rcConfig(env);
  if (config.accountId !== '827653020') throw new Error('V3 configuration unavailable');
  if (config.environment === 'production') {
    if (env.FAX_V3_PRODUCTION_ACCEPTANCE !== 'enabled' || !validProduction(env)) throw new Error('V3 configuration unavailable');
    config.productionAcceptance = true;
  } else if (config.environment !== 'development' || !validConnection(env.DATABASE_URL)) {
    throw new Error('V3 configuration unavailable');
  }
  return config;
}
