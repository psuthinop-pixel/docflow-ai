import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';

export const ROLES = ['owner', 'admin', 'member'] as const;
type Role = (typeof ROLES)[number];

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
const isEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Readable one-time password: no 0/O/1/l/I, grouped for reading aloud. */
function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}

/**
 * Who may do what to whom:
 * - owners manage everyone, including other owners;
 * - admins manage admins and members, never owners, and cannot grant owner;
 * - anyone may remove themselves (leave);
 * - an organization always keeps at least one owner.
 */
function canManage(actor: string, target: string | undefined, newRole?: Role): boolean {
  if (actor === 'owner') return true;
  if (actor !== 'admin') return false;
  return target !== 'owner' && newRole !== 'owner';
}

async function ownerCount(db: Db, orgId: string): Promise<number> {
  const row = await one<{ n: string }>(
    db, `SELECT COUNT(*) AS n FROM memberships WHERE organization_id = $1 AND role = 'owner'`, [orgId],
  );
  return Number(row?.n ?? 0);
}

// Mounted under /organizations/:id/members, so :id comes from the parent route
const params = (req: Request) => req.params as Record<string, string>;

export function membersRouter(db: Db): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth(db));

  // Any member can see who else is in the organization.
  r.get('/', async (req, res) => {
    const orgId = params(req).id;
    if (!(await membershipRole(db, req.user!.id, orgId))) return res.status(404).json({ detail: 'Organization not found' });
    const rows = await all(
      db,
      `SELECT u.id AS user_id, u.name, u.email, m.role FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
      [orgId],
    );
    res.json(rows);
  });

  // Add someone by email. Unknown emails get a new account with a one-time password,
  // returned once so the inviter can pass it on (there is no email delivery yet).
  r.post('/', async (req, res) => {
    const orgId = params(req).id;
    const actor = await membershipRole(db, req.user!.id, orgId);
    if (!actor) return res.status(404).json({ detail: 'Organization not found' });

    const { email, name, role = 'member' } = req.body ?? {};
    if (!isEmail(email)) return res.status(400).json({ detail: 'A valid email is required' });
    if (!isRole(role)) return res.status(400).json({ detail: `role must be one of ${ROLES.join(', ')}` });
    if (!canManage(actor, undefined, role)) {
      return res.status(403).json({ detail: role === 'owner' ? 'Only an owner can add another owner' : 'Only an owner or admin can add members' });
    }

    const addr = email.trim().toLowerCase();
    let user = await one<{ id: string; name: string }>(db, 'SELECT id, name FROM users WHERE email = $1', [addr]);
    let temporary_password: string | undefined;
    if (!user) {
      const display = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : addr.split('@')[0];
      temporary_password = tempPassword();
      const id = newId();
      await db.query(
        'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, addr, display, bcrypt.hashSync(temporary_password, 10), now()],
      );
      user = { id, name: display };
    } else if (await membershipRole(db, user.id, orgId)) {
      return res.status(409).json({ detail: `${addr} is already a member` });
    }

    await db.query('INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)', [user.id, orgId, role]);
    res.status(201).json({
      user_id: user.id, name: user.name, email: addr, role,
      ...(temporary_password ? { temporary_password } : {}),
    });
  });

  r.put('/:userId', async (req, res) => {
    const { id: orgId, userId } = params(req);
    const actor = await membershipRole(db, req.user!.id, orgId);
    if (!actor) return res.status(404).json({ detail: 'Organization not found' });
    const target = await membershipRole(db, userId, orgId);
    if (!target) return res.status(404).json({ detail: 'Member not found' });

    const { role } = req.body ?? {};
    if (!isRole(role)) return res.status(400).json({ detail: `role must be one of ${ROLES.join(', ')}` });
    if (!canManage(actor, target, role)) return res.status(403).json({ detail: 'You cannot change this member’s role' });
    if (target === 'owner' && role !== 'owner' && (await ownerCount(db, orgId)) <= 1) {
      return res.status(409).json({ detail: 'Every property needs at least one owner. Make someone else owner first.' });
    }

    await db.query('UPDATE memberships SET role = $1 WHERE user_id = $2 AND organization_id = $3', [role, userId, orgId]);
    res.json({ user_id: userId, role });
  });

  r.delete('/:userId', async (req, res) => {
    const { id: orgId, userId } = params(req);
    const actor = await membershipRole(db, req.user!.id, orgId);
    if (!actor) return res.status(404).json({ detail: 'Organization not found' });
    const target = await membershipRole(db, userId, orgId);
    if (!target) return res.status(404).json({ detail: 'Member not found' });

    const self = userId === req.user!.id;
    if (!self && !canManage(actor, target)) return res.status(403).json({ detail: 'You cannot remove this member' });
    if (target === 'owner' && (await ownerCount(db, orgId)) <= 1) {
      return res.status(409).json({ detail: 'Every property needs at least one owner. Make someone else owner first.' });
    }

    await db.query('DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2', [userId, orgId]);
    res.status(204).end();
  });

  return r;
}
