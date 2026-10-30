// Receipt extraction pipeline: pick an engine, extract, normalise and validate.
import { extractText } from './ocr.js';
import { typhoonEnabled, typhoonText } from './typhoon.js';
import { claudeEnabled, extractWithClaude } from './claude.js';
import { isValidThaiTaxId, parseReceipt, validateFields, type ReceiptFields } from './parse.js';

export type Engine = 'tesseract' | 'claude' | 'typhoon';

export interface Extraction {
  engine: Engine;
  confidence: number | null;
  text: string;
  fields: ReceiptFields & { category: string };
  warnings: string[];
}

export function pickEngine(setting: string): Engine {
  if (setting === 'claude' || setting === 'tesseract' || setting === 'typhoon') return setting;
  // Typhoon reads Thai receipts best; tesseract is the offline fallback.
  if (typhoonEnabled()) return 'typhoon';
  return claudeEnabled() ? 'claude' : 'tesseract';
}

// PDF text layers can carry NUL bytes, which Postgres rejects in text and JSON values.
const stripNul = (s: string) => s.replace(/\u0000/g, '');

export async function extractReceipt(buf: Buffer, mime: string, categories: string[], setting = 'auto'): Promise<Extraction> {
  const x = await extract(buf, mime, categories, setting);
  const fields = Object.fromEntries(
    Object.entries(x.fields).map(([k, v]) => [k, typeof v === 'string' ? stripNul(v) : v]),
  ) as Extraction['fields'];
  return { ...x, text: stripNul(x.text), fields };
}

async function extract(buf: Buffer, mime: string, categories: string[], setting: string): Promise<Extraction> {
  let engine = pickEngine(setting);
  if (engine === 'claude') {
    const c = await extractWithClaude(buf, mime, categories);
    // Cross-check the model's answer with the rule-based parser on its own transcription.
    const rules = parseReceipt(c.raw_text);
    const taxid = c.vendor_taxid.replace(/\D/g, '');
    const fields = {
      ...c,
      vendor_taxid: isValidThaiTaxId(taxid) || !isValidThaiTaxId(rules.vendor_taxid) ? taxid : rules.vendor_taxid,
      category: categories.includes(c.category) ? c.category : '',
    };
    const { raw_text: _t, ...clean } = fields;
    return { engine, confidence: null, text: c.raw_text, fields: clean, warnings: validateFields(clean) };
  }
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
