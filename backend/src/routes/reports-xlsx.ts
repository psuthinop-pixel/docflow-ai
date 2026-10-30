// Excel versions of the reports. Same figures as the JSON endpoints; layout made for an accountant.
import ExcelJS from 'exceljs';

export interface VatRow {
  date: string | null;
  invoice_number: string;
  vendor_name: string;
  vendor_taxid: string;
  vendor_branch: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: string;
  claimable: boolean;
}

interface Summary {
  range: { from: string; to: string; months: number };
  organizations: { id: string; organization_name: string }[];
  by_month: { organization_id: string; month: string; spend: number; vat_claimable: number; count: number }[];
  by_category: { organization_id: string; category: string; spend: number; count: number }[];
}

const MONEY = '#,##0.00';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const WARN_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
const THIN: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

const monthLabel = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 'YYYY-MM-DD…' → a UTC Date so Excel shows the same calendar day everywhere */
const excelDate = (v: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};

/** '00000' → สำนักงานใหญ่, '00012' → สาขาที่ 00012, '' → '' */
export const branchLabel = (b: string) => (b === '00000' ? 'สำนักงานใหญ่' : b ? `สาขาที่ ${b}` : '');

// Receipt text goes in as string cells: unlike CSV, xlsx never evaluates a string as a formula
const text = (v: unknown) => String(v ?? '');

function newBook() {
  const book = new ExcelJS.Workbook();
  book.creator = 'DocFlow AI';
  book.created = new Date();
  return book;
}

function title(ws: ExcelJS.Worksheet, lines: string[]) {
  lines.forEach((text, i) => {
    const cell = ws.getCell(i + 1, 1);
    cell.value = text;
    cell.font = i === 0 ? { bold: true, size: 14 } : { size: 11, color: { argb: 'FF475569' } };
  });
  return lines.length + 2; // first row after a blank line
}

function header(ws: ExcelJS.Worksheet, rowNo: number, labels: string[]) {
  const row = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { bold: true };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = THIN;
  });
  row.height = 32;
}

export function vatWorkbook(rows: VatRow[], orgName: string, month: string) {
  const book = newBook();
  const ws = book.addWorksheet('Input VAT', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [
    { width: 7 }, { width: 12 }, { width: 18 }, { width: 38 }, { width: 18 }, { width: 18 },
    { width: 16 }, { width: 14 }, { width: 16 }, { width: 24 },
  ];

  let r = title(ws, [
    'รายงานภาษีซื้อ / Input tax report',
    `สถานประกอบการ / Business: ${orgName}`,
    `เดือนภาษี / Tax month: ${monthLabel(month)}`,
  ]);
  const labels = [
    'ลำดับ\nNo.', 'วันที่\nDate', 'เลขที่ใบกำกับภาษี\nInvoice no.', 'ชื่อผู้ขาย\nSeller', 'เลขประจำตัวผู้เสียภาษี\nSeller tax ID',
    'สำนักงานใหญ่/สาขา\nHead office / branch', 'มูลค่าสินค้าหรือบริการ\nValue before VAT', 'ภาษีมูลค่าเพิ่ม\nVAT', 'รวม\nTotal', 'สถานะ\nFiling status',
  ];
  header(ws, r, labels);
  ws.views = [{ state: 'frozen', ySplit: r }];
  const headerRow = r;

  const put = (x: VatRow, no: number | null, status: string) => {
    r++;
    const row = ws.getRow(r);
    row.values = [
      no ?? '', excelDate(x.date) ?? '', text(x.invoice_number), text(x.vendor_name), x.vendor_taxid, branchLabel(x.vendor_branch),
      x.subtotal, x.tax_amount, x.total, status,
    ];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    row.getCell(5).numFmt = '@';
    [7, 8, 9].forEach((c) => { row.getCell(c).numFmt = MONEY; });
    // Highlight what the accountant will query: a missing branch on a claimable invoice
    if (x.claimable && !x.vendor_branch) row.getCell(6).fill = WARN_FILL;
  };

  const claimable = rows.filter((x) => x.claimable);
  const pending = rows.filter((x) => !x.claimable);
  claimable.forEach((x, i) => put(x, i + 1, 'Claimable'));
  const first = headerRow + 1;
  const last = r;

  r++;
  const total = ws.getRow(r);
  total.getCell(4).value = 'รวมภาษีซื้อที่ขอคืนได้ / Total claimable';
  const sum = (col: string, list: VatRow[], key: 'subtotal' | 'tax_amount' | 'total') => ({
    formula: claimable.length ? `SUM(${col}${first}:${col}${last})` : '0',
    result: Math.round(list.reduce((t, x) => t + x[key], 0) * 100) / 100,
  });
  total.getCell(7).value = sum('G', claimable, 'subtotal');
  total.getCell(8).value = sum('H', claimable, 'tax_amount');
  total.getCell(9).value = sum('I', claimable, 'total');
  total.font = { bold: true };
  [7, 8, 9].forEach((c) => { total.getCell(c).numFmt = MONEY; total.getCell(c).border = { top: { style: 'thin' }, bottom: { style: 'double' } }; });
  if (claimable.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: labels.length } };

  if (pending.length) {
    r += 2;
    ws.getCell(r, 1).value = 'ยังขอคืนไม่ได้ / Not claimable yet: fix these in DocFlow, then download again';
    ws.getCell(r, 1).font = { bold: true, color: { argb: 'FFB45309' } };
    r++;
    header(ws, r, labels);
    pending.forEach((x) => put(x, null, x.status === 'draft' ? 'Not reviewed (draft)' : 'Missing seller tax ID'));
  }

  return book;
}

