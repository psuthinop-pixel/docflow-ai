// Bookkeeping, Phase A: chart of accounts, category → account mapping, month readiness.
// Design: docs/ACCOUNTING.md. Reads are open to members; changes are owner/admin only.
import { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';
import { ACCOUNT_TYPES, DEFAULT_BANK_CODE, DEFAULT_CAPEX_CODE, SEED_ACCOUNTS, suggestAccount, type AccountType } from '../accounting/coa.js';
import { CAPEX, MONTH } from './reports.js';

const EDITORS = ['owner', 'admin'];
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
    res.json({ categories: await categoryRows(a.orgId), settings });
  });

  // GET /accounting/readiness?organization_id=<id>&month=YYYY-MM: can this month be posted to the journal?
  r.get('/readiness', async (req, res) => {
    const a = await access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const month = req.query.month;
    const inMonth = `FROM expenses e WHERE e.organization_id = $1 AND ${MONTH} = $2`;
    const args = [a.orgId, month];

    const [counts] = await all<Record<string, number>>(
      db,
      `SELECT COUNT(*) FILTER (WHERE ${POSTED})::int AS posted,
              COUNT(*) FILTER (WHERE e.status = 'draft')::int AS drafts,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.category = '')::int AS uncategorised,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.total_thb IS NULL)::int AS fx_pending,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.payment_source = '')::int AS payment_unset,
              COUNT(*) FILTER (WHERE ${POSTED} AND e.payment_source = 'advance' AND e.paid_by = '')::int AS advance_no_person
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

    const blockers: { code: string; message: string; count: number; categories?: string[] }[] = [];
    const warnings: { code: string; message: string; count: number }[] = [];
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
    if (capexToDefault?.n) warnings.push({ code: 'capex_default_account', message: 'Capex in a non-asset category: will post to the default capex account', count: capexToDefault.n });

    res.json({ organization_id: a.orgId, month, posted: counts.posted, ready: blockers.length === 0, blockers, warnings });
  });

  return r;
}
