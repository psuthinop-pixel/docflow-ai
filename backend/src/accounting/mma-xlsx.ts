// Monthly management account pack as an Excel workbook (one sheet per section).
import ExcelJS from 'exceljs';
import type { Pack } from './mma.js';
import type { CommentaryResult } from './commentary.js';

const MONEY = '#,##0.00';
const PCT = '0.0"%"';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const REASONS: Record<string, string> = {
  fuel: 'Fuel (passenger car): VAT kept in cost', excluded: 'Marked not claimable', missing_tax_id: 'No 13-digit seller tax ID',
};

function sheet(book: ExcelJS.Workbook, name: string, title: string, sub: string, labels: string[], widths: number[]) {
  const ws = book.addWorksheet(name);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = sub;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF475569' } };
  const head = ws.getRow(4);
  head.values = labels;
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = HEADER_FILL; });
  ws.columns = widths.map((width) => ({ width }));
  return ws;
}

function rows(ws: ExcelJS.Worksheet, data: unknown[][], formats: Record<number, string> = {}) {
  data.forEach((values, i) => {
    const row = ws.getRow(i + 5);
    row.values = values as ExcelJS.CellValue[];
    for (const [col, fmt] of Object.entries(formats)) row.getCell(Number(col)).numFmt = fmt;
  });
}

