// Phase E2: budget per property × account × month. Owner/admin edit; members read. Not locked by month close
// (a budget is a plan, not the books), but every change is in the audit log.
import type { Router } from 'express';
import type { Db } from '../db.js';
import { all, now } from '../db.js';
import { audit } from '../accounting/periods.js';
import { parseBudgetCsv, type MonthBudget } from '../accounting/budget.js';
import { round2 } from '../accounting/journal.js';

type Access = { error: { status: number; detail: string } } | { orgId: string; role: string };
const MM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const isYear = (v: unknown): v is string => typeof v === 'string' && /^20\d{2}$/.test(v);

/** The month's budget for one property, as the pack needs it. */
export async function monthBudget(db: Db, orgId: string, month: string): Promise<MonthBudget> {
  const rows = await all<{ account_code: string; amount: number; name: string; type: 'revenue' | 'expense' }>(db,
    `SELECT b.account_code, b.amount, a.name, a.type FROM budgets b
     JOIN accounts a ON a.organization_id = b.organization_id AND a.code = b.account_code
     WHERE b.organization_id = $1 AND b.month = $2 AND a.type IN ('revenue', 'expense')`, [orgId, month]);
  return new Map(rows.map((r) => [r.account_code, { amount: Number(r.amount), name: r.name, type: r.type }]));
}

export function mountBudget(r: Router, db: Db, deps: { access: (userId: string, orgId: unknown, write?: boolean) => Promise<Access> }) {
  const budgetable = async (orgId: string) => new Map((await all<{ code: string; name: string; type: string }>(db,
    `SELECT code, name, type FROM accounts WHERE organization_id = $1 AND active AND type IN ('revenue', 'expense') ORDER BY code`, [orgId])).map((a) => [a.code, a]));

  async function year(orgId: string, y: string) {
    const rows = await all<{ month: string; account_code: string; amount: number }>(db,
      `SELECT month, account_code, amount FROM budgets WHERE organization_id = $1 AND substr(month, 1, 4) = $2 ORDER BY account_code, month`, [orgId, y]);
    const accounts = await budgetable(orgId);
    const lines = new Map<string, { account_code: string; name: string; type: string; months: Record<string, number>; total: number }>();
    for (const x of rows) {
      const acc = accounts.get(x.account_code);
      const line = lines.get(x.account_code) ?? { account_code: x.account_code, name: acc?.name ?? x.account_code, type: acc?.type ?? '', months: {}, total: 0 };
      line.months[x.month.slice(5)] = Number(x.amount);
      line.total = round2(line.total + Number(x.amount));
      lines.set(x.account_code, line);
    }
    const list = [...lines.values()].sort((a, b) => (a.type === b.type ? a.account_code.localeCompare(b.account_code) : a.type === 'revenue' ? -1 : 1));
    return { year: y, lines: list, accounts: [...accounts.values()] };
  }

  /** Replace the whole year's budget for the given accounts (accounts not listed are left alone). */
  async function save(orgId: string, userId: string, y: string, lines: { account: string; months: Record<string, unknown> }[]) {
    const accounts = await budgetable(orgId);
    const errors: string[] = [];
    const clean: { account: string; months: Record<string, number> }[] = [];
    for (const l of lines) {
      const code = String(l.account ?? '').trim();
      if (!accounts.has(code)) { errors.push(`${code || '(empty)'} is not an active revenue or expense account`); continue; }
      const months: Record<string, number> = {};
      for (const [k, v] of Object.entries(l.months ?? {})) {
        const mm = String(k).padStart(2, '0');
        if (!MM.includes(mm)) { errors.push(`${code}: month ${k} is not 1-12`); continue; }
        if (v === '' || v === null || v === undefined) continue;
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[฿,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) { errors.push(`${code} ${mm}: enter a positive amount (costs are positive too)`); continue; }
        months[mm] = round2(n);
      }
      clean.push({ account: code, months });
    }
    if (errors.length) return { errors };
    const ts = now();
    for (const l of clean) {
      await db.query(`DELETE FROM budgets WHERE organization_id = $1 AND account_code = $2 AND substr(month, 1, 4) = $3`, [orgId, l.account, y]);
      for (const [mm, amount] of Object.entries(l.months)) {
        if (!amount) continue;
        await db.query(`INSERT INTO budgets (organization_id, month, account_code, amount, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [orgId, `${y}-${mm}`, l.account, amount, userId, ts]);
      }
    }
    await audit(db, { orgId, userId, action: 'update', entity: 'budget', detail: { year: y, accounts: clean.length,
      total: round2(clean.reduce((t, l) => t + Object.values(l.months).reduce((s, v) => s + v, 0), 0)) } });
    return { errors: [] };
  }

  // GET /accounting/budget?organization_id=<id>&year=YYYY
  r.get('/budget', async (req, res) => {
    const a = await deps.access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isYear(req.query.year)) return res.status(400).json({ detail: 'year must be YYYY' });
    res.json(await year(a.orgId, req.query.year));
  });

  // PUT /accounting/budget { organization_id, year, lines: [{ account, months: { '01': amount, ... } }] }
  r.put('/budget', async (req, res) => {
    const body = req.body ?? {};
    const a = await deps.access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isYear(body.year)) return res.status(400).json({ detail: 'year must be YYYY' });
    if (!Array.isArray(body.lines)) return res.status(400).json({ detail: 'lines must be an array' });
    const { errors } = await save(a.orgId, req.user!.id, body.year, body.lines);
    if (errors.length) return res.status(400).json({ detail: errors.slice(0, 10).join('; '), errors });
    res.json(await year(a.orgId, body.year));
  });

  // POST /accounting/budget/import { organization_id, year, csv }: header account,jan..dec; all or nothing
  r.post('/budget/import', async (req, res) => {
    const body = req.body ?? {};
    const a = await deps.access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isYear(body.year)) return res.status(400).json({ detail: 'year must be YYYY' });
    if (typeof body.csv !== 'string') return res.status(400).json({ detail: 'Paste the budget as CSV' });
    const parsed = parseBudgetCsv(body.csv);
    if (parsed.errors.length) return res.status(400).json({ detail: parsed.errors.slice(0, 10).join('; '), errors: parsed.errors });
    if (!parsed.rows.length) return res.status(400).json({ detail: 'No budget lines under the header' });
    const { errors } = await save(a.orgId, req.user!.id, body.year, parsed.rows);
    if (errors.length) return res.status(400).json({ detail: errors.slice(0, 10).join('; '), errors });
    res.status(201).json(await year(a.orgId, body.year));
  });
}
