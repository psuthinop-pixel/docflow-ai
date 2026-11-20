// Phase E2: budgets. Monthly amounts per revenue/expense account; the pack shows actual vs budget.
// Applied after the pack is built (and after consolidation for the group), so pack maths stays untouched.
import type { Pack } from './mma.js';
import { round2 } from './journal.js';

export interface BudgetAccount { code: string; name: string; type: 'revenue' | 'expense' }
/** Budget for one month: account code → amount (positive for revenue and for costs). */
export type MonthBudget = Map<string, { amount: number; name: string; type: 'revenue' | 'expense' }>;

const round1 = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * 10 + Number.EPSILON)) / 10;
const varPct = (actual: number, budget: number) => (budget ? round1(((actual - budget) / Math.abs(budget)) * 100) : null);

export interface BudgetSummary {
  revenue: number; opex: number; gop: number;
  /** actual − budget; for costs a positive variance is unfavourable */
  revenue_var: number | null; opex_var: number | null; gop_var: number | null;
  revenue_var_pct: number | null; opex_var_pct: number | null; gop_var_pct: number | null;
}

/** Adds budget and variance to the pack's opex rows, revenue rows and summary. Mutates and returns the pack. */
export function applyBudget(pack: Pack, budget: MonthBudget): Pack {
  if (!budget.size) return pack;
  const expense = [...budget.entries()].filter(([, b]) => b.type === 'expense');
  const income = [...budget.entries()].filter(([, b]) => b.type === 'revenue');

  for (const [code, b] of expense) {
    if (!pack.opex.some((o) => o.code === code)) {
      pack.opex.push({ code, name: b.name, amount: 0, prev: 0, ly: 0, change_pct: null, share_pct: 0 });
    }
  }
  for (const o of pack.opex as (Pack['opex'][number] & { budget?: number | null; variance?: number | null; variance_pct?: number | null })[]) {
    const b = budget.get(o.code);
    o.budget = b ? b.amount : null;
    o.variance = b ? round2(o.amount - b.amount) : null;
    o.variance_pct = b ? varPct(o.amount, b.amount) : null;
  }

  if (income.length && !pack.revenue) {
    // Budgeted revenue but none entered yet: show the gap rather than hide it
    pack.revenue = {
      total: 0, prev: 0, ly: 0, change_pct: null, yoy_pct: null, by_account: [], by_channel: [], commission: 0,
      room_nights: 0, room_revenue: 0, rooms: null, days: 0, occupancy_pct: null, adr: null, revpar: null,
    };
  }
  if (pack.revenue) {
    for (const [code, b] of income) {
      if (!pack.revenue.by_account.some((a) => a.code === code)) pack.revenue.by_account.push({ code, name: b.name, amount: 0, prev: 0, ly: 0 });
    }
    for (const a of pack.revenue.by_account as (Pack['opex'][number] & { budget?: number | null; variance?: number | null })[]) {
      const b = budget.get(a.code);
      a.budget = b ? b.amount : null;
      a.variance = b ? round2(a.amount - b.amount) : null;
    }
  }

  const sum = (list: [string, { amount: number }][]) => round2(list.reduce((t, [, b]) => t + b.amount, 0));
  const revenueBudget = sum(income);
  const opexBudget = sum(expense);
  const gopBudget = round2(revenueBudget - opexBudget);
  const actualRevenue = pack.revenue?.total ?? 0;
  const actualGop = round2(actualRevenue - pack.summary.opex);
  pack.budget = {
    revenue: revenueBudget, opex: opexBudget, gop: gopBudget,
    revenue_var: income.length ? round2(actualRevenue - revenueBudget) : null,
    opex_var: expense.length ? round2(pack.summary.opex - opexBudget) : null,
    gop_var: income.length ? round2(actualGop - gopBudget) : null,
    revenue_var_pct: income.length ? varPct(actualRevenue, revenueBudget) : null,
    opex_var_pct: expense.length ? varPct(pack.summary.opex, opexBudget) : null,
    gop_var_pct: income.length ? varPct(actualGop, gopBudget) : null,
  };
  if (income.length && pack.summary.revenue === null) {
    Object.assign(pack.summary, { revenue: actualRevenue, gop: actualGop, gop_margin_pct: null, gop_prev: null });
  }
  return pack;
}

/** Sum several properties' month budgets (group view). Accounts are matched by code. */
export function sumBudgets(budgets: MonthBudget[]): MonthBudget {
  const out: MonthBudget = new Map();
  for (const b of budgets) {
    for (const [code, x] of b) {
      const row = out.get(code) ?? { ...x, amount: 0 };
      row.amount = round2(row.amount + x.amount);
      out.set(code, row);
    }
  }
  return out;
}

/**
 * Budget CSV for a year: header `account,jan,...,dec` (or `account,1,...,12` / `01..12`); extra columns (name) ignored.
 * Returns rows of { account, months: { '01': amount, ... } } or an error per line.
 */
export function parseBudgetCsv(csv: string): { rows: { account: string; months: Record<string, number> }[]; errors: string[] } {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => {
    const cells: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { cells.push(cur.trim()); cur = ''; } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  if (!lines.length) return { rows: [], errors: ['Paste the budget with a header row'] };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const accountCol = head.findIndex((h) => /^(account|code|account_code)$/.test(h));
  if (accountCol < 0) return { rows: [], errors: ['The header needs an "account" column'] };
  const monthCol = new Map<number, string>();
  head.forEach((h, i) => {
    const m = MONTHS.indexOf(h.slice(0, 3));
    const n = /^\d{1,2}$/.test(h) ? Number(h) : m + 1;
    if (n >= 1 && n <= 12 && (m >= 0 || /^\d{1,2}$/.test(h))) monthCol.set(i, String(n).padStart(2, '0'));
  });
  if (!monthCol.size) return { rows: [], errors: ['The header needs month columns (jan..dec or 1..12)'] };
  const rows: { account: string; months: Record<string, number> }[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((l, i) => {
    const cells = split(l);
    const account = cells[accountCol] ?? '';
    if (!account) { errors.push(`Line ${i + 2}: no account`); return; }
    const months: Record<string, number> = {};
    for (const [col, mm] of monthCol) {
      const raw = (cells[col] ?? '').replace(/[฿,\s]/g, '');
      if (raw === '' || raw === '-') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) { errors.push(`Line ${i + 2}: ${account} ${mm} is not a number`); return; }
      months[mm] = round2(n);
    }
    rows.push({ account, months });
  });
  return { rows, errors };
}
