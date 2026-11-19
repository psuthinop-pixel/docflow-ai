// One test per posting rule in docs/ACCOUNTING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ACCOUNTS } from '../src/accounting/coa.js';
import { expenseEntry, reimbursementEntry, revenueEntry, trialBalance, PostingError, type PostingContext, type PostingExpense, type PostingRevenue } from '../src/accounting/journal.js';

const accounts = new Map(SEED_ACCOUNTS.map((a) => [a.code, { code: a.code, name: a.name, role: a.role ?? '', type: a.type, active: true }]));
const ctx: PostingContext = {
  accounts,
  categoryAccount: new Map([['Office Supplies', '6140'], ['Transport', '6150'], ['Software', '6160'], ['Asset', '1230'], ['Computers', '1250']]),
  bankCode: '1112',
  capexCode: '1230',
  roleCode: (role) => SEED_ACCOUNTS.find((a) => a.role === role)?.code,
};
const base: PostingExpense = {
  id: 'x', date: '2026-11-05', invoice_number: 'INV1', vendor_name: 'Makro', vendor_taxid: '0107537000521', category: 'Office Supplies',
  notes: '', currency: 'THB', total_thb: 1070, tax_amount: 70, supply_type: '', payment_source: 'company', paid_by: '',
  reimbursed_at: null, claimable: true, capex: false,
};
const lines = (e: Partial<PostingExpense>) => expenseEntry({ ...base, ...e }, ctx).lines.map((l) => [l.account_code, l.debit, l.credit]);

test('opex with claimable VAT, company paid: net to expense, VAT to input VAT, bank credited gross', () => {
  assert.deepEqual(lines({}), [['6140', 1000, 0], ['1150', 70, 0], ['1112', 0, 1070]]);
});

test('VAT not claimable (fuel, vat_claim no, no tax ID): gross to expense', () => {
  assert.deepEqual(lines({ category: 'Transport', claimable: false }), [['6150', 1070, 0], ['1112', 0, 1070]]);
});

test('employee advance: credit advances payable, memo names the person', () => {
  const e = expenseEntry({ ...base, payment_source: 'advance', paid_by: 'Lek' }, ctx);
  assert.deepEqual(e.lines.map((l) => [l.account_code, l.debit, l.credit]), [['6140', 1000, 0], ['1150', 70, 0], ['2120', 0, 1070]]);
  assert.equal(e.lines[2].memo, 'Advance: Lek');
});

test('capex: asset account from the category, or the default capex account; VAT still claimable', () => {
  assert.deepEqual(lines({ category: 'Computers', capex: true }), [['1250', 1000, 0], ['1150', 70, 0], ['1112', 0, 1070]]);
  assert.deepEqual(lines({ category: 'Office Supplies', capex: true }), [['1230', 1000, 0], ['1150', 70, 0], ['1112', 0, 1070]]);
});

test('operating expense in an asset category cannot be posted', () => {
  assert.throws(() => expenseEntry({ ...base, category: 'Asset', capex: false }, ctx), PostingError);
  assert.throws(() => expenseEntry({ ...base, category: 'Unmapped' }, ctx), /no account/);
});

test('foreign service (ภ.พ.36): THB cost, 7% input VAT not yet due against PP.36 payable', () => {
  assert.deepEqual(
    lines({ category: 'Software', currency: 'USD', total_thb: 3625, tax_amount: 0, supply_type: 'service', claimable: false }),
    [['6160', 3625, 0], ['1112', 0, 3625], ['1151', 253.75, 0], ['2160', 0, 253.75]],
  );
  // Foreign goods: no reverse charge
  assert.deepEqual(lines({ category: 'Software', currency: 'USD', total_thb: 3625, supply_type: 'goods', claimable: false }), [['6160', 3625, 0], ['1112', 0, 3625]]);
});

test('satang rounding still balances', () => {
  const e = expenseEntry({ ...base, total_thb: 99.99, tax_amount: 6.54 }, ctx);
  assert.deepEqual(e.lines.map((l) => [l.debit, l.credit]), [[93.45, 0], [6.54, 0], [0, 99.99]]);
});

test('reimbursing an advance: Dr advances payable, Cr bank, dated the reimbursement', () => {
  const e = reimbursementEntry({ ...base, payment_source: 'advance', paid_by: 'Lek', reimbursed_at: '2026-12-02' }, ctx);
  assert.equal(e.date, '2026-12-02');
  assert.deepEqual(e.lines.map((l) => [l.account_code, l.debit, l.credit]), [['2120', 1070, 0], ['1112', 0, 1070]]);
});

test('missing or inactive role account is a posting error, not a crash', () => {
  const noVat = { ...ctx, roleCode: (r: string) => (r === 'input_vat' ? undefined : ctx.roleCode(r)) };
  assert.throws(() => expenseEntry(base, noVat), /input VAT/);
});

test('trial balance totals per account and balances', () => {
  const tb = trialBalance([expenseEntry(base, ctx), expenseEntry({ ...base, payment_source: 'advance' }, ctx)]);
  assert.deepEqual(tb.map((x) => [x.account_code, x.debit, x.credit]), [['1112', 0, 1070], ['1150', 140, 0], ['2120', 0, 1070], ['6140', 2000, 0]]);
});

const rev = (f: Partial<PostingRevenue>): PostingRevenue => ({
  id: 'r', date: '2026-11-30', account_code: '4110', channel: 'Agoda', description: '', net_amount: 10000, vat_amount: 700,
  commission: 0, received_to: 'bank', ...f,
});
const rl = (f: Partial<PostingRevenue>) => revenueEntry(rev(f), ctx).lines.map((l) => [l.account_code, l.debit, l.credit]);

test('revenue paid to the bank: Dr bank gross, Cr revenue net, Cr output VAT', () => {
  assert.deepEqual(rl({}), [['1112', 10700, 0], ['4110', 0, 10000], ['2150', 0, 700]]);
});

test('OTA keeps its commission: Dr bank the net payout, Dr commission, revenue still gross of commission', () => {
  assert.deepEqual(rl({ commission: 1605 }), [['1112', 9095, 0], ['5130', 1605, 0], ['4110', 0, 10000], ['2150', 0, 700]]);
});

test('not yet collected: Dr accounts receivable; no-VAT income has no VAT line', () => {
  assert.deepEqual(rl({ received_to: 'receivable' }), [['1130', 10700, 0], ['4110', 0, 10000], ['2150', 0, 700]]);
  assert.deepEqual(rl({ account_code: '4190', vat_amount: 0, channel: 'Bank interest' }), [['1112', 10000, 0], ['4190', 0, 10000]]);
});

test('revenue must post to a revenue account', () => {
  assert.throws(() => revenueEntry(rev({ account_code: '6140' }), ctx), /not an active revenue account/);
});
