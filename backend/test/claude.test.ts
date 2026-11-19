// Claude accuracy phase 1: checks, the second look, and suggestions, with a fake Claude (no API calls).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setClaudeCaller, type ClaudeFields, type ClaudeRequest } from '../src/extract/claude.js';
import { claudeProblems, extractReceipt } from '../src/extract/index.js';

const TAX = '0107537000521';
const good: ClaudeFields = {
  vendor_name: 'บริษัท สยามเรปแรป จำกัด', vendor_taxid: TAX, vendor_branch: '00000', vendor_address: 'Bangkok',
  buyer_name: 'Serve Property Co., Ltd.', invoice_number: 'INV2026080670', date: '2026-08-28',
  subtotal: 1000, tax_amount: 70, total: 1070, wht_amount: null, currency: 'THB', is_tax_invoice: true,
  tax_invoice_type: 'full', payment_method: 'unknown', card_last4: '', supply_type: '', is_capex: false,
  category: 'Repairs', uncertain_fields: [], raw_text: 'ใบกำกับภาษี',
};
const today = new Date('2026-09-10');

afterEach(() => setClaudeCaller());

async function run(responses: Partial<ClaudeFields>[], orgName = 'Serve Property') {
  const calls: ClaudeRequest[] = [];
  setClaudeCaller(async (req) => {
    calls.push(req);
    return { ...good, ...responses[Math.min(calls.length - 1, responses.length - 1)] };
  });
  const r = await extractReceipt(Buffer.from('x'), 'image/png', ['Repairs', 'Asset'], 'claude', orgName);
  return { r, calls };
}

test('checks: a clean reading has no problems', () => {
  assert.deepEqual(claudeProblems(good, 'Serve Property', today), []);
});

test('checks: arithmetic, VAT rate, checksum, date range, buyer as vendor, unclear fields', () => {
  const p = (f: Partial<ClaudeFields>) => claudeProblems({ ...good, ...f }, 'Serve Property', today);
  assert.match(p({ total: 1170 })[0], /does not equal total/);
  assert.match(p({ subtotal: 1000, tax_amount: 90, total: 1090 })[0], /not 7% of subtotal/);
  assert.match(p({ vendor_taxid: '0107537000522' })[0], /checksum/);
  assert.match(p({ date: '2569-08-28' })[0], /Buddhist Era/);       // BE year not converted
  assert.match(p({ date: null })[0], /date not found/);
  assert.match(p({ vendor_name: 'Serve Property Co., Ltd.' })[0], /looks like the buyer/);
  assert.match(p({ uncertain_fields: ['total'] })[0], /unclear: total/);
});

test('clean reading: one call at medium effort, buyer name passed, fields kept', async () => {
  const { r, calls } = await run([{}]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].effort, 'medium');
  assert.equal(calls[0].orgName, 'Serve Property');
  assert.equal(r.engine, 'claude');
  assert.equal(r.fields.total, 1070);
  assert.equal(r.fields.category, 'Repairs');
  assert.equal(r.fields.vat_claim, undefined);
  assert.deepEqual(r.warnings, []);
});

test('problems trigger one second look at high effort with the problems as feedback', async () => {
  const { r, calls } = await run([{ date: '2569-08-28' }, {}]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].effort, 'high');
  assert.match(calls[1].feedback!.join(), /Buddhist Era/);
  assert.equal(r.fields.date, '2026-08-28');          // the corrected reading wins
  assert.ok(!r.warnings.some((w) => /Claude flagged/.test(w)));
});

test('if the second look is worse, the first reading is kept and still flagged', async () => {
  const { r, calls } = await run([{ uncertain_fields: ['date'] }, { total: 9999, uncertain_fields: ['date'] }]);
  assert.equal(calls.length, 2);
  assert.equal(r.fields.total, 1070);
  assert.ok(r.warnings.some((w) => /Claude flagged after a second look: unclear: date/.test(w)));
});

test('suggestions: abbreviated tax invoice, asset purchase, foreign service, WHT, payment method', async () => {
  let { r } = await run([{ tax_invoice_type: 'abbreviated' }]);
  assert.equal(r.fields.vat_claim, 'no');
  assert.ok(r.warnings.some((w) => /อย่างย่อ/.test(w)));

  ({ r } = await run([{ is_capex: true, category: 'Repairs' }]));
  assert.equal(r.fields.capex, 'yes');
  ({ r } = await run([{ is_capex: true, category: 'Asset' }]));
  assert.equal(r.fields.capex, undefined);           // the Asset category already makes it capex

  ({ r } = await run([{ currency: 'USD', vendor_taxid: '', vendor_branch: '', subtotal: null, tax_amount: 0, total: 100, supply_type: 'service', tax_invoice_type: 'other' }]));
  assert.equal(r.fields.supply_type, 'service');
  assert.equal(r.fields.currency, 'USD');

  ({ r } = await run([{ wht_amount: 30, payment_method: 'card', card_last4: '4242' }]));
  assert.ok(r.warnings.some((w) => /Withholding tax of 30\.00/.test(w)));
  assert.ok(r.warnings.some((w) => /card ending 4242/.test(w)));
});

test('a category Claude made up is dropped; a bad tax ID falls back to the transcription', async () => {
  const { r } = await run([{ category: 'Hotel Stuff', vendor_taxid: '0107537000522', raw_text: `เลขประจำตัวผู้เสียภาษี ${TAX}` }, { category: 'Hotel Stuff', vendor_taxid: '0107537000522', raw_text: `เลขประจำตัวผู้เสียภาษี ${TAX}` }]);
  assert.equal(r.fields.category, '');
  assert.equal(r.fields.vendor_taxid, TAX);
});
