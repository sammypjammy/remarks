// Browser fixtures only: synthetic account preferences, no database or credentials.
export function preferenceApi() {
  const accounts = new Map();
  return async (req, res, accountId = 'synthetic-user') => {
    if (new URL(req.url, 'http://localhost').searchParams.get('preferences') !== '1') return false;
    res.setHeader('Content-Type', 'application/json');
    if (!accountId) { res.statusCode = 401; res.end('{}'); return true; }
    if (req.method === 'POST') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      if (body.accountId !== accountId) { res.statusCode = 409; res.end('{}'); return true; }
      if (body.mode !== 'migrate' || !accounts.has(accountId)) accounts.set(accountId, { ...accounts.get(accountId), ...body.values });
    }
    res.end(JSON.stringify({ accountId, values: accounts.get(accountId) ?? null }));
    return true;
  };
}
