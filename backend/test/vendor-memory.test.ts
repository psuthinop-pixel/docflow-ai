// Claude accuracy phase 2: vendor memory, through the real upload route with a fake Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { migrate, newId, now, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { setClaudeCaller, type ClaudeFields } from '../src/extract/claude.js';
import { applyMemory } from '../src/extract/memory.js';

const TAX = '0107537000521';
let server: Server;
let base = '';
let db: Db;
let token = '';
let orgId = '';
let reading: ClaudeFields;

const fresh = (f: Partial<ClaudeFields> = {}): ClaudeFields => ({
  vendor_name: 'SIAM REPRAP CO LTD', vendor_taxid: TAX, vendor_branch: '', vendor_address: '', buyer_name: 'Serve Property',
  invoice_number: `INV${Math.random().toString().slice(2, 8)}`, date: new Date().toISOString().slice(0, 10), subtotal: 1000, tax_amount: 70,
  total: 1070, wht_amount: null, currency: 'THB', is_tax_invoice: true, tax_invoice_type: 'full', payment_method: 'unknown',
  card_last4: '', supply_type: '', is_capex: false, category: 'Office Supplies', uncertain_fields: [], raw_text: '', ...f,
});

before(async () => {
  db = new PGlite();
  await migrate(db);
  await db.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
    [newId(), 'kenn@test.com', 'Kenn', bcrypt.hashSync('pw123456', 4), now()]);
  server = createApp(db, [], { maxUploadMb: 5, ocrEngine: 'claude' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kenn@test.com', password: 'pw123456' }) })).json()).auth;
  orgId = (await call('POST', '/organizations', { organization_name: 'Serve Property', categories: ['Office Supplies', 'Repairs', 'Transport', 'Software'] })).body._id;
  setClaudeCaller(async () => reading);
});
after(() => { setClaudeCaller(); server.close(); });

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
async function upload(f: Partial<ClaudeFields> = {}) {
  reading = fresh(f);
  const form = new FormData();
  form.append('organization_id', orgId);
  form.append('file', new Blob([Buffer.from(`png-${Math.random()}`)], { type: 'image/png' }), 'r.png');
  const res = await call('POST', '/receipts', form);
  assert.equal(res.status, 201);
  return res.body as { fields: Record<string, unknown>; warnings: string[] };
}
const save = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  call('POST', '/expenses', { organization_id: orgId, ...fields, status: 'confirmed', allow_duplicate: true, ...extra });

test('first receipt from a seller: nothing remembered', async () => {
  const r = await upload();
  assert.equal(r.fields.category, 'Office Supplies');
  assert.ok(!r.warnings.some((w) => /earlier receipt/.test(w)));
});

test('confirmed corrections are remembered for the next receipt from the same tax ID', async () => {
  // Person corrects the first one: proper name, branch, category, paid by advance
  await save({ ...fresh(), vendor_name: 'บริษัท สยามเรปแรป จำกัด', vendor_branch: '00000', category: 'Repairs', payment_source: 'advance', paid_by: 'Lek' });
  const r = await upload();
  assert.equal(r.fields.vendor_name, 'บริษัท สยามเรปแรป จำกัด');
  assert.equal(r.fields.vendor_branch, '00000');
  assert.equal(r.fields.category, 'Repairs');
  assert.equal(r.fields.payment_source, 'advance');
  assert.match(r.warnings[0], /^Filled from 1 earlier receipt from this vendor: name, branch, category, Paid from\.$/);
});

test('printed branch beats memory; drafts are not learned from', async () => {
  const r = await upload({ vendor_branch: '00012' });
  assert.equal(r.fields.vendor_branch, '00012');
  await save({ ...fresh(), category: 'Transport' }, { status: 'draft' });
  assert.equal((await upload()).fields.category, 'Repairs');
});

test('inconsistent history is not used; a consistent majority is', async () => {
  // Now 1 Repairs + 1 Transport confirmed: 50% < 60%, so Claude's own category stays
  await save({ ...fresh(), category: 'Transport', payment_source: 'company' });
  let r = await upload();
  assert.equal(r.fields.category, 'Office Supplies');
  // Two more Transport: 3 of 4 agree
  await save({ ...fresh(), category: 'Transport', payment_source: 'company' });
  await save({ ...fresh(), category: 'Transport', payment_source: 'company' });
  r = await upload();
  assert.equal(r.fields.category, 'Transport');
  assert.equal(r.fields.payment_source, 'company');
});

test('legal VAT rule and Claude asset call beat memory', async () => {
  for (let i = 0; i < 2; i++) await save({ ...fresh({ vendor_taxid: '0105536092641', vendor_name: 'PTT' }), category: 'Transport', vat_claim: 'yes', capex: 'no' });
  const r = await upload({ vendor_taxid: '0105536092641', vendor_name: 'PTT', tax_invoice_type: 'abbreviated', is_capex: true, category: 'Transport' });
  assert.equal(r.fields.vat_claim, 'no');   // abbreviated tax invoice: never claimable, whatever was used before
  assert.equal(r.fields.capex, 'yes');
});

test('sellers without a tax ID are matched by name (foreign suppliers)', async () => {
  await save({ ...fresh({ vendor_taxid: '', vendor_branch: '', vendor_name: 'Figma', currency: 'USD', total: 100, tax_amount: 0, subtotal: null }), category: 'Software', supply_type: 'service' });
  const r = await upload({ vendor_taxid: '', vendor_name: ' figma ', currency: 'USD', total: 100, tax_amount: 0, subtotal: null, supply_type: '', category: '' });
  assert.equal(r.fields.category, 'Software');
  assert.equal(r.fields.supply_type, 'service');
  assert.equal(r.fields.vendor_name, 'Figma');
});

test('applyMemory: a category outside the property list is ignored; unchanged values are not reported', () => {
  const fields: Record<string, unknown> = { vendor_name: 'A', category: 'Repairs', payment_source: 'company' };
  const used = applyMemory(fields, { receipts: 3, values: { vendor_name: 'A', category: 'Old Category', payment_source: 'company' } }, ['Repairs']);
  assert.deepEqual(used, []);
  assert.equal(fields.category, 'Repairs');
});
