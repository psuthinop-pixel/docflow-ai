import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, type Db } from '../db.js';
import { requireAuth, signToken } from '../auth.js';

export function authRouter(db: Db): Router {
  const r = Router();
  const auth = requireAuth(db);

  r.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ detail: 'Email and password are required' });
    }
    const user = await one<{ id: string; email: string; name: string; password_hash: string }>(
      db, 'SELECT id, email, name, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()],
    );
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ detail: 'Invalid email or password' });
    }
    res.json({ auth: signToken(user) });
  });

  r.get('/me', auth, async (req, res) => {
    const user = await one<Record<string, unknown>>(
      db, 'SELECT id, email, name, created_at FROM users WHERE id = $1', [req.user!.id],
    );
    if (!user) return res.status(401).json({ detail: 'Session expired' });
    res.json({ ...user, _id: user.id });
  });

  // Needed after an invite: new accounts start with a one-time password.
  r.post('/password', auth, async (req, res) => {
    const { current_password, new_password } = req.body ?? {};
    if (typeof current_password !== 'string' || typeof new_password !== 'string') {
      return res.status(400).json({ detail: 'Current and new password are required' });
    }
    if (new_password.length < 8) return res.status(400).json({ detail: 'New password must be at least 8 characters' });
    const user = await one<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(400).json({ detail: 'Current password is incorrect' });
    }
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(new_password, 10), req.user!.id]);
    res.json({ ok: true });
  });

  r.post('/logout', auth, async (req, res) => {
    const { jti, exp } = req.user!;
    await db.query('INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [jti, exp]);
    await db.query('DELETE FROM revoked_tokens WHERE expires_at < $1', [Math.floor(Date.now() / 1000)]);
    res.json({ ok: true });
  });

  return r;
}
