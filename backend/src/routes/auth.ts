import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, type Db } from '../db.js';
import { requireAuth, signToken } from '../auth.js';
import { now } from '../db.js';

export function authRouter(db: Db): Router {
  const r = Router();
  // These routes stay open while a temporary password is pending, so it can be replaced.
  const auth = requireAuth(db, { allowPasswordChange: true });

  r.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ detail: 'Email and password are required' });
    }
    const user = await one<{
      id: string; email: string; name: string; password_hash: string;
      must_change_password: boolean; temp_password_expires_at: string | null;
    }>(
      db,
      'SELECT id, email, name, password_hash, must_change_password, temp_password_expires_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ detail: 'Invalid email or password' });
    }
    if (user.must_change_password && user.temp_password_expires_at && Date.parse(user.temp_password_expires_at) < Date.now()) {
      return res.status(401).json({
        detail: 'This temporary password has expired. Ask the person who invited you for a new one.',
        code: 'temporary_password_expired',
      });
    }
    res.json({ auth: signToken(user), must_change_password: user.must_change_password });
  });

  r.get('/me', auth, async (req, res) => {
    const user = await one<Record<string, unknown>>(
      db, 'SELECT id, email, name, created_at, must_change_password FROM users WHERE id = $1', [req.user!.id],
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
    if (new_password === current_password) return res.status(400).json({ detail: 'Choose a password different from the current one' });
    // Clears the invite state and signs out every other session: requireAuth rejects tokens issued
    // before password_changed_at (compared in whole seconds, so the token issued below stays valid).
    await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, temp_password_expires_at = NULL, password_changed_at = $2
       WHERE id = $3`,
      [bcrypt.hashSync(new_password, 10), now(), req.user!.id],
    );
    const me = await one<{ id: string; email: string; name: string }>(db, 'SELECT id, email, name FROM users WHERE id = $1', [req.user!.id]);
    res.json({ ok: true, auth: signToken(me!) });
  });

  r.post('/logout', auth, async (req, res) => {
    const { jti, exp } = req.user!;
    await db.query('INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [jti, exp]);
    await db.query('DELETE FROM revoked_tokens WHERE expires_at < $1', [Math.floor(Date.now() / 1000)]);
    res.json({ ok: true });
  });

  return r;
}
