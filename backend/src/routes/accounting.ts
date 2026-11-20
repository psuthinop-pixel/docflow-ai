// Bookkeeping, Phase A: chart of accounts, category → account mapping, month readiness.
// Design: docs/ACCOUNTING.md. Reads are open to members; changes are owner/admin only.
import { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';
import { ACCOUNT_TYPES, DEFAULT_BANK_CODE, DEFAULT_CAPEX_CODE, SEED_ACCOUNTS, suggestAccount, type AccountType } from '../accounting/coa.js';
import { CAPEX, CLAIMABLE, MONTH } from './reports.js';
import { expenseEntry, PostingError, reimbursementEntry, revenueEntry, type PostingRevenue, round2, trialBalance, type AccountRef, type JournalEntry, type PostingContext, type PostingExpense } from '../accounting/journal.js';
import { journalWorkbook } from '../accounting/journal-xlsx.js';
import { audit } from '../accounting/periods.js';
import { mountMma } from './mma.js';
import { mountRevenue } from './revenue.js';
import { mountBudget } from './budget.js';

const EDITORS = ['owner', 'admin'];

interface Issue { code: string; message: string; count: number; categories?: string[] }
export interface Readiness { organization_id: string; month: string; posted: number; ready: boolean; blockers: Issue[]; warnings: Issue[] }
const POSTED = `e.status IN ('confirmed', 'approved')`;

export interface Account {
  id: string; organization_id: string; code: string; name: string; name_th: string;
  type: AccountType; role: string; life_years: number | null; contra_code: string | null; active: boolean;
}

/** Seed the standard chart once per property (only when it has no accounts, so edits and deletions stick). */
export async function ensureChart(db: Db, orgId: string): Promise<void> {
  const has = await one(db, 'SELECT 1 FROM accounts WHERE organization_id = $1 LIMIT 1', [orgId]);
  if (!has) {
    const ts = now();
    const values: unknown[] = [];
    const rows = SEED_ACCOUNTS.map((a, i) => {
      values.push(newId(), orgId, a.code, a.name, a.name_th, a.type, a.role ?? '', a.life_years ?? null, a.contra_code ?? null, ts);
      const b = i * 10;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10})`;
    });
    await db.query(
      `INSERT INTO accounts (id, organization_id, code, name, name_th, type, role, life_years, contra_code, created_at)
       VALUES ${rows.join(', ')} ON CONFLICT (organization_id, code) DO NOTHING`,
      values,
    );
  }
  // Charts seeded before a role existed get that role's account added (or tagged on the seed code, if unused)
  const roles = await all<{ role: string }>(db, `SELECT DISTINCT role FROM accounts WHERE organization_id = $1 AND role <> ''`, [orgId]);
  for (const a of SEED_ACCOUNTS.filter((x) => x.role && !roles.some((r) => r.role === x.role))) {
    const taken = await one<{ id: string; role: string; type: string }>(db, 'SELECT id, role, type FROM accounts WHERE organization_id = $1 AND code = $2', [orgId, a.code]);
    if (!taken) {
      await db.query(
        `INSERT INTO accounts (id, organization_id, code, name, name_th, type, role, life_years, contra_code, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [newId(), orgId, a.code, a.name, a.name_th, a.type, a.role, a.life_years ?? null, a.contra_code ?? null, now()],
      );
    } else if (!taken.role && taken.type === a.type) {
      await db.query('UPDATE accounts SET role = $2 WHERE id = $1', [taken.id, a.role]);
    }
  }
  await db.query(
    `INSERT INTO accounting_settings (organization_id, bank_code, capex_code, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO NOTHING`,
    [orgId, DEFAULT_BANK_CODE, DEFAULT_CAPEX_CODE, now()],
  );
}

const isCode = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-Za-z.-]{1,20}$/.test(v.trim());
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Accounts an expense category may post to: an expense, or a fixed asset / construction for capex categories. */
const postable = (a: Account) => a.active && (a.type === 'expense' || a.role === 'fixed_asset' || a.role === 'construction');

