// Run after npm run build. Checks Vite development/preview routing without calling live APIs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, preview } from 'vite';

for (const mode of ['development', 'preview']) {
  const server = mode === 'development'
    ? await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
    : await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
  if (mode === 'development') await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  async function get(path) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `${mode}: ${path}`);
    return response;
  }
  try {
    for (const route of ['/', '/fax-sender/', '/welcome-email-sender/', '/canned-remarks/', '/intake-checker/', '/med-tabs-generator/', '/settings/', '/version-history/']) {
      const html = await (await get(route)).text();
      assert.match(html, /<main|id="root"/, `${route}: page entry`);
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1]);
      const plainScripts = scripts.filter(attributes => !/type="module"/.test(attributes));
      // Vite hoists module scripts; they remain deferred until the classic settings script runs.
      assert(plainScripts[0]?.includes('settings-storage.js'), `${route}: settings is the first classic script`);
      assert(!plainScripts.some(attributes => /\b(?:async|defer)\b/.test(attributes)), `${route}: classic script execution order`);
    }
    for (const route of ['/auth/callback', '/auth/callback.html', '/welcome-email-sender/callback.html']) {
      const html = await (await get(route)).text();
      assert.match(html, /<script type="module"/, `${route}: callback module`);
      const sources = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => new URL(match[1], origin + route).pathname);
      for (const source of sources) await get(source);
    }
    const legacy = await (await get('/pages/canned-remarks.html?check=synthetic')).text();
    assert.match(legacy, /window\.location\.replace\("\.\.\/canned-remarks\/" \+ window\.location\.search \+ window\.location\.hash\)/);
    assert.equal(await (await get('/home.js')).text(), await (await get('/home/home.js')).text());
    for (const name of ['settings-storage.js', 'app-shell.js', 'toolkit-auth.js', 'toolkit-auth.css', 'footer.css', 'favicon.png']) {
      assert.deepEqual(Buffer.from(await (await get('/settings/shared/' + name)).arrayBuffer()), Buffer.from(await (await get('/shared/' + name)).arrayBuffer()), name);
    }
    const oldStyles = await (await get('/settings/shared/style.css')).text();
    for (const sheet of ['/shared/style.css', '/home/styles.css', '/canned-remarks/styles.css']) {
      assert(oldStyles.includes(sheet), `legacy stylesheet includes ${sheet}`);
      await get(sheet);
    }
    for (const name of await readdir('welcome-email-sender/attachments')) {
      const response = await get('/welcome-email-sender/attachments/' + encodeURIComponent(name));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile('welcome-email-sender/attachments/' + name), name);
    }
    console.log(`PASS ${mode}: eight pages, callback modules, legacy URLs and all attachment bytes`);
  } finally {
    if (mode === 'development') await server.close();
    else await new Promise(done => server.httpServer.close(done));
  }
}
