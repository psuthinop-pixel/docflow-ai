// Phase E: revenue lines per month (typed in from the PMS night audit / OTA statements, or pasted as CSV).
// Mounted inside the accounting router. Owner/admin only; closed months are locked like receipts.
import type { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { audit, closedMonths } from '../accounting/periods.js';
import { round2 } from '../accounting/journal.js';

type Access = { error: { status: number; detail: string } } | { orgId: string; role: string };

export interface RevenueRow {
  id: string; organization_id: string; date: string; account_code: string; channel: string; description: string;
  net_amount: number; vat_amount: number; commission: number; received_to: 'bank' | 'receivable'; room_nights: number | null;
}

const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[฿,\s]/g, '')));

/** Validate one line; a bare month (YYYY-MM) is dated the last day of that month. */
export function cleanRevenue(body: Record<string, unknown>, revenueCodes: Set<string>): string | Omit<RevenueRow, 'id' | 'organization_id'> {
  const rawDate = String(body.date ?? body.month ?? '').trim();
  const date = isMonth(rawDate) ? monthEnd(rawDate) : rawDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) return 'date must be YYYY-MM-DD (or a month YYYY-MM)';
  const account = String(body.account_code ?? body.account ?? '').trim();
  if (!revenueCodes.has(account)) return `account ${account || '(empty)'} is not an active revenue account`;
  const net = num(body.net_amount ?? body.net);
  if (!Number.isFinite(net)) return 'net amount must be a number';
  const vatRaw = body.vat_amount ?? body.vat;
  const vat = vatRaw === undefined || vatRaw === '' || vatRaw === null ? 0 : num(vatRaw);
  if (!Number.isFinite(vat)) return 'VAT must be a number';
  const comRaw = body.commission;
  const commission = comRaw === undefined || comRaw === '' || comRaw === null ? 0 : num(comRaw);
  if (!Number.isFinite(commission) || commission < 0) return 'commission must be zero or more';
  if (commission > round2(net + vat)) return 'commission cannot exceed the gross amount';
  const received = String(body.received_to ?? 'bank').trim() || 'bank';
  if (received !== 'bank' && received !== 'receivable') return "received_to must be 'bank' or 'receivable'";
  const rnRaw = body.room_nights;
  let roomNights: number | null = null;
  if (rnRaw !== undefined && rnRaw !== null && rnRaw !== '') {
    roomNights = Number(rnRaw);
    if (!Number.isInteger(roomNights) || roomNights < 0) return 'room nights must be a whole number';
  }
  return {
    date, account_code: account, channel: String(body.channel ?? '').trim().slice(0, 60),
    description: String(body.description ?? '').trim().slice(0, 200),
    net_amount: round2(net), vat_amount: round2(vat), commission: round2(commission), received_to: received, room_nights: roomNights,
  };
}

