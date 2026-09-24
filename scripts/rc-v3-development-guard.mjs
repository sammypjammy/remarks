import { validConnection } from '../maintenance/verify-production/validate.mjs';
export function assertDevelopment(env) {
  if (env.TOOLKIT_ORIGIN !== 'http://localhost:5173' ||
      (env.VERCEL_ENV && env.VERCEL_ENV !== 'development') ||
      (env.VERCEL && env.VERCEL_ENV !== 'development') || !validConnection(env.DATABASE_URL)) {
    throw new Error('Verified Development configuration required; no database action performed');
  }
}
