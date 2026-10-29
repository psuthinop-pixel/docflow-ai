import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Db } from '../db.js';
import { requireAuth, signToken } from '../auth.js';

export function authRouter(db: Db): Router {
  const r = Router();
  const auth = requireAuth(db);

  r.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ detail: 'Email and password are required' });
    }
    const user = db
      .prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as
      | { id: string; email: string; name: string; password_hash: string }
      | undefined;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ detail: 'Invalid email or password' });
    }
    res.json({ auth: signToken(user) });
  });

  r.get('/me', auth, (req, res) => {
    const user = db
      .prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .get(req.user!.id) as Record<string, unknown> | undefined;
    if (!user) return res.status(401).json({ detail: 'Session expired' });
    res.json({ ...user, _id: user.id });
  });

  r.post('/logout', auth, (req, res) => {
    const { jti, exp } = req.user!;
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, exp);
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
    res.json({ ok: true });
  });

  return r;
}