export function mmaWorkbook(p: Pack, who: string, commentary: CommentaryResult | null) {
  const book = new ExcelJS.Workbook();
  book.creator = 'DocFlow AI';
  book.created = new Date();
  const status = p.status === 'closed' ? 'Closed month (figures final)' : 'PROVISIONAL: month not closed, figures may change';
  const sub = `${who} · ${p.month} · ${status}`;

  // Summary
  const s = book.addWorksheet('Summary');
  s.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  s.getCell('A1').value = `Monthly management accounts · ${who} · ${p.month}`;
  s.getCell('A1').font = { bold: true, size: 14 };
  s.getCell('A2').value = status;
  s.getCell('A2').font = { bold: p.status !== 'closed', color: { argb: p.status === 'closed' ? 'FF475569' : 'FFB45309' } };
  s.getCell('A3').value = p.revenue
    ? 'Gross operating profit (GOP) = revenue − operating costs, before depreciation (not booked yet).'
    : 'Revenue is not captured in DocFlow yet: this is a cost statement, not a full P&L.';
  s.getCell('A3').font = { size: 10, color: { argb: 'FF475569' } };
  const head = s.getRow(5);
  head.values = ['', 'This month', 'Previous month', 'Same month last year', ...(p.budget ? ['Budget', 'Variance'] : [])];
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = HEADER_FILL; });
  const sm = p.summary;
  const rv = p.revenue;
  const lines: [string, number | null, number | null, number | null][] = [
    ...(rv ? [
      ['Revenue', rv.total, rv.prev, rv.ly],
      ['Gross operating profit (GOP)', sm.gop, sm.gop_prev, null],
      ['GOP margin (%)', sm.gop_margin_pct, null, null],
    ] as [string, number | null, number | null, number | null][] : []),
    ['Operating costs', sm.opex, sm.opex_prev, sm.opex_ly],
    ['Change vs previous month (%)', sm.opex_change_pct, null, null],
    ['Change vs same month last year (%)', sm.opex_yoy_pct, null, null],
    ['Capex this month', sm.capex, null, null],
    ['Capex year to date', sm.capex_ytd, null, null],
    ['Input VAT claimable', sm.input_vat, null, null],
    ['ภ.พ.36 VAT on foreign services', sm.pp36_vat, null, null],
    ['VAT not claimable (in cost)', sm.vat_not_claimable, null, null],
    ['Advances paid out of pocket this month', sm.advances_opened, null, null],
    ['Advances repaid this month', sm.advances_repaid, null, null],
    ['Advances owed at month end', sm.advances_outstanding, null, null],
    ['Cash paid from company accounts', sm.cash_out, null, null],
    ...(rv ? [
      ['Room nights sold', rv.room_nights, null, null],
      ['Occupancy (%)', rv.occupancy_pct, null, null],
      ['ADR (average daily rate)', rv.adr, null, null],
      ['RevPAR', rv.revpar, null, null],
    ] as [string, number | null, number | null, number | null][] : []),
  ];
  const bud = p.budget;
  const budgetOf: Record<string, [number | null, number | null]> = bud ? {
    'Revenue': [bud.revenue, bud.revenue_var], 'Gross operating profit (GOP)': [bud.gop, bud.gop_var], 'Operating costs': [bud.opex, bud.opex_var],
  } : {};
  lines.forEach((l, i) => {
    const row = s.getRow(6 + i);
    row.values = [...l, ...(budgetOf[l[0]] ?? [])];
    [5, 6].forEach((c) => { row.getCell(c).numFmt = MONEY; });
    const isPct = l[0].includes('(%)');
    const isCount = l[0].startsWith('Room nights');
    [2, 3, 4].forEach((c) => { row.getCell(c).numFmt = isPct ? PCT : isCount ? '#,##0' : MONEY; });
  });
  let r = 6 + lines.length + 1;
  if (commentary) {
    s.getCell(`A${r}`).value = 'Commentary';
    s.getCell(`A${r++}`).font = { bold: true, size: 12 };
    const put = (t: string) => { s.getCell(`A${r}`).value = t; s.getCell(`A${r++}`).alignment = { wrapText: true }; s.mergeCells(`A${r - 1}:D${r - 1}`); };
    if (commentary.headline) put(commentary.headline);
    for (const [label, list] of [['Highlights', commentary.highlights], ['Risks', commentary.risks], ['Actions', commentary.actions]] as const) {
      if (!list.length) continue;
      s.getCell(`A${r++}`).value = label;
      list.forEach((x) => put(`• ${x}`));
    }
    s.getCell(`A${r++}`).value = `Written by Claude from the figures above (${commentary.generated_at.slice(0, 10)}).`;
    r++;
  }
  if (p.checklist.blockers.length || p.checklist.warnings.length) {
    s.getCell(`A${r}`).value = 'Close checklist';
    s.getCell(`A${r++}`).font = { bold: true, size: 12 };
    for (const b of p.checklist.blockers) s.getCell(`A${r++}`).value = `✗ ${b.message} (${b.count})`;
    for (const w of p.checklist.warnings) s.getCell(`A${r++}`).value = `! ${w.message} (${w.count})`;
  }

  if (rv) {
    const rs = sheet(book, 'Revenue', 'Revenue', sub, ['Account', 'Name', 'This month', 'Previous month', 'Same month LY', 'Budget', 'Variance'], [12, 36, 16, 16, 16, 16, 16]);
    rows(rs, rv.by_account.map((x) => [x.code, x.name, x.amount, x.prev, x.ly, x.budget ?? null, x.variance ?? null]), { 3: MONEY, 4: MONEY, 5: MONEY, 6: MONEY, 7: MONEY });
    const ch = rs.getRow(rv.by_account.length + 7);
    ch.values = ['By channel', '', 'Net revenue', 'Commission', 'Room nights'];
    ch.font = { bold: true };
    rv.by_channel.forEach((c, i) => {
      const row = rs.getRow(rv.by_account.length + 8 + i);
      row.values = ['', c.channel, c.net, c.commission, c.room_nights];
      row.getCell(3).numFmt = MONEY;
      row.getCell(4).numFmt = MONEY;
    });
  }

  const opex = sheet(book, 'Operating costs', 'Operating costs by account', sub,
    ['Account', 'Name', 'This month', 'Previous month', 'Change %', 'Same month LY', 'Share %', 'Budget', 'Variance', 'Variance %'], [12, 36, 16, 16, 12, 16, 10, 16, 16, 12]);
  rows(opex, p.opex.map((o) => [o.code, o.name, o.amount, o.prev, o.change_pct, o.ly, o.share_pct, o.budget ?? null, o.variance ?? null, o.variance_pct ?? null]),
    { 3: MONEY, 4: MONEY, 5: PCT, 6: MONEY, 7: PCT, 8: MONEY, 9: MONEY, 10: PCT });
  const vend = opex.getRow(p.opex.length + 7);
  vend.values = ['Top vendors', '', 'Amount', 'Receipts'];
  vend.font = { bold: true };
  p.top_vendors.forEach((v, i) => {
    const row = opex.getRow(p.opex.length + 8 + i);
    row.values = ['', v.vendor, v.amount, v.count];
    row.getCell(3).numFmt = MONEY;
  });

  const cap = sheet(book, 'Capex', 'Capital expenditure', sub, ['Date', 'Vendor', 'Account', 'Name', 'Amount', 'Property'], [12, 28, 12, 32, 16, 20]);
  rows(cap, p.capex.items.map((x) => [x.date, x.vendor, x.code, x.name, x.amount, x.property ?? '']), { 5: MONEY });
  const ytdRow = p.capex.items.length + 7;
  cap.getRow(ytdRow).values = ['Year to date by category'];
  cap.getRow(ytdRow).font = { bold: true };
  p.capex.ytd.forEach((y, i) => {
    const row = cap.getRow(ytdRow + 1 + i);
    row.values = ['', y.category, '', '', y.amount];
    row.getCell(5).numFmt = MONEY;
  });

  const adv = sheet(book, 'Advances', 'Advances owed at month end', sub, ['Paid by', 'Receipts', 'Owed', 'Oldest month', 'Property'], [24, 10, 16, 14, 20]);
  rows(adv, p.advances.outstanding.map((x) => [x.paid_by, x.count, x.total, x.oldest_month, x.property ?? '']), { 3: MONEY });

  const vat = sheet(book, 'VAT', 'VAT position', sub, ['Item', 'Receipts', 'Amount'], [44, 10, 16]);
  rows(vat, [
    ['Input VAT claimable', null, sm.input_vat],
    ['ภ.พ.36 VAT payable (claimable next month)', null, sm.pp36_vat],
    ...p.vat.not_claimable.map((x) => [`Not claimable: ${REASONS[x.reason] ?? x.reason}`, x.count, x.vat]),
  ], { 3: MONEY });

  const cash = sheet(book, 'Cash', 'Cash paid from company accounts, by week', sub, ['Days', 'Operating', 'Capex', 'Advances repaid', 'Total'], [12, 16, 16, 16, 16]);
  rows(cash, p.cash.weeks.map((w) => [w.week, w.opex, w.capex, w.reimbursements, w.total]), { 2: MONEY, 3: MONEY, 4: MONEY, 5: MONEY });

  if (p.by_property) {
    const bp = sheet(book, 'By property', 'By property', sub, ['Property', 'Status', 'Revenue', 'GOP', 'Occupancy %', 'Operating costs', 'Capex', 'Input VAT', 'Advances owed', 'Cash out'], [28, 12, 16, 16, 12, 16, 16, 16, 16, 16]);
    rows(bp, p.by_property.map((x) => [x.name, x.status, x.revenue, x.gop, x.occupancy_pct, x.opex, x.capex, x.input_vat, x.advances_outstanding, x.cash_out]),
      { 3: MONEY, 4: MONEY, 5: PCT, 6: MONEY, 7: MONEY, 8: MONEY, 9: MONEY, 10: MONEY });
  }
  return book;
}
