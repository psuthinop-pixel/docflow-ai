import express from 'express';
import cors from 'cors';
import type { Db } from './db.js';
import { authRouter } from './routes/auth.js';
import { organizationsRouter } from './routes/organizations.js';
import { expensesRouter } from './routes/expenses.js';
import { receiptsRouter, type ReceiptOptions } from './routes/receipts.js';
import { systemRouter } from './routes/system.js';
import { membersRouter } from './routes/members.js';
import { reportsRouter } from './routes/reports.js';
import multer from 'multer';

const defaultReceipts: ReceiptOptions = { maxUploadMb: 10, ocrEngine: 'auto' };

export function createApp(db: Db, corsOrigins: string[] = [], receipts: ReceiptOptions = defaultReceipts) {
  const app = express();
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter(db));
  app.use('/organizations/:id/members', membersRouter(db));
  app.use('/organizations', organizationsRouter(db));
  app.use('/expenses', expensesRouter(db));
  app.use('/receipts', receiptsRouter(db, receipts));
  app.use('/system', systemRouter(db, receipts));
  app.use('/reports', reportsRouter(db));

  app.use((_req, res) => res.status(404).json({ detail: 'Not found' }));
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ detail: err.message });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ detail: err.message });
    console.error(err);
    res.status(500).json({ detail: 'Internal server error' });
  });
  return app;
}
