import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';
import { extractReceipt } from '../extract/index.js';

export interface ReceiptOptions { maxUploadMb: number; ocrEngine: string }

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

type ReceiptRow = Record<string, unknown> & { id: string; organization_id: string; extracted: string; mime: string };

// Every column except the file bytes, which only /:id/file returns.
const COLUMNS = `r.id, r.organization_id, r.uploaded_by, r.filename, r.mime, r.size, r.sha256,
  r.engine, r.confidence, r.ocr_text, r.extracted, r.created_at`;

const toApi = ({ extracted, ...r }: ReceiptRow) => ({ ...r, _id: r.id, extracted: JSON.parse(extracted) });

export function receiptsRouter(db: Db, opts: ReceiptOptions): Router {
  const r = Router();
  r.use(requireAuth(db));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in TYPES),
  });

  const findOwned = (id: string, userId: string, columns = COLUMNS) =>
    one<ReceiptRow>(
      db,
      `SELECT ${columns} FROM receipts r
       JOIN memberships m ON m.organization_id = r.organization_id AND m.user_id = $1
       WHERE r.id = $2`,
      [userId, id],
    );

  /** Upload a receipt, extract fields, and report likely duplicates. Does not create an expense. */
  r.post('/', upload.single('file'), async (req, res, next) => {
    try {
      const orgId = String(req.body?.organization_id ?? '');
      if (!orgId) return res.status(400).json({ detail: 'organization_id is required' });
      if (!(await membershipRole(db, req.user!.id, orgId))) return res.status(403).json({ detail: 'Not a member of this organization' });
      const file = req.file;
      if (!file) return res.status(400).json({ detail: 'file is required (JPEG, PNG, WebP or PDF)' });

      const org = (await one<{ categories: string }>(db, 'SELECT categories FROM organizations WHERE id = $1', [orgId]))!;
      const extraction = await extractReceipt(file.buffer, file.mimetype, JSON.parse(org.categories), opts.ocrEngine);

      const id = newId();
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      await db.query(
        `INSERT INTO receipts (id, organization_id, uploaded_by, filename, mime, size, sha256, content,
           engine, confidence, ocr_text, extracted, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id, orgId, req.user!.id, file.originalname, file.mimetype, file.size, sha256, file.buffer,
          extraction.engine, extraction.confidence, extraction.text, JSON.stringify(extraction.fields), now(),
        ],
      );

      const f = extraction.fields;
      // Known vendor: reuse the name/category/address a person already confirmed for this tax ID.
      if (f.vendor_taxid) {
        const known = await one<{ vendor_name: string; vendor_address: string; category: string }>(
          db,
          `SELECT vendor_name, vendor_address, category FROM expenses
           WHERE organization_id = $1 AND vendor_taxid = $2 AND status != 'draft' AND vendor_name != ''
           ORDER BY updated_at DESC LIMIT 1`,
          [orgId, f.vendor_taxid],
        );
        if (known) {
          f.vendor_name = known.vendor_name;
          f.vendor_address ||= known.vendor_address;
          f.category ||= known.category;
        }
      }
      const duplicates = await all(
        db,
        `SELECT e.id, e.vendor_name, e.invoice_number, e.total, e.date FROM expenses e
         LEFT JOIN receipts r ON r.id = e.receipt_id
         WHERE e.organization_id = $1 AND (
           r.sha256 = $2
           OR ($3 != '' AND $4 != '' AND e.vendor_taxid = $3 AND e.invoice_number = $4)
         )`,
        [orgId, sha256, f.vendor_taxid, f.invoice_number],
      );

      res.status(201).json({
        receipt: toApi((await findOwned(id, req.user!.id))!),
        fields: f,
        warnings: extraction.warnings,
        duplicates,
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', async (req, res) => {
    const row = await findOwned(req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ detail: 'Receipt not found' });
    res.json(toApi(row));
  });

  r.get('/:id/file', async (req, res) => {
    const row = await findOwned(req.params.id, req.user!.id, 'r.mime, r.content');
    if (!row) return res.status(404).json({ detail: 'Receipt not found' });
    res.type(row.mime).send(Buffer.from(row.content as Uint8Array));
  });

  return r;
}
