import { Router } from 'express';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';

const STATUSES = ['draft', 'confirmed', 'approved', 'disabled'];
const APPROVERS = ['owner', 'admin'];
const EDITABLE = [
  'status', 'vendor_name', 'vendor_address', 'vendor_taxid', 'date',
  'total', 'subtotal', 'tax_amount', 'currency', 'category', 'notes', 'invoice_number', 'receipt_id',
] as const;

type ExpenseRow = Record<string, unknown> & { id: string; organization_id: string };

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
    db
      .prepare(
        `SELECT e.* FROM expenses e
         JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = ?
         WHERE e.id = ?`,
      )
      .get(userId, id) as ExpenseRow | undefined;

  /** Role and receipt checks shared by create and update. */
  const checkWrite = (orgId: string, role: string, fields: Fields) => {
    if (fields.status === 'approved' && !APPROVERS.includes(role)) {
      return { status: 403, detail: 'Only an owner or admin can approve expenses' };
    }
    if (fields.receipt_id) {
      const receipt = db.prepare('SELECT organization_id FROM receipts WHERE id = ?').get(fields.receipt_id) as
        | { organization_id: string } | undefined;
      if (!receipt || receipt.organization_id !== orgId) return { status: 400, detail: 'receipt_id is not a receipt of this organization' };
    }
    return null;
  };

  /** Same receipt file, or same seller tax ID + invoice number, already recorded in this organization. */
  const findDuplicates = (orgId: string, fields: Fields) => {
    const taxid = String(fields.vendor_taxid ?? '');
    const inv = String(fields.invoice_number ?? '');
    const receiptId = fields.receipt_id ? String(fields.receipt_id) : '';
    return db
      .prepare(
        `SELECT e.id, e.vendor_name, e.invoice_number, e.total, e.date FROM expenses e
         LEFT JOIN receipts r ON r.id = e.receipt_id
         WHERE e.organization_id = ? AND (
           (? != '' AND ? != '' AND e.vendor_taxid = ? AND e.invoice_number = ?)
           OR (? != '' AND r.sha256 = (SELECT sha256 FROM receipts WHERE id = ?))
         )`,
      )
      .all(orgId, taxid, inv, taxid, inv, receiptId, receiptId);
  };

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
    const role = membershipRole(db, req.user!.id, orgId)!;
    const fields = clean(body);
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });
    const problem = checkWrite(orgId, role, fields);
    if (problem) return res.status(problem.status).json({ detail: problem.detail });

    if (body.allow_duplicate !== true) {
      const dups = findDuplicates(orgId, fields);
      if (dups.length) {
        return res.status(409).json({ detail: 'This receipt looks like it was already recorded', duplicates: dups });
      }
    }
    if (fields.status === 'approved') Object.assign(fields, { approved_by: req.user!.id, approved_at: now() });

    const id = newId();
    const ts = now();
    const cols = ['id', 'organization_id', 'created_by', 'created_at', 'updated_at', ...Object.keys(fields)];
    const vals = [id, orgId, req.user!.id, ts, ts, ...Object.values(fields)];
    db.prepare(`INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    res.status(201).json(toApi(findOwned(id, req.user!.id)!));
  });

  r.put('/:id', (req, res) => {
    const existing = findOwned(req.params.id, req.user!.id);
    if (!existing) return res.status(404).json({ detail: 'Expense not found' });
    const role = membershipRole(db, req.user!.id, existing.organization_id)!;
    const fields = clean(req.body ?? {});
    if (typeof fields === 'string') return res.status(400).json({ detail: fields });
    if (existing.status === 'approved' && !APPROVERS.includes(role)) {
      return res.status(403).json({ detail: 'Approved expenses can only be changed by an owner or admin' });
    }
    const problem = checkWrite(existing.organization_id, role, fields);
    if (problem) return res.status(problem.status).json({ detail: problem.detail });
    if (fields.status === 'approved' && existing.status !== 'approved') {
      Object.assign(fields, { approved_by: req.user!.id, approved_at: now() });
    } else if (fields.status && fields.status !== 'approved') {
      Object.assign(fields, { approved_by: null, approved_at: null });
    }
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE expenses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
        ...Object.values(fields), now(), req.params.id,
      );
    }
    res.json(toApi(findOwned(req.params.id, req.user!.id)!));
  });

  r.delete('/:id', (req, res) => {
    const existing = findOwned(req.params.id, req.user!.id);
    if (!existing) return res.status(404).json({ detail: 'Expense not found' });
    if (existing.status === 'approved' && !APPROVERS.includes(membershipRole(db, req.user!.id, existing.organization_id)!)) {
      return res.status(403).json({ detail: 'Approved expenses can only be deleted by an owner or admin' });
    }
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return r;
}
