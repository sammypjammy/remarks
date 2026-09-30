import { authError, sameOrigin } from './security.js';

const text = max => value => typeof value === 'string' && value.length <= max;
const choice = options => value => options.includes(value);
const boolean = value => typeof value === 'boolean';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, schema) => object(value) && Object.keys(value).every(key =>
  Object.hasOwn(schema, key) && schema[key](value[key]));
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text(100));
const list = schema => value => Array.isArray(value) && value.length <= 100 && value.every(item => fields(item, schema));

// This allowlist is the extension point for new preferences. Credentials, draft
// contents, receipt/history data and arbitrary browser storage are never imported.
export const preferenceSchema = Object.freeze({
  theme: choice(['system', 'light', 'dark', 'sepia', 'forest', 'blossom']),
  density: choice(['comfortable', 'compact']),
  openDraftsInNewTab: boolean,
  confirmBeforeClearingMedTabs: boolean,
  autoClearRemarksAfterCopy: boolean,
  emailSignature: text(4000),
  emailResourcesUrl: text(2000),
  emailManager: text(180),
  emailLanguage: choice(['english', 'spanish']),
  homepage: value => fields(value, { version: v => v === 1, name: text(160), order: strings, hidden: strings }),
  customRemarks: list({ id: text(180), application: choice(['filing', '795']), group: text(180), title: text(300), text: text(16000), kind: choice(['custom']) }),
  emailTemplates: value => fields(value, Object.fromEntries(['english', 'spanish'].map(language =>
    [language, template => fields(template, { subject: text(500), body: text(24000) })]))),
  customCaseManagers: list({ fullName: text(180), phone: text(100), email: text(254), introVideo: v => v === null || text(2000)(v), languages: v => Array.isArray(v) && v.length <= 2 && v.every(choice(['english', 'spanish'])), kind: choice(['custom']) }),
});

export function validatePreferences(values) {
  if (!fields(values, preferenceSchema) || Buffer.byteLength(JSON.stringify(values)) > 60000) throw authError(400);
  return values;
}

export async function handlePreferences(req, res, user, store, config) {
  let values;
  if (req.method === 'GET') {
    values = await store.getPreferences(user.id);
  } else {
    sameOrigin(req, config);
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw authError(400);
    let body = req.body;
    if (body === undefined && req[Symbol.asyncIterator]) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 65000) throw authError(400);
        chunks.push(Buffer.from(chunk));
      }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw authError(400); }
    }
    if (body?.accountId !== user.id) throw authError(409);
    if (!object(body) || Object.keys(body).some(key => !['accountId', 'mode', 'values'].includes(key)) ||
        !['migrate', 'patch'].includes(body.mode)) throw authError(400);
    values = await store.savePreferences(user.id, validatePreferences(body.values), body.mode === 'migrate');
  }
  return res.status(200).json({ accountId: user.id, values });
}
