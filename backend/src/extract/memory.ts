// Claude accuracy phase 2: vendor memory. What a person confirmed on this seller's recent receipts pre-fills the
// next one. It learns only from confirmed/approved receipts, so every correction is remembered automatically.
import type { Db } from '../db.js';
import { all } from '../db.js';

/** Fields remembered per seller, and how the review form labels them. */
export const REMEMBERED = {
  vendor_name: 'name',
  vendor_address: 'address',
  vendor_branch: 'branch',
  category: 'category',
  payment_source: 'Paid from',
  vat_claim: 'Input VAT claim',
  capex: 'Capex',
  supply_type: 'Service or goods',
} as const;
export type RememberedField = keyof typeof REMEMBERED;

const RECENT = 5;
/** A value is used when at least this share of the recent receipts agree (a single confirmed receipt counts). */
const AGREEMENT = 0.6;

export interface VendorMemory {
  receipts: number;
  values: Partial<Record<RememberedField, string>>;
}

/**
 * The consistent values on this seller's last few confirmed receipts. Matched by tax ID; sellers without one
 * (foreign suppliers, some slips) by exact vendor name.
 */
export async function vendorMemory(db: Db, orgId: string, seller: { taxid: string; name: string }): Promise<VendorMemory | null> {
  const taxid = seller.taxid.replace(/\D/g, '');
  const name = seller.name.trim().toLowerCase();
  if (!taxid && !name) return null;
  const rows = await all<Record<RememberedField, string | null>>(
    db,
    `SELECT ${Object.keys(REMEMBERED).join(', ')} FROM expenses
     WHERE organization_id = $1 AND status IN ('confirmed', 'approved') AND vendor_name <> ''
       AND ${taxid ? 'vendor_taxid = $2' : `vendor_taxid = '' AND lower(trim(vendor_name)) = $2`}
     ORDER BY updated_at DESC LIMIT ${RECENT}`,
    [orgId, taxid || name],
  );
  if (!rows.length) return null;

  const values: VendorMemory['values'] = {};
  for (const field of Object.keys(REMEMBERED) as RememberedField[]) {
    if (field === 'vendor_name' || field === 'vendor_address') {
      // The latest confirmed spelling wins (people fix OCR typos in names)
      const latest = rows.find((r) => (r[field] ?? '').trim());
      if (latest) values[field] = latest[field]!.trim();
      continue;
    }
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r[field] ?? '', (counts.get(r[field] ?? '') ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    // '' means "not set / automatic": nothing to remember
    if (top && n / rows.length >= AGREEMENT) values[field] = top;
  }
  return { receipts: rows.length, values };
}

type Fields = Record<string, unknown>;

/**
 * Apply memory to freshly extracted fields. What is printed on this receipt beats memory for the branch; the
 * legal VAT rule beats memory (an abbreviated tax invoice is never claimable); Claude's per-receipt asset call
 * beats memory for capex. Everything else: the owner's confirmed history wins over a fresh guess.
 * Returns the labels of the fields that memory filled or changed.
 */
export function applyMemory(fields: Fields, memory: VendorMemory, categories: string[]): string[] {
  const used: string[] = [];
  const set = (field: RememberedField, value: string | undefined) => {
    if (value === undefined || fields[field] === value) return;
    fields[field] = value;
    used.push(REMEMBERED[field]);
  };
  const v = memory.values;
  set('vendor_name', v.vendor_name);
  if (!fields.vendor_address) set('vendor_address', v.vendor_address);
  if (!fields.vendor_branch) set('vendor_branch', v.vendor_branch);
  if (v.category && (!categories.length || categories.includes(v.category))) set('category', v.category);
  set('payment_source', v.payment_source);
  if (fields.vat_claim !== 'no') set('vat_claim', v.vat_claim);
  if (fields.capex !== 'yes') set('capex', v.capex);
  if (!fields.supply_type) set('supply_type', v.supply_type);
  return used;
}
