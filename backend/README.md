# DocFlow API

Node 22.13+ · TypeScript · Express · Postgres on [Neon](https://neon.tech) (`pg`) · JWT

```bash
npm install
export DATABASE_URL='postgresql://…-pooler….neon.tech/neondb?sslmode=require'   # Neon → Connect → pooled
npm run seed -- you@example.com 'password' 'Your Name'   # create first user
npm run dev                                              # http://localhost:8000
npm test
```

The schema is created on startup (`CREATE TABLE IF NOT EXISTS`). Tests run on in-process Postgres (PGlite), so they need no database.

Env: `DATABASE_URL` (**required**), `MAX_UPLOAD_MB` (10; Vercel caps request bodies at 4.5 MB), `OCR_ENGINE` (`auto` | `typhoon` | `tesseract` | `claude`; `auto` = Typhoon → Claude → Tesseract, falling back to Tesseract if Typhoon fails), `TYPHOON_OCR_API_KEY` (enables Typhoon in `auto`; needs `pip install typhoon-ocr` and `pdftoppm`, so not available on Vercel), `TYPHOON_CACHE_DIR` (optional OCR text cache), `ANTHROPIC_API_KEY` (enables Claude in `auto`), `CLAUDE_MODEL`, `PORT` (8000), `JWT_SECRET` (**required in production**), `JWT_EXPIRES_IN` (7d), `CORS_ORIGINS` (http://localhost:3000).

Uploaded receipt files are stored in Postgres (`receipts.content`), since serverless instances have no persistent disk.

## Deploy (Vercel + Neon)

Two Vercel projects from this repo, each deploying and rolling back on its own:

| Project | Root Directory | URL |
|---|---|---|
| `docflow-api` (API) | `backend` | `https://docflow-api-serve-property.vercel.app` |
| `docflow-ai` (frontend, static) | `/` | `https://docflow-ai-serve-property.vercel.app`, listed in the API's `CORS_ORIGINS` |

The frontend's `config.js` uses `http://localhost:8000` on localhost and the API URL above everywhere else; change it there if the API project is renamed. The root `vercel.json` (frontend project) redirects `/backend/*` away so the API source is not served as static files.

The API's serverless entry is `api/index.ts`; `vercel.json` sends every path to it and pins the region to `sin1` (Singapore, next to Neon). If `DATABASE_URL` or `JWT_SECRET` is missing, every request returns a 500 naming the missing variables.

1. API project → **Root Directory: `backend`**, Framework: Other, Build Command: `npm run migrate` (idempotent, so every deploy brings the schema up to date).
2. Environment variables: `DATABASE_URL` (Neon **pooled** string), `JWT_SECRET` (long random), `CORS_ORIGINS` (frontend URL), `NODE_ENV=production`.
3. Deploy, then check `https://<project>.vercel.app/health` → `{"ok":true}`.
4. The schema is not migrated on cold start; the build command migrates it. To migrate by hand, run `DATABASE_URL=… npm run migrate`.

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
