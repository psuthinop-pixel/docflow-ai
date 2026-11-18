// High-accuracy extractor: Claude reads the receipt image/PDF directly (Phase 1 of the Claude accuracy plan).
// Thai-specific rules in the system prompt; the pipeline (extract/index.ts) checks the arithmetic and re-asks at
// higher effort when the numbers don't add up.
import Anthropic from '@anthropic-ai/sdk';
import type { ReceiptFields } from './parse.js';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';

export const TAX_INVOICE_TYPES = ['full', 'abbreviated', 'receipt', 'other'] as const;
export const PAYMENT_METHODS = ['transfer', 'cash', 'card', 'cheque', 'unknown'] as const;
const FIELD_NAMES = ['vendor_name', 'vendor_taxid', 'vendor_branch', 'invoice_number', 'date', 'subtotal', 'tax_amount', 'total', 'currency', 'category'] as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendor_name', 'vendor_taxid', 'vendor_branch', 'vendor_address', 'buyer_name', 'invoice_number', 'date',
    'subtotal', 'tax_amount', 'total', 'wht_amount', 'currency', 'tax_invoice_type', 'payment_method', 'card_last4',
    'supply_type', 'is_capex', 'category', 'uncertain_fields', 'raw_text',
  ],
  properties: {
    vendor_name: { type: 'string', description: 'Seller / issuer (ผู้ขาย / ผู้ออกใบกำกับ), never the buyer' },
    vendor_taxid: { type: 'string', description: "Seller's 13-digit tax ID (เลขประจำตัวผู้เสียภาษี), digits only, or empty" },
    vendor_branch: { type: 'string', description: "Seller branch: '00000' for สำนักงานใหญ่ / head office, the 5-digit number for สาขาที่ (e.g. '00012'), or empty if not printed" },
    vendor_address: { type: 'string' },
    buyer_name: { type: 'string', description: 'Buyer / customer (ผู้ซื้อ / ลูกค้า) as printed, or empty' },
    invoice_number: { type: 'string', description: 'Tax invoice / receipt number (เลขที่), exactly as printed' },
    date: { type: ['string', 'null'], description: 'Issue date as YYYY-MM-DD, Gregorian. Thai Buddhist Era years: subtract 543 (2569 → 2026)' },
    subtotal: { type: ['number', 'null'], description: 'Amount before VAT (มูลค่าสินค้า/บริการ ก่อนภาษี)' },
    tax_amount: { type: ['number', 'null'], description: 'VAT amount (ภาษีมูลค่าเพิ่ม)' },
    total: { type: ['number', 'null'], description: 'Grand total including VAT, before any withholding tax (จำนวนเงินรวมทั้งสิ้น)' },
    wht_amount: { type: ['number', 'null'], description: 'Withholding tax deducted (ภาษีหัก ณ ที่จ่าย), if shown, else null' },
    currency: { type: 'string', description: 'ISO code, e.g. THB, USD' },
    tax_invoice_type: { type: 'string', enum: [...TAX_INVOICE_TYPES], description: "'full' = ใบกำกับภาษีเต็มรูป (buyer name/tax ID printed); 'abbreviated' = ใบกำกับภาษีอย่างย่อ (e.g. POS slip, no buyer details); 'receipt' = ใบเสร็จรับเงิน only; 'other'" },
    payment_method: { type: 'string', enum: [...PAYMENT_METHODS], description: 'How it was paid, only if the document shows it (โอน / เงินสด / บัตรเครดิต / เช็ค)' },
    card_last4: { type: 'string', description: 'Last 4 digits of the card if printed, else empty' },
    supply_type: { type: 'string', enum: ['', 'service', 'goods'], description: "Foreign-currency invoices only: 'service' (software, subscriptions, online services) or 'goods'; empty for THB" },
    is_capex: { type: 'boolean', description: 'True for long-lived assets: furniture, appliances, equipment, computers, renovation work. False for consumables and services' },
    category: { type: 'string', description: 'Best match from the provided category list, exactly as written there, or empty' },
    uncertain_fields: { type: 'array', items: { type: 'string', enum: [...FIELD_NAMES] }, description: 'Fields you could not read clearly (blurred, cut off, handwritten, ambiguous)' },
    raw_text: { type: 'string', description: 'Full transcription of the document text' },
  },
} as const;

