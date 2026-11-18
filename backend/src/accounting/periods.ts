// Bookkeeping, Phase C: closed months and the audit log (docs/ACCOUNTING.md).
import type { Db } from '../db.js';
import { all, newId, now } from '../db.js';

/** The month an expense belongs to: receipt date, else when it was recorded (same rule as reports' MONTH). */
export const monthOf = (row: Record<string, unknown>) =>
  String((row.date as string) || (row.created_at as string) || '').slice(0, 7);

const reimbMonth = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 7) : null);

export async function closedMonths(db: Db, orgId: string, months: (string | null)[]): Promise<string[]> {
  const list = [...new Set(months.filter((m): m is string => !!m))];
  if (!list.length) return [];
  const rows = await all<{ month: string }>(
    db, `SELECT month FROM periods WHERE organization_id = $1 AND status = 'closed' AND month = ANY($2::text[])`, [orgId, list],
  );
  return rows.map((x) => x.month).sort();
}

/** Fields whose value really changes (the review form re-sends every field on each save). */
export function changedFields(existing: Record<string, unknown>, fields: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const blank = (v: unknown) => v === null || v === undefined || v === '';
  const numeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
  const same = (a: unknown, b: unknown) =>
    (blank(a) && blank(b)) || (numeric(a) && numeric(b) ? Number(a) === Number(b) : String(a ?? '') === String(b ?? ''));
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'approved_by' || k === 'approved_at') continue;
    if (!same(existing[k], v)) out[k] = { from: existing[k] ?? null, to: v ?? null };
  }
  return out;
}

/**
 * Refuse a change that would alter a closed month's books. Paying back an advance only touches the month it is
 * repaid in, so recording a reimbursement for a receipt from a closed month is allowed.
 */
export async function lockProblem(
  db: Db, orgId: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null,
  changed?: string[],
): Promise<{ status: number; detail: string } | null> {
  const onlyReimbursement = before && after && changed && changed.length > 0 && changed.every((k) => k === 'reimbursed_at');
  if (before && after && changed && changed.length === 0) return null;
  const months = onlyReimbursement
    ? [reimbMonth(before!.reimbursed_at), reimbMonth(after!.reimbursed_at)]
    : [before && monthOf(before), after && monthOf(after), before && reimbMonth(before.reimbursed_at), after && reimbMonth(after.reimbursed_at)];
  const closed = await closedMonths(db, orgId, months);
  if (!closed.length) return null;
  return { status: 423, detail: `${closed.join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed. An owner must reopen the month before this receipt can change.` };
}

export async function audit(
  db: Db,
  e: { orgId: string; userId: string; action: string; entity: string; entityId?: string | null; month?: string | null; detail?: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, organization_id, user_id, action, entity, entity_id, month, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [newId(), e.orgId, e.userId, e.action, e.entity, e.entityId ?? null, e.month ?? null, JSON.stringify(e.detail ?? {}), now()],
  );
}
