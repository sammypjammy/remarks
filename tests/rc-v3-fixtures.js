import { rcConfig } from '../server/ringcentral-v3/config.js';
export const env = () => ({ TOOLKIT_ORIGIN:'http://localhost:5173',RC_OAUTH_CLIENT_ID:'synthetic-client',RC_OAUTH_CLIENT_SECRET:'synthetic-secret',
  RC_ALLOWED_ACCOUNT_ID:'827653020',RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:'v1',RC_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,7).toString('base64') });
export const config = () => rcConfig(env());
export const token = () => ({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessExpires:new Date(Date.now()+3600000),refreshExpires:new Date(Date.now()+86400000),scopes:['Contacts','Faxes','ReadAccounts','ReadMessages'],ownerId:'12345'});
export const identity = {accountId:'827653020',extensionId:'12345',displayName:'Synthetic Employee'};
