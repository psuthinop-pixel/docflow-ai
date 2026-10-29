import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import type { Db } from './db.js';

export interface AuthUser { id: string; email: string; name: string; jti: string; exp: number }

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

export function requireAuth(db: Db) {
  const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ detail: 'Not authenticated' });
    try {
      const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
      if (!p.sub || !p.jti || isRevoked.get(p.jti)) throw new Error('revoked');
      req.user = { id: p.sub, email: p.email, name: p.name, jti: p.jti, exp: p.exp ?? 0 };
      next();
    } catch {
      res.status(401).json({ detail: 'Session expired' });
    }
  };
}

/** Role of the current user in an organization, or undefined if not a member. */
export function membershipRole(db: Db, userId: string, orgId: string): string | undefined {
  const row = db
    .prepare('SELECT role FROM memberships WHERE user_id = ? AND organization_id = ?')
    .get(userId, orgId) as { role: string } | undefined;
  return row?.role;
}
