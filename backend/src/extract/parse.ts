// Rule-based field extraction from OCR text of Thai / English receipts and tax invoices.

export interface ReceiptFields {
  vendor_name: string;
  vendor_taxid: string;
  vendor_address: string;
  invoice_number: string;
  date: string | null; // ISO date (YYYY-MM-DD), Gregorian
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
  currency: string;
  is_tax_invoice: boolean;
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

const THAI_MONTHS: [RegExp, number][] = [
  [/^(มกราคม|ม\.?ค\.?)$/, 1], [/^(กุมภาพันธ์|ก\.?พ\.?)$/, 2], [/^(มีนาคม|มี\.?ค\.?)$/, 3],
  [/^(เมษายน|เม\.?ย\.?)$/, 4], [/^(พฤษภาคม|พ\.?ค\.?)$/, 5], [/^(มิถุนายน|มิ\.?ย\.?)$/, 6],
  [/^(กรกฎาคม|ก\.?ค\.?)$/, 7], [/^(สิงหาคม|ส\.?ค\.?)$/, 8], [/^(กันยายน|ก\.?ย\.?)$/, 9],
  [/^(ตุลาคม|ต\.?ค\.?)$/, 10], [/^(พฤศจิกายน|พ\.?ย\.?)$/, 11], [/^(ธันวาคม|ธ\.?ค\.?)$/, 12],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Convert Thai numerals to Arabic and normalise whitespace. */
export function normalizeText(text: string): string {
  return text
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/ํา/g, 'ำ') // นิคหิต + สระอา → สระอำ (common OCR / PDF split)
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    // OCR engines and PDF text layers put spaces inside Thai words; Thai has no inter-word spaces.
    .replace(/(?<=[ก-๛]) (?=[ก-๛])/g, '');
}

/** Thai 13-digit tax ID / national ID checksum (mod 11). */
export function isValidThaiTaxId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export function parseAmount(s: string): number | null {
  let t = s.replace(/[฿\s]/g, '').replace(/บาท$/, '');
  // OCR often reads thousands commas as dots: 2.140.00 → 2140.00
  if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(t)) t = t.replace(/\.(?=\d{3}\.)/g, '');
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Years ≥ 2400 are Buddhist Era; 2-digit years are BE when > 50 (e.g. 68 → 2568). */
function toGregorianYear(y: number): number {
  if (y < 100) y = y > 50 ? 2500 + y : 2000 + y;
  return y >= 2400 ? y - 543 : y;
}

function isoDate(y: number, m: number, d: number): string | null {
  y = toGregorianYear(y);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseDate(text: string): string | null {
  // Prefer a date on a line that is labelled as the date.
  const lines = text.split('\n');
  const labelled = lines.filter((l) => /(วันที่|date)/i.test(l) && !/(due|ครบกำหนด)/i.test(l));
  for (const src of [...labelled, text]) {
    // 25/10/2568, 25-10-68, 2025-10-25
    let m = src.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (m) { const r = isoDate(+m[1], +m[2], +m[3]); if (r) return r; }
    m = src.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) { const r = isoDate(+m[3], +m[2], +m[1]); if (r) return r; }
    // 25 ตุลาคม 2568 / 25 ต.ค. 68
    m = src.match(/(\d{1,2})\s*([ก-๙.]+)\s*(\d{2,4})/);
    if (m) {
      const mon = THAI_MONTHS.find(([re]) => re.test(m![2].trim()));
      if (mon) { const r = isoDate(+m[3], mon[1], +m[1]); if (r) return r; }
    }
    // 25 Oct 2025
    m = src.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?,?\s*(\d{2,4})/);
    if (m) {
      const idx = EN_MONTHS.indexOf(m[2].toLowerCase());
      if (idx >= 0) { const r = isoDate(+m[3], idx + 1, +m[1]); if (r) return r; }
    }
  }
  return null;
}

function findTaxIds(text: string): string[] {
  const out: string[] = [];
  // 13 digits, optionally grouped as 0-1055-12345-67-8 or with spaces.
  for (const m of text.matchAll(/(?<!\d)(\d[\d\s-]{11,20}\d)(?!\d)/g)) {
    const digits = m[1].replace(/[\s-]/g, '');
    if (digits.length === 13) out.push(digits);
  }
  return out;
}

const AMOUNT = String.raw`([0-9]{1,3}(?:[.,][0-9]{3})+\.\d{2}|[0-9][0-9,]*\.\d{2}|[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)`;

/** Last amount on the first line matching any label (receipts list totals near the bottom). */
function amountAfter(lines: string[], labels: RegExp, exclude?: RegExp): number | null {
  const amountsIn = (line: string) =>
    [...line.matchAll(new RegExp(AMOUNT, 'g'))]
      .map((m) => m[1])
      .filter((s) => !/^(7|07)$/.test(s)); // skip the "7" in "VAT 7%"
  let found: number | null = null;
  lines.forEach((line, i) => {
    if (!labels.test(line) || (exclude && exclude.test(line))) return;
    let nums = amountsIn(line);
    // Narrow receipts often print the amount right-aligned on the next line.
    const next = lines[i + 1] ?? '';
    if (!nums.length && !/[A-Za-z]/.test(next) && (next.match(/[ก-๙]/g) ?? []).length <= 3) nums = amountsIn(next);
    const last = nums.length ? parseAmount(nums[nums.length - 1]) : null;
    if (last !== null) found = last;
  });
  return found;
}

