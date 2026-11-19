// Receipt extraction pipeline: pick an engine, extract, normalise and validate.
import { extractText } from './ocr.js';
import { typhoonEnabled, typhoonText } from './typhoon.js';
import { claudeEnabled, extractWithClaude, type ClaudeFields } from './claude.js';
import { isValidThaiTaxId, normalizeBranch, parseReceipt, validateFields, type ReceiptFields } from './parse.js';

export type Engine = 'tesseract' | 'claude' | 'typhoon';

/** Values the review form can be pre-filled with; the person still confirms them. */
export interface Suggestions { vat_claim?: 'no'; capex?: 'yes'; supply_type?: 'service' | 'goods' }

export interface Extraction {
  engine: Engine;
  confidence: number | null;
  text: string;
  fields: ReceiptFields & { category: string } & Suggestions;
  warnings: string[];
}

export function pickEngine(setting: string): Engine {
  if (setting === 'claude' || setting === 'tesseract' || setting === 'typhoon') return setting;
  // Claude reads the document itself and is checked below; Typhoon next; tesseract is the offline fallback.
  if (claudeEnabled()) return 'claude';
  return typhoonEnabled() ? 'typhoon' : 'tesseract';
}

// PDF text layers can carry NUL bytes, which Postgres rejects in text and JSON values.
const stripNul = (s: string) => s.replace(/\u0000/g, '');

export async function extractReceipt(buf: Buffer, mime: string, categories: string[], setting = 'auto', orgName = ''): Promise<Extraction> {
  const x = await extract(buf, mime, categories, setting, orgName);
  const fields = Object.fromEntries(
    Object.entries(x.fields).map(([k, v]) => [k, typeof v === 'string' ? stripNul(v) : v]),
  ) as Extraction['fields'];
  return { ...x, text: stripNul(x.text), fields };
}

async function extract(buf: Buffer, mime: string, categories: string[], setting: string, orgName: string): Promise<Extraction> {
  let engine = pickEngine(setting);
  if (engine === 'claude') return claudeExtraction(buf, mime, categories, orgName);
  let fallback = '';
  if (engine === 'typhoon') {
    try {
      const text = await typhoonText(buf, mime);
      const fields = { ...parseReceipt(text), category: '' };
      return { engine, confidence: null, text, fields, warnings: validateFields(fields) };
    } catch (e) {
      // An explicit 'typhoon' setting (e.g. the eval) should surface the error, not mask it.
      if (setting === 'typhoon') throw e;
      engine = 'tesseract';
      fallback = `Typhoon OCR unavailable (${(e as Error).message.split('\n')[0].slice(0, 120)}) — used offline OCR`;
    }
  }
  const ocr = await extractText(buf, mime);
  const fields = { ...parseReceipt(ocr.text), category: '' };
  const warnings = validateFields(fields);
  if (fallback) warnings.unshift(fallback);
  if (ocr.source === 'tesseract' && ocr.confidence < 60) warnings.push(`Low OCR confidence (${ocr.confidence}%) — please check every field`);
  return { engine, confidence: ocr.confidence, text: ocr.text, fields, warnings };
}

const norm = (v: string) => v.toLowerCase().replace(/บริษัท|จำกัด|\(มหาชน\)|co\.?,?|ltd\.?|limited|company|[\s.,()]/g, '');

/** Arithmetic and sanity checks on a Claude reading. Anything found triggers one closer look at higher effort. */
export function claudeProblems(f: ClaudeFields, orgName: string, today = new Date()): string[] {
  const out: string[] = [];
  const thb = f.currency.trim().toUpperCase() === 'THB';
  if (f.total === null) out.push('total not found');
  if (f.subtotal !== null && f.tax_amount !== null && f.total !== null && Math.abs(f.subtotal + f.tax_amount - f.total) > 1) {
    out.push(`subtotal ${f.subtotal} + VAT ${f.tax_amount} does not equal total ${f.total}`);
  }
  if (thb && f.tax_amount !== null && f.tax_amount > 0) {
    if (f.subtotal !== null && Math.abs(f.tax_amount - f.subtotal * 0.07) > 1) out.push(`VAT ${f.tax_amount} is not 7% of subtotal ${f.subtotal}`);
    else if (f.subtotal === null && f.total !== null && Math.abs(f.tax_amount - (f.total * 7) / 107) > 1) out.push(`VAT ${f.tax_amount} is not 7/107 of total ${f.total}`);
  }
  const taxid = f.vendor_taxid.replace(/\D/g, '');
  if (taxid && !isValidThaiTaxId(taxid)) out.push(`seller tax ID ${taxid} fails the checksum`);
  if (!f.date) out.push('date not found');
  else {
    const d = new Date(f.date);
    const days = (d.getTime() - today.getTime()) / 86_400_000;
    if (isNaN(d.getTime()) || days > 3 || days < -730) out.push(`date ${f.date} is outside the expected range (check the Buddhist Era conversion)`);
  }
  const vendor = norm(f.vendor_name);
  if (vendor && ((f.buyer_name && vendor === norm(f.buyer_name)) || (orgName && vendor.includes(norm(orgName))))) {
    out.push('the vendor looks like the buyer; the vendor must be the seller who issued the document');
  }
  if (f.uncertain_fields.length) out.push(`unclear: ${f.uncertain_fields.join(', ')}`);
  return out;
}

