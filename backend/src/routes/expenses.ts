import { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';

const STATUSES = ['draft', 'confirmed', 'approved', 'disabled'];
const APPROVERS = ['owner', 'admin'];
const EDITABLE = [
  'status', 'vendor_name', 'vendor_address', 'vendor_taxid', 'date',
  'total', 'subtotal', 'tax_amount', 'currency', 'category', 'notes', 'invoice_number', 'receipt_id',
] as const;

type ExpenseRow = Record<string, unknown> & { id: string; organization_id: string; status: string };

/** Validate and normalise editable fields. Returns an error message or the cleaned fields. */
function clean(body: Record<string, unknown>): string | Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    const v = body[key];
    if (key === 'subtotal' && (v === null || v === '')) { out.subtotal = null; continue; }
    if (key === 'receipt_id') { out.receipt_id = v ? String(v) : null; continue; }
    if (key === 'total' || key === 'tax_amount' || key === 'subtotal') {
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

type Fields = Record<string, string | number | null>;

export function expensesRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  const findOwned = (id: string, userId: string) =>
    one<ExpenseRow>(
      db,
      `SELECT e.* FROM expenses e
       JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = $1
       WHERE e.id = $2`,
      [userId, id],
    );

  /** Role and receipt checks shared by create and update. */
  const checkWrite = async (orgId: string, role: string, fields: Fields) => {
    if (fields.status === 'approved' && !APPROVERS.includes(role)) {
      return { status: 403, detail: 'Only an owner or admin can approve expenses' };
    }
    if (fields.receipt_id) {
      const receipt = await one<{ organization_id: string }>(
        db, 'SELECT organization_id FROM receipts WHERE id = $1', [fields.receipt_id],
      );
      if (!receipt || receipt.organization_id !== orgId) return { status: 400, detail: 'receipt_id is not a receipt of this organization' };
    }
    return null;
  };

  /** Same receipt file, or same seller tax ID + invoice number, already recorded in this organization. */
  const findDuplicates = (orgId: string, fields: Fields) => {
    const taxid = String(fields.vendor_taxid ?? '');
    const inv = String(fields.invoice_number ?? '');
    const receiptId = fields.receipt_id ? String(fields.receipt_id) : '';
    return all(
      db,
      `SELECT e.id, e.vendor_name, e.invoice_number, e.total, e.date FROM expenses e
       LEFT JOIN receipts r ON r.id = e.receipt_id
       WHERE e.organization_id = $1 AND (
         ($2 != '' AND $3 != '' AND e.vendor_taxid = $2 AND e.invoice_number = $3)
         OR ($4 != '' AND r.sha256 = (SELECT sha256 FROM receipts WHERE id = $4))
       )`,
      [orgId, taxid, inv, receiptId],
    );
  };

  r.get('/', async (req, res) => {
    const orgId = req.query.organization_id;
    if (typeof orgId === 'string' && orgId) {
      if (!(await membershipRole(db, req.user!.id, orgId))) return res.status(403).json({ detail: 'Not a member of this organization' });
      // ?sort=updated lists the most recently changed first (activity feeds); ?limit caps the rows
      const order = req.query.sort === 'updated' ? 'updated_at DESC' : 'date DESC NULLS LAST, created_at DESC';
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || 0, 0), 500);
      const rows = await all<ExpenseRow>(
        db,
        `SELECT * FROM expenses WHERE organization_id = $1 ORDER BY ${order}${limit ? ` LIMIT ${limit}` : ''}`,
        [orgId],
      );
      return res.json(rows.map(toApi));
    }
    const rows = await all<ExpenseRow>(
      db,
      `SELECT e.* FROM expenses e
       JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = $1
       ORDER BY e.date DESC NULLS LAST, e.created_at DESC`,
      [req.user!.id],
    );
    res.json(rows.map(toApi));
  });

  r.post('/', async (req, res) => {
    const body = req.body ?? {};
    const orgId = body.organization_id;
    if (typeof orgId !== 'string' || !orgId) return res.status(400).json({ detail: 'organization_id is required' });
    const role = await membershipRole(db, req.user!.id, orgId);
    if (!role) return res.status(403).json({ detail: 'Not a member of this organization' });
    const fields = clean(body);
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });
    const problem = await checkWrite(orgId, role, fields);
    if (problem) return res.status(problem.status).json({ detail: problem.detail });

    if (body.allow_duplicate !== true) {
      const dups = await findDuplicates(orgId, fields);
      if (dups.length) {
        return res.status(409).json({ detail: 'This receipt looks like it was already recorded', duplicates: dups });
      }
    }
    if (fields.status === 'approved') Object.assign(fields, { approved_by: req.user!.id, approved_at: now() });

    const id = newId();
    const ts = now();
    const cols = ['id', 'organization_id', 'created_by', 'created_at', 'updated_at', ...Object.keys(fields)];
    const vals = [id, orgId, req.user!.id, ts, ts, ...Object.values(fields)];
    await db.query(`INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
    res.status(201).json(toApi((await findOwned(id, req.user!.id))!));
  });

  r.put('/:id', async (req, res) => {
    const existing = await findOwned(req.params.id, req.user!.id);
    if (!existing) return res.status(404).json({ detail: 'Expense not found' });
    const role = (await membershipRole(db, req.user!.id, existing.organization_id))!;
    const fields = clean(req.body ?? {});
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });
    if (existing.status === 'approved' && !APPROVERS.includes(role)) {
      return res.status(403).json({ detail: 'Approved expenses can only be changed by an owner or admin' });
    }
    const problem = await checkWrite(existing.organization_id, role, fields);
    if (problem) return res.status(problem.status).json({ detail: problem.detail });
    if (fields.status === 'approved' && existing.status !== 'approved') {
      Object.assign(fields, { approved_by: req.user!.id, approved_at: now() });
    } else if (fields.status && fields.status !== 'approved') {
      Object.assign(fields, { approved_by: null, approved_at: null });
    }
    const keys = Object.keys(fields);
    if (keys.length) {
      await db.query(
        `UPDATE expenses SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
        [...Object.values(fields), now(), req.params.id],
      );
    }
    res.json(toApi((await findOwned(req.params.id, req.user!.id))!));
  });

  r.delete('/:id', async (req, res) => {
    const existing = await findOwned(req.params.id, req.user!.id);
    if (!existing) return res.status(404).json({ detail: 'Expense not found' });
    if (existing.status === 'approved' && !APPROVERS.includes((await membershipRole(db, req.user!.id, existing.organization_id))!)) {
      return res.status(403).json({ detail: 'Approved expenses can only be deleted by an owner or admin' });
    }
    await db.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.status(204).end();
  });

  return r;
}
