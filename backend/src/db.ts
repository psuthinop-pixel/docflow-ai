import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
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
      total REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'THB',
      category TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id, date);
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      engine TEXT NOT NULL,
      confidence INTEGER,
      ocr_text TEXT NOT NULL DEFAULT '',
      extracted TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_hash ON receipts(organization_id, sha256);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  migrate(db);
  return db;
}

/** Additive column migrations for databases created by earlier versions. */
function migrate(db: Db) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn('expenses', 'receipt_id', 'TEXT REFERENCES receipts(id) ON DELETE SET NULL');
  addColumn('expenses', 'invoice_number', "TEXT NOT NULL DEFAULT ''");
  addColumn('expenses', 'subtotal', 'REAL');
  addColumn('expenses', 'approved_by', 'TEXT REFERENCES users(id)');
  addColumn('expenses', 'approved_at', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_expenses_invoice ON expenses(organization_id, vendor_taxid, invoice_number)`);
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();
