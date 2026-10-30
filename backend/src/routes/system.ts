import { Router } from 'express';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { pickEngine } from '../extract/index.js';
import { typhoonEnabled } from '../extract/typhoon.js';
import { claudeEnabled } from '../extract/claude.js';

/** What the server is configured to do, for the Settings page. Never returns secrets, only whether they are set. */
export function systemRouter(db: Db, opts: { ocrEngine: string; maxUploadMb: number }): Router {
  const r = Router();
  r.use(requireAuth(db));

  r.get('/status', (_req, res) => {
    res.json({
      ocr: {
        setting: opts.ocrEngine,
        active: pickEngine(opts.ocrEngine),
        engines: { typhoon: typhoonEnabled(), claude: claudeEnabled(), tesseract: true },
      },
      max_upload_mb: opts.maxUploadMb,
    });
  });

  return r;
}
