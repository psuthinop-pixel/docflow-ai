# DocFlow AI — Roadmap

Receipt capture and expense tracking for multiple companies, built for Thai SMEs.

## Current state (baseline)

| Module | Status |
|---|---|
| App core: routing, theme, auth bootstrap, company switcher | ✅ Real |
| Auth API: `login`, `getMe`, `logout`, `password` (forced change for invites) | ✅ Real |
| Organizations API: `list`, `create`, `update`, members and roles | ✅ Real |
| Expenses API: `create`, `list`, `update`, `delete` | ✅ Real |
| Receipts: upload + Tesseract OCR + confirm/edit | ✅ Server-side Thai OCR (Phase 1) |
| Dashboard | ✅ Real data, server-side totals |
| Sheets: table, sort, filter, CSV | ⚠️ Table is real, "sync" is mock |
| Reports | ✅ Real (Phase 2): by month, category, property; summary + input VAT CSV; print to PDF |
| Email / LINE / Drive intake | ❌ Mock |
| Settings: property, members, OCR status, account, export | ✅ Real; no keys in the browser |

### Key risks
- ~~**Thai OCR:** only `eng` is loaded~~ — fixed in Phase 1.
- ~~**Secrets in the browser:** API keys belong on the server.~~ — fake key fields removed; Settings shows server OCR status only.
- ~~**Mixed data sources:** Reports and Settings use `MockData`~~ — both pages now read the real API, and Dashboard and Reports share `GET /reports/summary`.
- **Hardcoded `localhost:8000`:** there's no config per environment.

---

## Phase 0 — Foundation (1–2 weeks)
Goal: the features that already work end to end run against a real backend.

