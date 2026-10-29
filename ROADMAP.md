# DocFlow AI — Roadmap

Receipt capture and expense tracking for multiple companies, built for Thai SMEs.

## Current state (baseline)

| Module | Status |
|---|---|
| App core: routing, theme, auth bootstrap, company switcher | ✅ Real |
| Auth API: `login`, `getMe`, `logout` | ✅ Real (backend added in Phase 0) |
| Organizations API: `list`, `create` | ✅ Real |
| Expenses API: `create`, `list`, `update`, `delete` | ✅ Real |
| Receipts: upload + Tesseract OCR + confirm/edit | ✅ Server-side Thai OCR (Phase 1) |
| Dashboard | ✅ Real data |
| Sheets: table, sort, filter, CSV | ⚠️ Table is real, "sync" is mock |
| Reports | ❌ Mock data |
| Email / LINE / Drive intake | ❌ Mock |
| Settings: API keys, companies | ❌ Mock; keys kept in the browser |

### Key risks
- ~~**Thai OCR:** only `eng` is loaded~~ — fixed in Phase 1.
- **Secrets in the browser:** API keys belong on the server.
- **Mixed data sources:** Reports and Settings use `MockData` while the Dashboard uses real organizations, so totals disagree.
- **Hardcoded `localhost:8000`:** there's no config per environment.

---

## Phase 0 — Foundation (1–2 weeks)
Goal: the features that already work end to end run against a real backend.

- [x] Backend in `backend/`: Node + TypeScript + Express, with SQLite (`node:sqlite`)
- [x] JWT auth: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` (tokens revoked on logout)
- [x] `GET/POST /organizations`, with a role per organization
- [x] `GET/POST /expenses`, `PUT/DELETE /expenses/:id`, all scoped to the user's organizations
- [x] Seed script for the first admin user
- [x] Frontend API URL set through `config.js` (`window.DOCFLOW_CONFIG`)
- [x] `ExpenseApi.deleteExpense`
- [x] API tests (`node:test`)
- [ ] Choose a host and database for production (e.g. Postgres) — decision needed

**Exit:** login → choose an organization → upload a receipt → save → it appears on the Dashboard, with no mock data on that path.

## Phase 1 — Core receipt capture (2–3 weeks) ← where most of the value is
- [x] OCR on the server, Thai + English (`tesseract.js`, `tha+eng`, language data bundled, works offline)
- [x] Optional Claude extractor (`OCR_ENGINE=claude`, or `auto` when `ANTHROPIC_API_KEY` is set) — not yet tested live
- [x] Extract the 13-digit tax ID (checksum validated), VAT, invoice number, date (พ.ศ. → ค.ศ., Thai month names, Thai digits)
- [x] PDFs: text layer first (e-Tax), scanned PDFs rasterised with `pdftoppm`
- [x] Original receipt file stored (`UPLOAD_DIR`) and viewable from the UI
- [x] Status workflow: draft → confirmed → approved (owner/admin only; approved records locked for members)
- [x] Duplicate check: same file hash, or same seller tax ID + invoice number → warning on upload, 409 on save unless confirmed
- [x] Review warnings: bad tax ID checksum, VAT not 7% of total, missing date/total, low OCR confidence
- [x] Frontend: Receipts page uses server extraction; browser Tesseract and demo receipts removed
- [ ] **Validate on 50 real receipts from your properties** (now 96.9% on 10 synthetic + 1 real toll receipt; 1 of 50 real done)

**Exit:** ≥90% field accuracy on a sample of 50 real Thai receipts.

## Phase 2 — Real reporting (1–2 weeks)
- Summary endpoints by month, category and organization
- Rebuild Reports on real data; Excel/PDF export
- Remove `MockData` from Reports and Settings; manage companies through the organizations API

## Phase 3 — Intake channels (3–4 weeks, built one at a time)
1. LINE bot webhook (highest value in Thailand)
2. Gmail scan via OAuth
3. Google Drive auto-filing
4. Two-way Google Sheets / Airtable sync

## Phase 4 — Hardening
- Role permissions, audit log, accountant export, CI, backups and monitoring
