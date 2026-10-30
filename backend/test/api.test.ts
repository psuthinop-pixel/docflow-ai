import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { migrate, newId, now, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import ExcelJS from 'exceljs';

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
  const nul = await call('PUT', `/expenses/${created.body._id}`, a, { notes: 'API\u0000 credits' });
  assert.equal(nul.status, 200);
  assert.equal(nul.body.notes, 'API credits');

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

test('members: invite, roles, last-owner guard, leave, password change', async () => {
  const a = await login('a@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Atrium Ratchada' })).body;
  const path = `/organizations/${org._id}/members`;

  // New email: account created with a one-time password, which works for login
  const invited = await call('POST', path, a, { email: ' New.Person@Test.com ', name: 'Noi', role: 'admin' });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.email, 'new.person@test.com');
  assert.match(invited.body.temporary_password, /^[\w]{4}-[\w]{4}-[\w]{4}$/);
  const first = (await call('POST', '/auth/login', undefined, { email: 'new.person@test.com', password: invited.body.temporary_password })).body.auth;
  assert.ok(first);
  // Invited accounts must set their own password before using the API
  const n = (await call('POST', '/auth/password', first, { current_password: invited.body.temporary_password, new_password: 'noi-password1' })).body.auth as string;

  // Existing account: added without a password; duplicates rejected
  const b = await call('POST', path, a, { email: 'b@test.com' });
  assert.equal(b.status, 201);
  assert.equal(b.body.role, 'member');
  assert.equal(b.body.temporary_password, undefined);
  assert.equal((await call('POST', path, a, { email: 'b@test.com' })).status, 409);
  assert.equal((await call('POST', path, a, { email: 'not-an-email' })).status, 400);
  assert.equal((await call('POST', path, a, { email: 'x@test.com', role: 'boss' })).status, 400);

  const list = (await call('GET', path, n)).body;
  assert.deepEqual(list.map((m: { role: string }) => m.role), ['owner', 'admin', 'member']);
  assert.equal(list[0].password_hash, undefined);

  // Admin limits: cannot grant owner, cannot touch an owner
  const ownerId = list[0].user_id;
  assert.equal((await call('POST', path, n, { email: 'y@test.com', role: 'owner' })).status, 403);
  assert.equal((await call('PUT', `${path}/${ownerId}`, n, { role: 'member' })).status, 403);
  assert.equal((await call('DELETE', `${path}/${ownerId}`, n)).status, 403);
  assert.equal((await call('PUT', `${path}/${b.body.user_id}`, n, { role: 'admin' })).status, 200);

  // Members cannot manage; outsiders see nothing
  const bTok = await login('b@test.com');
  await call('PUT', `${path}/${b.body.user_id}`, a, { role: 'member' });
  assert.equal((await call('POST', path, bTok, { email: 'z@test.com' })).status, 403);
  const c = await login('c@test.com');
  assert.equal((await call('GET', path, c)).status, 404);

  // Last owner cannot be demoted or leave; after promoting another owner they can
  assert.equal((await call('PUT', `${path}/${ownerId}`, a, { role: 'admin' })).status, 409);
  assert.equal((await call('DELETE', `${path}/${ownerId}`, a)).status, 409);
  assert.equal((await call('PUT', `${path}/${invited.body.user_id}`, a, { role: 'owner' })).status, 200);
  assert.equal((await call('DELETE', `${path}/${ownerId}`, a)).status, 204);
  assert.equal((await call('GET', path, a)).status, 404);

  // A member may leave on their own
  assert.equal((await call('DELETE', `${path}/${b.body.user_id}`, bTok)).status, 204);

  // Password change
  assert.equal((await call('POST', '/auth/password', n, { current_password: 'wrong', new_password: 'longenough' })).status, 400);
  assert.equal((await call('POST', '/auth/password', n, { current_password: 'noi-password1', new_password: 'noi-password1' })).status, 400);
  assert.equal((await call('POST', '/auth/password', n, { current_password: 'noi-password1', new_password: 'short' })).status, 400);
  assert.equal((await call('POST', '/auth/password', n, { current_password: 'noi-password1', new_password: 'a-new-password' })).status, 200);
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'new.person@test.com', password: 'a-new-password' })).status, 200);
});

