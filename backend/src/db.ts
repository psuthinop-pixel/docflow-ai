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
  `CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}

/** Connect to Postgres (e.g. Neon's pooled connection string) and ensure the schema exists. */
export async function openDb(databaseUrl: string): Promise<Db> {
  if (!databaseUrl) throw new Error('DATABASE_URL must be set (Neon pooled connection string)');
  const db = new pg.Pool({ connectionString: databaseUrl, max: 5 });
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