export function summaryWorkbook(d: Summary, who: string) {
  const book = newBook();
  const months: string[] = [];
  for (let m = d.range.from; months.length < d.range.months; ) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const orgs = d.organizations;
  const period = `${monthLabel(d.range.from)} – ${monthLabel(d.range.to)}`;
  const colLetter = (n: number) => String.fromCharCode(64 + n); // fine up to Z: a handful of properties

  // Sheet 1: spend by month, one column per property, totals by formula
  const byMonth = book.addWorksheet('By month');
  let r = title(byMonth, [`Spend by month · ${who}`, period, 'All records except disabled ones, by receipt date']);
  header(byMonth, r, ['Month', ...orgs.map((o) => o.organization_name), 'Total']);
  byMonth.columns = [{ width: 16 }, ...orgs.map(() => ({ width: 22 })), { width: 18 }];
  byMonth.views = [{ state: 'frozen', ySplit: r, xSplit: 1 }];
  const top = r + 1;
  const spend = (m: string, id: string) => d.by_month.find((x) => x.month === m && x.organization_id === id)?.spend ?? 0;
  months.forEach((m) => {
    r++;
    const row = byMonth.getRow(r);
    row.getCell(1).value = monthLabel(m);
    orgs.forEach((o, i) => { row.getCell(i + 2).value = spend(m, o.id); row.getCell(i + 2).numFmt = MONEY; });
    const t = row.getCell(orgs.length + 2);
    t.value = { formula: `SUM(B${r}:${colLetter(orgs.length + 1)}${r})`, result: orgs.reduce((s, o) => s + spend(m, o.id), 0) };
    t.numFmt = MONEY;
    t.font = { bold: true };
  });
  r++;
  const totals = byMonth.getRow(r);
  totals.getCell(1).value = 'Total';
  for (let c = 2; c <= orgs.length + 2; c++) {
    const L = colLetter(c);
    const result = c <= orgs.length + 1 ? months.reduce((s, m) => s + spend(m, orgs[c - 2].id), 0) : d.by_month.reduce((s, x) => s + x.spend, 0);
    totals.getCell(c).value = { formula: `SUM(${L}${top}:${L}${r - 1})`, result: Math.round(result * 100) / 100 };
    totals.getCell(c).numFmt = MONEY;
  }
  totals.font = { bold: true };

  // Sheet 2: spend by category, per property
  const byCat = book.addWorksheet('By category');
  r = title(byCat, [`Spend by category · ${who}`, period]);
  header(byCat, r, ['Category', ...orgs.map((o) => o.organization_name), 'Total', 'Records']);
  byCat.columns = [{ width: 26 }, ...orgs.map(() => ({ width: 22 })), { width: 18 }, { width: 10 }];
  const cats = [...new Set(d.by_category.map((x) => x.category))];
  const catTotal = (c: string) => d.by_category.filter((x) => x.category === c).reduce((s, x) => s + x.spend, 0);
  cats.sort((a, b) => catTotal(b) - catTotal(a)).forEach((c) => {
    r++;
    const row = byCat.getRow(r);
    row.getCell(1).value = text(c);
    orgs.forEach((o, i) => {
      row.getCell(i + 2).value = d.by_category.find((x) => x.category === c && x.organization_id === o.id)?.spend ?? 0;
      row.getCell(i + 2).numFmt = MONEY;
    });
    row.getCell(orgs.length + 2).value = { formula: `SUM(B${r}:${colLetter(orgs.length + 1)}${r})`, result: catTotal(c) };
    row.getCell(orgs.length + 2).numFmt = MONEY;
    row.getCell(orgs.length + 2).font = { bold: true };
    row.getCell(orgs.length + 3).value = d.by_category.filter((x) => x.category === c).reduce((s, x) => s + x.count, 0);
  });

  // Sheet 3: claimable input VAT by month and property
  const vat = book.addWorksheet('Input VAT');
  r = title(vat, [`Claimable input VAT · ${who}`, period, 'Confirmed or approved, VAT > 0, with a 13-digit seller tax ID']);
  header(vat, r, ['Month', ...orgs.map((o) => o.organization_name), 'Total']);
  vat.columns = [{ width: 16 }, ...orgs.map(() => ({ width: 22 })), { width: 18 }];
  const vatOf = (m: string, id: string) => d.by_month.find((x) => x.month === m && x.organization_id === id)?.vat_claimable ?? 0;
  months.forEach((m) => {
    r++;
    const row = vat.getRow(r);
    row.getCell(1).value = monthLabel(m);
    orgs.forEach((o, i) => { row.getCell(i + 2).value = vatOf(m, o.id); row.getCell(i + 2).numFmt = MONEY; });
    row.getCell(orgs.length + 2).value = { formula: `SUM(B${r}:${colLetter(orgs.length + 1)}${r})`, result: orgs.reduce((s, o) => s + vatOf(m, o.id), 0) };
    row.getCell(orgs.length + 2).numFmt = MONEY;
  });

  // Sheet 4: long format for pivot tables
  const data = book.addWorksheet('Data');
  header(data, 1, ['Month', 'Property', 'Spend', 'Claimable VAT', 'Records']);
  data.columns = [{ width: 12 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 10 }];
  const names = Object.fromEntries(orgs.map((o) => [o.id, o.organization_name]));
  d.by_month.forEach((x, i) => {
    const row = data.getRow(i + 2);
    row.values = [x.month, names[x.organization_id], x.spend, x.vat_claimable, x.count];
    row.getCell(3).numFmt = MONEY;
    row.getCell(4).numFmt = MONEY;
  });
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(d.by_month.length + 1, 1), column: 5 } };

  return book;
}
