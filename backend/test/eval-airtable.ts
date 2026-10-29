// Accuracy on real receipts exported from Airtable (PCK table, "Tax Receipt" field).
// Real documents stay OUTSIDE the repo. Usage:
//   npx tsx test/eval-airtable.ts <dir>   where <dir> has manifest.jsonl + files/<recordId>.<ext>
// manifest.jsonl rows: {id, date, vendor, vfull, total, exvat, vatreg, order, files:[{filename,type,url}]}
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractReceipt } from '../src/extract/index.js';
import { shutdownOcr } from '../src/extract/ocr.js';

const dir = process.argv[2];
if (!dir) { console.error('Usage: npx tsx test/eval-airtable.ts <dir>'); process.exit(1); }
const engine = process.argv[3] ?? 'tesseract';

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// Strip legal-form words so "บริษัท โฮม โปรดักส์ เซ็นเตอร์ จำกัด (มหาชน) สาขา..." ≈ "โฮมโปรดักส์เซ็นเตอร์".
const core = (s: string) =>
  s.toLowerCase()
    .replace(/\(.*?\)|สาขา.*$|สำนักงานใหญ่|บริษัท|จำ\s*า?กัด|มหาชน|ห้างหุ้นส่วน|limited|ltd\.?|co\.,?|public|company|pbc|\(thailand\)|thailand/g, '')
    .replace(/[^a-z0-9ก-๙]/g, '');

const rows = readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const files = readdirSync(path.join(dir, 'files'));
const score = { total: [0, 0], vendor: [0, 0], invoice: [0, 0], vat: [0, 0], date7: [0, 0] };
const report: string[] = [];

for (const r of rows) {
  const file = files.find((f) => f.startsWith(r.id + '.'));
  if (!file) continue;
  const mime = MIME[file.split('.').pop()!.toLowerCase()];
  if (!mime) continue;
  let f;
  try {
    f = (await extractReceipt(readFileSync(path.join(dir, 'files', file)), mime, [], engine)).fields;
  } catch (e) {
    report.push(`${r.id} ERROR ${(e as Error).message}`);
    continue;
  }
  const line: string[] = [r.id];
  const check = (k: keyof typeof score, ok: boolean, detail: string) => {
    score[k][1]++; if (ok) score[k][0]++; line.push(`${ok ? '✓' : '✗'}${k}${ok ? '' : `(${detail})`}`);
  };
  check('total', f.total !== null && Math.abs(f.total - r.total) < 0.01, `${f.total} vs ${r.total}`);
  const want = r.vfull ?? r.vendor ?? '';
  if (want) check('vendor', !!core(f.vendor_name) && (core(want).includes(core(f.vendor_name)) || core(f.vendor_name).includes(core(want))), `${f.vendor_name} vs ${want}`);
  // Order numbers like 251201 are record dates, not document numbers — skip those.
  if (r.order && !/^\d{6}$/.test(r.order)) check('invoice', f.invoice_number.toUpperCase() === r.order.toUpperCase(), `${f.invoice_number} vs ${r.order}`);
  if ((r.vatreg?.name ?? r.vatreg) === 'Yes') check('vat', f.tax_amount !== null && Math.abs(f.tax_amount - (r.total - r.exvat)) <= 0.05, `${f.tax_amount} vs ${(r.total - r.exvat).toFixed(2)}`);
  // Record date is when it was logged; the document date is usually within a week.
  if (r.date) check('date7', !!f.date && Math.abs(Date.parse(f.date) - Date.parse(r.date)) <= 7 * 864e5, `${f.date} vs ${r.date}`);
  report.push(line.join(' '));
}

const pct = ([a, b]: number[]) => (b ? `${((a / b) * 100).toFixed(0)}% (${a}/${b})` : 'n/a');
const summary = Object.entries(score).map(([k, v]) => `${k}: ${pct(v)}`).join(' · ');
console.log(summary);
writeFileSync(path.join(dir, `report-${engine}.txt`), summary + '\n' + report.join('\n') + '\n');
console.log(`details → ${path.join(dir, `report-${engine}.txt`)}`);
if (!existsSync(path.join(dir, 'files'))) console.log('no files/ directory');
await shutdownOcr();
