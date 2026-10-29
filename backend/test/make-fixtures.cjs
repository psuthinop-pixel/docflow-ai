// Renders synthetic Thai/English receipts to PNG + PDF with Chromium, plus expected.json.
// Run: node test/make-fixtures.cjs   (needs playwright + Thai fonts, e.g. fonts-tlwg)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'fixtures');

const receipts = [
  {
    id: 'thai-tax-invoice',
    expected: { vendor_taxid: '0105556012341', invoice_number: 'INV6810-0045', date: '2025-10-15', total: 2140, tax_amount: 140, is_tax_invoice: true, vendor_name: 'บริษัท สยามวัสดุ จำกัด' },
    html: `<h2>บริษัท สยามวัสดุ จำกัด (สำนักงานใหญ่)</h2>
      <p>123 ถนนรัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310</p>
      <p>เลขประจำตัวผู้เสียภาษี 0105556012341</p>
      <h3>ใบกำกับภาษี / ใบเสร็จรับเงิน</h3>
      <p>เลขที่ INV6810-0045</p><p>วันที่ 15/10/2568</p>
      <table><tr><td>หลอดไฟ LED 3000K</td><td>10</td><td>2,000.00</td></tr></table>
      <p>รวมเงิน 2,000.00</p><p>ภาษีมูลค่าเพิ่ม 7% 140.00</p><p><b>จำนวนเงินรวมทั้งสิ้น 2,140.00</b></p>`,
  },
  {
    id: 'thai-month-name',
    expected: { vendor_taxid: '0994000165340', invoice_number: 'RC2568-1188', date: '2025-09-03', total: 856, tax_amount: 56, is_tax_invoice: true },
    html: `<h2>ห้างหุ้นส่วนจำกัด ไทยซัพพลาย</h2>
      <p>45 ถนนพระราม 9 เขตห้วยขวาง กรุงเทพมหานคร 10310</p>
      <p>เลขประจำตัวผู้เสียภาษีอากร 0-9940-00165-34-0</p>
      <h3>ใบกำกับภาษีอย่างย่อ</h3>
      <p>เลขที่ RC2568-1188</p><p>วันที่ 3 กันยายน 2568</p>
      <p>น้ำยาทำความสะอาด 800.00</p>
      <p>ภาษีมูลค่าเพิ่ม 56.00</p><p><b>ยอดสุทธิ 856.00</b></p>`,
  },
  {
    id: 'english-retail',
    expected: { vendor_taxid: '0107542000011', invoice_number: 'T25-778812', date: '2025-10-28', total: 1284, tax_amount: 84, is_tax_invoice: true },
    html: `<h2>CP ALL Public Company Limited</h2>
      <p>313 Silom Road, Bang Rak, Bangkok 10500</p>
      <p>TAX ID 0107542000011</p><h3>TAX INVOICE (ABB)</h3>
      <p>Receipt No: T25-778812</p><p>Date: 28 Oct 2025</p>
      <p>Coffee beans 1,200.00</p><p>VAT 7% 84.00</p><p><b>TOTAL 1,284.00</b></p>`,
  },
  {
    id: 'short-be-year',
    expected: { vendor_taxid: '0105536092641', invoice_number: 'HP-99231', date: '2025-08-21', total: 5350, tax_amount: 350, is_tax_invoice: true },
    html: `<h2>บริษัท โฮม โปรดักส์ เซ็นเตอร์ จำกัด (มหาชน)</h2>
      <p>96/27 ถนนประชาชื่น ตำบลบางเขน อำเภอเมือง นนทบุรี 11000</p>
      <p>Tax ID: 0105536092641</p><h3>ใบเสร็จรับเงิน/ใบกำกับภาษี</h3>
      <p>Invoice No. HP-99231</p><p>วันที่ 21/08/68</p>
      <p>ชั้นวางไม้ 5,000.00</p><p>VAT 350.00</p><p><b>Grand Total 5,350.00</b></p>`,
  },
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 2 });
  const expected = {};
  for (const r of receipts) {
    await page.setContent(`<html><body style="font-family:'Loma','Garuda',sans-serif;font-size:18px;padding:24px;width:560px;color:#111">${r.html}</body></html>`);
    await page.screenshot({ path: path.join(out, `${r.id}.png`), fullPage: true });
    expected[`${r.id}.png`] = r.expected;
  }
  // Phone-photo style variants: slight rotation, blur, low contrast, off-white paper.
  const degrade = 'transform:rotate(-1.5deg);filter:blur(0.6px) contrast(0.75) brightness(1.05);background:#efe9dc';
  for (const r of receipts.slice(0, 2).concat(receipts[3])) {
    await page.setContent(`<html><body style="margin:0;background:#bbb"><div style="font-family:'Loma','Garuda',sans-serif;font-size:18px;padding:24px;width:560px;color:#333;margin:30px;${degrade}">${r.html}</div></body></html>`);
    await page.screenshot({ path: path.join(out, `${r.id}-photo.jpg`), fullPage: true, type: 'jpeg', quality: 60 });
    expected[`${r.id}-photo.jpg`] = r.expected;
  }
  // Scanned PDF (image only, no text layer).
  const img = fs.readFileSync(path.join(out, 'short-be-year-photo.jpg')).toString('base64');
  await page.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/jpeg;base64,${img}"></body></html>`);
  await page.pdf({ path: path.join(out, 'short-be-year-scan.pdf'), width: '148mm', height: '210mm' });
  expected['short-be-year-scan.pdf'] = receipts[3].expected;
  // Digital PDF with a text layer (e-Tax style).
  await page.setContent(`<html><body style="font-family:'Loma',sans-serif;font-size:16px;padding:24px">${receipts[0].html}</body></html>`);
  await page.pdf({ path: path.join(out, 'thai-tax-invoice.pdf'), width: '148mm', height: '210mm' });
  expected['thai-tax-invoice.pdf'] = receipts[0].expected;
  fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  await browser.close();
})();
