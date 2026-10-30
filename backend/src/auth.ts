import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { one, type Db } from './db.js';

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
    try {
      if (await one(db, 'SELECT 1 FROM revoked_tokens WHERE jti = $1', [p.jti])) {
        return res.status(401).json({ detail: 'Session expired' });
      }
    } catch (err) {
      return next(err);
    }
    req.user = { id: p.sub, email: p.email, name: p.name, jti: p.jti, exp: p.exp ?? 0 };
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