test('invited account: must change password first, temp expiry, reset invite, other sessions signed out', async () => {
  const a = await login('a@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Ratchada 13' })).body;
  const path = `/organizations/${org._id}/members`;
  const inv = (await call('POST', path, a, { email: 'fresh@test.com', name: 'Fresh' })).body;
  assert.ok(inv.invite_expires_at);

  const first = await call('POST', '/auth/login', undefined, { email: 'fresh@test.com', password: inv.temporary_password });
  assert.equal(first.body.must_change_password, true);
  const t = first.body.auth;

  // Everything but the auth routes is blocked until the password is replaced
  const blocked = await call('GET', '/organizations', t);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'password_change_required');
  assert.equal((await call('GET', `/expenses?organization_id=${org._id}`, t)).status, 403);
  assert.equal((await call('GET', '/auth/me', t)).body.must_change_password, true);

  // The owner sees the invite as pending and can issue a new temporary password; the old one stops working
  const pending = (await call('GET', path, a)).body.find((m: { email: string }) => m.email === 'fresh@test.com');
  assert.equal(pending.invite_pending, true);
  const reset = await call('POST', `${path}/${inv.user_id}/reset-invite`, a);
  assert.equal(reset.status, 200);
  assert.notEqual(reset.body.temporary_password, inv.temporary_password);
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'fresh@test.com', password: inv.temporary_password })).status, 401);

  // Expired temporary password is refused with a clear reason
  await db.query('UPDATE users SET temp_password_expires_at = $1 WHERE id = $2', [new Date(Date.now() - 1000).toISOString(), inv.user_id]);
  const expired = await call('POST', '/auth/login', undefined, { email: 'fresh@test.com', password: reset.body.temporary_password });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, 'temporary_password_expired');
  const again = (await call('POST', `${path}/${inv.user_id}/reset-invite`, a)).body;

  // Two sessions; changing the password in one signs out the other and unlocks the account
  const s1 = (await call('POST', '/auth/login', undefined, { email: 'fresh@test.com', password: again.temporary_password })).body.auth;
  await new Promise((r) => setTimeout(r, 1100)); // tokens carry whole-second timestamps
  const s2 = (await call('POST', '/auth/login', undefined, { email: 'fresh@test.com', password: again.temporary_password })).body.auth;
  await new Promise((r) => setTimeout(r, 1100));
  const changed = await call('POST', '/auth/password', s2, { current_password: again.temporary_password, new_password: 'fresh-password' });
  assert.equal(changed.status, 200);
  assert.ok(changed.body.auth);
  assert.equal((await call('GET', '/auth/me', s1)).status, 401);
  assert.equal((await call('GET', '/auth/me', s2)).status, 401);
  assert.equal((await call('GET', '/organizations', changed.body.auth)).status, 200);
  assert.equal((await call('GET', '/auth/me', changed.body.auth)).body.must_change_password, false);

  // Once they chose their own password, nobody else can reset it
  assert.equal((await call('POST', `${path}/${inv.user_id}/reset-invite`, a)).status, 409);
});

test('reports: summary by month/category/property, VAT rules, scoping', async () => {
  const a = await login('a@test.com');
  const b = await login('b@test.com');
  const o1 = (await call('POST', '/organizations', a, { organization_name: 'Hotel A' })).body;
  const o2 = (await call('POST', '/organizations', a, { organization_name: 'Hotel B' })).body;
  const add = (org: string, f: Record<string, unknown>) => call('POST', '/expenses', a, { organization_id: org, currency: 'THB', ...f });
  const TAX = '0107537000521';
  await add(o1._id, { status: 'approved', vendor_name: 'MEA', date: '2026-09-03', total: 1070, tax_amount: 70, vendor_taxid: TAX, vendor_branch: 'สาขาที่ 12', category: 'Utilities', invoice_number: 'B2' });
  await add(o1._id, { status: 'confirmed', vendor_name: 'Makro', date: '2026-09-01', total: 535, tax_amount: 35, vendor_taxid: TAX, category: 'Supplies', invoice_number: 'A1' });
  await add(o1._id, { status: 'confirmed', vendor_name: 'Toll', date: '2026-09-10', total: 50, tax_amount: 3.27, vendor_taxid: '', category: 'Travel' });
  await add(o1._id, { status: 'draft', vendor_name: 'Draft', date: '2026-10-02', total: 214, tax_amount: 14, vendor_taxid: TAX, category: '' });
  await add(o1._id, { status: 'disabled', vendor_name: 'Ignored', date: '2026-09-05', total: 9999, tax_amount: 9 });
  await add(o2._id, { status: 'approved', vendor_name: 'HomePro', date: '2026-10-15', total: 2140, tax_amount: 140, vendor_taxid: TAX, category: 'Repairs' });
  // Foreign currency: left out of spend until its THB amount is entered; never Thai input VAT
  const usd = (await add(o1._id, { status: 'confirmed', vendor_name: 'Figma', date: '2026-09-20', total: 100, tax_amount: 7, currency: 'USD', vendor_taxid: TAX, category: 'Software' })).body;

  const one = await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-10`, a);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.range, { from: '2026-09', to: '2026-10', months: 2 });
  const sep = one.body.by_month.find((x: { month: string }) => x.month === '2026-09');
  assert.equal(sep.spend, 1655);           // disabled excluded
  assert.equal(sep.vat_claimable, 105);    // toll has no tax ID
  assert.equal(sep.vat_claimable_count, 2);
  assert.equal(sep.count, 4);              // includes the USD receipt waiting for its THB amount
  assert.equal(one.body.by_month.find((x: { month: string }) => x.month === '2026-10').spend, 214); // drafts count as spend
  assert.equal(one.body.by_category[0].category, 'Utilities');
  assert.ok(one.body.by_category.some((x: { category: string }) => x.category === 'Uncategorised'));
  const gaps = Object.fromEntries(one.body.vat_not_claimable.map((x: { reason: string; vat: number }) => [x.reason, x.vat]));
  assert.deepEqual(gaps, { missing_tax_id: 3.27, not_reviewed: 14 });
  assert.equal(one.body.organizations.length, 1);
  assert.deepEqual(one.body.fx_pending, [{ currency: 'USD', count: 1, total: 100 }]);
  await call('PUT', `/expenses/${usd._id}`, a, { total_thb: 3625 });
  const conv = (await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-09`, a)).body;
  assert.equal(conv.by_month[0].spend, 1655 + 3625);
  assert.equal(conv.by_month[0].vat_claimable, 105);
  assert.deepEqual(conv.fx_pending, []);
  await call('PUT', `/expenses/${usd._id}`, a, { status: 'disabled' });

  // All properties: both orgs, nothing from orgs the user is not in
  const both = (await call('GET', '/reports/summary?organization_id=all&from=2026-09&to=2026-10', a)).body;
  assert.ok(both.organizations.some((o: { id: string }) => o.id === o2._id));
  assert.equal(both.by_month.filter((x: { organization_id: string }) => [o1._id, o2._id].includes(x.organization_id)).reduce((t: number, x: { spend: number }) => t + x.spend, 0), 1655 + 214 + 2140);
  const bAll = (await call('GET', '/reports/summary?organization_id=all', b)).body;
  assert.ok(!bAll.organizations.some((o: { id: string }) => o.id === o1._id));
  assert.equal((await call('GET', `/reports/summary?organization_id=${o1._id}`, b)).status, 403);
  assert.equal((await call('GET', '/reports/summary', a)).status, 400);
  assert.equal((await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-10&to=2026-09`, a)).status, 400);
  assert.equal((await call('GET', `/reports/summary?organization_id=${o1._id}&from=2020-01&to=2026-10`, a)).status, 400);

  // VAT listing: one property and month, by date then invoice; flags the record that is not claimable
  const recent = (await call('GET', `/expenses?organization_id=${o1._id}&limit=2`, a)).body;
  assert.deepEqual(recent.map((x: { vendor_name: string }) => x.vendor_name), ['Draft', 'Figma']);
  const makro = recent.length && (await call('GET', `/expenses?organization_id=${o1._id}`, a)).body.find((x: { vendor_name: string }) => x.vendor_name === 'Makro');
  await new Promise((r) => setTimeout(r, 10));
  await call('PUT', `/expenses/${makro._id}`, a, { notes: 'checked' });
  assert.equal((await call('GET', `/expenses?organization_id=${o1._id}&sort=updated&limit=1`, a)).body[0].vendor_name, 'Makro');
  assert.equal((await call('GET', `/expenses?organization_id=${o1._id}&limit=abc`, a)).body.length, 6);

  const vat = await call('GET', `/reports/vat?organization_id=${o1._id}&month=2026-09`, a);
  assert.equal(vat.status, 200);
  assert.deepEqual(vat.body.map((x: { vendor_name: string }) => x.vendor_name), ['Makro', 'MEA', 'Toll']);
  assert.deepEqual(vat.body.map((x: { claimable: boolean }) => x.claimable), [true, true, false]);
  assert.equal(vat.body[0].subtotal, 500);
  assert.equal(vat.body[1].vendor_branch, '00012');
  assert.equal((await add(o1._id, { vendor_branch: 'Ladprao' })).status, 400);

  // Excel: VAT report and summary workbook
  const xl = async (path: string) => {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${a}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /spreadsheetml/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    return { book, disposition: res.headers.get('content-disposition') ?? '' };
  };
  const v = await xl(`/reports/vat.xlsx?organization_id=${o1._id}&month=2026-09`);
  assert.match(decodeURIComponent(v.disposition), /Hotel A input VAT 2026-09\.xlsx/);
  const ws = v.book.getWorksheet('Input VAT')!;
  const rows = Array.from(ws.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));
  const makroRow = rows.find((r) => r[3] === 'Makro')!;
  assert.equal(makroRow[0], 1);
  assert.equal(makroRow[4], TAX);                 // text, leading zero kept
  assert.equal(rows.find((r) => r[3] === 'MEA')![5], 'สาขาที่ 00012');
  const totalRow = rows.find((r) => String(r[3]).includes('Total claimable'))!;
  assert.equal((totalRow[7] as { result: number }).result, 105);
  assert.ok(rows.some((r) => r[3] === 'Toll' && r[9] === 'Missing seller tax ID'));
  assert.equal((ws.getCell(`B${rows.indexOf(makroRow)}`).value as Date).toISOString().slice(0, 10), '2026-09-01');

  const sm = await xl('/reports/summary.xlsx?organization_id=all&from=2026-09&to=2026-10');
  assert.deepEqual(sm.book.worksheets.map((w) => w.name), ['By month', 'By category', 'Input VAT', 'Data']);
  const bm = Array.from(sm.book.getWorksheet('By month')!.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));
  const grand = bm.find((r) => r[0] === 'Total')!;
  assert.equal((grand[grand.length - 1] as { result: number }).result, 1655 + 214 + 2140);
  assert.equal((await fetch(`${base}/reports/vat.xlsx?organization_id=${o1._id}&month=2026-09`, { headers: { Authorization: `Bearer ${b}` } })).status, 403);
  assert.equal((await call('GET', '/reports/vat?organization_id=all&month=2026-09', a)).status, 400);
  assert.equal((await call('GET', `/reports/vat?organization_id=${o1._id}&month=2026-13`, a)).status, 400);
});
