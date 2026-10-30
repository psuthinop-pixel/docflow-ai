import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { migrate, newId, now, one, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';
let db: Db;

before(async () => {
  db = new PGlite();
  await migrate(db);
  for (const email of ['owner@fx.com', 'member@fx.com']) {
    await db.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
      newId(), email, 'T', bcrypt.hashSync('pw123456', 4), now(),
    ]);
  }
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}
const login = async (email: string) =>
  (await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw123456' }) })).json()).auth as string;

test('THB expenses convert at 1; legacy rows are backfilled', async () => {
  const owner = await login('owner@fx.com');
  const org = (await call('POST', '/organizations', owner, { organization_name: 'Atrium' })).body;
  const e = (await call('POST', '/expenses', owner, { organization_id: org._id, total: 1070, tax_amount: 70, currency: 'THB' })).body;
  assert.equal(e.fx_rate, 1);
  assert.equal(e.total_thb, 1070);
  assert.equal(e.tax_amount_thb, 70);

  await db.query('UPDATE expenses SET total_thb = NULL, fx_rate = NULL WHERE id = $1', [e.id]);
  await migrate(db);
  assert.equal((await one<{ total_thb: number }>(db, 'SELECT total_thb FROM expenses WHERE id = $1', [e.id]))!.total_thb, 1070);
});

test('USD receipt: pending until owner enters card statement THB, then approvable', async () => {
  const owner = await login('owner@fx.com');
  const member = await login('member@fx.com');
  const org = (await call('POST', '/organizations', owner, { organization_name: 'Ratchada 13' })).body;
  const memberId = (await one<{ id: string }>(db, "SELECT id FROM users WHERE email = 'member@fx.com'"))!.id;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [memberId, org._id, 'member']);

  const saved = await call('POST', '/expenses', member, { organization_id: org._id, vendor_name: 'Figma', total: 100, currency: 'usd', status: 'confirmed' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.currency, 'USD');
  assert.equal(saved.body.total, 100);
  assert.equal(saved.body.total_thb, null);
  const id = saved.body._id;

  // Members cannot set the rate; nobody can approve while the THB amount is missing.
  assert.equal((await call('PUT', `/expenses/${id}`, member, { total_thb: 3625 })).status, 403);
  assert.equal((await call('POST', '/expenses', member, { organization_id: org._id, total: 5, currency: 'USD', fx_rate: 36 })).status, 403);
  const blocked = await call('PUT', `/expenses/${id}`, owner, { status: 'approved' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.detail, /card statement/);

  // Card statement amount → rate is derived; the THB charged is kept exactly.
  const fx = await call('PUT', `/expenses/${id}`, owner, { total_thb: '3,625.37', fx_rate_date: '2026-10-28' });
  assert.equal(fx.status, 200);
  assert.equal(fx.body.total_thb, 3625.37);
  assert.equal(fx.body.fx_rate, 36.2537);
  assert.equal(fx.body.fx_source, 'card_statement');
  assert.equal(fx.body.fx_rate_date, '2026-10-28');
  assert.ok(fx.body.fx_set_by && fx.body.fx_set_at);

  // Unrelated edits keep the THB amount; a currency change drops the old rate.
  assert.equal((await call('PUT', `/expenses/${id}`, member, { notes: 'annual plan' })).body.total_thb, 3625.37);
  const eur = (await call('PUT', `/expenses/${id}`, owner, { currency: 'EUR' })).body;
  assert.equal(eur.fx_rate, null);
  assert.equal(eur.total_thb, null);

  // Rate entry also works, and approval then goes through.
  const rated = (await call('PUT', `/expenses/${id}`, owner, { fx_rate: 39.5, tax_amount: 10 })).body;
  assert.equal(rated.total_thb, 3950);
  assert.equal(rated.tax_amount_thb, 395);
  assert.equal((await call('PUT', `/expenses/${id}`, owner, { status: 'approved' })).body.status, 'approved');
  // Clearing the rate on an approved expense is refused.
  assert.equal((await call('PUT', `/expenses/${id}`, owner, { fx_rate: null })).status, 400);

  assert.equal((await call('PUT', `/expenses/${id}`, owner, { currency: 'US Dollar' })).status, 400);
  assert.equal((await call('PUT', `/expenses/${id}`, owner, { fx_rate: -1 })).status, 400);
});
