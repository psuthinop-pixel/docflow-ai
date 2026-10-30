import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { migrate, newId, now, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';
let db: Db;

async function addUser(db: Db, email: string) {
  await db.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
    newId(), email, 'Test', bcrypt.hashSync('pw123456', 4), now(),
  ]);
}

before(async () => {
  // In-process Postgres, so tests exercise the same SQL that runs on Neon.
  db = new PGlite();
  await migrate(db);
  await addUser(db, 'a@test.com');
  await addUser(db, 'b@test.com');
  await addUser(db, 'c@test.com');
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

test('organization edit: owner/admin only, validated', async () => {
  const a = await login('a@test.com');
  const c = await login('c@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Serve', color: '#6366f1' })).body;
  assert.equal((await call('POST', '/organizations', a, { organization_name: 'X', color: 'red;}' })).status, 400);

  const edited = await call('PUT', `/organizations/${org._id}`, a, {
    organization_name: '  Serve Property ', color: '#10b981', categories: [' Utilities ', 'utilities', 'Repairs', ''],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.organization_name, 'Serve Property');
  assert.equal(edited.body.color, '#10b981');
  assert.deepEqual(edited.body.categories, ['Utilities', 'Repairs']);
  assert.equal(edited.body.role, 'owner');

  assert.equal((await call('PUT', `/organizations/${org._id}`, a, { color: 'javascript:1' })).status, 400);
  assert.equal((await call('PUT', `/organizations/${org._id}`, a, { organization_name: ' ' })).status, 400);
  assert.equal((await call('PUT', `/organizations/${org._id}`, a, {})).status, 400);

  // Not a member: 404. Member without edit rights: 403.
  assert.equal((await call('PUT', `/organizations/${org._id}`, c, { color: '#000000' })).status, 404);
  const cId = (await db.query('SELECT id FROM users WHERE email = $1', ['c@test.com'])).rows[0].id as string;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [cId, org._id, 'member']);
  assert.equal((await call('PUT', `/organizations/${org._id}`, c, { color: '#000000' })).status, 403);
});

test('system status reports the OCR engine without secrets', async () => {
  assert.equal((await call('GET', '/system/status')).status, 401);
  const a = await login('a@test.com');
  const r = await call('GET', '/system/status', a);
  assert.equal(r.status, 200);
  assert.equal(r.body.ocr.setting, 'auto');
  assert.ok(['typhoon', 'claude', 'tesseract'].includes(r.body.ocr.active));
  assert.equal(r.body.ocr.engines.tesseract, true);
  assert.equal(typeof r.body.ocr.engines.typhoon, 'boolean');
});