async function claudeExtraction(buf: Buffer, mime: string, categories: string[], orgName: string): Promise<Extraction> {
  let c = await extractWithClaude({ buf, mime, categories, orgName, effort: 'medium' });
  let problems = claudeProblems(c, orgName);
  let secondLook = false;
  if (problems.length) {
    // One closer look at higher effort, told what didn't add up; keep whichever reading has fewer problems.
    const again = await extractWithClaude({ buf, mime, categories, orgName, effort: 'high', feedback: problems });
    const againProblems = claudeProblems(again, orgName);
    secondLook = true;
    if (againProblems.length <= problems.length) {
      c = again;
      problems = againProblems;
    }
  }

  // Cross-check the model's answer with the rule-based parser on its own transcription.
  const rules = parseReceipt(c.raw_text);
  const taxid = c.vendor_taxid.replace(/\D/g, '');
  const thb = /^[A-Za-z]{3}$/.test(c.currency.trim()) ? c.currency.trim().toUpperCase() : rules.currency;
  const fields: Extraction['fields'] = {
    vendor_name: c.vendor_name,
    vendor_taxid: isValidThaiTaxId(taxid) || !isValidThaiTaxId(rules.vendor_taxid) ? taxid : rules.vendor_taxid,
    vendor_branch: normalizeBranch(c.vendor_branch || '') || rules.vendor_branch,
    vendor_address: c.vendor_address,
    invoice_number: c.invoice_number,
    date: c.date,
    subtotal: c.subtotal,
    tax_amount: c.tax_amount,
    total: c.total,
    currency: thb,
    is_tax_invoice: c.is_tax_invoice,
    category: categories.includes(c.category) ? c.category : '',
  };

  const warnings: string[] = [];
  // Suggestions the reviewer confirms in the form
  if (thb === 'THB' && c.tax_invoice_type === 'abbreviated' && (c.tax_amount ?? 0) > 0) {
    fields.vat_claim = 'no';
    warnings.push('Abbreviated tax invoice (ใบกำกับภาษีอย่างย่อ): its VAT cannot be claimed, so "Input VAT claim" is set to Not claimable. Ask the seller for a full tax invoice to claim it.');
  }
  if (thb === 'THB' && c.tax_invoice_type === 'receipt' && (c.tax_amount ?? 0) > 0) {
    warnings.push('This looks like a receipt, not a tax invoice: VAT is only claimable with a ใบกำกับภาษี.');
  }
  if (c.is_capex && !/asset|capex|ทรัพย์สิน/i.test(fields.category)) {
    fields.capex = 'yes';
    warnings.push('Looks like an asset purchase (furniture, equipment, renovation): "Capex" is set to Capex. Change it if this is a running cost.');
  }
  if (thb !== 'THB' && c.supply_type) fields.supply_type = c.supply_type;
  if (c.wht_amount) {
    warnings.push(`Withholding tax of ${c.wht_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} was deducted (ภ.ง.ด.3/53). DocFlow doesn't post withholding tax yet; tell your accountant.`);
  }
  if (c.payment_method !== 'unknown') {
    const how = { transfer: 'bank transfer', cash: 'cash', card: `card${c.card_last4 ? ` ending ${c.card_last4}` : ''}`, cheque: 'cheque' }[c.payment_method];
    warnings.push(`Receipt says it was paid by ${how}: set "Paid from" to match.`);
  }
  if (problems.length) warnings.push(`Claude flagged${secondLook ? ' after a second look' : ''}: ${problems.join('; ')}. Please check these fields.`);
  for (const w of validateFields(fields)) if (!warnings.some((x) => x.includes(w))) warnings.push(w);
  return { engine: 'claude', confidence: null, text: c.raw_text, fields, warnings };
}
