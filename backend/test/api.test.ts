import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { type Db, migrate, newId, now } from '../src/db.js';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';

async function addUser(db: Db, email: string) {
  await db.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
    newId(), email, 'Test', bcrypt.hashSync('pw123456', 4), now(),
  ]);
}

before(async () => {
  // In-memory Postgres, so tests need no running database.
  const pg = new PGlite();
  const db: Db = { query: async (sql, params) => (await pg.query(sql, params)).rows as never };
  await migrate(db);
  await addUser(db, 'a@test.com');
  await addUser(db, 'b@test.com');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const login = async (email: string) => (await call('POST', '/auth/login', undefined, { email, password: 'pw123456' })).body.auth as string;

test('login rejects bad password', async () => {
  const r = await call('POST', '/auth/login', undefined, { email: 'a@test.com', password: 'nope' });
  assert.equal(r.status, 401);
  assert.ok(r.body.detail);
});

test('full flow: org → expense CRUD, isolation, logout', async () => {
  const a = await login('a@test.com');
  const b = await login('b@test.com');

  assert.equal((await call('GET', '/auth/me', a)).body.email, 'a@test.com');

  const org = (await call('POST', '/organizations', a, { organization_name: 'Atrium', categories: ['Food'] })).body;
  assert.equal(org.role, 'owner');
  assert.deepEqual(org.categories, ['Food']);
  assert.equal((await call('GET', '/organizations', a)).body.length, 1);
  assert.equal((await call('GET', '/organizations', b)).body.length, 0);

  // Payload shaped like pages/receipts.js confirmExpense()
  const created = await call('POST', '/expenses', a, {
    organization_id: org._id, status: 'confirmed', vendor_name: '7-Eleven',
    date: '2026-10-01T00:00:00.000Z', total: '1,070.00', tax_amount: 70, currency: 'THB', category: 'Food', notes: '',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.total, 1070);

  assert.equal((await call('POST', '/expenses', b, { organization_id: org._id, total: 1 })).status, 403);
  assert.equal((await call('GET', `/expenses?organization_id=${org._id}`, b)).status, 403);
  assert.equal((await call('PUT', `/expenses/${created.body._id}`, b, { total: 1 })).status, 404);

  const updated = await call('PUT', `/expenses/${created.body._id}`, a, { status: 'disabled', total: 500 });
  assert.equal(updated.body.status, 'disabled');
  assert.equal(updated.body.total, 500);
  assert.equal((await call('PUT', `/expenses/${created.body._id}`, a, { status: 'weird' })).status, 400);

  assert.equal((await call('GET', `/expenses?organization_id=${org._id}`, a)).body.length, 1);
  assert.equal((await call('DELETE', `/expenses/${created.body._id}`, a)).status, 204);
  assert.equal((await call('GET', '/expenses', a)).body.length, 0);

  await call('POST', '/auth/logout', a);
  assert.equal((await call('GET', '/auth/me', a)).status, 401);
});
