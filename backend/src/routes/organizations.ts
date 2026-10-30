import { Router } from 'express';
import type { Db } from '../db.js';
import { all, newId, now, one } from '../db.js';
import { membershipRole, requireAuth } from '../auth.js';

type OrgRow = Record<string, unknown> & { id: string; categories: string };

const toApi = (o: OrgRow) => ({ ...o, _id: o.id, categories: JSON.parse(o.categories) });

const EDITORS = ['owner', 'admin'];
const isColor = (v: unknown) => v === null || (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v));

/** Trimmed, de-duplicated category names, or an error message. */
function cleanCategories(v: unknown): string | string[] {
  if (!Array.isArray(v)) return 'categories must be an array';
  const out: string[] = [];
  for (const c of v) {
    if (typeof c !== 'string') return 'categories must be strings';
    const name = c.trim();
    if (!name) continue;
    if (name.length > 60) return 'category names must be 60 characters or fewer';
    if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  if (out.length > 50) return 'at most 50 categories';
  return out;
}

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
    const cats = cleanCategories(categories);
    if (typeof cats === 'string') return res.status(400).json({ detail: cats });
    if (!isColor(color)) return res.status(400).json({ detail: 'color must be a hex colour like #6366f1' });
    const id = newId();
    // One statement so the organization and its owner membership are created atomically.
    await db.query(
      `WITH org AS (
         INSERT INTO organizations (id, organization_name, currency, timezone, categories, color, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
       )
       INSERT INTO memberships (user_id, organization_id, role) SELECT $8::text, id, 'owner' FROM org`,
      [id, organization_name.trim(), String(currency), String(timezone), JSON.stringify(cats), color, now(), req.user!.id],
    );
    const row = await one<OrgRow>(db, `SELECT *, 'owner' AS role FROM organizations WHERE id = $1`, [id]);
    res.status(201).json(toApi(row!));
  });

  // Rename, recolour or edit the category list. Owners and admins only.
  r.put('/:id', async (req, res) => {
    const role = await membershipRole(db, req.user!.id, req.params.id);
    if (!role) return res.status(404).json({ detail: 'Organization not found' });
    if (!EDITORS.includes(role)) return res.status(403).json({ detail: 'Only an owner or admin can edit this organization' });

    const body = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };

    if ('organization_name' in body) {
      if (typeof body.organization_name !== 'string' || !body.organization_name.trim()) {
        return res.status(400).json({ detail: 'organization_name is required' });
      }
      set('organization_name', body.organization_name.trim());
    }
    if ('color' in body) {
      if (!isColor(body.color)) return res.status(400).json({ detail: 'color must be a hex colour like #6366f1' });
      set('color', body.color);
    }
    if ('categories' in body) {
      const cats = cleanCategories(body.categories);
      if (typeof cats === 'string') return res.status(400).json({ detail: cats });
      set('categories', JSON.stringify(cats));
    }
    if (!sets.length) return res.status(400).json({ detail: 'Nothing to update' });

    params.push(req.params.id);
    await db.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    const row = await one<OrgRow>(db, 'SELECT *, $2::text AS role FROM organizations WHERE id = $1', [req.params.id, role]);
    res.json(toApi(row!));
  });

  return r;
}
