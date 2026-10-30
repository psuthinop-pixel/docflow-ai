import pg from 'pg';
import { randomUUID } from 'node:crypto';

/** Minimal query interface, satisfied by a `pg` Pool (Neon) and by PGlite (tests). */
export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    organization_name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    categories TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (user_id, organization_id)
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id, date)`,
  // The file itself lives in `content`: serverless instances have no persistent disk.
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    content BYTEA NOT NULL,
    engine TEXT NOT NULL,
    confidence INTEGER,
    ocr_text TEXT NOT NULL DEFAULT '',
    extracted TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_hash ON receipts(organization_id, sha256)`,
  // Additive columns for databases created before receipts existed.
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subtotal DOUBLE PRECISION`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_invoice ON expenses(organization_id, vendor_taxid, invoice_number)`,
  // Invited accounts start with a temporary password that must be replaced before anything else.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TEXT`,
  // Tokens issued before this moment are rejected, so a password change signs out other sessions.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT`,
  `CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}

/** Postgres pool for a Neon pooled connection string. Lazy: no connection is opened until the first query. */
export function connect(databaseUrl: string, max = 5): Db {
  if (!databaseUrl) throw new Error('DATABASE_URL must be set (Neon pooled connection string)');
  return new pg.Pool({ connectionString: databaseUrl, max, idleTimeoutMillis: 10_000 });
}

/** Connect and ensure the schema exists (long-running server, seed, migrate). */
export async function openDb(databaseUrl: string): Promise<Db> {
  const db = connect(databaseUrl);
  await migrate(db);
  return db;
}

/** First row of a query, or undefined. */
export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

/** All rows of a query. */
export async function all<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
