// Phase D routes: the monthly management account pack (mounted inside the accounting router).
import type { Router } from 'express';
import type { Db } from '../db.js';
import { all, now, one } from '../db.js';
import { buildPack, consolidate, type AccountInfo, type Pack } from '../accounting/mma.js';
import { commentaryEnabled, generateCommentary, packHash, type CommentaryResult } from '../accounting/commentary.js';
import { mmaWorkbook } from '../accounting/mma-xlsx.js';
import type { JournalEntry } from '../accounting/journal.js';
import { audit } from '../accounting/periods.js';
import { CAPEX, CLAIMABLE, FUEL, MONTH } from './reports.js';

const POSTED = `e.status IN ('confirmed', 'approved')`;
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const shift = (month: string, by: number) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + by, 1)).toISOString().slice(0, 7);

type Access = { error: { status: number; detail: string } } | { orgId: string; role: string };
interface JournalLike {
  ready: boolean; blockers: Pack['checklist']['blockers']; warnings: Pack['checklist']['warnings'];
  entries: JournalEntry[]; period: { status: string; closed_at: string | null; closed_by: string | null };
}

export function mountMma(r: Router, db: Db, deps: {
  access: (userId: string, orgId: unknown, write?: boolean) => Promise<Access>;
  journal: (orgId: string, month: string) => Promise<JournalLike>;
}) {
  async function propertyPack(orgId: string, month: string): Promise<Pack> {
    const [org, accts, current, prev, ly, revenueLines] = await Promise.all([
      one<{ organization_name: string; rooms: number | null }>(db, 'SELECT organization_name, rooms FROM organizations WHERE id = $1', [orgId]),
      all<AccountInfo>(db, 'SELECT code, name, role, type FROM accounts WHERE organization_id = $1', [orgId]),
      deps.journal(orgId, month),
      deps.journal(orgId, shift(month, -1)),
      deps.journal(orgId, shift(month, -12)),
      all<Record<string, any>>(db, `SELECT channel, net_amount, commission, room_nights FROM revenue_entries
        WHERE organization_id = $1 AND substr(date, 1, 7) = $2`, [orgId, month]),
    ]);
    const args = [orgId, month];
    const [advances, vatGaps, capexYtd] = await Promise.all([
      // Owed to people as at the month end: advanced on or before the month, not repaid by then
      all<Record<string, any>>(db,
        `SELECT COALESCE(NULLIF(e.paid_by, ''), 'Unknown') AS paid_by, COUNT(*)::int AS count, COALESCE(SUM(e.total_thb), 0) AS total, MIN(${MONTH}) AS oldest_month
         FROM expenses e WHERE e.organization_id = $1 AND ${POSTED} AND e.payment_source = 'advance' AND ${MONTH} <= $2
           AND (e.reimbursed_at IS NULL OR substr(e.reimbursed_at, 1, 7) > $2)
         GROUP BY 1 ORDER BY 3 DESC`, args),
      all<Record<string, any>>(db,
        `SELECT CASE WHEN e.vat_claim = 'no' THEN 'excluded' WHEN ${FUEL} AND e.vat_claim <> 'yes' THEN 'fuel' ELSE 'missing_tax_id' END AS reason,
                COUNT(*)::int AS count, SUM(e.tax_amount) AS vat
         FROM expenses e WHERE e.organization_id = $1 AND ${POSTED} AND ${MONTH} = $2 AND e.currency = 'THB' AND e.tax_amount > 0 AND NOT ${CLAIMABLE}
         GROUP BY 1 ORDER BY 3 DESC`, args),
      all<Record<string, any>>(db,
        `SELECT COALESCE(NULLIF(e.category, ''), 'Uncategorised') AS category,
                SUM(CASE WHEN ${CLAIMABLE} THEN e.total_thb - e.tax_amount ELSE e.total_thb END) AS amount
         FROM expenses e WHERE e.organization_id = $1 AND ${POSTED} AND ${CAPEX} AND e.total_thb IS NOT NULL
           AND ${MONTH} BETWEEN $3 AND $2
         GROUP BY 1 ORDER BY 2 DESC`, [orgId, month, `${month.slice(0, 4)}-01`]),
    ]);
    const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
    return buildPack({
      organization: { id: orgId, name: org?.organization_name ?? 'Property' },
      month,
      period: current.period,
      ready: current.ready,
      blockers: current.blockers,
      warnings: current.warnings,
      entries: current.entries,
      prevEntries: prev.entries,
      lyEntries: ly.entries,
      accounts: new Map(accts.map((a) => [a.code, a])),
      advancesOutstanding: advances.map((x) => ({ paid_by: x.paid_by, count: x.count, total: money(x.total), oldest_month: x.oldest_month })),
      vatNotClaimable: vatGaps.map((x) => ({ reason: x.reason, count: x.count, vat: money(x.vat) })),
      capexYtd: capexYtd.map((x) => ({ category: x.category, amount: money(x.amount) })),
      // A closed month's channels/room nights come from its locked revenue lines, so they match the frozen journal
      revenueLines: revenueLines.map((x) => ({ channel: x.channel, net_amount: Number(x.net_amount), commission: Number(x.commission), room_nights: x.room_nights == null ? null : Number(x.room_nights) })),
      rooms: org?.rooms ?? null,
    });
  }

  /** organization_id=<id> or "all" (every property the user belongs to). */
  type PackResult = { error: { status: number; detail: string } } | { pack: Pack; scopeKey: string };
  async function pack(userId: string, orgParam: unknown, month: string, write = false): Promise<PackResult> {
    if (orgParam === 'all') {
      const orgs = await all<{ organization_id: string; role: string }>(
        db, `SELECT m.organization_id, m.role FROM memberships m JOIN organizations o ON o.id = m.organization_id
             WHERE m.user_id = $1 ORDER BY o.created_at`, [userId]);
      if (write && orgs.some((o) => !['owner', 'admin'].includes(o.role))) {
        return { error: { status: 403, detail: 'Group commentary needs owner or admin on every property' } };
      }
      for (const o of orgs) await deps.access(userId, o.organization_id);
      const packs = [];
      for (const o of orgs) packs.push(await propertyPack(o.organization_id, month));
      return { pack: consolidate(packs, month), scopeKey: `all:${orgs.map((o) => o.organization_id).sort().join(',')}` };
    }
    const a = await deps.access(userId, orgParam, write);
    if ('error' in a) return a;
    return { pack: await propertyPack(a.orgId, month), scopeKey: a.orgId };
  }

  async function cachedCommentary(scopeKey: string, month: string, p: Pack) {
    const rows = await all<{ language: string; pack_hash: string; content: string }>(
      db, 'SELECT language, pack_hash, content FROM mma_commentary WHERE scope_key = $1 AND month = $2', [scopeKey, month]);
    const hash = packHash(p);
    const out: Record<string, CommentaryResult & { stale: boolean }> = {};
    for (const x of rows) out[x.language] = { ...JSON.parse(x.content), stale: x.pack_hash !== hash };
    return out;
  }

  // GET /accounting/mma?organization_id=<id|all>&month=YYYY-MM
  r.get('/mma', async (req, res) => {
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const result = await pack(req.user!.id, req.query.organization_id, req.query.month);
    if ('error' in result) return res.status(result.error.status).json({ detail: result.error.detail });
    res.json({
      ...result.pack,
      commentary: await cachedCommentary(result.scopeKey, req.query.month, result.pack),
      commentary_available: commentaryEnabled(),
    });
  });

  // POST /accounting/mma/commentary { organization_id, month, language: 'en' | 'th' }: owner/admin (it costs API usage)
  r.post('/mma/commentary', async (req, res) => {
    const body = req.body ?? {};
    if (!isMonth(body.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const language = body.language === 'th' ? 'th' : 'en';
    if (!commentaryEnabled()) return res.status(503).json({ detail: 'Claude is not configured on the server (ANTHROPIC_API_KEY)' });
    const result = await pack(req.user!.id, body.organization_id, body.month, true);
    if ('error' in result) return res.status(result.error.status).json({ detail: result.error.detail });
    if (!result.pack.summary.entries) return res.status(409).json({ detail: `No posted receipts in ${body.month} to comment on` });
    const commentary = await generateCommentary(result.pack, language);
    await db.query(
      `INSERT INTO mma_commentary (scope_key, month, language, pack_hash, content, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (scope_key, month, language) DO UPDATE SET pack_hash = $4, content = $5, created_by = $6, created_at = $7`,
      [result.scopeKey, body.month, language, packHash(result.pack), JSON.stringify(commentary), req.user!.id, now()],
    );
    for (const o of result.pack.organizations) {
      await audit(db, { orgId: o.id, userId: req.user!.id, action: 'commentary', entity: 'mma', month: body.month,
        detail: { language, scope: result.scopeKey.startsWith('all:') ? 'group' : 'property', removed: commentary.removed.length } });
    }
    res.json({ ...commentary, stale: false });
  });

  // GET /accounting/mma.xlsx?organization_id=<id|all>&month=YYYY-MM
  r.get('/mma.xlsx', async (req, res) => {
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const result = await pack(req.user!.id, req.query.organization_id, req.query.month);
    if ('error' in result) return res.status(result.error.status).json({ detail: result.error.detail });
    const commentary = await cachedCommentary(result.scopeKey, req.query.month, result.pack);
    const who = result.pack.organizations.length === 1 ? result.pack.organizations[0].name : 'All properties';
    const book = mmaWorkbook(result.pack, who, commentary.en ?? commentary.th ?? null);
    const buf = Buffer.from(await book.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${who} management accounts ${req.query.month}.xlsx`)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buf);
  });
}
