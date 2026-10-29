import { Router } from 'express';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';

const STATUSES = ['draft', 'confirmed', 'disabled'];
const EDITABLE = [
  'status', 'vendor_name', 'vendor_address', 'vendor_taxid', 'date',
  'total', 'tax_amount', 'currency', 'category', 'notes',
] as const;

type ExpenseRow = Record<string, unknown> & { id: string; organization_id: string };

/** Validate and normalise editable fields. Returns an error message or the cleaned fields. */
function clean(body: Record<string, unknown>): string | Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    const v = body[key];
    if (key === 'total' || key === 'tax_amount') {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[฿,\s]/g, ''));
      if (!Number.isFinite(n)) return `${key} must be a number`;
      out[key] = n;
    } else if (key === 'date') {
      if (v === null || v === '') { out.date = null; continue; }
      const d = new Date(String(v));
      if (isNaN(d.getTime())) return 'date is invalid';
      out.date = d.toISOString();
    } else if (key === 'status') {
      if (!STATUSES.includes(String(v))) return `status must be one of ${STATUSES.join(', ')}`;
      out.status = String(v);
    } else {
      out[key] = v == null ? '' : String(v);
    }
  }
  return out;
}

const toApi = (e: ExpenseRow) => ({ ...e, _id: e.id });

export function expensesRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  const findOwned = (id: string, userId: string) =>
    db
      .prepare(
        `SELECT e.* FROM expenses e
         JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = ?
         WHERE e.id = ?`,
      )
      .get(userId, id) as ExpenseRow | undefined;

  r.get('/', (req, res) => {
    const orgId = req.query.organization_id;
    if (typeof orgId === 'string' && orgId) {
      if (!membershipRole(db, req.user!.id, orgId)) return res.status(403).json({ detail: 'Not a member of this organization' });
      const rows = db
        .prepare('SELECT * FROM expenses WHERE organization_id = ? ORDER BY date DESC, created_at DESC')
        .all(orgId) as ExpenseRow[];
      return res.json(rows.map(toApi));
    }
    const rows = db
      .prepare(
        `SELECT e.* FROM expenses e
         JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = ?
         ORDER BY e.date DESC, e.created_at DESC`,
      )
      .all(req.user!.id) as ExpenseRow[];
    res.json(rows.map(toApi));
  });

  r.post('/', (req, res) => {
    const body = req.body ?? {};
    const orgId = body.organization_id;
    if (typeof orgId !== 'string' || !orgId) return res.status(400).json({ detail: 'organization_id is required' });
    if (!membershipRole(db, req.user!.id, orgId)) return res.status(403).json({ detail: 'Not a member of this organization' });
    const fields = clean(body);
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });

    const id = newId();
    const ts = now();
    const cols = ['id', 'organization_id', 'created_by', 'created_at', 'updated_at', ...Object.keys(fields)];
    const vals = [id, orgId, req.user!.id, ts, ts, ...Object.values(fields)];
    db.prepare(`INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    res.status(201).json(toApi(findOwned(id, req.user!.id)!));
  });

  r.put('/:id', (req, res) => {
    if (!findOwned(req.params.id, req.user!.id)) return res.status(404).json({ detail: 'Expense not found' });
    const fields = clean(req.body ?? {});
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE expenses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
        ...Object.values(fields), now(), req.params.id,
      );
    }
    res.json(toApi(findOwned(req.params.id, req.user!.id)!));
  });

  r.delete('/:id', (req, res) => {
    if (!findOwned(req.params.id, req.user!.id)) return res.status(404).json({ detail: 'Expense not found' });
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return r;
}
