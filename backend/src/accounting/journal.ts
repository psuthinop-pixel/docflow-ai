// Bookkeeping, Phase B: expense → balanced journal lines. Pure functions; posting rules in docs/ACCOUNTING.md.
// Which receipts are claimable / capex comes from the SQL definitions in routes/reports.ts (single source of truth).

export const PP36_RATE = 0.07;

/** One expense as the generator needs it (flags already evaluated in SQL). */
export interface PostingExpense {
  id: string;
  date: string;               // YYYY-MM-DD (invoice / tax point)
  invoice_number: string;
  vendor_name: string;
  vendor_taxid: string;
  category: string;
  notes: string;
  currency: string;
  total_thb: number;
  tax_amount: number;         // in the receipt currency
  supply_type: string;        // '', 'service', 'goods' (foreign sellers; 'service' = ภ.พ.36 applies)
  payment_source: string;     // '', 'company', 'advance'
  paid_by: string;
  reimbursed_at: string | null;
  claimable: boolean;         // input VAT claimable this month
  capex: boolean;
}

export interface AccountRef { code: string; name: string; role: string; type: string; active: boolean }

/** Accounts the generator needs for one property. */
export interface PostingContext {
  accounts: Map<string, AccountRef>;        // by code
  categoryAccount: Map<string, string>;     // category → account code
  bankCode: string;
  capexCode: string;
  roleCode: (role: string) => string | undefined; // first active account with that role
}

