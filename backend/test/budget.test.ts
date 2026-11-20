// Phase E2: budget vs actual in the pack, and budget CSV parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBudget, parseBudgetCsv, sumBudgets, type MonthBudget } from '../src/accounting/budget.js';
import type { Pack } from '../src/accounting/mma.js';

const pack = (over: Partial<Pack> = {}): Pack => ({
  organizations: [{ id: 'o', name: 'Atrium', status: 'closed' }], month: '2026-11', status: 'closed', closed_at: null, closed_by: null,
  checklist: { ready: true, blockers: [], warnings: [] },
  revenue: { total: 91000, prev: 0, ly: 0, change_pct: null, yoy_pct: null, by_account: [{ code: '4110', name: 'Room revenue', amount: 90000, prev: 0, ly: 0 }, { code: '4190', name: 'Other income', amount: 1000, prev: 0, ly: 0 }],
    by_channel: [], commission: 0, room_nights: 0, room_revenue: 0, rooms: null, days: 30, occupancy_pct: null, adr: null, revpar: null },
  summary: { opex: 11165, opex_prev: 0, opex_ly: 0, opex_change_pct: null, opex_yoy_pct: null, capex: 0, capex_ytd: 0, input_vat: 0, pp36_vat: 0,
    vat_not_claimable: 0, advances_opened: 0, advances_repaid: 0, advances_outstanding: 0, cash_out: 0, entries: 1,
    revenue: 91000, gop: 79835, gop_margin_pct: 87.7, gop_prev: null },
  opex: [{ code: '6140', name: 'Office supplies', amount: 1535, prev: 0, ly: 0, change_pct: null, share_pct: 13.7 },
    { code: '5130', name: 'OTA commission', amount: 9630, prev: 0, ly: 0, change_pct: null, share_pct: 86.3 }],
  top_vendors: [], capex: { items: [], ytd: [] }, advances: { outstanding: [] }, vat: { not_claimable: [] }, cash: { weeks: [] },
  ...over,
});
const budget: MonthBudget = new Map([
  ['4110', { amount: 100000, name: 'Room revenue', type: 'revenue' }],
  ['6140', { amount: 1000, name: 'Office supplies', type: 'expense' }],
  ['6120', { amount: 8000, name: 'Electricity', type: 'expense' }],
]);

test('variances: revenue under budget, costs over/under, GOP; budget-only accounts appear', () => {
  const p = applyBudget(pack(), budget);
  assert.deepEqual(p.budget, {
    revenue: 100000, opex: 9000, gop: 91000,
    revenue_var: -9000, opex_var: 2165, gop_var: -11165,
    revenue_var_pct: -9, opex_var_pct: 24.1, gop_var_pct: -12.3,
  });
  const row = (c: string) => p.opex.find((o) => o.code === c)!;
  assert.deepEqual([row('6140').budget, row('6140').variance, row('6140').variance_pct], [1000, 535, 53.5]);
  assert.deepEqual([row('6120').amount, row('6120').budget, row('6120').variance], [0, 8000, -8000]); // budgeted, nothing spent yet
  assert.equal(row('5130').budget, null);     // not budgeted: no variance shown
  assert.deepEqual(p.revenue!.by_account.map((a) => [a.code, a.budget, a.variance]), [['4110', 100000, -10000], ['4190', null, null]]);
});

test('no budget: pack untouched; revenue budget with no revenue entered shows the gap', () => {
  assert.equal(applyBudget(pack(), new Map()).budget, undefined);
  const p = applyBudget(pack({ revenue: null, summary: { ...pack().summary, revenue: null, gop: null, gop_margin_pct: null } }), budget);
  assert.equal(p.revenue!.total, 0);
  assert.equal(p.budget!.revenue_var, -100000);
  assert.equal(p.summary.gop, -11165);
});

test('group budget sums properties by account', () => {
  const g = sumBudgets([budget, new Map([['4110', { amount: 50000, name: 'Room revenue', type: 'revenue' }]])]);
  assert.equal(g.get('4110')!.amount, 150000);
  assert.equal(g.get('6120')!.amount, 8000);
});

test('budget CSV: month names or numbers, thousands separators, blanks skipped, bad numbers reported', () => {
  const a = parseBudgetCsv('account,name,jan,feb,mar\n4110,Room revenue,"1,200,000",1100000,\n6120,Electricity,80000,-,82000');
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.rows, [
    { account: '4110', months: { '01': 1200000, '02': 1100000 } },
    { account: '6120', months: { '01': 80000, '03': 82000 } },
  ]);
  assert.deepEqual(parseBudgetCsv('code,1,12\n6140,500,700').rows, [{ account: '6140', months: { '01': 500, '12': 700 } }]);
  assert.match(parseBudgetCsv('account,jan\n6140,abc').errors[0], /Line 2: 6140 01 is not a number/);
  assert.match(parseBudgetCsv('name,jan\nx,1').errors[0], /account/);
});
