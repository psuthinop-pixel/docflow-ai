# DocFlow AI: notes for Claude sessions

Receipt capture → expense records → (next) bookkeeping and monthly management accounts, for Thai hotel
properties. Owner/operator is the user; the accountant consumes the exports.

## Where things are
- Frontend: plain JS SPA at the repo root (`app.js`, `pages/*.js`, `services/*.js`, `style.css`). No build step.
- Backend: `backend/` (Node + TypeScript + Express, Postgres via `pg`), deployed on Vercel (`backend/api/index.ts`).
  Schema = additive statements in `backend/src/db.ts` (`ADD COLUMN IF NOT EXISTS`; never destructive).
- Extraction: `backend/src/extract/` (Typhoon, Tesseract, Claude). Scanned PDFs use poppler, with a
  pdfjs + `@napi-rs/canvas` fallback because Vercel has no poppler.
- Report definitions (spend, capex, claimable VAT, advances) live in one place: `backend/src/routes/reports.ts`.

## Plans: read before starting work
- `ROADMAP.md`: phases and status.
- `docs/ACCOUNTING.md`: bookkeeping + monthly management account design, posting rules, open decisions.
- `plan.md`: UX follow-ups and the "Still open" list.

## Business rules the owner has decided (don't change silently)
- Fuel VAT is not claimable by default; it stays in spend. Per-receipt `vat_claim` override ('yes' for
  pickup/van fuel, 'no' to exclude anything).
- Capex: category Asset (or `capex = 'yes'`) is reported apart from operating spend; its VAT stays claimable.
- `payment_source`: 'company' (direct transfer) or 'advance' (สำรองจ่าย). `reimbursed_at` is owner/admin only.
- Dates are Western year (dd/mm/yyyy) in exports; seller branch stored as the 5-digit RD code.
- Approval and FX rates are owner/admin only.
- No accounting software yet: DocFlow keeps its own management journal on a seeded Thai SME chart of
  accounts and exports a neutral journal format (see `docs/ACCOUNTING.md` → Goal).

## Conventions
- Tests: `cd backend && npm test` (node:test + PGlite; no external DB). Add a test with every rule change.
- Typecheck: `cd backend && npx tsc --noEmit`. Frontend: `node --check pages/<file>.js`.
- Claude API: `@anthropic-ai/sdk`, model `claude-opus-5-5` (env `CLAUDE_MODEL`), structured outputs,
  server-side `fallbacks: 'default'`. Never let the model invent numbers in reports; numbers come from SQL.
