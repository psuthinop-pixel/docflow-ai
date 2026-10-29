import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { openDb, newId, now } from '../src/db.js';
import { createApp } from '../src/app.js';
import { shutdownOcr } from '../src/extract/ocr.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const uploadDir = mkdtempSync(path.join(tmpdir(), 'docflow-test-'));
let server: Server;
let base = '';
let db: ReturnType<typeof openDb>;

before(async () => {
  db = openDb(':memory:');
  for (const email of ['owner@test.com', 'member@test.com']) {
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      newId(), email, 'T', bcrypt.hashSync('pw123456', 4), now(),
    );
  }
  server = createApp(db, [], { uploadDir, maxUploadMb: 5, ocrEngine: 'tesseract' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await shutdownOcr();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function call(method: string, p: string, token: string, body?: unknown) {
  const res = await fetch(base + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer() };
}
const login = async (email: string) =>
  (await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw123456' }) })).json()).auth as string;

function form(orgId: string, file: string, mime: string) {
  const fd = new FormData();
  fd.append('organization_id', orgId);
  fd.append('file', new Blob([readFileSync(path.join(fixtures, file))], { type: mime }), file);
  return fd;
}

test('upload → extract → save → duplicate → approve', { timeout: 120_000 }, async () => {
  const owner = await login('owner@test.com');
  const member = await login('member@test.com');
  const org = (await call('POST', '/organizations', owner, { organization_name: 'Atrium' })).body;
  const memberId = (db.prepare("SELECT id FROM users WHERE email = 'member@test.com'").get() as { id: string }).id;
  db.prepare('INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?)').run(memberId, org._id, 'member');

  const up = await call('POST', '/receipts', member, form(org._id, 'thai-tax-invoice.png', 'image/png'));
  assert.equal(up.status, 201);
  assert.equal(up.body.fields.vendor_taxid, '0105556012341');
  assert.equal(up.body.fields.total, 2140);
  assert.equal(up.body.fields.date, '2025-10-15');
  assert.deepEqual(up.body.duplicates, []);
  assert.equal(up.body.receipt.storage_path, undefined); // not exposed

  const file = await call('GET', `/receipts/${up.body.receipt._id}/file`, member);
  assert.equal(file.status, 200);
  assert.equal((file.body as ArrayBuffer).byteLength, readFileSync(path.join(fixtures, 'thai-tax-invoice.png')).length);

  const f = up.body.fields;
  const expense = { organization_id: org._id, receipt_id: up.body.receipt._id, status: 'confirmed', ...f, date: f.date };
  delete expense.is_tax_invoice;
  const saved = await call('POST', '/expenses', member, expense);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.invoice_number, 'INV6810-0045');

  // Same file again → flagged on upload and blocked on save unless overridden.
  const again = await call('POST', '/receipts', member, form(org._id, 'thai-tax-invoice.png', 'image/png'));
  assert.equal(again.body.duplicates.length, 1);
  const dup = await call('POST', '/expenses', member, { ...expense, receipt_id: again.body.receipt._id });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.duplicates[0].id, saved.body._id);
  assert.equal((await call('POST', '/expenses', member, { ...expense, receipt_id: again.body.receipt._id, allow_duplicate: true })).status, 201);

  // Approval workflow: members cannot approve; owners can; approved is then locked for members.
  assert.equal((await call('PUT', `/expenses/${saved.body._id}`, member, { status: 'approved' })).status, 403);
  const approved = await call('PUT', `/expenses/${saved.body._id}`, owner, { status: 'approved' });
  assert.equal(approved.body.status, 'approved');
  assert.ok(approved.body.approved_at);
  assert.equal((await call('PUT', `/expenses/${saved.body._id}`, member, { notes: 'x' })).status, 403);
  assert.equal((await call('DELETE', `/expenses/${saved.body._id}`, member)).status, 403);
});

test('real toll receipt: extraction, then vendor learned from a confirmed expense', { timeout: 120_000 }, async () => {
  const owner = await login('owner@test.com');
  const org = (await call('POST', '/organizations', owner, { organization_name: 'Tolls', categories: ['Transport'] })).body;
  const first = await call('POST', '/receipts', owner, form(org._id, 'real-exat-toll.jpg', 'image/jpeg'));
  assert.equal(first.body.fields.vendor_taxid, '0994000165421');
  assert.equal(first.body.fields.total, 60);
  await call('POST', '/expenses', owner, {
    organization_id: org._id, receipt_id: first.body.receipt._id, status: 'confirmed',
    vendor_name: 'การทางพิเศษแห่งประเทศไทย', vendor_taxid: '0994000165421', category: 'Transport',
    invoice_number: first.body.fields.invoice_number, total: 60,
  });
  const fd = new FormData();
  fd.append('organization_id', org._id);
  // Different bytes (not a file-hash duplicate) but the same seller.
  fd.append('file', new Blob([readFileSync(path.join(fixtures, 'real-exat-toll.jpg')), new Uint8Array([0])], { type: 'image/jpeg' }), 'toll2.jpg');
  const second = await call('POST', '/receipts', owner, fd);
  assert.equal(second.body.fields.vendor_name, 'การทางพิเศษแห่งประเทศไทย');
  assert.equal(second.body.fields.category, 'Transport');
});

test('rejects unsupported types and foreign receipts', async () => {
  const owner = await login('owner@test.com');
  const org = (await call('POST', '/organizations', owner, { organization_name: 'Other' })).body;
  const fd = new FormData();
  fd.append('organization_id', org._id);
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await call('POST', '/receipts', owner, fd)).status, 400);
  assert.equal((await call('POST', '/expenses', owner, { organization_id: org._id, receipt_id: 'nope', total: 1 })).status, 400);
});

test('field accuracy on fixtures ≥ 90%', { timeout: 300_000 }, async () => {
  const { measure } = await import('./accuracy.js');
  const r = await measure('tesseract');
  assert.ok(r.accuracy >= 0.9, `accuracy ${r.accuracy}: ${r.misses.join('; ')}`);
});