export type ClaudeFields = ReceiptFields & {
  buyer_name: string;
  wht_amount: number | null;
  tax_invoice_type: (typeof TAX_INVOICE_TYPES)[number];
  payment_method: (typeof PAYMENT_METHODS)[number];
  card_last4: string;
  supply_type: '' | 'service' | 'goods';
  is_capex: boolean;
  category: string;
  uncertain_fields: string[];
  raw_text: string;
};

export interface ClaudeRequest {
  buf: Buffer;
  mime: string;
  categories: string[];
  orgName: string;
  effort: 'medium' | 'high';
  /** Problems found in a first pass, for the second look. */
  feedback?: string[];
}

const SYSTEM =
  'You extract fields from receipts and tax invoices for a Thai hotel company\'s bookkeeping. Accuracy matters more than speed. Rules:\n' +
  '- The vendor is the SELLER who issued the document. The buyer/customer block (ผู้ซื้อ, ลูกค้า, Bill to, Sold to) is never the vendor; ' +
  'the buyer is usually the hotel company named in the request.\n' +
  '- Tax ID and branch: take them from the seller block only. สำนักงานใหญ่ = branch 00000.\n' +
  '- Dates: Thai documents often use Buddhist Era years (พ.ศ.); convert to Gregorian. Thai month names and abbreviations ' +
  '(ม.ค. … ธ.ค.) and Thai digits (๐-๙) are common.\n' +
  '- Amounts: read numbers carefully (commas are thousand separators). total = grand total incl. VAT. If VAT is included in the ' +
  'price and not shown separately, tax_amount = total × 7/107 only when the document says VAT is included; otherwise null.\n' +
  '- Check your numbers: subtotal + tax_amount should equal total; VAT is normally 7% of subtotal. If they do not agree, re-read the ' +
  'document and list the doubtful fields in uncertain_fields rather than forcing them to agree.\n' +
  '- Withholding tax (หัก ณ ที่จ่าย) is not part of total; report it in wht_amount.\n' +
  '- Never invent a value: use empty string or null when a field is not on the document.';

/** One extraction call. Swappable in tests (setClaudeCaller). */
async function callClaude(req: ClaudeRequest): Promise<ClaudeFields> {
  client ??= new Anthropic();
  const data = req.buf.toString('base64');
  const file =
    req.mime === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: req.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data } } as const);
  const text =
    `The buyer is our company: "${req.orgName}". Expense categories: ${req.categories.length ? req.categories.join(', ') : '(none)'}.` +
    (req.feedback?.length
      ? `\nA first reading had these problems; look again carefully at the relevant parts of the document: ${req.feedback.join('; ')}.`
      : '');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: req.effort, format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: [file, { type: 'text', text }] }],
  });
  if (!('content' in response)) throw new Error('Unexpected streaming response');
  if (response.stop_reason === 'refusal') throw new Error('Extraction was declined by the model');
  if (response.stop_reason === 'max_tokens') throw new Error('Extraction was cut off (document too long)');
  const out = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return { ...(JSON.parse(out) as ClaudeFields), is_tax_invoice: false };
}

let client: Anthropic | null = null;
let caller: (req: ClaudeRequest) => Promise<ClaudeFields> = callClaude;

/** Tests only: replace the API call with a fake. Pass nothing to restore. */
export function setClaudeCaller(fn?: (req: ClaudeRequest) => Promise<ClaudeFields>) {
  caller = fn ?? callClaude;
}

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function extractWithClaude(req: ClaudeRequest): Promise<ClaudeFields> {
  const f = await caller(req);
  return { ...f, is_tax_invoice: f.tax_invoice_type === 'full' || f.tax_invoice_type === 'abbreviated' };
}
