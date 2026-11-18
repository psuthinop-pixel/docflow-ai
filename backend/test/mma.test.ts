// Monthly pack maths and the commentary number guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ACCOUNTS } from '../src/accounting/coa.js';
import { expenseEntry, reimbursementEntry, type PostingContext, type PostingExpense } from '../src/accounting/journal.js';
import { buildPack, consolidate, type PackInput } from '../src/accounting/mma.js';
import { allowedNumbers, enforce, unsupportedNumbers } from '../src/accounting/commentary.js';

const accounts = new Map(SEED_ACCOUNTS.map((a) => [a.code, { code: a.code, name: a.name, role: a.role ?? '', type: a.type, active: true }]));
const ctx: PostingContext = {
  accounts, categoryAccount: new Map([['Office Supplies', '6140'], ['Transport', '6150'], ['Asset', '1230']]),
  bankCode: '1112', capexCode: '1230', roleCode: (role) => SEED_ACCOUNTS.find((a) => a.role === role)?.code,
};
const e = (f: Partial<PostingExpense>): PostingExpense => ({
  id: 'x', date: '2026-11-05', invoice_number: '', vendor_name: 'Makro', vendor_taxid: '', category: 'Office Supplies', notes: '',
  currency: 'THB', total_thb: 1070, tax_amount: 70, supply_type: '', payment_source: 'company', paid_by: '', reimbursed_at: null,
  claimable: true, capex: false, ...f,
});

const input = (over: Partial<PackInput> = {}): PackInput => ({
  organization: { id: 'o1', name: 'Serve Property' },
  month: '2026-11',
  period: { status: 'closed', closed_at: '2026-12-03', closed_by: 'Kenn' },
  ready: true, blockers: [], warnings: [],
  entries: [
    expenseEntry(e({}), ctx),                                                                    // opex 1000 + VAT 70, bank wk1
    expenseEntry(e({ date: '2026-11-10', vendor_name: 'PTT', category: 'Transport', total_thb: 535, claimable: false, payment_source: 'advance', paid_by: 'Lek' }), ctx),
    expenseEntry(e({ date: '2026-11-20', vendor_name: 'IKEA', category: 'Asset', total_thb: 10700, tax_amount: 700, capex: true }), ctx),
    reimbursementEntry(e({ date: '2026-10-02', payment_source: 'advance', paid_by: 'Noi', total_thb: 300, reimbursed_at: '2026-11-25' }), ctx),
  ],
  prevEntries: [expenseEntry(e({ total_thb: 2140, tax_amount: 140 }), ctx)],                    // Oct opex 2000
  lyEntries: [],
  accounts,
  advancesOutstanding: [{ paid_by: 'Lek', count: 1, total: 535, oldest_month: '2026-11' }],
  vatNotClaimable: [{ reason: 'fuel', count: 1, vat: 35 }],
  capexYtd: [{ category: 'Asset', amount: 10000 }],
  ...over,
});

test('pack summary: opex from expense accounts only, capex, VAT, advances, cash by week', () => {
  const p = buildPack(input());
  assert.equal(p.status, 'closed');
  assert.equal(p.revenue, null);
  assert.deepEqual(
    { opex: p.summary.opex, prev: p.summary.opex_prev, chg: p.summary.opex_change_pct, yoy: p.summary.opex_yoy_pct },
    { opex: 1535, prev: 2000, chg: -23.3, yoy: null },
  );
  assert.equal(p.summary.capex, 10000);
  assert.equal(p.summary.input_vat, 770);       // 70 + 700; fuel VAT stays in cost
  assert.equal(p.summary.advances_opened, 535);
  assert.equal(p.summary.advances_repaid, 300);
  assert.equal(p.summary.advances_outstanding, 535);
  assert.equal(p.summary.cash_out, 1070 + 10700 + 300); // the advance itself isn't company cash
  assert.deepEqual(p.cash.weeks.map((w) => [w.week, w.opex, w.capex, w.reimbursements]), [
    ['1-7', 1070, 0, 0], ['8-14', 0, 0, 0], ['15-21', 0, 10700, 0], ['22-end', 0, 0, 300],
  ]);
  assert.deepEqual(p.opex.map((o) => [o.code, o.amount, o.prev, o.change_pct]), [['6140', 1000, 2000, -50], ['6150', 535, 0, null]]);
  assert.deepEqual(p.capex.items.map((x) => [x.vendor, x.code, x.amount]), [['IKEA', '1230', 10000]]);
  assert.deepEqual(p.top_vendors.map((v) => [v.vendor, v.amount]), [['IKEA', 10000], ['Makro', 1000], ['PTT', 535]]);
});

test('open month is provisional and carries the close checklist', () => {
  const p = buildPack(input({ period: { status: 'open', closed_at: null, closed_by: null }, ready: false,
    blockers: [{ code: 'drafts', message: 'Drafts', count: 2 }] }));
  assert.equal(p.status, 'provisional');
  assert.equal(p.checklist.blockers[0].count, 2);
});

test('consolidated pack sums properties and keeps each one', () => {
  const a = buildPack(input());
  const b = buildPack(input({ organization: { id: 'o2', name: 'Atrium' }, period: { status: 'open', closed_at: null, closed_by: null } }));
  const g = consolidate([a, b], '2026-11');
  assert.equal(g.status, 'provisional');            // one property still open
  assert.equal(g.summary.opex, 3070);
  assert.equal(g.summary.opex_change_pct, -23.3);
  assert.deepEqual(g.opex.map((o) => [o.code, o.amount]), [['6140', 2000], ['6150', 1070]]);
  assert.deepEqual(g.by_property!.map((x) => [x.name, x.opex, x.status]), [['Serve Property', 1535, 'closed'], ['Atrium', 1535, 'provisional']]);
  assert.deepEqual(g.capex.items.map((x) => x.property), ['Serve Property', 'Atrium']);
  assert.deepEqual(g.vat.not_claimable, [{ reason: 'fuel', count: 2, vat: 70 }]);
});

test('commentary guard: figures from the pack pass, invented figures are dropped', () => {
  const p = buildPack(input());
  const allowed = allowedNumbers(p);
  assert.deepEqual(unsupportedNumbers('Operating costs fell 23.3% to ฿1,535 (from ฿2,000); capex ฿10,000.', allowed), []);
  assert.deepEqual(unsupportedNumbers('Costs rose to ฿9,999 and 3 receipts are pending.', allowed), ['9,999']);
  assert.deepEqual(unsupportedNumbers('Lek is owed ฿535.00, week 22-end.', allowed), []);
  const { commentary, removed } = enforce({
    headline: 'November closed with operating costs of ฿1,535.',
    highlights: ['Capex of ฿10,000 for FF&E.', 'Savings of ฿465 vs October.'], // 465 isn't in the data
    risks: [], actions: ['Repay Lek ฿535.'],
  }, allowed);
  assert.equal(commentary.headline, 'November closed with operating costs of ฿1,535.');
  assert.deepEqual(commentary.highlights, ['Capex of ฿10,000 for FF&E.']);
  assert.deepEqual(removed, ['Savings of ฿465 vs October.']);
});
