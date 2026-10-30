import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidThaiTaxId, normalizeBranch, parseAmount, parseDate, parseReceipt, tidyCompanyName, validateFields } from '../src/extract/parse.js';

test('tax ID checksum', () => {
  assert.equal(isValidThaiTaxId('0105536092641'), true);
  assert.equal(isValidThaiTaxId('0105536092642'), false);
  assert.equal(isValidThaiTaxId('12345'), false);
});

test('amounts', () => {
  assert.equal(parseAmount('1,284.00'), 1284);
  assert.equal(parseAmount('2.140.00'), 2140); // OCR comma → dot
  assert.equal(parseAmount('฿ 99.50'), 99.5);
});

test('dates: Buddhist Era, Thai months, English', () => {
  assert.equal(parseDate('วันที่ 15/10/2568'), '2025-10-15');
  assert.equal(parseDate('วันที่ 21/08/68'), '2025-08-21');
  assert.equal(parseDate('วันที่ 3 กันยายน 2568'), '2025-09-03');
  assert.equal(parseDate('3 ก.ย. 68'), '2025-09-03');
  assert.equal(parseDate('Date: 28 Oct 2025'), '2025-10-28');
  assert.equal(parseDate('Date of issue September 25, 2026'), '2026-09-25');
  assert.equal(parseDate('๑๕/๑๐/๒๕๖๘'), null); // raw Thai digits are converted by parseReceipt, not parseDate
  assert.equal(parseReceipt('วันที่ ๑๕/๑๐/๒๕๖๘').date, '2025-10-15');
  assert.equal(parseDate('31/02/2568'), null);
});

test('company names', () => {
  assert.equal(tidyCompanyName('บริษัทสยามวัสดุจำกัด'), 'บริษัท สยามวัสดุ จำกัด');
  assert.equal(tidyCompanyName('บริษัท โฮม จำกัด(มหาชน)'), 'บริษัท โฮม จำกัด (มหาชน)');
});

test('full Thai tax invoice from spaced OCR text', () => {
  const f = parseReceipt(`บ ริ ษั ท สยาม วั ส ดุ จํา กั ด (สํานักงานใหญ่)
เลขประ จํา ตั ว ผู้เสียภาษี 0-1055-56012-34-1
ใบ กํา กั บภา ษี
เลข ที่ INV6810-0045
วั น ที่ 15/10/2568
รวมเงิน 2,000.00
ภาษีมูลค่าเพิ่ม 7% 140.00
จำนวนเงินรวมทั้งสิ้น 2,140.00`);
  assert.equal(f.vendor_name, 'บริษัท สยามวัสดุ จำกัด');
  assert.equal(f.vendor_taxid, '0105556012341');
  assert.equal(f.invoice_number, 'INV6810-0045');
  assert.equal(f.date, '2025-10-15');
  assert.equal(f.total, 2140);
  assert.equal(f.tax_amount, 140);
  assert.equal(f.subtotal, 2000);
  assert.equal(f.is_tax_invoice, true);
  assert.equal(f.vendor_branch, '00000');
  assert.equal(parseReceipt('123 ถนนรัชดาภิเษกแขวงห้วยขวางเขตห้วยขวางกรุงเทพฯ 10310').vendor_address, '123 ถนนรัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310');
  assert.deepEqual(validateFields(f), []);
});

test('validation warnings', () => {
  const f = parseReceipt('Tax Invoice\nTotal 1,000.00\nVAT 10.00');
  const w = validateFields(f);
  assert.ok(w.some((x) => x.includes('tax ID')));
  assert.ok(w.some((x) => x.includes('VAT')));
  assert.ok(w.some((x) => x.includes('Date')));
});