export function accountingRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  /** Resolve organization_id and the caller's role; seeds the chart on first use. */
  type Access = { error: { status: number; detail: string } } | { orgId: string; role: string };
  async function access(userId: string, orgId: unknown, write = false): Promise<Access> {
    if (typeof orgId !== 'string' || !orgId) return { error: { status: 400, detail: 'organization_id is required' } };
    const role = await membershipRole(db, userId, orgId);
    if (!role) return { error: { status: 403, detail: 'Not a member of this organization' } };
    if (write && !EDITORS.includes(role)) return { error: { status: 403, detail: 'Only an owner or admin can change the chart of accounts' } };
    await ensureChart(db, orgId);
    return { orgId, role };
  }

  const accounts = (orgId: string) =>
    all<Account>(db, 'SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code', [orgId]);

  // GET /accounting/accounts?organization_id=<id>
  r.get('/accounts', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    res.json(await accounts(a.orgId));
  });

  // POST /accounting/accounts { organization_id, code, name, name_th?, type, life_years?, contra_code? }
  r.post('/accounts', async (req, res) => {
    const body = req.body ?? {};
    const a = await access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isCode(body.code)) return res.status(400).json({ detail: 'code must be 1-20 letters, digits, dots or dashes' });
    if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ detail: 'name is required' });
    if (!ACCOUNT_TYPES.includes(body.type)) return res.status(400).json({ detail: `type must be one of ${ACCOUNT_TYPES.join(', ')}` });
    const code = body.code.trim();
    if (await one(db, 'SELECT 1 FROM accounts WHERE organization_id = $1 AND code = $2', [a.orgId, code])) {
      return res.status(409).json({ detail: `Account ${code} already exists` });
    }
    const id = newId();
    await db.query(
      `INSERT INTO accounts (id, organization_id, code, name, name_th, type, role, life_years, contra_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9)`,
      [id, a.orgId, code, body.name.trim(), String(body.name_th ?? '').trim(), body.type,
        Number.isInteger(body.life_years) && body.life_years > 0 ? body.life_years : null,
        isCode(body.contra_code) ? body.contra_code.trim() : null, now()],
    );
    res.status(201).json(await one<Account>(db, 'SELECT * FROM accounts WHERE id = $1', [id]));
  });

  // PUT /accounting/accounts/:id { code?, name?, name_th?, active?, life_years? }. A code change follows through to mappings.
  r.put('/accounts/:id', async (req, res) => {
    const acc = await one<Account>(db, 'SELECT * FROM accounts WHERE id = $1', [req.params.id]);
    if (!acc || !(await membershipRole(db, req.user!.id, acc.organization_id))) return res.status(404).json({ detail: 'Account not found' });
    const a = await access(req.user!.id, acc.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    const body = req.body ?? {};
    const next = { ...acc };
    if ('code' in body) {
      if (!isCode(body.code)) return res.status(400).json({ detail: 'code must be 1-20 letters, digits, dots or dashes' });
      next.code = body.code.trim();
      if (next.code !== acc.code && await one(db, 'SELECT 1 FROM accounts WHERE organization_id = $1 AND code = $2', [acc.organization_id, next.code])) {
        return res.status(409).json({ detail: `Account ${next.code} already exists` });
      }
    }
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ detail: 'name is required' });
      next.name = body.name.trim();
    }
    if ('name_th' in body) next.name_th = String(body.name_th ?? '').trim();
    if ('active' in body) next.active = Boolean(body.active);
    if ('life_years' in body) {
      if (body.life_years !== null && !(Number.isInteger(body.life_years) && body.life_years > 0)) {
        return res.status(400).json({ detail: 'life_years must be a whole number of years, or null' });
      }
      next.life_years = body.life_years;
    }
    if (!next.active && acc.role) {
      return res.status(400).json({ detail: `Account ${acc.code} is used for ${acc.role.replace(/_/g, ' ')} postings and can't be deactivated` });
    }
    await db.query(
      'UPDATE accounts SET code = $1, name = $2, name_th = $3, active = $4, life_years = $5 WHERE id = $6',
      [next.code, next.name, next.name_th, next.active, next.life_years, acc.id],
    );
    if (next.code !== acc.code) {
      const args = [acc.organization_id, acc.code, next.code];
      await db.query('UPDATE category_accounts SET account_code = $3 WHERE organization_id = $1 AND account_code = $2', args);
      await db.query('UPDATE accounting_settings SET bank_code = $3 WHERE organization_id = $1 AND bank_code = $2', args);
      await db.query('UPDATE accounting_settings SET capex_code = $3 WHERE organization_id = $1 AND capex_code = $2', args);
      await db.query('UPDATE accounts SET contra_code = $3 WHERE organization_id = $1 AND contra_code = $2', args);
    }
    res.json(await one<Account>(db, 'SELECT * FROM accounts WHERE id = $1', [acc.id]));
  });

  /** Categories of this property: its configured list plus any used on expenses. */
  async function categoryRows(orgId: string) {
    const org = await one<{ categories: string }>(db, 'SELECT categories FROM organizations WHERE id = $1', [orgId]);
    const used = await all<{ category: string; records: number }>(
      db,
      `SELECT e.category, COUNT(*)::int AS records FROM expenses e
       WHERE e.organization_id = $1 AND e.status <> 'disabled' AND e.category <> '' GROUP BY 1`,
      [orgId],
    );
    const mapped = await all<{ category: string; account_code: string }>(
      db, 'SELECT category, account_code FROM category_accounts WHERE organization_id = $1', [orgId],
    );
    const names = [...new Set([...(JSON.parse(org?.categories ?? '[]') as string[]), ...used.map((u) => u.category)])];
    return names.map((category) => ({
      category,
      account_code: mapped.find((m) => m.category === category)?.account_code ?? null,
      suggested_code: suggestAccount(category),
      records: used.find((u) => u.category === category)?.records ?? 0,
    }));
  }

  // GET /accounting/mapping?organization_id=<id>
  r.get('/mapping', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    const settings = await one<{ bank_code: string; capex_code: string }>(
      db, 'SELECT bank_code, capex_code FROM accounting_settings WHERE organization_id = $1', [a.orgId],
    );
    res.json({ categories: await categoryRows(a.orgId), settings });
  });

  // PUT /accounting/mapping { organization_id, mappings?: [{ category, account_code | null }], bank_code?, capex_code? }
  r.put('/mapping', async (req, res) => {
    const body = req.body ?? {};
    const a = await access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    const byCode = new Map((await accounts(a.orgId)).map((x) => [x.code, x]));

    const mappings = body.mappings ?? [];
    if (!Array.isArray(mappings)) return res.status(400).json({ detail: 'mappings must be an array' });
    for (const m of mappings) {
      if (typeof m?.category !== 'string' || !m.category.trim()) return res.status(400).json({ detail: 'each mapping needs a category' });
      if (m.account_code === null || m.account_code === '') continue;
      const acc = byCode.get(String(m.account_code));
      if (!acc) return res.status(400).json({ detail: `Account ${m.account_code} does not exist` });
      if (!postable(acc)) return res.status(400).json({ detail: `${m.category}: account ${acc.code} must be an active expense or fixed-asset account` });
    }
    const check = (key: 'bank_code' | 'capex_code', ok: (x: Account) => boolean, what: string) => {
      if (!(key in body)) return null;
      const acc = byCode.get(String(body[key]));
      return acc && acc.active && ok(acc) ? null : `${key} must be an active ${what} account`;
    };
    const bad = check('bank_code', (x) => x.role === 'bank' || x.role === 'cash', 'bank or cash')
      ?? check('capex_code', (x) => x.role === 'fixed_asset' || x.role === 'construction', 'fixed-asset');
    if (bad) return res.status(400).json({ detail: bad });

    const ts = now();
    for (const m of mappings) {
      if (m.account_code === null || m.account_code === '') {
        await db.query('DELETE FROM category_accounts WHERE organization_id = $1 AND category = $2', [a.orgId, m.category.trim()]);
      } else {
        await db.query(
          `INSERT INTO category_accounts (organization_id, category, account_code, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, category) DO UPDATE SET account_code = $3, updated_at = $4`,
          [a.orgId, m.category.trim(), String(m.account_code), ts],
        );
      }
    }
    if ('bank_code' in body) await db.query('UPDATE accounting_settings SET bank_code = $2, updated_at = $3 WHERE organization_id = $1', [a.orgId, String(body.bank_code), ts]);
    if ('capex_code' in body) await db.query('UPDATE accounting_settings SET capex_code = $2, updated_at = $3 WHERE organization_id = $1', [a.orgId, String(body.capex_code), ts]);
    const settings = await one(db, 'SELECT bank_code, capex_code FROM accounting_settings WHERE organization_id = $1', [a.orgId]);
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'update', entity: 'mapping',
      detail: { mappings, bank_code: body.bank_code, capex_code: body.capex_code } });
    res.json({ categories: await categoryRows(a.orgId), settings });
  });

  // GET /accounting/readiness?organization_id=<id>&month=YYYY-MM: can this month be posted to the journal?
  async function readiness(orgId: string, month: string): Promise<Readiness> {
    const inMonth = `FROM expenses e WHERE e.organization_id = $1 AND ${MONTH} = $2`;
    const args = [orgId, month];

    const [counts] = await all<Record<string, number>>(
      db,
      `SELECT COUNT(*) FILTER (WHERE ${POSTED})::int AS posted,
              COUNT(*) FILTER (WHERE e.status = 'draft')::int AS drafts,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.category = '')::int AS uncategorised,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.total_thb IS NULL)::int AS fx_pending,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.payment_source = '')::int AS payment_unset,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.payment_source = 'advance' AND e.paid_by = '')::int AS advance_no_person,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.currency <> 'THB' AND e.supply_type = '')::int AS foreign_type_unset,
              COUNT(*) FILTER (WHERE e.status = 'confirmed')::int AS not_approved
       ${inMonth}`,
      args,
    );
    const unmapped = await all<{ category: string; records: number }>(
      db,
      `SELECT e.category, COUNT(*)::int AS records ${inMonth} AND ${POSTED} AND e.category <> ''
         AND NOT EXISTS (
           SELECT 1 FROM category_accounts c JOIN accounts acc ON acc.organization_id = c.organization_id AND acc.code = c.account_code AND acc.active
           WHERE c.organization_id = e.organization_id AND c.category = e.category)
       GROUP BY 1 ORDER BY 2 DESC`,
      args,
    );
    const capexToDefault = await one<{ n: number }>(
      db,
      `SELECT COUNT(*)::int AS n ${inMonth} AND ${POSTED} AND ${CAPEX}
         AND NOT EXISTS (
           SELECT 1 FROM category_accounts c JOIN accounts acc ON acc.organization_id = c.organization_id AND acc.code = c.account_code
           WHERE c.organization_id = e.organization_id AND c.category = e.category AND acc.role IN ('fixed_asset', 'construction'))`,
      args,
    );

    const blockers: Issue[] = [];
    const warnings: Issue[] = [];
    if (counts.drafts) blockers.push({ code: 'drafts', message: 'Receipts still in draft: review and confirm, or disable them', count: counts.drafts });
    if (unmapped.length) {
      blockers.push({
        code: 'unmapped_categories', message: 'Categories with no account: map them in Settings → Chart of accounts',
        count: unmapped.reduce((t, u) => t + u.records, 0), categories: unmapped.map((u) => u.category),
      });
    }
    if (counts.uncategorised) blockers.push({ code: 'uncategorised', message: 'Confirmed receipts without a category', count: counts.uncategorised });
    if (counts.fx_pending) blockers.push({ code: 'fx_pending', message: 'Foreign-currency receipts waiting for their THB amount', count: counts.fx_pending });
    if (counts.payment_unset) warnings.push({ code: 'payment_unset', message: '"Paid from" not set: will post as company bank payments', count: counts.payment_unset });
    if (counts.advance_no_person) warnings.push({ code: 'advance_no_person', message: 'Advances without "Paid by": owed to an unknown person', count: counts.advance_no_person });
    if (counts.foreign_type_unset) warnings.push({ code: 'foreign_type_unset', message: 'Foreign receipts without "Service or goods": posted with no ภ.พ.36', count: counts.foreign_type_unset });
    const rev = await one<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM revenue_entries WHERE organization_id = $1 AND substr(date, 1, 7) = $2`, args);
    if (!rev?.n && counts.posted) warnings.push({ code: 'no_revenue', message: 'No revenue entered for this month (Management accounts → Revenue)', count: 0 });
    if (counts.not_approved) warnings.push({ code: 'not_approved', message: 'Confirmed but not yet approved by an owner/admin', count: counts.not_approved });
    if (capexToDefault?.n) warnings.push({ code: 'capex_default_account', message: 'Capex in a non-asset category: will post to the default capex account', count: capexToDefault.n });

    return { organization_id: orgId, month, posted: counts.posted, ready: blockers.length === 0, blockers, warnings };
  }

  r.get('/readiness', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    res.json(await readiness(a.orgId, req.query.month));
  });

  /** The month's journal: one entry per posted expense dated in the month, plus advances reimbursed in the month. */
  async function buildJournal(orgId: string, month: string) {
    const [accts, maps, settings] = await Promise.all([
      accounts(orgId),
      all<{ category: string; account_code: string }>(db, 'SELECT category, account_code FROM category_accounts WHERE organization_id = $1', [orgId]),
      one<{ bank_code: string; capex_code: string }>(db, 'SELECT bank_code, capex_code FROM accounting_settings WHERE organization_id = $1', [orgId]),
    ]);
    const byCode = new Map<string, AccountRef>(accts.map((x) => [x.code, x]));
    const ctx: PostingContext = {
      accounts: byCode,
      categoryAccount: new Map(maps.map((m) => [m.category, m.account_code])),
      bankCode: settings!.bank_code,
      capexCode: settings!.capex_code,
      roleCode: (role) => accts.find((x) => x.role === role && x.active)?.code,
    };
    const cols = `e.id, substr(COALESCE(NULLIF(e.date, ''), e.created_at), 1, 10) AS date, e.invoice_number, e.vendor_name,
      e.vendor_taxid, e.category, e.notes, e.currency, e.total_thb, e.tax_amount, e.supply_type, e.payment_source, e.paid_by,
      e.reimbursed_at, ${CLAIMABLE} AS claimable, ${CAPEX} AS capex, e.created_at`;
    const toPosting = (x: Record<string, any>): PostingExpense => ({
      ...x, total_thb: Number(x.total_thb), tax_amount: Number(x.tax_amount), claimable: Boolean(x.claimable), capex: Boolean(x.capex),
    } as PostingExpense);
    const [expenses, reimbursed, revenue] = await Promise.all([
      all<Record<string, any>>(db, `SELECT ${cols} FROM expenses e
        WHERE e.organization_id = $1 AND ${POSTED} AND ${MONTH} = $2 AND e.total_thb IS NOT NULL
        ORDER BY 2, e.created_at`, [orgId, month]),
      all<Record<string, any>>(db, `SELECT ${cols} FROM expenses e
        WHERE e.organization_id = $1 AND ${POSTED} AND e.payment_source = 'advance' AND e.total_thb IS NOT NULL
          AND substr(e.reimbursed_at, 1, 7) = $2
        ORDER BY e.reimbursed_at, e.created_at`, [orgId, month]),
      all<Record<string, any>>(db, `SELECT * FROM revenue_entries WHERE organization_id = $1 AND substr(date, 1, 7) = $2
        ORDER BY date, created_at`, [orgId, month]),
    ]);

    const entries: JournalEntry[] = [];
    const errors: { expense_id: string; vendor_name: string; message: string }[] = [];
    const tryPost = (x: Record<string, any>, make: typeof expenseEntry) => {
      try {
        entries.push(make(toPosting(x), ctx));
      } catch (err) {
        if (!(err instanceof PostingError)) throw err;
        errors.push({ expense_id: x.id, vendor_name: x.vendor_name, message: err.message });
      }
    };
    expenses.forEach((x) => tryPost(x, expenseEntry));
    reimbursed.forEach((x) => tryPost(x, reimbursementEntry));
    for (const x of revenue) {
      const line: PostingRevenue = { ...x, net_amount: Number(x.net_amount), vat_amount: Number(x.vat_amount), commission: Number(x.commission) } as PostingRevenue;
      try {
        entries.push(revenueEntry(line, ctx));
      } catch (err) {
        if (!(err instanceof PostingError)) throw err;
        errors.push({ expense_id: x.id, vendor_name: `Revenue ${x.channel || x.account_code}`, message: err.message });
      }
    }
    const order = { revenue: 0, expense: 1, reimbursement: 2 };
    entries.sort((p, q) => p.date.localeCompare(q.date) || order[p.kind] - order[q.kind]);
    const numbered = entries.map((x, i) => ({ entry_no: `JV-${month.replace('-', '')}-${String(i + 1).padStart(4, '0')}`, ...x }));

    const ready = await readiness(orgId, month);
    if (errors.length) {
      ready.blockers.push({ code: 'cannot_post', message: 'Receipts that cannot be posted (see errors)', count: errors.length });
      ready.ready = false;
    }
    const tb = trialBalance(entries);
    const debit = round2(tb.reduce((t, x) => t + x.debit, 0));
    const credit = round2(tb.reduce((t, x) => t + x.credit, 0));
    return { ...ready, entries: numbered, errors, trial_balance: tb, totals: { debit, credit, balanced: debit === credit } };
  }

  type Period = { month: string; status: string; closed_by: string | null; closed_at: string | null; closed_by_name?: string;
    reopened_at: string | null; reopen_reason: string; journal_snapshot: string | null };
  const period = (orgId: string, month: string) => one<Period>(
    db,
    `SELECT p.*, u.name AS closed_by_name FROM periods p LEFT JOIN users u ON u.id = p.closed_by
     WHERE p.organization_id = $1 AND p.month = $2`,
    [orgId, month],
  );

  /** A closed month returns its frozen journal; an open month is generated from the receipts as they are now. */
  async function journal(orgId: string, month: string) {
    const p = await period(orgId, month);
    const closing = p?.status === 'closed'
      ? { status: 'closed', closed_at: p.closed_at, closed_by: p.closed_by_name ?? null }
      : { status: 'open', closed_at: null, closed_by: null, reopened_at: p?.reopened_at ?? null, reopen_reason: p?.reopen_reason ?? '' };
    if (p?.status === 'closed' && p.journal_snapshot) return { ...JSON.parse(p.journal_snapshot), period: closing } as Awaited<ReturnType<typeof buildJournal>> & { period: typeof closing };
    return { ...(await buildJournal(orgId, month)), period: closing };
  }

  // GET /accounting/periods?organization_id=<id>: closed and reopened months
  r.get('/periods', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    res.json(await all(db,
      `SELECT p.month, p.status, p.closed_at, cu.name AS closed_by, p.reopened_at, ru.name AS reopened_by, p.reopen_reason
       FROM periods p LEFT JOIN users cu ON cu.id = p.closed_by LEFT JOIN users ru ON ru.id = p.reopened_by
       WHERE p.organization_id = $1 ORDER BY p.month DESC`, [a.orgId]));
  });

  // POST /accounting/periods/close { organization_id, month }: owner/admin, only when the month is ready
  r.post('/periods/close', async (req, res) => {
    const body = req.body ?? {};
    const a = await access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(body.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    if ((await period(a.orgId, body.month))?.status === 'closed') return res.status(409).json({ detail: `${body.month} is already closed` });
    const j = await buildJournal(a.orgId, body.month);
    if (!j.ready) {
      return res.status(409).json({ detail: `${body.month} isn't ready to close: ${j.blockers.map((b) => b.message).join('; ')}`, blockers: j.blockers });
    }
    const ts = now();
    await db.query(
      `INSERT INTO periods (organization_id, month, status, closed_by, closed_at, journal_snapshot) VALUES ($1, $2, 'closed', $3, $4, $5)
       ON CONFLICT (organization_id, month) DO UPDATE SET status = 'closed', closed_by = $3, closed_at = $4, journal_snapshot = $5`,
      [a.orgId, body.month, req.user!.id, ts, JSON.stringify(j)],
    );
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'close', entity: 'period', month: body.month,
      detail: { entries: j.entries.length, debit: j.totals.debit, credit: j.totals.credit } });
    res.json(await journal(a.orgId, body.month));
  });

  // POST /accounting/periods/reopen { organization_id, month, reason }: owner only, reason required
  r.post('/periods/reopen', async (req, res) => {
    const body = req.body ?? {};
    const a = await access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (a.role !== 'owner') return res.status(403).json({ detail: 'Only an owner can reopen a closed month' });
    if (!isMonth(body.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) return res.status(400).json({ detail: 'Give a reason for reopening the month' });
    if ((await period(a.orgId, body.month))?.status !== 'closed') return res.status(409).json({ detail: `${body.month} is not closed` });
    await db.query(
      `UPDATE periods SET status = 'open', reopened_by = $3, reopened_at = $4, reopen_reason = $5, journal_snapshot = NULL
       WHERE organization_id = $1 AND month = $2`,
      [a.orgId, body.month, req.user!.id, now(), reason],
    );
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'reopen', entity: 'period', month: body.month, detail: { reason } });
    res.json(await journal(a.orgId, body.month));
  });

  // GET /accounting/audit?organization_id=<id>[&month=YYYY-MM]: newest first, at most 200
  r.get('/audit', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    const month = isMonth(req.query.month) ? req.query.month : null;
    const rows = await all<Record<string, any>>(db,
      `SELECT l.id, l.action, l.entity, l.entity_id, l.month, l.detail, l.created_at, u.name AS user_name
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.organization_id = $1 AND ($2::text IS NULL OR l.month = $2)
       ORDER BY l.created_at DESC LIMIT 200`, [a.orgId, month]);
    res.json(rows.map((x) => ({ ...x, detail: JSON.parse(x.detail) })));
  });

  // GET /accounting/journal?organization_id=<id>&month=YYYY-MM: preview, always available
  r.get('/journal', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    res.json(await journal(a.orgId, req.query.month));
  });

  // GET /accounting/journal.xlsx?organization_id=<id>&month=YYYY-MM: only when the month is ready
  r.get('/journal.xlsx', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const j = await journal(a.orgId, req.query.month);
    if (!j.ready) {
      return res.status(409).json({ detail: `${j.month} isn't ready to post: ${j.blockers.map((b) => b.message).join('; ')}`, blockers: j.blockers });
    }
    const org = await one<{ organization_name: string }>(db, 'SELECT organization_name FROM organizations WHERE id = $1', [a.orgId]);
    const name = org?.organization_name ?? 'Property';
    const book = journalWorkbook(j.entries, j.trial_balance, name, j.month);
    const buf = Buffer.from(await book.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${name} journal ${j.month}.xlsx`)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition'); // the app is on another origin
    res.send(buf);
  });

  mountMma(r, db, { access, journal });
  mountRevenue(r, db, { access });
  mountBudget(r, db, { access });

  return r;
}
