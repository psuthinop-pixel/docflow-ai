import { Router } from 'express';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';
import { requireAuth } from '../auth.js';

type OrgRow = Record<string, unknown> & { id: string; categories: string };

const toApi = (o: OrgRow) => ({ ...o, _id: o.id, categories: JSON.parse(o.categories) });

export function organizationsRouter(db: Db): Router {
  const r = Router();
  r.use(requireAuth(db));

  r.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT o.*, m.role FROM organizations o
         JOIN memberships m ON m.organization_id = o.id
         WHERE m.user_id = ? ORDER BY o.created_at`,
      )
      .all(req.user!.id) as OrgRow[];
    res.json(rows.map(toApi));
  });

  r.post('/', (req, res) => {
    const { organization_name, currency = 'THB', timezone = 'Asia/Bangkok', categories = [], color = null } =
      req.body ?? {};
    if (typeof organization_name !== 'string' || !organization_name.trim()) {
      return res.status(400).json({ detail: 'organization_name is required' });
    }
    if (!Array.isArray(categories)) return res.status(400).json({ detail: 'categories must be an array' });
    const id = newId();
    db.prepare(
      `INSERT INTO organizations (id, organization_name, currency, timezone, categories, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, organization_name.trim(), String(currency), String(timezone), JSON.stringify(categories), color, now());
    db.prepare('INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?)').run(
      req.user!.id, id, 'owner',
    );
    const row = db.prepare('SELECT *, ? AS role FROM organizations WHERE id = ?').get('owner', id) as OrgRow;
    res.status(201).json(toApi(row));
  });

  return r;
}