test('invoice number: document-number label wins over buyer address house numbers', () => {
  const f = parseReceipt(`ACME RETAIL (THAILAND) LIMITED
TAX ID 0105556012341
ผู้ซื้อ/NAME : บริษัท ตัวอย่าง จำกัด
ที่อยู่/ADDRESS : ชั้น 16 บ้านเลขที่ 140 ห้อง 1605 ถนนสุขุมวิท กรุงเทพมหานคร 10110
เลขประจำตัวผู้เสียภาษีอากร/TAX ID : 0105556012341
เลขที่เอกสาร NO. 694-EIV26001525
วันที่ DATE 07-02-2026`);
  assert.equal(f.invoice_number, '694-EIV26001525');
  // Address lines alone never yield a document number.
  assert.equal(parseReceipt('ที่อยู่ : เลขที่ 140 อาคาร ตัวอย่าง ถนนสุขุมวิท').invoice_number, '');
  assert.equal(parseReceipt('เลขที่ NO. HS26010042').invoice_number, 'HS26010042');
  assert.equal(parseReceipt('TAX INVOICE NO. PURCHASE ORDER').invoice_number, '');
});

test('total "มูลค่ารวม" and VAT skips the no-VAT goods line', () => {
  const f = parseReceipt(`บริษัท ตัวอย่าง จำกัด (มหาชน)
มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม 83.18 บาท
ภาษีมูลค่าเพิ่ม 5.82 บาท
มูลค่าสินค้าที่ไม่มีภาษีมูลค่าเพิ่ม 0.00 บาท
มูลค่ารวม 89.00 บาท`);
  assert.equal(f.total, 89);
  assert.equal(f.tax_amount, 5.82);
});

test('vendor: label prefix stripped; foreign legal suffixes; USD invoices', () => {
  assert.equal(parseReceipt('ชื่อบริษัท : บริษัทตัวอย่างจำกัด').vendor_name, 'บริษัท ตัวอย่าง จำกัด');
  const f = parseReceipt(`Invoice
Invoice number ABC123-0007
Date of issue September 25, 2026
Example AI, PBC
Bill to
Customer Co., Ltd.
Total $20.00`);
  assert.equal(f.vendor_name, 'Example AI, PBC');
  assert.equal(f.currency, 'USD');
  assert.equal(parseReceipt('รวมทั้งสิ้น 1,000.00 บาท').currency, 'THB');
});

test('seller branch: head office, branch numbers, buyer block ignored', () => {
  assert.equal(normalizeBranch('สาขาที่ 00012'), '00012');
  assert.equal(normalizeBranch('สาขาเลขที่ 3'), '00003');
  assert.equal(normalizeBranch('Branch No. 0021'), '00021');
  assert.equal(normalizeBranch('HEAD OFFICE'), '00000');
  assert.equal(normalizeBranch('12'), '00012');
  assert.equal(normalizeBranch('สาขา ลาดพร้าว'), '');
  assert.equal(normalizeBranch('สาขา 02-123-4567'), '');

  const f = parseReceipt(`บริษัท สยามแม็คโคร จำกัด (มหาชน) สาขาที่ 00041
เลขประจำตัวผู้เสียภาษี 0107537000521
ใบกำกับภาษี
ชื่อผู้ซื้อ บริษัท เซิร์ฟ พร็อพเพอร์ตี้ จำกัด (สำนักงานใหญ่)
เลขประจำตัวผู้เสียภาษี 0105561012345
รวมทั้งสิ้น 1,070.00`);
  assert.equal(f.vendor_branch, '00041');

  // The buyer's "head office" must not be read as the seller's
  const g = parseReceipt(`ร้าน ช่างดี การค้า
เลขประจำตัวผู้เสียภาษี 0107537000521
ใบกำกับภาษี
ชื่อผู้ซื้อ บริษัท เซิร์ฟ พร็อพเพอร์ตี้ จำกัด สำนักงานใหญ่
เลขประจำตัวผู้เสียภาษี 0105561012345
รวมทั้งสิ้น 1,070.00`);
  assert.equal(g.vendor_branch, '');
  assert.ok(validateFields(g).some((w) => w.includes('branch')));
});

test('USD receipts skip Thai VAT and tax ID checks', () => {
  const f = parseReceipt('Figma Inc\nTax Invoice\nDate 2026-10-01\nVAT 10.00\nTotal USD 100.00');
  assert.equal(f.currency, 'USD');
  const w = validateFields(f);
  assert.ok(w.some((x) => x.includes('USD') && x.includes('card statement')));
  assert.ok(!w.some((x) => x.includes('VAT') || x.includes('tax ID')));
});
