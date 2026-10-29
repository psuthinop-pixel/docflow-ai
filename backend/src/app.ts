import express from 'express';
import cors from 'cors';
import type { Db } from './db.js';
import { authRouter } from './routes/auth.js';
import { organizationsRouter } from './routes/organizations.js';
import { expensesRouter } from './routes/expenses.js';

export function createApp(db: Db, corsOrigins: string[] = []) {
  const app = express();
  const patterns = corsOrigins.map((o) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*') + '$'));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || patterns.some((p) => p.test(origin))) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter(db));
  app.use('/organizations', organizationsRouter(db));
  app.use('/expenses', expensesRouter(db));

  app.use((_req, res) => res.status(404).json({ detail: 'Not found' }));
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ detail: err.message });
    console.error(err);
    res.status(500).json({ detail: 'Internal server error' });
  });
  return app;
}