export interface JournalLine { account_code: string; account_name: string; debit: number; credit: number; memo: string }
export interface JournalEntry {
  kind: 'expense' | 'reimbursement' | 'revenue';
  date: string;
  expense_id: string;
  document_no: string;
  vendor_name: string;
  vendor_taxid: string;
  description: string;
  lines: JournalLine[];
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export class PostingError extends Error {}

function line(ctx: PostingContext, code: string | undefined, what: string, debit: number, credit: number, memo: string): JournalLine {
  const acc = code ? ctx.accounts.get(code) : undefined;
  if (!acc || !acc.active) throw new PostingError(`No active account for ${what}`);
  return { account_code: acc.code, account_name: acc.name, debit: round2(debit), credit: round2(credit), memo };
}

const isAssetRole = (role: string) => role === 'fixed_asset' || role === 'construction';

/** The debit account for the cost itself: an asset for capex, an expense otherwise. */
export function costAccount(e: PostingExpense, ctx: PostingContext): string {
  const mapped = ctx.categoryAccount.get(e.category);
  const acc = mapped ? ctx.accounts.get(mapped) : undefined;
  if (e.capex) return acc && isAssetRole(acc.role) ? acc.code : ctx.capexCode;
  if (!acc) throw new PostingError(`Category "${e.category || '(none)'}" has no account`);
  if (acc.type !== 'expense') throw new PostingError(`"${e.category}" maps to ${acc.code}, which isn't an expense account, but this receipt is an operating expense`);
  return acc.code;
}

/** Journal entry for one confirmed/approved expense. Throws PostingError when it can't be posted. */
export function expenseEntry(e: PostingExpense, ctx: PostingContext): JournalEntry {
  const gross = round2(e.total_thb);
  const memo = [e.vendor_name, e.invoice_number].filter(Boolean).join(' ');
  const cost = costAccount(e, ctx);
  const lines: JournalLine[] = [];

  if (e.currency === 'THB' && e.claimable && e.tax_amount > 0) {
    // Claimable input VAT is split out; the cost is the net amount (gross − VAT keeps it balanced to the satang).
    const vat = round2(e.tax_amount);
    lines.push(line(ctx, cost, 'the cost', gross - vat, 0, memo));
    lines.push(line(ctx, ctx.roleCode('input_vat'), 'input VAT', vat, 0, memo));
  } else {
    // Fuel, vat_claim = 'no', no tax ID, or foreign VAT: the whole amount is the cost.
    lines.push(line(ctx, cost, 'the cost', gross, 0, memo));
  }

  const credit = e.payment_source === 'advance'
    ? line(ctx, ctx.roleCode('advances_payable'), 'advances payable', 0, gross, e.paid_by ? `Advance: ${e.paid_by}` : 'Advance: unknown')
    : line(ctx, ctx.bankCode, 'the bank account', 0, gross, memo);
  lines.push(credit);

  if (e.supply_type === 'service') {
    // ภ.พ.36 reverse charge (any currency: a foreign seller may bill in THB): VAT payable on the THB amount, claimable as input VAT from the following month.
    const pp36 = round2(gross * PP36_RATE);
    lines.push(line(ctx, ctx.roleCode('input_vat_pending'), 'input VAT not yet due', pp36, 0, `ภ.พ.36 ${memo}`));
    lines.push(line(ctx, ctx.roleCode('pp36_payable'), 'ภ.พ.36 VAT payable', 0, pp36, `ภ.พ.36 ${memo}`));
  }

  return {
    kind: 'expense', date: e.date, expense_id: e.id, document_no: e.invoice_number,
    vendor_name: e.vendor_name, vendor_taxid: e.vendor_taxid,
    description: [e.category, e.notes].filter(Boolean).join(' · '), lines: assertBalanced(lines),
  };
}

/** Paying an advance back: clears the liability against the bank, dated the reimbursement day. */
export function reimbursementEntry(e: PostingExpense, ctx: PostingContext): JournalEntry {
  const gross = round2(e.total_thb);
  const who = e.paid_by || 'unknown';
  return {
    kind: 'reimbursement', date: e.reimbursed_at!, expense_id: e.id, document_no: e.invoice_number,
    vendor_name: e.vendor_name, vendor_taxid: e.vendor_taxid, description: `Reimburse advance: ${who}`,
    lines: assertBalanced([
      line(ctx, ctx.roleCode('advances_payable'), 'advances payable', gross, 0, `Advance: ${who}`),
      line(ctx, ctx.bankCode, 'the bank account', 0, gross, `Reimburse ${who}`),
    ]),
  };
}

/** One revenue line as entered (from the PMS night audit / OTA statement). */
export interface PostingRevenue {
  id: string;
  date: string;
  account_code: string;
  channel: string;
  description: string;
  net_amount: number;
  vat_amount: number;
  commission: number;
  received_to: 'bank' | 'receivable';
}

/**
 * Revenue: Cr revenue (net) + Cr output VAT; Dr bank or receivable for what is collected, Dr commission for what
 * the OTA keeps. Gross = net + VAT = cash/receivable + commission.
 */
export function revenueEntry(r: PostingRevenue, ctx: PostingContext): JournalEntry {
  const acc = ctx.accounts.get(r.account_code);
  if (!acc || !acc.active || acc.type !== 'revenue') throw new PostingError(`Account ${r.account_code} is not an active revenue account`);
  const net = round2(r.net_amount);
  const vat = round2(r.vat_amount);
  const commission = round2(r.commission);
  const gross = round2(net + vat);
  const memo = [r.channel, r.description].filter(Boolean).join(' · ');
  const lines: JournalLine[] = [];
  const debit = r.received_to === 'receivable' ? ctx.roleCode('receivable') : ctx.bankCode;
  lines.push(line(ctx, debit, r.received_to === 'receivable' ? 'accounts receivable' : 'the bank account', gross - commission, 0, memo));
  if (commission) lines.push(line(ctx, ctx.roleCode('commission'), 'OTA commission', commission, 0, memo));
  lines.push(line(ctx, acc.code, 'revenue', 0, net, memo));
  if (vat) lines.push(line(ctx, ctx.roleCode('output_vat'), 'output VAT', 0, vat, memo));
  return {
    kind: 'revenue', date: r.date, expense_id: r.id, document_no: '', vendor_name: r.channel, vendor_taxid: '',
    description: memo || acc.name, lines: assertBalanced(lines),
  };
}

export function assertBalanced(lines: JournalLine[]): JournalLine[] {
  const d = round2(lines.reduce((t, l) => t + l.debit, 0));
  const c = round2(lines.reduce((t, l) => t + l.credit, 0));
  if (d !== c) throw new PostingError(`Entry does not balance (debit ${d}, credit ${c})`);
  return lines.filter((l) => l.debit !== 0 || l.credit !== 0);
}

/** Debit/credit totals per account across entries (the month's trial balance movement). */
export function trialBalance(entries: JournalEntry[]) {
  const by = new Map<string, { account_code: string; account_name: string; debit: number; credit: number }>();
  for (const l of entries.flatMap((x) => x.lines)) {
    const row = by.get(l.account_code) ?? { account_code: l.account_code, account_name: l.account_name, debit: 0, credit: 0 };
    row.debit = round2(row.debit + l.debit);
    row.credit = round2(row.credit + l.credit);
    by.set(l.account_code, row);
  }
  return [...by.values()].sort((a, b) => a.account_code.localeCompare(b.account_code));
}