- [x] Backend in `backend/`: Node + TypeScript + Express, with Postgres on Neon (`pg`)
- [x] JWT auth: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` (tokens revoked on logout)
- [x] `GET/POST /organizations`, with a role per organization
- [x] `GET/POST /expenses`, `PUT/DELETE /expenses/:id`, all scoped to the user's organizations
- [x] Seed script for the first admin user
- [x] Frontend API URL set through `config.js` (`window.DOCFLOW_CONFIG`)
- [x] `ExpenseApi.deleteExpense`
- [x] API tests (`node:test`)
- [x] Production database: Neon Postgres (project `docflow`, ap-southeast-1)
- [x] API host: Vercel serverless (`backend/api/index.ts`, region `sin1`)

**Exit:** login → choose an organization → upload a receipt → save → it appears on the Dashboard, with no mock data on that path.

## Phase 1 — Core receipt capture (2–3 weeks) ← where most of the value is
- [x] OCR on the server, Thai + English (`tesseract.js`, `tha+eng`, language data bundled, works offline)
- [x] Typhoon OCR engine (used in `auto` when there is no Claude key); Tesseract is the offline fallback
- [x] Claude accuracy phase 1: Claude first in `auto`; Thai rules (seller vs buyer, BE dates, branch, VAT 7%, WHT); effort medium with one high-effort second look when the arithmetic/checksum/date/buyer checks fail; suggestions prefilled for review (abbreviated tax invoice → VAT not claimable, asset → capex, foreign service/goods, WHT and payment-method notes)
- [x] Claude accuracy phase 2, vendor memory (`backend/src/extract/memory.ts`): the last 5 confirmed/approved receipts per seller (tax ID, or exact name when there's none) pre-fill name, address, branch, category, Paid from, VAT claim, capex, service/goods when ≥60% agree; printed branch, the abbreviated-tax-invoice rule and Claude's per-receipt asset call win over memory
- [x] Optional Claude extractor (`OCR_ENGINE=claude`, or `auto` when `ANTHROPIC_API_KEY` is set) — not yet tested live
- [x] Extract the 13-digit tax ID (checksum validated), VAT, invoice number, date (พ.ศ. → ค.ศ., Thai month names, Thai digits)
- [x] PDFs: text layer first (e-Tax), scanned PDFs rasterised with `pdftoppm`
- [x] Original receipt file stored (in Postgres) and viewable from the UI
- [x] Status workflow: draft → confirmed → approved (owner/admin only; approved records locked for members)
- [x] Duplicate check: same file hash, or same seller tax ID + invoice number → warning on upload, 409 on save unless confirmed
- [x] Review warnings: bad tax ID checksum, VAT not 7% of total, missing date/total, low OCR confidence
- [x] Frontend: Receipts page uses server extraction; browser Tesseract and demo receipts removed
- [x] Foreign-currency receipts (USD etc.): original amount kept, owner/admin enters THB from the card statement later; THB totals exclude FX-pending items; approval blocked until converted
- [ ] **Validate on 50 real receipts from your properties** — 40 real Airtable PCK receipts tested. Typhoon: totals 74%, VAT 59%, invoice no. 32%, date ±60d 90%; Tesseract: totals 55%, VAT 38% (vendor ground truth only on 7 records — Airtable lookup field is empty)

**Exit:** ≥90% field accuracy on a sample of 50 real Thai receipts.

## Phase 2 — Real reporting (1–2 weeks) ✅
- [x] `GET /reports/summary?organization_id=<id|all>&from&to`: spend and claimable VAT by month, category and property; status counts; VAT that can't be claimed and why
- [x] `GET /reports/vat?organization_id&month`: input VAT listing for the accountant
- [x] Reports page rebuilt on real data: one property or all, period presets, monthly chart (stacked by property), categories, property comparison, VAT panel
- [x] Exports: summary CSV (long format, pivots in Excel), input VAT report CSV (Thai/English headers), print to PDF
- [x] Dashboard KPIs from the same endpoint; `GET /expenses?limit&sort=updated` for the short lists
- [x] `MockData` removed from Reports and Settings; organizations managed through the API
- [x] Native .xlsx export (input tax report and summary workbook), seller branch captured from receipts

## Phase 3 — Intake channels (3–4 weeks, built one at a time)
1. LINE bot webhook (highest value in Thailand)
2. Gmail scan via OAuth
3. Google Drive auto-filing
4. Two-way Google Sheets / Airtable sync

## Phase 3b — Bookkeeping & monthly management accounts (next)
Design and posting rules: [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md).
- [x] Inputs on each expense: VAT claim override (fuel), capex flag, payment source (company / advance), reimbursement date
- [x] A: Chart of accounts (Thai SME seed, editable) + category → account mapping per property, default bank and capex accounts, month readiness check (`/accounting/*`, Settings → Chart of accounts)
- [x] B: Journal generator (expense → balanced lines, reimbursements) + neutral Excel journal & trial balance (`/accounting/journal[.xlsx]`); depreciation, WHT and AP still to come
- [x] C: Month-end close: readiness checklist, close (owner/admin) freezes the journal and locks the month's receipts, owner-only reopen with a reason, audit log (`/accounting/periods*`, `/accounting/audit`)
- [x] D: MMA pack per property + consolidated (costs vs last month / last year, top vendors, capex + YTD, advances at month end, VAT, cash by week, close checklist), Excel + print, Claude commentary (EN/TH) number-checked against the pack (`/accounting/mma*`, page *Management accounts*)
- [x] E1: Revenue lines per month (manual or CSV paste; account, channel, net, VAT, OTA commission, room nights, bank/receivable), posted to the journal; pack shows revenue, GOP, occupancy, ADR, RevPAR; rooms per property
- [x] E2: Budgets per property × account × month (grid or CSV paste; owner/admin; audit-logged), actual vs budget in the pack (tiles, revenue/cost tables, GOP), Excel and commentary
- [ ] E3: PMS/OTA-specific importers once a sample file is available; year-to-date vs budget

## Phase 4 — Hardening
- Role permissions, audit log, accountant export, CI, backups and monitoring
