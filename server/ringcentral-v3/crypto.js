import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function aad(context, kid) {
  return Buffer.from(JSON.stringify(['toolkit-ringcentral', 1, kid, ...context]));
}
export const tokenContext = row => ['tokens', row.environment, row.user_id, row.id, row.account_id, row.extension_id];
export const transactionContext = row => ['pkce', row.environment, row.user_id, row.connection_id, row.state_hash, row.session_hash];
export function encrypt(value, context, config) {
  const kid = config.activeKey, key = config.keys.get(kid);
  if (!key || context.some(v => typeof v !== 'string' || !v)) throw new Error('Encryption unavailable');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(context, kid));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}
export function decrypt(envelope, context, config) {
  try {
    if (!envelope || envelope.v !== 1 || !config.keys.has(envelope.kid) ||
        context.some(v => typeof v !== 'string' || !v) || Object.keys(envelope).sort().join() !== 'data,iv,kid,tag,v') throw new Error();
    const decode = value => { if (typeof value !== 'string' || value.length > 65536) throw new Error(); const b = Buffer.from(value, 'base64'); if (b.toString('base64') !== value) throw new Error(); return b; };
    const iv = decode(envelope.iv), tag = decode(envelope.tag);
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', config.keys.get(envelope.kid), iv);
    decipher.setAAD(aad(context, envelope.kid)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(decode(envelope.data)), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Encrypted authorization unavailable'); }
}
