import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { one, type Db } from './db.js';

export interface AuthUser { id: string; email: string; name: string; jti: string; exp: number; mustChangePassword: boolean }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export function signToken(user: { id: string; email: string; name: string }): string {
  return jwt.sign({ email: user.email, name: user.name }, config.jwtSecret, {
    subject: user.id,
    jwtid: randomUUID(),
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** How long an invite's temporary password works. */
export const TEMP_PASSWORD_DAYS = 7;

/**
 * Verify the bearer token. Rejects revoked tokens, tokens issued before the user's last password
 * change, and — unless `allowPasswordChange` — users who still have to replace a temporary password.
 */
export function requireAuth(db: Db, { allowPasswordChange = false } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ detail: 'Not authenticated' });
    let p: jwt.JwtPayload;
    try {
      p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
      if (!p.sub || !p.jti) throw new Error('invalid');
    } catch {
      return res.status(401).json({ detail: 'Session expired' });
    }
    let row: { revoked: boolean; must_change_password: boolean; password_changed_at: string | null } | undefined;
    try {
      // One round trip: the user row (gone → 401) plus whether this token was revoked.
      row = await one(
        db,
        `SELECT EXISTS (SELECT 1 FROM revoked_tokens WHERE jti = $1) AS revoked, must_change_password, password_changed_at
         FROM users WHERE id = $2`,
        [p.jti, p.sub],
      );
    } catch (err) {
      return next(err);
    }
    if (!row || row.revoked) return res.status(401).json({ detail: 'Session expired' });
    if (row.password_changed_at && (p.iat ?? 0) < Math.floor(Date.parse(row.password_changed_at) / 1000)) {
      return res.status(401).json({ detail: 'Session expired' });
    }
    if (row.must_change_password && !allowPasswordChange) {
      return res.status(403).json({ detail: 'Set a new password before continuing', code: 'password_change_required' });
    }
    req.user = { id: p.sub, email: p.email, name: p.name, jti: p.jti, exp: p.exp ?? 0, mustChangePassword: row.must_change_password };
    next();
  };
}

/** Role of the current user in an organization, or undefined if not a member. */
export async function membershipRole(db: Db, userId: string, orgId: string): Promise<string | undefined> {
  const row = await one<{ role: string }>(
    db, 'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2', [userId, orgId],
  );
  return row?.role;
}
