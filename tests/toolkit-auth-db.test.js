import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from '../server/auth/database.js';
import { AuthStore } from '../server/auth/store.js';
import { randomToken, hash } from '../server/auth/security.js';
import { requireToolkitUser } from '../server/auth/service.js';

test('PostgreSQL: migration, transaction races, session ownership, expiry, revocation and inactive users',
  { skip: !process.env.DATABASE_URL, timeout: 60000 }, async () => {
    assert.equal(process.env.TOOLKIT_ORIGIN, 'http://localhost:5173', 'Integration tests require the configured development environment');
    const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
    const pool = new pg.Pool(databaseOptions());
    pool.on('error', () => {});
    let created = false;
    try {
      const migration = await readFile(new URL('../migrations/001_toolkit_auth.sql', import.meta.url), 'utf8');
      await pool.query(migration.replaceAll('toolkit_auth', schema));
      created = true;
      const store = new AuthStore(pool, schema);
      const transaction = () => ({ stateHash: hash(randomToken()), bindingHash: hash(randomToken()), nonceHash: hash(randomToken()), verifier: randomToken(), redirectUri: 'http://localhost:5173/api/auth/callback' });
      const tx = transaction();
      await store.createTransaction(tx);
      assert.equal(await store.consumeTransaction(tx.stateHash, hash(randomToken()), tx.redirectUri), null);
      const results = await Promise.all([1,2].map(() => store.consumeTransaction(tx.stateHash, tx.bindingHash, tx.redirectUri)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(results.find(Boolean).pkce_verifier, tx.verifier);
      const stored = (await pool.query(`SELECT * FROM ${schema}.oauth_transactions WHERE state_hash=$1`, [tx.stateHash])).rows[0];
      assert.ok(stored.consumed_at);
      assert.equal(stored.pkce_verifier, null);
      const expired = transaction();
      await store.createTransaction(expired);
      await pool.query(`UPDATE ${schema}.oauth_transactions SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE state_hash=$1`, [expired.stateHash]);
      assert.equal(await store.consumeTransaction(expired.stateHash, expired.bindingHash, expired.redirectUri), null);
      const a = { tenantId: randomUUID(), objectId: randomUUID(), displayName: 'Synthetic A' };
      const b = { ...a, objectId: randomUUID(), displayName: 'Synthetic B' };
      const tokenA = randomToken(), tokenB = randomToken(), tokenA2 = randomToken();
      const idA = await store.createSession(a, hash(tokenA));
      const idB = await store.createSession(b, hash(tokenB));
      const config = { sessionCookie: 'toolkit_session', tenant: a.tenantId };
      const request = token => ({ headers: { cookie: `toolkit_session=${token}` } });
      assert.equal((await requireToolkitUser(request(tokenA), { config, store })).id, idA);
      assert.equal((await requireToolkitUser(request(tokenB), { config, store })).id, idB);
      assert.notEqual(idA, idB);
      assert.equal((await store.resolveSession(hash(tokenA))).id, idA);
      assert.equal((await store.resolveSession(hash(tokenB))).id, idB);
      assert.equal(await store.resolveSession(tokenA), null);
      assert.equal(await store.createSession(a, hash(tokenA2), hash(tokenA)), idA);
      assert.equal(await store.resolveSession(hash(tokenA)), null);
      await assert.rejects(requireToolkitUser(request(tokenA), { config, store }), { status: 401 });
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${schema}.users`)).rows[0].count, 2);
      await pool.query(`UPDATE ${schema}.sessions SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE token_hash=$1`, [hash(tokenA2)]);
      assert.equal(await store.resolveSession(hash(tokenA2)), null);
      await assert.rejects(requireToolkitUser(request(tokenA2), { config, store }), { status: 401 });
      await store.revokeSession(hash(tokenB));
      assert.equal(await store.resolveSession(hash(tokenB)), null);
      await assert.rejects(requireToolkitUser(request(tokenB), { config, store }), { status: 401 });
      const activeToken = randomToken();
      await store.createSession(a, hash(activeToken));
      await pool.query(`UPDATE ${schema}.users SET active=false WHERE id=$1`, [idA]);
      await assert.rejects(requireToolkitUser(request(activeToken), { config, store }), { status: 403 });
      await assert.rejects(store.createSession(a, hash(randomToken())), { status: 403 });
      assert.equal((await pool.query(`SELECT active FROM ${schema}.users WHERE id=$1`, [idA])).rows[0].active, false);
      console.log('Development PostgreSQL integration checks passed; synthetic schema only.');
    } catch (error) {
      // Assertion diagnostics contain synthetic data only; suppress all driver diagnostics.
      if (error.code === 'ERR_ASSERTION') throw error;
      throw new Error('Database integration failed; connection/driver details withheld.');
    } finally {
      if (created && /^auth_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });
