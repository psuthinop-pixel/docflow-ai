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
  await add(o1._id, { status: 'approved', vendor_name: 'PTT Station', date: '2026-09-12', total: 535, tax_amount: 35, vendor_taxid: TAX, category: 'Travel' });
  await add(o1._id, { status: 'approved', vendor_name: 'Somchai Oil', date: '2026-09-13', total: 107, tax_amount: 7, vendor_taxid: TAX, category: 'ค่าน้ำมัน' });
  await add(o1._id, { status: 'draft', vendor_name: 'Draft', date: '2026-10-02', total: 214, tax_amount: 14, vendor_taxid: TAX, category: '' });
  await add(o1._id, { status: 'disabled', vendor_name: 'Ignored', date: '2026-09-05', total: 9999, tax_amount: 9 });
  await add(o2._id, { status: 'approved', vendor_name: 'HomePro', date: '2026-10-15', total: 2140, tax_amount: 140, vendor_taxid: TAX, category: 'Repairs' });
  // Foreign currency: left out of spend until its THB amount is entered; never Thai input VAT
  const usd = (await add(o1._id, { status: 'confirmed', vendor_name: 'Figma', date: '2026-09-20', total: 100, tax_amount: 7, currency: 'USD', vendor_taxid: TAX, category: 'Software' })).body;

  const one = await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-10`, a);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.range, { from: '2026-09', to: '2026-10', months: 2 });
  const sep = one.body.by_month.find((x: { month: string }) => x.month === '2026-09');
  assert.equal(sep.spend, 2297);           // disabled excluded; fuel still counts as spend
  assert.equal(sep.vat_claimable, 105);    // toll has no tax ID
  assert.equal(sep.vat_claimable_count, 2);
  assert.equal(sep.count, 6);              // includes the USD receipt waiting for its THB amount
  assert.equal(one.body.by_month.find((x: { month: string }) => x.month === '2026-10').spend, 214); // drafts count as spend
  assert.equal(one.body.by_category[0].category, 'Utilities');
  assert.ok(one.body.by_category.some((x: { category: string }) => x.category === 'Uncategorised'));
  const gaps = Object.fromEntries(one.body.vat_not_claimable.map((x: { reason: string; vat: number }) => [x.reason, x.vat]));
  assert.deepEqual(gaps, { fuel: 42, missing_tax_id: 3.27, not_reviewed: 14 });
  // VAT claim override: pickup fuel marked claimable; an ordinary receipt marked not claimable
  const list = (await call('GET', `/expenses?organization_id=${o1._id}`, a)).body as { _id: string; vendor_name: string }[];
  const idOf = (n: string) => list.find((x) => x.vendor_name === n)!._id;
  assert.equal((await call('PUT', `/expenses/${idOf('PTT Station')}`, a, { vat_claim: 'maybe' })).status, 400);
  await call('PUT', `/expenses/${idOf('PTT Station')}`, a, { vat_claim: 'yes' });
  await call('PUT', `/expenses/${idOf('Makro')}`, a, { vat_claim: 'no' });
  const ov = (await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-10`, a)).body;
  assert.equal(ov.by_month.find((x: { month: string }) => x.month === '2026-09').vat_claimable, 105 + 35 - 35);
  assert.deepEqual(Object.fromEntries(ov.vat_not_claimable.map((x: { reason: string; vat: number }) => [x.reason, x.vat])),
    { excluded: 35, fuel: 7, missing_tax_id: 3.27, not_reviewed: 14 });
  const ovVat = (await call('GET', `/reports/vat?organization_id=${o1._id}&month=2026-09`, a)).body as { vendor_name: string; claimable: boolean }[];
  assert.equal(ovVat.find((x) => x.vendor_name === 'PTT Station')!.claimable, true);
  await call('PUT', `/expenses/${idOf('PTT Station')}`, a, { vat_claim: '' });
  await call('PUT', `/expenses/${idOf('Makro')}`, a, { vat_claim: '' });
  // Capex: category Asset is capex on auto; per-receipt flag overrides either way. VAT stays claimable.
  const sofa = (await add(o1._id, { status: 'approved', vendor_name: 'IKEA', date: '2026-09-20', total: 10700, tax_amount: 700, vendor_taxid: TAX, category: 'Asset' })).body;
  assert.equal((await call('PUT', `/expenses/${sofa._id}`, a, { capex: 'maybe' })).status, 400);
  await call('PUT', `/expenses/${idOf('MEA')}`, a, { capex: 'yes' });
  let cx = (await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-09`, a)).body;
  assert.equal(cx.by_month[0].spend, 2297 - 1070);        // operating spend excludes capex
  assert.equal(cx.by_month[0].capex, 10700 + 1070);
  assert.equal(cx.by_month[0].vat_claimable, 105 + 700);  // capex VAT is still input VAT
  assert.equal(cx.by_category.find((x: { category: string }) => x.category === 'Asset').capex, 10700);
  await call('PUT', `/expenses/${sofa._id}`, a, { capex: 'no' });
  await call('PUT', `/expenses/${idOf('MEA')}`, a, { capex: '' });
  cx = (await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-09`, a)).body;
  assert.equal(cx.by_month[0].capex, 0);
  assert.equal((await call('DELETE', `/expenses/${sofa._id}`, a)).status < 300, true);
  assert.equal(one.body.organizations.length, 1);
  assert.deepEqual(one.body.fx_pending, [{ currency: 'USD', count: 1, total: 100 }]);
  await call('PUT', `/expenses/${usd._id}`, a, { total_thb: 3625 });
  const conv = (await call('GET', `/reports/summary?organization_id=${o1._id}&from=2026-09&to=2026-09`, a)).body;
  assert.equal(conv.by_month[0].spend, 2297 + 3625);
  assert.equal(conv.by_month[0].vat_claimable, 105);
  assert.deepEqual(conv.fx_pending, []);
  await call('PUT', `/expenses/${usd._id}`, a, { status: 'disabled' });

  // All properties: both orgs, nothing from orgs the user is not in
  const both = (await call('GET', '/reports/summary?organization_id=all&from=2026-09&to=2026-10', a)).body;
  assert.ok(both.organizations.some((o: { id: string }) => o.id === o2._id));
  assert.equal(both.by_month.filter((x: { organization_id: string }) => [o1._id, o2._id].includes(x.organization_id)).reduce((t: number, x: { spend: number }) => t + x.spend, 0), 2297 + 214 + 2140);
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
  assert.equal((await call('GET', `/expenses?organization_id=${o1._id}&limit=abc`, a)).body.length, 8);

  const vat = await call('GET', `/reports/vat?organization_id=${o1._id}&month=2026-09`, a);
  assert.equal(vat.status, 200);
  assert.deepEqual(vat.body.map((x: { vendor_name: string }) => x.vendor_name), ['Makro', 'MEA', 'Toll', 'PTT Station', 'Somchai Oil']);
  assert.deepEqual(vat.body.map((x: { claimable: boolean }) => x.claimable), [true, true, false, false, false]);
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
  assert.ok(rows.some((r) => r[3] === 'PTT Station' && r[9] === 'Fuel: expense only, VAT not claimable'));
  assert.equal((ws.getCell(`B${rows.indexOf(makroRow)}`).value as Date).toISOString().slice(0, 10), '2026-09-01');

  const sm = await xl('/reports/summary.xlsx?organization_id=all&from=2026-09&to=2026-10');
  assert.deepEqual(sm.book.worksheets.map((w) => w.name), ['By month', 'By category', 'Input VAT', 'Data']);
  const bm = Array.from(sm.book.getWorksheet('By month')!.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));
  const grand = bm.find((r) => r[0] === 'Total')!;
  assert.equal((grand[grand.length - 1] as { result: number }).result, 2297 + 214 + 2140);
  assert.equal((await fetch(`${base}/reports/vat.xlsx?organization_id=${o1._id}&month=2026-09`, { headers: { Authorization: `Bearer ${b}` } })).status, 403);
  // ภ.พ.36: the Figma USD payment, 7% of the THB amount paid
  await call('PUT', `/expenses/${usd._id}`, a, { status: 'confirmed' });
  let pp = await call('GET', `/reports/pp36?organization_id=${o1._id}&month=2026-09`, a);
  assert.equal(pp.body[0].ready, false);           // service/goods not set yet
  assert.equal((await call('PUT', `/expenses/${usd._id}`, a, { supply_type: 'gift' })).status, 400);
  await call('PUT', `/expenses/${usd._id}`, a, { supply_type: 'goods' });
  assert.equal((await call('GET', `/reports/pp36?organization_id=${o1._id}&month=2026-09`, a)).body.length, 0);
  await call('PUT', `/expenses/${usd._id}`, a, { supply_type: 'service' });
  pp = await call('GET', `/reports/pp36?organization_id=${o1._id}&month=2026-09`, a);
  assert.equal(pp.status, 200);
  assert.deepEqual(pp.body.map((x: { vendor_name: string }) => x.vendor_name), ['Figma']);
  assert.equal(pp.body[0].base_thb, 3625);
  assert.equal(pp.body[0].vat_thb, 253.75);
  assert.equal(pp.body[0].ready, true);
  const p36 = await xl(`/reports/pp36.xlsx?organization_id=${o1._id}&month=2026-09`);
  const prow = Array.from(p36.book.getWorksheet('PP36')!.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));
  assert.equal((prow.find((r) => r[5] === 'รวม / Total')![10] as { result: number }).result, 253.75);
  assert.equal((await call('GET', '/reports/vat?organization_id=all&month=2026-09', a)).status, 400);
  assert.equal((await call('GET', `/reports/vat?organization_id=${o1._id}&month=2026-13`, a)).status, 400);
});

test('payment source: company vs employee advance, reimbursement by owner/admin only', async () => {
  const a = await login('a@test.com');
  const c = await login('c@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Advances Hotel' })).body;
  const cId = (await db.query('SELECT id FROM users WHERE email = $1', ['c@test.com'])).rows[0].id as string;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [cId, org._id, 'member']);
  const add = (t: string, f: Record<string, unknown>) =>
    call('POST', '/expenses', t, { organization_id: org._id, currency: 'THB', status: 'confirmed', date: '2026-11-02', ...f });

  assert.equal((await add(a, { total: 1, payment_source: 'cash' })).status, 400);
  await add(a, { vendor_name: 'HomePro', total: 5000, payment_source: 'company' });
  const lek = (await add(c, { vendor_name: 'Makro', total: 1200, payment_source: 'advance', paid_by: 'Lek' })).body;
  await add(c, { vendor_name: '7-Eleven', total: 300, payment_source: 'advance', paid_by: 'Lek' });
  await add(a, { vendor_name: 'Grab', total: 250, payment_source: 'advance', paid_by: 'Kenn' });

  const owed = async () => (await call('GET', `/reports/summary?organization_id=${org._id}&from=2026-11&to=2026-11`, a)).body.advances_pending
    .map((x: { paid_by: string; count: number; total: number }) => [x.paid_by, x.count, x.total]);
  assert.deepEqual(await owed(), [['Lek', 2, 1500], ['Kenn', 1, 250]]);

  // A member can't mark their own advance reimbursed; an owner can
  assert.equal((await call('PUT', `/expenses/${lek._id}`, c, { reimbursed_at: '2026-11-15' })).status, 403);
  assert.equal((await call('PUT', `/expenses/${lek._id}`, a, { payment_source: 'company', reimbursed_at: '2026-11-15' })).status, 400);
  const paid = await call('PUT', `/expenses/${lek._id}`, a, { reimbursed_at: '2026-11-15' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.reimbursed_at, '2026-11-15');
  assert.deepEqual(await owed(), [['Lek', 1, 300], ['Kenn', 1, 250]]);
  // Still counts as spend either way
  const sum = (await call('GET', `/reports/summary?organization_id=${org._id}&from=2026-11&to=2026-11`, a)).body;
  assert.equal(sum.by_month[0].spend, 6750);
});

test('accounting phase A: seeded chart, category mapping, month readiness', async () => {
  const a = await login('a@test.com');
  const c = await login('c@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Books Hotel', categories: ['Office Supplies', 'Transport', 'Asset', 'Mystery'] })).body;
  const cId = (await db.query('SELECT id FROM users WHERE email = $1', ['c@test.com'])).rows[0].id as string;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [cId, org._id, 'member']);
  const q = `organization_id=${org._id}`;

  // Seeded once, readable by members
  const accts = (await call('GET', `/accounting/accounts?${q}`, c)).body as { id: string; code: string; role: string; type: string }[];
  assert.ok(accts.length > 40);
  assert.equal(accts.find((x) => x.code === '1150')!.role, 'input_vat');
  assert.equal(accts.find((x) => x.code === '2120')!.role, 'advances_payable');
  assert.equal((await call('GET', `/accounting/accounts?${q}`, a)).body.length, accts.length); // not re-seeded
  assert.equal((await call('GET', `/accounting/accounts?organization_id=nope`, a)).status, 403);

  // Only owner/admin edit; codes unique; role accounts can't be deactivated
  assert.equal((await call('POST', '/accounting/accounts', c, { organization_id: org._id, code: '6240', name: 'Pest control', type: 'expense' })).status, 403);
  const pest = await call('POST', '/accounting/accounts', a, { organization_id: org._id, code: '6240', name: 'Pest control', name_th: 'ค่ากำจัดแมลง', type: 'expense' });
  assert.equal(pest.status, 201);
  assert.equal((await call('POST', '/accounting/accounts', a, { organization_id: org._id, code: '6240', name: 'Dup', type: 'expense' })).status, 409);
  assert.equal((await call('POST', '/accounting/accounts', a, { organization_id: org._id, code: '7000', name: 'X', type: 'cost' })).status, 400);
  const inputVat = accts.find((x) => x.code === '1150')!;
  assert.equal((await call('PUT', `/accounting/accounts/${inputVat.id}`, a, { active: false })).status, 400);

  // Mapping: suggestions shown but not saved
  let map = (await call('GET', `/accounting/mapping?${q}`, a)).body;
  const row = (cat: string) => map.categories.find((x: { category: string }) => x.category === cat);
  assert.equal(row('Office Supplies').suggested_code, '6140');
  assert.equal(row('Office Supplies').account_code, null);
  assert.equal(row('Asset').suggested_code, '1230');
  assert.equal(row('Mystery').suggested_code, null);
  assert.deepEqual(map.settings, { bank_code: '1112', capex_code: '1230' });

  assert.equal((await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [{ category: 'Transport', account_code: '1150' }] })).status, 400); // not an expense account
  assert.equal((await call('PUT', '/accounting/mapping', a, { organization_id: org._id, bank_code: '6140' })).status, 400);
  assert.equal((await call('PUT', '/accounting/mapping', c, { organization_id: org._id, mappings: [] })).status, 403);

  // Readiness for a month
  const add = (f: Record<string, unknown>) => call('POST', '/expenses', a, { organization_id: org._id, currency: 'THB', status: 'confirmed', date: '2026-11-05', total: 107, tax_amount: 7, ...f });
  await add({ category: 'Office Supplies', payment_source: 'company' });
  await add({ category: 'Transport', payment_source: 'advance' });
  await add({ category: 'Office Supplies', capex: 'yes', payment_source: 'company' });
  await add({ category: 'Transport', status: 'draft' });
  await add({ category: '', payment_source: 'company' });
  const ready = async () => (await call('GET', `/accounting/readiness?${q}&month=2026-11`, c)).body;
  let r = await ready();
  assert.equal(r.ready, false);
  assert.equal(r.posted, 4);
  const codes = (list: { code: string }[]) => list.map((x) => x.code).sort();
  assert.deepEqual(codes(r.blockers), ['drafts', 'uncategorised', 'unmapped_categories']);
  assert.deepEqual(r.blockers.find((x: { code: string }) => x.code === 'unmapped_categories').categories.sort(), ['Office Supplies', 'Transport']);
  assert.deepEqual(codes(r.warnings), ['advance_no_person', 'capex_default_account', 'no_revenue', 'not_approved']);
  assert.equal((await call('GET', `/accounting/readiness?${q}&month=2026-13`, a)).status, 400);

  // Map, then rename an account code: the mapping follows
  map = (await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [
    { category: 'Office Supplies', account_code: '6140' }, { category: 'Transport', account_code: '6150' }, { category: 'Asset', account_code: '1230' },
  ], bank_code: '1113' })).body;
  assert.equal(row('Transport').account_code, '6150');
  assert.equal(map.settings.bank_code, '1113');
  const travel = accts.find((x) => x.code === '6150')!;
  assert.equal((await call('PUT', `/accounting/accounts/${travel.id}`, a, { code: '6151' })).status, 200);
  map = (await call('GET', `/accounting/mapping?${q}`, a)).body;
  assert.equal(row('Transport').account_code, '6151');

  // Resolve the blockers
  const list = (await call('GET', `/expenses?organization_id=${org._id}`, a)).body as { _id: string; status: string; category: string }[];
  for (const e of list) {
    if (e.status === 'draft') await call('PUT', `/expenses/${e._id}`, a, { status: 'disabled' });
    else if (!e.category) await call('PUT', `/expenses/${e._id}`, a, { category: 'Office Supplies' });
  }
  r = await ready();
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
  // Unmapping makes it not ready again
  await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [{ category: 'Transport', account_code: null }] });
  assert.equal((await ready()).ready, false);
});

test('accounting phase B: month journal preview, blockers, reimbursements, Excel export', async () => {
  const a = await login('a@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Journal Hotel', categories: ['Office Supplies', 'Transport'] })).body;
  const q = `organization_id=${org._id}&month=2026-11`;
  const add = (f: Record<string, unknown>) => call('POST', '/expenses', a, {
    organization_id: org._id, currency: 'THB', status: 'confirmed', date: '2026-11-05', vendor_taxid: '0107537000521', ...f,
  });
  await call('GET', `/accounting/accounts?organization_id=${org._id}`, a); // seed
  await add({ vendor_name: 'Makro', invoice_number: 'M1', category: 'Office Supplies', total: 1070, tax_amount: 70, payment_source: 'company' });
  const fuel = (await add({ vendor_name: 'PTT Station', category: 'Transport', total: 535, tax_amount: 35, payment_source: 'advance', paid_by: 'Lek' })).body;

  // Unmapped: preview works, not ready, export refused
  let j = (await call('GET', `/accounting/journal?${q}`, a)).body;
  assert.equal(j.ready, false);
  assert.ok(j.blockers.some((b: { code: string }) => b.code === 'unmapped_categories'));
  assert.equal(j.errors.length, 2);
  const res409 = await fetch(`${base}/accounting/journal.xlsx?${q}`, { headers: { Authorization: `Bearer ${a}` } });
  assert.equal(res409.status, 409);

  await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [
    { category: 'Office Supplies', account_code: '6140' }, { category: 'Transport', account_code: '6150' },
  ] });
  j = (await call('GET', `/accounting/journal?${q}`, a)).body;
  assert.equal(j.ready, true);
  assert.deepEqual(j.errors, []);
  assert.equal(j.entries.length, 2);
  assert.equal(j.entries[0].entry_no, 'JV-202611-0001');
  assert.deepEqual(j.totals, { debit: 1605, credit: 1605, balanced: true });
  const tb = Object.fromEntries(j.trial_balance.map((x: { account_code: string; debit: number; credit: number }) => [x.account_code, [x.debit, x.credit]]));
  assert.deepEqual(tb, { '1112': [0, 1070], '1150': [70, 0], '2120': [0, 535], '6140': [1000, 0], '6150': [535, 0] }); // fuel VAT stays in cost

  // Reimbursed in December: the December journal clears the advance, November is unchanged
  await call('PUT', `/expenses/${fuel._id}`, a, { reimbursed_at: '2026-12-03' });
  const dec = (await call('GET', `/accounting/journal?organization_id=${org._id}&month=2026-12`, a)).body;
  assert.equal(dec.entries.length, 1);
  assert.equal(dec.entries[0].kind, 'reimbursement');
  assert.deepEqual(dec.entries[0].lines.map((l: { account_code: string; debit: number; credit: number }) => [l.account_code, l.debit, l.credit]), [['2120', 535, 0], ['1112', 0, 535]]);
  assert.equal((await call('GET', `/accounting/journal?${q}`, a)).body.entries.length, 2);

  // Excel: journal lines and trial balance read back
  const res = await fetch(`${base}/accounting/journal.xlsx?${q}`, { headers: { Authorization: `Bearer ${a}` } });
  assert.equal(res.status, 200);
  assert.match(decodeURIComponent(res.headers.get('content-disposition') ?? ''), /Journal Hotel journal 2026-11\.xlsx/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  assert.deepEqual(book.worksheets.map((w) => w.name), ['Journal', 'Trial balance']);
  const rows = Array.from(book.getWorksheet('Journal')!.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));
  const body = rows.filter((r) => String(r[1] ?? '').startsWith('JV-'));
  assert.equal(body.length, 5);
  assert.deepEqual(body.map((r) => r[3]), ['6140', '1150', '1112', '6150', '2120']);
  const total = rows.find((r) => r[4] === 'Total')!;
  assert.equal((total[5] as { result: number }).result, 1605);
  assert.equal((total[6] as { result: number }).result, 1605);

  // Members can read; non-members can't
  assert.equal((await call('GET', `/accounting/journal?organization_id=${org._id}&month=bad`, a)).status, 400);
  const c = await login('c@test.com');
  assert.equal((await call('GET', `/accounting/journal?${q}`, c)).status, 403);
});

test('accounting phase C: close a month, lock its receipts, owner-only reopen, audit log', async () => {
  const a = await login('a@test.com');
  const c = await login('c@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Close Hotel', categories: ['Office Supplies'] })).body;
  const cId = (await db.query('SELECT id FROM users WHERE email = $1', ['c@test.com'])).rows[0].id as string;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [cId, org._id, 'admin']);
  await call('GET', `/accounting/accounts?organization_id=${org._id}`, a);
  await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [{ category: 'Office Supplies', account_code: '6140' }] });
  const add = (f: Record<string, unknown>) => call('POST', '/expenses', a, {
    organization_id: org._id, currency: 'THB', status: 'approved', date: '2026-10-10', category: 'Office Supplies',
    vendor_taxid: '0107537000521', total: 1070, tax_amount: 70, payment_source: 'company', ...f,
  });
  const draft = (await add({ status: 'draft', vendor_name: 'Draft' })).body;
  const adv = (await add({ vendor_name: 'Makro', payment_source: 'advance', paid_by: 'Lek' })).body;
  const close = (month: string, t = a) => call('POST', '/accounting/periods/close', t, { organization_id: org._id, month });

  // Not ready (draft) → refused
  assert.equal((await close('2026-10')).status, 409);
  await call('PUT', `/expenses/${draft._id}`, a, { status: 'disabled' });
  const closed = await close('2026-10', c); // admin may close
  assert.equal(closed.status, 200);
  assert.equal(closed.body.period.status, 'closed');
  assert.equal(closed.body.entries.length, 1);
  assert.equal((await close('2026-10')).status, 409); // already closed

  // Locked: edit, delete, new receipt dated in the month, moving a receipt into it
  assert.equal((await call('PUT', `/expenses/${adv._id}`, a, { total: 2000 })).status, 423);
  assert.equal((await call('DELETE', `/expenses/${adv._id}`, a)).status, 423);
  assert.equal((await add({ vendor_name: 'Late' })).status, 423);
  const nov = (await add({ vendor_name: 'Nov', date: '2026-11-03' })).body;
  assert.equal((await call('PUT', `/expenses/${nov._id}`, a, { date: '2026-10-30' })).status, 423);
  // Re-saving unchanged values (what the form does) is fine
  assert.equal((await call('PUT', `/expenses/${adv._id}`, a, { total: 1070, vendor_name: 'Makro', payment_source: 'advance' })).status, 200);
  // Paying the advance back in an open month is allowed; into a closed month is not
  assert.equal((await call('PUT', `/expenses/${adv._id}`, a, { reimbursed_at: '2026-10-31' })).status, 423);
  assert.equal((await call('PUT', `/expenses/${adv._id}`, a, { reimbursed_at: '2026-11-04' })).status, 200);

  // The closed journal is frozen: mapping changes don't alter it
  await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [{ category: 'Office Supplies', account_code: '6900' }] });
  const frozen = (await call('GET', `/accounting/journal?organization_id=${org._id}&month=2026-10`, a)).body;
  assert.equal(frozen.period.status, 'closed');
  assert.equal(frozen.period.closed_by, 'Test');
  assert.equal(frozen.entries[0].lines[0].account_code, '6140');
  const xlsx = await fetch(`${base}/accounting/journal.xlsx?organization_id=${org._id}&month=2026-10`, { headers: { Authorization: `Bearer ${a}` } });
  assert.equal(xlsx.status, 200);

  // Reopen: owner only, with a reason
  const reopen = (t: string, reason: string) => call('POST', '/accounting/periods/reopen', t, { organization_id: org._id, month: '2026-10', reason });
  assert.equal((await reopen(c, 'fix')).status, 403);
  assert.equal((await reopen(a, '')).status, 400);
  const opened = await reopen(a, 'Supplier sent a corrected invoice');
  assert.equal(opened.status, 200);
  assert.equal(opened.body.period.status, 'open');
  assert.equal(opened.body.entries[0].lines[0].account_code, '6900'); // regenerated with the new mapping
  assert.equal((await call('PUT', `/expenses/${adv._id}`, a, { total: 1177, tax_amount: 77 })).status, 200);
  assert.equal((await reopen(a, 'again')).status, 409);

  const periods = (await call('GET', `/accounting/periods?organization_id=${org._id}`, a)).body;
  assert.equal(periods[0].month, '2026-10');
  assert.equal(periods[0].status, 'open');
  assert.equal(periods[0].reopen_reason, 'Supplier sent a corrected invoice');

  // Audit trail, newest first
  const log = (await call('GET', `/accounting/audit?organization_id=${org._id}&month=2026-10`, a)).body as { action: string; entity: string; detail: any }[];
  const actions = log.map((x) => `${x.action}:${x.entity}`);
  assert.equal(actions[0], 'update:expense');
  assert.ok(actions.includes('reopen:period'));
  assert.ok(actions.includes('close:period'));
  assert.ok(actions.includes('create:expense'));
  assert.deepEqual(log[0].detail.changes.total, { from: 1070, to: 1177 });
  assert.equal(log.find((x) => x.action === 'reopen')!.detail.reason, 'Supplier sent a corrected invoice');
  assert.equal((await call('GET', `/accounting/audit?organization_id=nope`, a)).status, 403);
});

test('accounting phase D: monthly pack per property and for the group, Excel, commentary gate', async () => {
  const a = await login('a@test.com');
  const mk = async (name: string) => {
    const org = (await call('POST', '/organizations', a, { organization_name: name, categories: ['Office Supplies', 'Asset'] })).body;
    await call('GET', `/accounting/accounts?organization_id=${org._id}`, a);
    await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [
      { category: 'Office Supplies', account_code: '6140' }, { category: 'Asset', account_code: '1230' },
    ] });
    return org;
  };
  const p1 = await mk('Pack One');
  const p2 = await mk('Pack Two');
  const add = (org: string, f: Record<string, unknown>) => call('POST', '/expenses', a, {
    organization_id: org, currency: 'THB', status: 'approved', category: 'Office Supplies', vendor_taxid: '0107537000521',
    payment_source: 'company', ...f,
  });
  await add(p1._id, { vendor_name: 'Makro', date: '2026-08-04', total: 2140, tax_amount: 140 });
  await add(p1._id, { vendor_name: 'Makro', date: '2026-09-04', total: 1070, tax_amount: 70 });
  await add(p1._id, { vendor_name: 'IKEA', date: '2026-09-18', category: 'Asset', total: 10700, tax_amount: 700 });
  await add(p2._id, { vendor_name: 'HomePro', date: '2026-09-09', total: 535, tax_amount: 35, payment_source: 'advance', paid_by: 'Lek' });

  const one = await call('GET', `/accounting/mma?organization_id=${p1._id}&month=2026-09`, a);
  assert.equal(one.status, 200);
  assert.equal(one.body.status, 'provisional');
  assert.deepEqual([one.body.summary.opex, one.body.summary.opex_prev, one.body.summary.opex_change_pct], [1000, 2000, -50]);
  assert.equal(one.body.summary.capex, 10000);
  assert.equal(one.body.summary.capex_ytd, 10000);
  assert.equal(one.body.summary.input_vat, 770);
  assert.equal(typeof one.body.commentary_available, 'boolean');

  // Closing makes it final
  await call('POST', '/accounting/periods/close', a, { organization_id: p1._id, month: '2026-09' });
  assert.equal((await call('GET', `/accounting/mma?organization_id=${p1._id}&month=2026-09`, a)).body.status, 'closed');

  // Group: every property the user belongs to (earlier tests' properties included)
  const group = (await call('GET', '/accounting/mma?organization_id=all&month=2026-09', a)).body;
  const mine = group.by_property.filter((x: { id: string }) => [p1._id, p2._id].includes(x.id));
  assert.deepEqual(mine.map((x: { name: string; opex: number; advances_outstanding: number }) => [x.name, x.opex, x.advances_outstanding]),
    [['Pack One', 1000, 0], ['Pack Two', 500, 535]]);
  assert.equal(group.status, 'provisional');

  // Excel
  const res = await fetch(`${base}/accounting/mma.xlsx?organization_id=${p1._id}&month=2026-09`, { headers: { Authorization: `Bearer ${a}` } });
  assert.equal(res.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  assert.deepEqual(book.worksheets.map((w) => w.name), ['Summary', 'Operating costs', 'Capex', 'Advances', 'VAT', 'Cash']);
  assert.equal(book.getWorksheet('Summary')!.getCell('B6').value, 1000);
  const gres = await fetch(`${base}/accounting/mma.xlsx?organization_id=all&month=2026-09`, { headers: { Authorization: `Bearer ${a}` } });
  const gbook = new ExcelJS.Workbook();
  await gbook.xlsx.load(Buffer.from(await gres.arrayBuffer()) as unknown as ArrayBuffer);
  assert.ok(gbook.getWorksheet('By property'));

  // Commentary: needs Claude configured on the server; validation first
  const saved = [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN];
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    assert.equal((await call('POST', '/accounting/mma/commentary', a, { organization_id: p1._id, month: 'x' })).status, 400);
    assert.equal((await call('POST', '/accounting/mma/commentary', a, { organization_id: p1._id, month: '2026-09' })).status, 503);
  } finally {
    if (saved[0] !== undefined) process.env.ANTHROPIC_API_KEY = saved[0];
    if (saved[1] !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved[1];
  }
  assert.equal((await call('GET', `/accounting/mma?organization_id=${p1._id}&month=2026-13`, a)).status, 400);
  const c = await login('c@test.com');
  assert.equal((await call('GET', `/accounting/mma?organization_id=${p1._id}&month=2026-09`, c)).status, 403);
});

test('phase E: revenue lines, CSV import, posting, lock, P&L pack with KPIs, chart upgrade', async () => {
  const a = await login('a@test.com');
  const c = await login('c@test.com');
  const org = (await call('POST', '/organizations', a, { organization_name: 'Revenue Hotel', categories: ['Office Supplies'] })).body;
  const cId = (await db.query('SELECT id FROM users WHERE email = $1', ['c@test.com'])).rows[0].id as string;
  await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [cId, org._id, 'member']);

  // A chart seeded before phase E (no receivable account, untagged 5130) is upgraded on first use
  await call('GET', `/accounting/accounts?organization_id=${org._id}`, a);
  await db.query(`DELETE FROM accounts WHERE organization_id = $1 AND code = '1130'`, [org._id]);
  await db.query(`UPDATE accounts SET role = '' WHERE organization_id = $1 AND code = '5130'`, [org._id]);
  const accts = (await call('GET', `/accounting/accounts?organization_id=${org._id}`, a)).body as { code: string; role: string }[];
  assert.equal(accts.find((x) => x.code === '1130')?.role, 'receivable');
  assert.equal(accts.find((x) => x.code === '5130')?.role, 'commission');

  await call('PUT', '/accounting/mapping', a, { organization_id: org._id, mappings: [{ category: 'Office Supplies', account_code: '6140' }] });
  assert.equal((await call('PUT', `/organizations/${org._id}`, a, { rooms: 'many' })).status, 400);
  assert.equal((await call('PUT', `/organizations/${org._id}`, a, { rooms: 20 })).status, 200);

  // Enter revenue: owner/admin only, validated
  const line = { organization_id: org._id, month: '2026-11', account_code: '4110', channel: 'Agoda', net_amount: 60000, vat_amount: 4200, commission: 9630, room_nights: 40 };
  assert.equal((await call('POST', '/accounting/revenue', c, line)).status, 403);
  assert.equal((await call('POST', '/accounting/revenue', a, { ...line, account_code: '6140' })).status, 400);
  assert.equal((await call('POST', '/accounting/revenue', a, { ...line, commission: 999999 })).status, 400);
  const agoda = await call('POST', '/accounting/revenue', a, line);
  assert.equal(agoda.status, 201);
  assert.equal(agoda.body.date, '2026-11-30');      // a bare month is dated at month end

  // CSV import: all or nothing
  const bad = await call('POST', '/accounting/revenue/import', a, { organization_id: org._id, csv: 'date,account,channel,net,vat,room_nights\n2026-11-15,4110,Walk-in,30000,2100,20\n2026-11-15,9999,X,1,0,' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /Line 3/);
  const csv = 'date,account,channel,description,net,vat,commission,room_nights,received_to\n' +
    '2026-11-15,4110,Walk-in,,"30,000",2100,0,20,bank\n2026-11-20,4190,Laundry,Guest laundry,1000,70,,,receivable';
  const imp = await call('POST', '/accounting/revenue/import', a, { organization_id: org._id, csv });
  assert.equal(imp.status, 201);
  assert.equal(imp.body.imported, 2);
  const list = (await call('GET', `/accounting/revenue?organization_id=${org._id}&month=2026-11`, c)).body;
  assert.equal(list.lines.length, 3);
  assert.equal(list.rooms, 20);

  // A receipt so the month has costs
  await call('POST', '/expenses', a, { organization_id: org._id, currency: 'THB', status: 'approved', date: '2026-11-05', category: 'Office Supplies',
    vendor_taxid: '0107537000521', total: 1070, tax_amount: 70, payment_source: 'company', vendor_name: 'Makro' });

  // Journal: revenue entries first, balanced
  const j = (await call('GET', `/accounting/journal?organization_id=${org._id}&month=2026-11`, a)).body;
  assert.equal(j.ready, true);
  assert.equal(j.totals.balanced, true);
  assert.equal(j.entries.filter((e: { kind: string }) => e.kind === 'revenue').length, 3);
  const tb = Object.fromEntries(j.trial_balance.map((x: { account_code: string; debit: number; credit: number }) => [x.account_code, [x.debit, x.credit]]));
  assert.deepEqual(tb['4110'], [0, 90000]);
  assert.deepEqual(tb['2150'], [0, 6370]);
  assert.deepEqual(tb['5130'], [9630, 0]);
  assert.deepEqual(tb['1130'], [1070, 0]);

  // Pack: P&L with KPIs
  const pack = (await call('GET', `/accounting/mma?organization_id=${org._id}&month=2026-11`, a)).body;
  assert.equal(pack.summary.revenue, 91000);
  assert.equal(pack.summary.opex, 1000 + 9630);
  assert.equal(pack.summary.gop, 80370);
  assert.equal(pack.revenue.occupancy_pct, 10);
  assert.equal(pack.revenue.adr, 1500);
  const res = await fetch(`${base}/accounting/mma.xlsx?organization_id=${org._id}&month=2026-11`, { headers: { Authorization: `Bearer ${a}` } });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  assert.ok(book.getWorksheet('Revenue'));
  assert.equal(book.getWorksheet('Summary')!.getCell('A6').value, 'Revenue');
  assert.equal(book.getWorksheet('Summary')!.getCell('B6').value, 91000);

  // No revenue in a month with costs → a warning, not a blocker
  await call('POST', '/expenses', a, { organization_id: org._id, currency: 'THB', status: 'approved', date: '2026-12-02', category: 'Office Supplies',
    vendor_taxid: '0107537000521', total: 535, tax_amount: 35, payment_source: 'company', vendor_name: 'Makro' });
  const dec = (await call('GET', `/accounting/readiness?organization_id=${org._id}&month=2026-12`, a)).body;
  assert.ok(dec.warnings.some((w: { code: string }) => w.code === 'no_revenue'));

  // Close November: revenue is locked
  assert.equal((await call('POST', '/accounting/periods/close', a, { organization_id: org._id, month: '2026-11' })).status, 200);
  assert.equal((await call('PUT', `/accounting/revenue/${agoda.body._id}`, a, { net_amount: 1 })).status, 423);
  assert.equal((await call('DELETE', `/accounting/revenue/${agoda.body._id}`, a)).status, 423);
  assert.equal((await call('POST', '/accounting/revenue', a, line)).status, 423);
  const log = (await call('GET', `/accounting/audit?organization_id=${org._id}&month=2026-11`, a)).body as { action: string; entity: string }[];
  assert.ok(log.some((x) => x.entity === 'revenue' && x.action === 'import'));
});
