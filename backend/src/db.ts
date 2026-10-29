import pg from 'pg';
import { randomUUID } from 'node:crypto';

/** Minimal async query interface, implemented by a pg Pool (Neon) in production and PGlite in tests. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    organization_name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    categories TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (user_id, organization_id)
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'confirmed',
    vendor_name TEXT NOT NULL DEFAULT '',
    vendor_address TEXT NOT NULL DEFAULT '',
    vendor_taxid TEXT NOT NULL DEFAULT '',
    date TEXT,
    total DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'THB',
    category TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id, date);
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );
`;

// BIGINT comes back as a string by default; our values (unix seconds) fit in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export function openDb(connectionString: string): Db {
  // Small pool: on Vercel each function instance holds its own; Neon's pooled URL multiplexes them.
  const pool = new pg.Pool({ connectionString, max: 3 });
  return { query: async (sql, params) => (await pool.query(sql, params)).rows };
}

export async function migrate(db: Db) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