const INVOICE_LABELS = [
  /(?:receipt|invoice|inv|bill|doc(?:ument)?)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  /เลขที่\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  /\bno\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
];

function findInvoiceNumber(lines: string[], taxid: string): string {
  for (const re of INVOICE_LABELS) {
    for (const line of lines) {
      if (/(ผู้เสียภาษี|ประจำตัว|tax\s*id)/i.test(line)) continue;
      const m = line.match(re);
      if (m && m[1].replace(/\D/g, '') !== taxid) return m[1];
    }
  }
  return '';
}

/** Restore the conventional spaces in Thai company names after OCR de-spacing. */
export function tidyCompanyName(name: string): string {
  return name
    .replace(/^(บริษัท|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญ|หจก\.|บจก\.)\s*/, '$1 ')
    .replace(/(?<=\S)\s*จำกัด(\s*\(มหาชน\))?$/, (_m, pub) => ' จำกัด' + (pub ? ' (มหาชน)' : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReceipt(raw: string): ReceiptFields {
  const text = normalizeText(raw);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const taxIds = findTaxIds(text);
  const vendor_taxid = taxIds.find(isValidThaiTaxId) ?? taxIds[0] ?? '';

  const invoice_number = findInvoiceNumber(lines, vendor_taxid);

  const total = amountAfter(
    lines,
    /(ยอดสุทธิ|รวมทั้งสิ้น|ยอดรวมสุทธิ|จำนวนเงินรวม|รวมภาษีมูลค่าเพิ่ม|baht\s*\(?\s*vat\s*incl|grand\s*total|net\s*total|total\s*amount|amount\s*due|^total\b|\btotal\b)/i,
    /(sub\s*total|ก่อน\s*vat|before\s*vat|ไม่รวม)/i,
  );
  const tax_amount = amountAfter(lines, /(ภาษีมูลค่าเพิ่ม|vat|ภาษี)/i, /(ก่อน|before|ไม่รวม|excl|ราคารวม|incl|ผู้เสียภาษี|ประจำตัว|tax\s*id)/i);
  const subtotal = amountAfter(lines, /(sub\s*total|ก่อน\s*vat|before\s*vat|มูลค่าสินค้า|ราคาไม่รวม|รวมเงิน)/i);

  // Vendor: first line that looks like a company name, else the first non-numeric line.
  const vendorLine =
    lines.find((l) => /(บริษัท|ห้างหุ้นส่วน|หจก\.|บจก\.|บมจ\.|co\.,?\s*ltd|company|limited|public)/i.test(l)) ??
    // State enterprises and agencies: การทางพิเศษแห่งประเทศไทย, การไฟฟ้านครหลวง, กรม..., องค์การ...
    lines.find((l) => /(^การ[ก-๙]{3,}|^องค์การ|^กรม[ก-๙]|^สำนักงาน[ก-๙]|แห?่?งประเทศไทย|มหาวิทยาลัย|โรงพยาบาล)/.test(l)) ??
    lines.find((l) => (l.match(/[A-Za-zก-๙]/g) ?? []).length >= 6 && !/(ใบเสร็จ|ใบกำกับ|ใบรับ|receipt|invoice|tax)/i.test(l)) ??
    '';
  const vendor_name = tidyCompanyName(vendorLine.replace(/\s*(\((?!มหาชน).*\)|สำนักงานใหญ่|head\s*office)\s*$/i, '').trim());

  const addrIdx = lines.findIndex((l) => /(ถนน|ถ\.|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|กรุงเทพ|road|bangkok|\b\d{5}\b)/i.test(l));
  const vendor_address = addrIdx >= 0
    ? lines[addrIdx].replace(/(?<=\S)(ถนน|ถ\.|ซอย|แขวง|เขต|ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.|กรุงเทพ)/g, ' $1').replace(/\s+/g, ' ')
    : '';

  return {
    vendor_name,
    vendor_taxid,
    vendor_address,
    invoice_number,
    date: parseDate(text),
    subtotal,
    tax_amount,
    total,
    currency: 'THB',
    is_tax_invoice: /(ใบกำกับภาษี|tax\s*invoice)/i.test(text),
  };
}

/** Sanity checks surfaced to the reviewer; never blocks saving. */
export function validateFields(f: ReceiptFields): string[] {
  const warnings: string[] = [];
  if (f.vendor_taxid && !isValidThaiTaxId(f.vendor_taxid)) warnings.push('Tax ID checksum is invalid');
  if (f.is_tax_invoice && !f.vendor_taxid) warnings.push('Tax invoice without a vendor tax ID');
  if (f.total === null) warnings.push('Total not found');
  if (!f.date) warnings.push('Date not found');
  if (f.total !== null && f.tax_amount !== null && f.tax_amount > 0) {
    const expected = Math.round((f.total * 7) / 107 * 100) / 100;
    if (Math.abs(expected - f.tax_amount) > 1) warnings.push(`VAT ${f.tax_amount} is not 7% of total (expected ≈ ${expected})`);
  }
  return warnings;
}
