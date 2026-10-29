// Receipt extraction pipeline: pick an engine, extract, normalise and validate.
import { extractText } from './ocr.js';
import { claudeEnabled, extractWithClaude } from './claude.js';
import { isValidThaiTaxId, parseReceipt, validateFields, type ReceiptFields } from './parse.js';

export type Engine = 'tesseract' | 'claude';

export interface Extraction {
  engine: Engine;
  confidence: number | null;
  text: string;
  fields: ReceiptFields & { category: string };
  warnings: string[];
}

export function pickEngine(setting: string): Engine {
  if (setting === 'claude' || setting === 'tesseract') return setting;
  return claudeEnabled() ? 'claude' : 'tesseract';
}

export async function extractReceipt(buf: Buffer, mime: string, categories: string[], setting = 'auto'): Promise<Extraction> {
  const engine = pickEngine(setting);
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
  const ocr = await extractText(buf, mime);
  const fields = { ...parseReceipt(ocr.text), category: '' };
  const warnings = validateFields(fields);
  if (ocr.source === 'tesseract' && ocr.confidence < 60) warnings.push(`Low OCR confidence (${ocr.confidence}%) — please check every field`);
  return { engine, confidence: ocr.confidence, text: ocr.text, fields, warnings };
}
