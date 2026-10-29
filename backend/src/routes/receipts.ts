import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';
import { extractReceipt } from '../extract/index.js';

export interface ReceiptOptions { uploadDir: string; maxUploadMb: number; ocrEngine: string }

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

type ReceiptRow = Record<string, unknown> & { id: string; organization_id: string; storage_path: string; extracted: string; mime: string };

const toApi = ({ storage_path: _p, extracted, ...r }: ReceiptRow) => ({ ...r, _id: r.id, extracted: JSON.parse(extracted) });

export function receiptsRouter(db: Db, opts: ReceiptOptions): Router {
  const r = Router();
  r.use(requireAuth(db));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in TYPES),
  });

  const findOwned = (id: string, userId: string) =>
    db
      .prepare(
        `SELECT r.* FROM receipts r
         JOIN memberships m ON m.organization_id = r.organization_id AND m.user_id = ?
         WHERE r.id = ?`,
      )
      .get(userId, id) as ReceiptRow | undefined;

  /** Upload a receipt, extract fields, and report likely duplicates. Does not create an expense. */
  r.post('/', upload.single('file'), async (req, res, next) => {
    try {
      const orgId = String(req.body?.organization_id ?? '');
      if (!orgId) return res.status(400).json({ detail: 'organization_id is required' });
      if (!membershipRole(db, req.user!.id, orgId)) return res.status(403).json({ detail: 'Not a member of this organization' });
      const file = req.file;
      if (!file) return res.status(400).json({ detail: 'file is required (JPEG, PNG, WebP or PDF)' });

      const org = db.prepare('SELECT categories FROM organizations WHERE id = ?').get(orgId) as { categories: string };
      const extraction = await extractReceipt(file.buffer, file.mimetype, JSON.parse(org.categories), opts.ocrEngine);

      const id = newId();
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const rel = path.join(orgId, `${id}.${TYPES[file.mimetype]}`);
      mkdirSync(path.join(opts.uploadDir, orgId), { recursive: true });
      writeFileSync(path.join(opts.uploadDir, rel), file.buffer);

      db.prepare(
        `INSERT INTO receipts (id, organization_id, uploaded_by, filename, mime, size, sha256, storage_path,
           engine, confidence, ocr_text, extracted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, orgId, req.user!.id, file.originalname, file.mimetype, file.size, sha256, rel,
        extraction.engine, extraction.confidence, extraction.text, JSON.stringify(extraction.fields), now(),
      );

      const f = extraction.fields;
      const duplicates = db
        .prepare(
          `SELECT e.id, e.vendor_name, e.invoice_number, e.total, e.date FROM expenses e
           LEFT JOIN receipts r ON r.id = e.receipt_id
           WHERE e.organization_id = ? AND (
             r.sha256 = ?
             OR (? != '' AND ? != '' AND e.vendor_taxid = ? AND e.invoice_number = ?)
           )`,
        )
        .all(orgId, sha256, f.vendor_taxid, f.invoice_number, f.vendor_taxid, f.invoice_number);

      res.status(201).json({
        receipt: toApi(findOwned(id, req.user!.id)!),
        fields: f,
        warnings: extraction.warnings,
        duplicates,
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', (req, res) => {
    const row = findOwned(req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ detail: 'Receipt not found' });
    res.json(toApi(row));
  });

  r.get('/:id/file', (req, res) => {
    const row = findOwned(req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ detail: 'Receipt not found' });
    res.type(row.mime).sendFile(path.resolve(opts.uploadDir, row.storage_path));
  });

  return r;
}
