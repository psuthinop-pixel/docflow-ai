# DocFlow API (Phase 0)

Node 22.13+ · TypeScript · Express · Postgres on [Neon](https://neon.tech) (`pg`) · JWT

```bash
npm install
export DATABASE_URL='postgresql://…-pooler….neon.tech/neondb?sslmode=require'   # Neon → Connect → pooled
npm run seed -- you@example.com 'password' 'Your Name'   # create first user
npm run dev                                              # http://localhost:8000
npm test
```

The schema is created on startup (`CREATE TABLE IF NOT EXISTS`). Tests run on in-process Postgres (PGlite), so they need no database.

Env: `DATABASE_URL` (**required**), `PORT` (8000), `JWT_SECRET` (**required in production**), `JWT_EXPIRES_IN` (7d), `CORS_ORIGINS` (http://localhost:3000).

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
| PUT/DELETE | /expenses/:id | member only |

Errors are returned as `{ "detail": "..." }`.
