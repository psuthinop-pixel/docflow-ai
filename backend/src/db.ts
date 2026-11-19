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
  // Seller branch for the input VAT report: '00000' head office, '00012' branch 12, '' unknown
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_branch TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_invoice ON expenses(organization_id, vendor_taxid, invoice_number)`,
  // Invited accounts start with a temporary password that must be replaced before anything else.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TEXT`,
  // Tokens issued before this moment are rejected, so a password change signs out other sessions.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT`,
  // Foreign-currency receipts: amounts stay in the receipt's currency; *_thb is what reports add up.
  // fx_rate is THB per 1 unit, normally taken from the card statement (THB charged / amount).
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate DOUBLE PRECISION`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_date TEXT`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_source TEXT`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_set_by TEXT REFERENCES users(id)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_set_at TEXT`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS total_thb DOUBLE PRECISION`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subtotal_thb DOUBLE PRECISION`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_amount_thb DOUBLE PRECISION`,
  `UPDATE expenses SET fx_rate = 1, total_thb = total, subtotal_thb = subtotal, tax_amount_thb = tax_amount
   WHERE currency = 'THB' AND total_thb IS NULL`,
  // What was bought, for ภ.พ.36: 'service' (reverse-charge VAT applies), 'goods' (VAT paid at customs), '' not set
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supply_type TEXT NOT NULL DEFAULT ''`,
  // Input VAT override: '' auto (fuel not claimable), 'yes' claimable (e.g. pickup/van fuel), 'no' never claimable
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_claim TEXT NOT NULL DEFAULT ''`,
  // Capital expenditure: '' auto (category Asset/Capex = capex), 'yes' capex, 'no' operating expense.
  // Capex is reported apart from operating spend so a big FF&E purchase does not distort the month.
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS capex TEXT NOT NULL DEFAULT ''`,
  // How it was paid: 'company' (direct transfer from the company account), 'advance' (someone paid
  // out of pocket and is owed a reimbursement), '' not set. paid_by names who advanced it;
  // reimbursed_at (YYYY-MM-DD) is set by an owner/admin when the advance is paid back.
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_source TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reimbursed_at TEXT`,
  // Bookkeeping (docs/ACCOUNTING.md). Chart of accounts per property, seeded from accounting/coa.ts.
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_th TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    life_years INTEGER,
    contra_code TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TEXT NOT NULL,
    UNIQUE (organization_id, code)
  )`,
  // Which account each expense category posts to (owner/accountant confirmed; suggestions are never saved)
  `CREATE TABLE IF NOT EXISTS category_accounts (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    account_code TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, category)
  )`,
  // Default credit account for company payments, and the asset account for capex in a non-asset category
  `CREATE TABLE IF NOT EXISTS accounting_settings (
    organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    bank_code TEXT NOT NULL,
    capex_code TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Month-end close: a closed month's receipts can't change; its journal is frozen in journal_snapshot.
  `CREATE TABLE IF NOT EXISTS periods (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    status TEXT NOT NULL,
    closed_by TEXT REFERENCES users(id),
    closed_at TEXT,
    reopened_by TEXT REFERENCES users(id),
    reopened_at TEXT,
    reopen_reason TEXT NOT NULL DEFAULT '',
    journal_snapshot TEXT,
    PRIMARY KEY (organization_id, month)
  )`,
  // Who changed what: receipts, mappings, month close/reopen
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    month TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(organization_id, created_at)`,
  // Claude's owner commentary on a monthly pack; reused while the pack's figures (pack_hash) are unchanged
  `CREATE TABLE IF NOT EXISTS mma_commentary (
    scope_key TEXT NOT NULL,
    month TEXT NOT NULL,
    language TEXT NOT NULL,
    pack_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope_key, month, language)
  )`,
  // Revenue (Phase E): rooms for occupancy KPIs, and revenue lines entered per month from the PMS / OTA statements
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rooms INTEGER`,
  `CREATE TABLE IF NOT EXISTS revenue_entries (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    account_code TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    net_amount DOUBLE PRECISION NOT NULL,
    vat_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    commission DOUBLE PRECISION NOT NULL DEFAULT 0,
    received_to TEXT NOT NULL DEFAULT 'bank',
    room_nights INTEGER,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_org ON revenue_entries(organization_id, date)`,
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
