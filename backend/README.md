# DocFlow API

Node 22.13+ · TypeScript · Express · SQLite (`node:sqlite`) · JWT

```bash
npm install
npm run seed -- you@example.com 'password' 'Your Name'   # create first user
npm run dev                                              # http://localhost:8000
npm test
```

Env: `UPLOAD_DIR` (uploads), `MAX_UPLOAD_MB` (10), `OCR_ENGINE` (`auto` | `tesseract` | `claude`), `ANTHROPIC_API_KEY` (enables Claude in `auto`), `CLAUDE_MODEL`, `PORT` (8000), `DB_PATH` (docflow.db), `JWT_SECRET` (**required in production**), `JWT_EXPIRES_IN` (7d), `CORS_ORIGINS` (http://localhost:3000).

| Method | Path | Notes |
|---|---|---|
| POST | /auth/login | `{email,password}` → `{auth}` |
| GET | /auth/me | |
| POST | /auth/logout | revokes the token |
| GET/POST | /organizations | creator becomes `owner` |
| GET | /expenses?organization_id= | member only |
| POST | /expenses | requires `organization_id` |
| PUT/DELETE | /expenses/:id | member only; approved records owner/admin only |
| POST | /receipts | multipart `file` + `organization_id` → `{receipt, fields, warnings, duplicates}` |
| GET | /receipts/:id, /receipts/:id/file | metadata / original file |

Expense `status`: `draft` → `confirmed` → `approved` (owner/admin), or `disabled`.
`POST /expenses` returns **409** with `duplicates` when the same receipt file or seller tax ID + invoice number already exists; resend with `allow_duplicate: true` to save anyway.

Errors are returned as `{ "detail": "..." }`.

## Receipt extraction

- **tesseract** (default): Thai + English OCR on the server, language data bundled (no network). PDFs use their text layer; scanned PDFs need `pdftoppm` (`apt install poppler-utils`).
- **claude**: sends the image/PDF to Claude for structured extraction, then checks the tax ID with the same rules. Roughly ฿1 per receipt on Claude Opus 5.5 (estimate: ~2k input + ~1k output tokens); more robust on crumpled or handwritten receipts.

Accuracy check: `npx tsx test/accuracy.ts [tesseract|claude]` over `test/fixtures` (regenerate with `node test/make-fixtures.cjs`). Add real receipts plus their entries in `expected.json` to measure on your own data.
