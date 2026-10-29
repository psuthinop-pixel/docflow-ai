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

Serverless entry is `api/index.ts`; `vercel.json` sends every path to it and pins the region to `sin1` (Singapore, next to Neon).

1. Vercel → New Project → import this repo → **Root Directory: `backend`**, Framework: Other.
2. Environment variables: `DATABASE_URL` (Neon **pooled** string), `JWT_SECRET` (long random), `CORS_ORIGINS` (frontend URL), `NODE_ENV=production`.
3. Deploy, then check `https://<project>.vercel.app/health` → `{"ok":true}`.
4. The schema is not migrated on cold start. After a schema change, run `DATABASE_URL=… npm run migrate`.

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
