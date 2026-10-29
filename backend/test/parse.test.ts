import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidThaiTaxId, parseAmount, parseDate, parseReceipt, tidyCompanyName, validateFields } from '../src/extract/parse.js';

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
