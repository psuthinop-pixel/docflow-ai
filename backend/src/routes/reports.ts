import { Router, type Request, type Response } from 'express';
import type { Db } from '../db.js';
import { all, one } from '../db.js';
import { summaryWorkbook, vatWorkbook, type VatRow } from './reports-xlsx.js';
import { membershipRole, requireAuth } from '../auth.js';

/*
 * Reporting definitions, shared by the Dashboard and Reports pages:
 * - Spend: every record except disabled ones, drafts included, in THB (total_thb), grouped by the
 *   receipt date (falling back to when it was recorded). A foreign-currency receipt is left out until
 *   an owner/admin enters its THB amount; those are reported separately as fx_pending.
 * - Claimable input VAT: THB, confirmed or approved records with VAT > 0 and a 13-digit seller tax ID.
 */
const MONTH = `substr(COALESCE(NULLIF(e.date, ''), e.created_at), 1, 7)`;
const CLAIMABLE = `(e.currency = 'THB' AND e.status IN ('confirmed', 'approved') AND e.tax_amount > 0 AND e.vendor_taxid ~ '^[0-9]{13}$')`;
const MAX_MONTHS = 36;

const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
const shift = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
type Row = Record<string, any>;
const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

export function reportsRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  /** Resolve ?organization_id=<id|all> to a list of org ids the user belongs to, or an error. */
  async function scope(userId: string, orgParam: unknown): Promise<{ orgId: string | null } | { status: number; detail: string }> {
    if (orgParam === 'all') return { orgId: null };
    if (typeof orgParam !== 'string' || !orgParam) return { status: 400, detail: 'organization_id is required (an id or "all")' };
    if (!(await membershipRole(db, userId, orgParam))) return { status: 403, detail: 'Not a member of this organization' };
    return { orgId: orgParam };
  }

  /** from/to query params → a validated range (default: the last 12 months), or an error. */
  function range(q: Record<string, unknown>): { from: string; to: string; months: number } | { status: number; detail: string } {
    const to = isMonth(q.to) ? q.to : new Date().toISOString().slice(0, 7);
    const from = isMonth(q.from) ? q.from : shift(to, -11);
    const months = monthsBetween(from, to);
    if (months < 1) return { status: 400, detail: 'from must not be after to' };
    if (months > MAX_MONTHS) return { status: 400, detail: `A report covers at most ${MAX_MONTHS} months` };
    return { from, to, months };
  }

  async function summarize(userId: string, orgId: string | null, from: string, to: string, months: number) {
    // $1 user, $2 org (or null for all of the user's organizations)
    const base = `FROM expenses e
      JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = $1
      WHERE ($2::text IS NULL OR e.organization_id = $2) AND e.status <> 'disabled'`;
    const params = [userId, orgId];
    const ranged = [...params, from, to];

    const [orgs, byMonth, byCategory, statuses, vatGaps, fxPending] = await Promise.all([
      all<{ id: string; organization_name: string; color: string | null; role: string }>(
        db,
        `SELECT o.id, o.organization_name, o.color, m.role FROM organizations o
         JOIN memberships m ON m.organization_id = o.id AND m.user_id = $1
         WHERE ($2::text IS NULL OR o.id = $2) ORDER BY o.created_at`,
        params,
      ),
      all<Row>(
        db,
        `SELECT e.organization_id, ${MONTH} AS month, COALESCE(SUM(e.total_thb), 0) AS spend, COUNT(*)::int AS count,
                SUM(CASE WHEN ${CLAIMABLE} THEN e.tax_amount ELSE 0 END) AS vat_claimable,
                COUNT(*) FILTER (WHERE ${CLAIMABLE})::int AS vat_claimable_count
         ${base} AND ${MONTH} BETWEEN $3 AND $4
         GROUP BY 1, 2 ORDER BY 2, 1`,
        ranged,
      ),
      all<Row>(
        db,
        `SELECT e.organization_id, COALESCE(NULLIF(e.category, ''), 'Uncategorised') AS category,
                COALESCE(SUM(e.total_thb), 0) AS spend, COUNT(*)::int AS count
         ${base} AND ${MONTH} BETWEEN $3 AND $4
         GROUP BY 1, 2 ORDER BY 3 DESC`,
        ranged,
      ),
      // Work queues are about current state, so they ignore the date range
      all<Row>(db, `SELECT e.organization_id, e.status, COUNT(*)::int AS count ${base} GROUP BY 1, 2`, params),
      // VAT that is on a receipt but not (yet) claimable, and why
      all<Row>(
        db,
        `SELECT CASE WHEN e.status = 'draft' THEN 'not_reviewed' ELSE 'missing_tax_id' END AS reason,
                COUNT(*)::int AS count, SUM(e.tax_amount) AS vat
         ${base} AND ${MONTH} BETWEEN $3 AND $4 AND e.currency = 'THB' AND e.tax_amount > 0 AND NOT ${CLAIMABLE}
         GROUP BY 1`,
        ranged,
      ),
      // Foreign-currency receipts not in the totals yet, per currency
      all<Row>(
        db,
        `SELECT e.currency, COUNT(*)::int AS count, SUM(e.total) AS total
         ${base} AND ${MONTH} BETWEEN $3 AND $4 AND e.total_thb IS NULL
         GROUP BY 1 ORDER BY 1`,
        ranged,
      ),
    ]);

    return {
      range: { from, to, months },
      organizations: orgs.map((o) => ({ id: o.id, _id: o.id, organization_name: o.organization_name, color: o.color, role: o.role })),
      by_month: byMonth.map((x) => ({ organization_id: x.organization_id as string, month: x.month as string, spend: money(x.spend), vat_claimable: money(x.vat_claimable), vat_claimable_count: x.vat_claimable_count as number, count: x.count as number })),
      by_category: byCategory.map((x) => ({ organization_id: x.organization_id as string, category: x.category as string, spend: money(x.spend), count: x.count as number })),
      status_counts: statuses,
      vat_not_claimable: vatGaps.map((x) => ({ reason: x.reason as string, count: x.count as number, vat: money(x.vat) })),
      fx_pending: fxPending.map((x) => ({ currency: x.currency as string, count: x.count as number, total: money(x.total) })),
    };
  }

  // Every receipt with VAT for one property and month, in the order an accountant files it
  async function vatRows(orgId: string, month: string): Promise<VatRow[]> {
    const rows = await all<Row>(
      db,
      `SELECT e.id, e.date, e.invoice_number, e.vendor_name, e.vendor_taxid, e.vendor_branch, e.subtotal, e.tax_amount, e.total,
              e.status, e.receipt_id, ${CLAIMABLE} AS claimable
       FROM expenses e
       WHERE e.organization_id = $1 AND e.status <> 'disabled' AND e.currency = 'THB' AND e.tax_amount > 0 AND ${MONTH} = $2
       ORDER BY e.date NULLS LAST, e.invoice_number`,
      [orgId, month],
    );
    return rows.map((x) => ({
      ...x,
      subtotal: x.subtotal == null ? money(Number(x.total) - Number(x.tax_amount)) : money(x.subtotal),
      tax_amount: money(x.tax_amount),
      total: money(x.total),
    })) as VatRow[];
  }

  /** A single property and month, as the VAT report needs. */
  async function vatScope(req: Request) {
    const s = await scope(req.user!.id, req.query.organization_id);
    if ('status' in s) return s;
    if (s.orgId === null) return { status: 400, detail: 'The VAT report is per property: pass one organization_id' };
    if (!isMonth(req.query.month)) return { status: 400, detail: 'month must be YYYY-MM' };
    return { orgId: s.orgId, month: req.query.month };
  }

  const sendXlsx = async (res: Response, filename: string, book: { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }) => {
    const buf = Buffer.from(await book.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition'); // the app is on another origin
    res.send(buf);
  };

  // GET /reports/summary?organization_id=<id|all>&from=YYYY-MM&to=YYYY-MM  (default: the last 12 months)
  r.get('/summary', async (req, res) => {
    const s = await scope(req.user!.id, req.query.organization_id);
    if ('status' in s) return res.status(s.status).json({ detail: s.detail });
    const rg = range(req.query);
    if ('status' in rg) return res.status(rg.status).json({ detail: rg.detail });
    res.json(await summarize(req.user!.id, s.orgId, rg.from, rg.to, rg.months));
  });

  // Same as /summary, as an Excel workbook: by month (one column per property), by category, and long-format data
  r.get('/summary.xlsx', async (req, res) => {
    const s = await scope(req.user!.id, req.query.organization_id);
    if ('status' in s) return res.status(s.status).json({ detail: s.detail });
    const rg = range(req.query);
    if ('status' in rg) return res.status(rg.status).json({ detail: rg.detail });
    const data = await summarize(req.user!.id, s.orgId, rg.from, rg.to, rg.months);
    const who = s.orgId ? data.organizations[0]?.organization_name ?? 'property' : 'All properties';
    await sendXlsx(res, `${who} summary ${rg.from} to ${rg.to}.xlsx`, summaryWorkbook(data, who));
  });

  // GET /reports/vat?organization_id=<id>&month=YYYY-MM — the input VAT listing for one property and month
  r.get('/vat', async (req, res) => {
    const v = await vatScope(req);
    if ('status' in v) return res.status(v.status).json({ detail: v.detail });
    res.json(await vatRows(v.orgId, v.month));
  });

  r.get('/vat.xlsx', async (req, res) => {
    const v = await vatScope(req);
    if ('status' in v) return res.status(v.status).json({ detail: v.detail });
    const org = await one<{ organization_name: string }>(db, 'SELECT organization_name FROM organizations WHERE id = $1', [v.orgId]);
    const name = org?.organization_name ?? 'Property';
    await sendXlsx(res, `${name} input VAT ${v.month}.xlsx`, vatWorkbook(await vatRows(v.orgId, v.month), name, v.month));
  });

  return r;
}
