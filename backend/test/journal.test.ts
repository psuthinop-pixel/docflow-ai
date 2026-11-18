// One test per posting rule in docs/ACCOUNTING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ACCOUNTS } from '../src/accounting/coa.js';
import { expenseEntry, reimbursementEntry, trialBalance, PostingError, type PostingContext, type PostingExpense } from '../src/accounting/journal.js';

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
