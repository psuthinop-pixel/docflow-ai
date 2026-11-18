# DocFlow AI: Bookkeeping & Monthly Management Accounts

Status: **design. Nothing below is built yet** unless marked ✅.
Owner decisions still needed are in [Open decisions](#open-decisions); don't guess them in code.

## Goal
Every confirmed or approved expense in DocFlow becomes a correct, balanced journal entry. Each month, the
owner gets a **monthly management account (MMA) pack** per property, and for the group, without
re-keying data.

**Decision (Nov 2026): there is no accounting software yet.** So:
- DocFlow keeps its **own journal** (double-entry lines generated from expenses) and builds the MMA pack from it.
  This is management accounting, not the statutory books.
- The chart of accounts starts from a **standard Thai SME chart (TFRS for NPAEs layout)** seeded per property,
  which the owner/accountant can rename or extend. Account codes are editable, so a later move to real
  software is a mapping exercise, not a rebuild.
- Exports use a **neutral journal format** (.xlsx/CSV: date, document no., account code, account name,
  debit, credit, property, vendor, tax ID, description). Any accountant can import or key it, and an
  adapter for specific software (Express, PEAK, FlowAccount, Xero…) can be added once one is chosen.
- Out of scope for DocFlow: statutory financial statements, ภ.ง.ด.50/51, audit. Those stay with the accountant.

```
Receipt ──► Expense (DocFlow) ──► Journal lines ──► (1) Export to accountant's GL
             review/approve        auto-generated     (2) MMA pack: P&L, capex, advances, VAT, cash
```

## What the expense record already carries ✅
| Field | Accounting meaning |
|---|---|
| `date` | Tax point / invoice date: the period the cost belongs to (accrual) |
| `total`, `subtotal`, `tax_amount`, `*_thb` | Gross, net, input VAT; THB amounts for FX receipts |
| `vendor_name`, `vendor_taxid`, `vendor_branch`, `invoice_number` | Supplier identity for the input VAT report and AP |
| `category` | Drives the GL expense account (mapping below) |
| `vat_claim` + fuel rule | Whether VAT goes to Input VAT or is added to the cost |
| `capex` + Asset category | Fixed asset vs operating expense |
| `payment_source`, `paid_by`, `reimbursed_at` | Credit side: bank vs employee/director advance payable |
| `supply_type`, `currency`, `fx_*` | ภ.พ.36 reverse-charge VAT on foreign services |
| `status` | Only `confirmed` / `approved` post; `draft` and `disabled` never do |

Business rules already decided by the owner (keep these):
- **Fuel:** VAT is not claimable by default (passenger cars, ม.82/5). The cost is an expense *including* VAT.
  Pickup/van/truck fuel → `vat_claim = 'yes'`.
- **Capex:** category Asset (or `capex = 'yes'`) is capitalised, not expensed. Its VAT is still claimable.
- **Advances:** สำรองจ่าย is still a cost of the business when incurred; the liability to the person
  stays open until `reimbursed_at`.

## Posting rules (proposed)
Account names are placeholders until the accountant's chart of accounts is loaded (Phase A).

| Case | Debit | Credit |
|---|---|---|
| Opex, VAT claimable, company paid | Expense (by category) = net; Input VAT = VAT | Bank = gross |
| Opex, VAT **not** claimable (fuel, `vat_claim = 'no'`, no tax invoice) | Expense = gross | Bank = gross |
| Employee advance (any of the above) | same debits | **Advances payable: <paid_by>** = gross |
| Reimbursement of an advance (`reimbursed_at` set) | Advances payable: <paid_by> | Bank |
| Capex | Fixed asset (by class) = net; Input VAT | Bank or Advances payable |
| Monthly depreciation (generated) | Depreciation expense | Accumulated depreciation |
| Foreign service (`supply_type = 'service'`, ภ.พ.36) | Expense = THB amount; Input VAT (claimable the following month) | Bank; VAT payable ภ.พ.36 = 7% |
| Withholding tax deducted (not captured yet) | (as above) | Bank = net paid; WHT payable ภ.ง.ด.3/53 |
| Unpaid supplier invoice (credit terms; needs a payment date) | (as above) | Accounts payable: supplier |

Every entry must balance; the generator gets a unit test per row of this table.

## Monthly management account pack (per property + consolidated)
1. **P&L summary:** revenue (see gap below), operating expenses by category/GL, EBITDA, depreciation,
   vs prior month, same month last year and budget.
2. **Opex detail:** by category and vendor, top movers, and items still in draft (a cut-off warning).
3. **Capex & fixed asset register:** additions this month, cumulative per project (e.g. Atrium Ratchada 13
   FF&E), depreciation, NBV.
4. **Advances & payables:** owed per person (✅ data exists), ageing, reimbursed this month.
5. **VAT position:** input VAT claimable (✅), not claimable and why (✅), ภ.พ.36, output VAT from revenue,
   net payable/refundable for ภ.พ.30.
6. **Cash view:** company-paid outflows by week, advances settled, capex cash.
7. **Close checklist:** zero drafts in the month, all FX converted, all tax invoices have a branch, period locked.

## Gaps the current data model doesn't cover
- **Revenue.** DocFlow only holds costs. The P&L needs room revenue / other income from the PMS, OTA
  statements or bank deposits. Without it the pack is a cost report, not a P&L.
- **Payment date & bank account.** `date` is the invoice date; cash reports need the actual payment date and
  which bank account paid it.
- **Withholding tax** amount and form (ภ.ง.ด.3 individual / ภ.ง.ด.53 company).
- **Period lock:** stop edits to a closed month (only owner can reopen; audit log).
- **`is_tax_invoice`** is detected at OCR time but not stored (also in plan.md "Still open").
- **Asset register:** useful life, asset class and project per capex item.
- **Budget** per property × category × month for variance columns.

## Phased build
- ✅ **Phase A: Chart of accounts & mapping** (`backend/src/routes/accounting.ts`, `backend/src/accounting/coa.ts`, Settings → 📒 Chart of accounts). Seed a standard Thai SME CoA per property (editable codes/names); map each category per property →
  GL account; asset classes → asset/depreciation accounts and useful lives; bank accounts; advance-payable
  sub-accounts per person. UI in Settings. Refuse to post a month with an unmapped category.
- ✅ **Phase B: Journal generator + export** (`backend/src/accounting/journal.ts`, `journal-xlsx.ts`;
  `GET /accounting/journal` preview, `GET /accounting/journal.xlsx` only when the month is ready; Settings → Chart of
  accounts → ⬇ Journal). Built: every row of the posting table except depreciation (needs the asset register),
  withholding tax and accounts payable (fields not captured yet). Entry numbers `JV-YYYYMM-NNNN` are assigned by
  date when the journal is generated, so they can shift until Phase C locks the month.
  Original plan: **Phase B: Journal generator + GL export.** Pure function `expense → journal lines` (the posting rules above),
  `GET /accounting/journal?organization_id&month` (+ .xlsx), in the import format of the accountant's software.
  Reimbursements generate their own entries on `reimbursed_at`.
- ✅ **Phase C: Month-end close** (`backend/src/accounting/periods.ts`; `POST /accounting/periods/close|reopen`,
  `GET /accounting/periods`, `GET /accounting/audit`). Closing needs the month to be ready and stores the journal as
  a snapshot (entry numbers fixed). In a closed month, receipts can't be created, edited, deleted or moved in/out (HTTP 423),
  except recording a reimbursement dated in an open month. Reopen: owner only, reason required, journal regenerated.
  Audit log: receipt create/update (field-level from → to)/delete, mapping changes, close/reopen.
  Original plan: **Phase C: Month-end close.** Close checklist, period lock, audit log, re-export after reopen.
- ✅ **Phase D: MMA pack** (`backend/src/accounting/mma.ts`, `commentary.ts`, `mma-xlsx.ts`, `routes/mma.ts`; page
  *Management accounts*). Built from the month's journal (closed = frozen snapshot, final; open = provisional).
  Commentary: Claude (structured output, EN/TH) gets the pack JSON only; every number > 10 in its text must match a pack
  figure within ฿0.51, else one retry, then offending sentences are dropped and counted. Cached per month/language
  with a hash of the figures, flagged stale when they change. Not yet: P&L lines that need revenue (Phase E), depreciation
  (asset register), budget variance.
  Original plan: **Phase D: MMA pack.** `GET /reports/mma?organization_id=<id|all>&month` + Excel/PDF with the 7 sections
  above. Claude writes a short owner commentary (variances, risks, cash timing) from the numbers. It
  never invents figures; every number in the text must come from the pack data.
- **Phase E: Revenue & budget inputs.** Revenue import (PMS/bank CSV) and a budget sheet, so the pack is a
  full P&L with variance.

## Open decisions
1. ~~Accounting software~~: none yet; DocFlow keeps the management journal and exports a neutral format (see Goal).
   Revisit when the accountant or group size calls for real software; add an import adapter then.
2. Review the seeded chart of accounts with the accountant, and which account each category maps to.
3. Accrual (invoice date) or cash (payment date) basis for the management P&L? Recommended: accrual for
   P&L, with a separate cash view.
4. Capitalisation threshold: **default for now = none**, the capex flag alone decides. Useful lives are seeded per asset class (editable).
5. Advances by the owner/director: **default for now = 2120 Advances payable** with the person in the line memo. Switch to 2130 Loan from director per person if the accountant prefers.
6. Source of revenue data per property.
7. Fiscal year end, and when the MMA pack is due each month (e.g. working day 5).
