import { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { requireAuth } from '../auth.js';

type OrgRow = Record<string, unknown> & { id: string; categories: string };

const toApi = (o: OrgRow) => ({ ...o, _id: o.id, categories: JSON.parse(o.categories) });

export function organizationsRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  r.get('/', async (req, res) => {
    const rows = await all<OrgRow>(
      db,
      `SELECT o.*, m.role FROM organizations o
       JOIN memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.created_at`,
      [req.user!.id],
    );
    res.json(rows.map(toApi));
  });

  r.post('/', async (req, res) => {
    const { organization_name, currency = 'THB', timezone = 'Asia/Bangkok', categories = [], color = null } =
      req.body ?? {};
    if (typeof organization_name !== 'string' || !organization_name.trim()) {
      return res.status(400).json({ detail: 'organization_name is required' });
    }
    if (!Array.isArray(categories)) return res.status(400).json({ detail: 'categories must be an array' });
    const id = newId();
    // One statement so the organization and its owner membership are created atomically.
    await db.query(
      `WITH org AS (
         INSERT INTO organizations (id, organization_name, currency, timezone, categories, color, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
       )
       INSERT INTO memberships (user_id, organization_id, role) SELECT $8::text, id, 'owner' FROM org`,
      [id, organization_name.trim(), String(currency), String(timezone), JSON.stringify(categories), color, now(), req.user!.id],
    );
    const row = await one<OrgRow>(db, `SELECT *, 'owner' AS role FROM organizations WHERE id = $1`, [id]);
    res.status(201).json(toApi(row!));
  });

  return r;
}