/** CSV with a header row: date,account,channel,description,net,vat,commission,room_nights,received_to (any order). */
export function parseRevenueCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  for (const raw of csv.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells: string[] = [];
    let cur = '', quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"' && raw[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',' || ch === '\t') { cells.push(cur.trim()); cur = ''; } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function mountRevenue(r: Router, db: Db, deps: { access: (userId: string, orgId: unknown, write?: boolean) => Promise<Access> }) {
  const revenueCodes = async (orgId: string) =>
    new Set((await all<{ code: string }>(db, `SELECT code FROM accounts WHERE organization_id = $1 AND type = 'revenue' AND active`, [orgId])).map((x) => x.code));
  const locked = async (orgId: string, dates: string[]) => {
    const closed = await closedMonths(db, orgId, dates.map((d) => d.slice(0, 7)));
    return closed.length ? `${closed.join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed. An owner must reopen the month to change its revenue.` : null;
  };
  const rowOut = (x: Record<string, any>) => ({
    ...x, _id: x.id, net_amount: Number(x.net_amount), vat_amount: Number(x.vat_amount), commission: Number(x.commission),
    room_nights: x.room_nights == null ? null : Number(x.room_nights),
  });

  // GET /accounting/revenue?organization_id=<id>&month=YYYY-MM
  r.get('/revenue', async (req, res) => {
    const a = await deps.access(req.user!.id, req.query.organization_id);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (!isMonth(req.query.month)) return res.status(400).json({ detail: 'month must be YYYY-MM' });
    const rows = await all<Record<string, any>>(db,
      `SELECT r.*, acc.name AS account_name FROM revenue_entries r
       LEFT JOIN accounts acc ON acc.organization_id = r.organization_id AND acc.code = r.account_code
       WHERE r.organization_id = $1 AND substr(r.date, 1, 7) = $2 ORDER BY r.date, r.created_at`, [a.orgId, req.query.month]);
    const org = await one<{ rooms: number | null }>(db, 'SELECT rooms FROM organizations WHERE id = $1', [a.orgId]);
    const closed = (await closedMonths(db, a.orgId, [req.query.month])).length > 0;
    res.json({ month: req.query.month, closed, rooms: org?.rooms ?? null, lines: rows.map(rowOut) });
  });

  // POST /accounting/revenue { organization_id, date|month, account_code, channel, description, net_amount, vat_amount, commission, received_to, room_nights }
  r.post('/revenue', async (req, res) => {
    const body = req.body ?? {};
    const a = await deps.access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    const line = cleanRevenue(body, await revenueCodes(a.orgId));
    if (typeof line === 'string') return res.status(400).json({ detail: line });
    const lock = await locked(a.orgId, [line.date]);
    if (lock) return res.status(423).json({ detail: lock });
    const id = newId();
    const ts = now();
    await db.query(
      `INSERT INTO revenue_entries (id, organization_id, date, account_code, channel, description, net_amount, vat_amount, commission, received_to, room_nights, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [id, a.orgId, line.date, line.account_code, line.channel, line.description, line.net_amount, line.vat_amount, line.commission, line.received_to, line.room_nights, req.user!.id, ts],
    );
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'create', entity: 'revenue', entityId: id, month: line.date.slice(0, 7), detail: line });
    res.status(201).json(rowOut((await one(db, 'SELECT * FROM revenue_entries WHERE id = $1', [id]))!));
  });

  // PUT /accounting/revenue/:id (full line, same fields as POST)
  r.put('/revenue/:id', async (req, res) => {
    const existing = await one<RevenueRow>(db, 'SELECT * FROM revenue_entries WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ detail: 'Revenue line not found' });
    const a = await deps.access(req.user!.id, existing.organization_id, true);
    if ('error' in a) return res.status(a.error.status === 403 ? 404 : a.error.status).json({ detail: a.error.status === 403 ? 'Revenue line not found' : a.error.detail });
    const wasLocked = await locked(a.orgId, [existing.date]);
    if (wasLocked) return res.status(423).json({ detail: wasLocked });
    const line = cleanRevenue({ ...existing, ...(req.body ?? {}) }, await revenueCodes(a.orgId));
    if (typeof line === 'string') return res.status(400).json({ detail: line });
    const lock = await locked(a.orgId, [line.date]);
    if (lock) return res.status(423).json({ detail: lock });
    await db.query(
      `UPDATE revenue_entries SET date = $2, account_code = $3, channel = $4, description = $5, net_amount = $6, vat_amount = $7,
         commission = $8, received_to = $9, room_nights = $10, updated_at = $11 WHERE id = $1`,
      [existing.id, line.date, line.account_code, line.channel, line.description, line.net_amount, line.vat_amount, line.commission, line.received_to, line.room_nights, now()],
    );
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'update', entity: 'revenue', entityId: existing.id, month: line.date.slice(0, 7), detail: { before: existing, after: line } });
    res.json(rowOut((await one(db, 'SELECT * FROM revenue_entries WHERE id = $1', [existing.id]))!));
  });

  r.delete('/revenue/:id', async (req, res) => {
    const existing = await one<RevenueRow>(db, 'SELECT * FROM revenue_entries WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ detail: 'Revenue line not found' });
    const a = await deps.access(req.user!.id, existing.organization_id, true);
    if ('error' in a) return res.status(a.error.status === 403 ? 404 : a.error.status).json({ detail: a.error.status === 403 ? 'Revenue line not found' : a.error.detail });
    const lock = await locked(a.orgId, [existing.date]);
    if (lock) return res.status(423).json({ detail: lock });
    await db.query('DELETE FROM revenue_entries WHERE id = $1', [existing.id]);
    await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'delete', entity: 'revenue', entityId: existing.id, month: existing.date.slice(0, 7), detail: existing });
    res.status(204).end();
  });

  // POST /accounting/revenue/import { organization_id, csv }: all lines are checked first; nothing is saved if any line is wrong
  r.post('/revenue/import', async (req, res) => {
    const body = req.body ?? {};
    const a = await deps.access(req.user!.id, body.organization_id, true);
    if ('error' in a) return res.status(a.error.status).json({ detail: a.error.detail });
    if (typeof body.csv !== 'string' || !body.csv.trim()) return res.status(400).json({ detail: 'Paste CSV with a header row' });
    const parsed = parseRevenueCsv(body.csv);
    if (!parsed.length) return res.status(400).json({ detail: 'No data rows under the header' });
    if (parsed.length > 500) return res.status(400).json({ detail: 'At most 500 lines per import' });
    const codes = await revenueCodes(a.orgId);
    const lines: Omit<RevenueRow, 'id' | 'organization_id'>[] = [];
    const errors: string[] = [];
    parsed.forEach((row, i) => {
      const l = cleanRevenue(row, codes);
      if (typeof l === 'string') errors.push(`Line ${i + 2}: ${l}`);
      else lines.push(l);
    });
    if (errors.length) return res.status(400).json({ detail: errors.slice(0, 10).join('; '), errors });
    const lock = await locked(a.orgId, lines.map((l) => l.date));
    if (lock) return res.status(423).json({ detail: lock });
    const ts = now();
    for (const l of lines) {
      await db.query(
        `INSERT INTO revenue_entries (id, organization_id, date, account_code, channel, description, net_amount, vat_amount, commission, received_to, room_nights, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [newId(), a.orgId, l.date, l.account_code, l.channel, l.description, l.net_amount, l.vat_amount, l.commission, l.received_to, l.room_nights, req.user!.id, ts],
      );
    }
    const months = [...new Set(lines.map((l) => l.date.slice(0, 7)))];
    for (const m of months) {
      const these = lines.filter((l) => l.date.startsWith(m));
      await audit(db, { orgId: a.orgId, userId: req.user!.id, action: 'import', entity: 'revenue', month: m,
        detail: { lines: these.length, net: round2(these.reduce((t, l) => t + l.net_amount, 0)) } });
    }
    res.status(201).json({ imported: lines.length, months });
  });
}
