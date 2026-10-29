# DocFlow API (Phase 0)

Node 22.13+ · TypeScript · Express · Postgres (Neon) · JWT

```bash
npm install
export DATABASE_URL='postgres://…'                       # local Postgres or a Neon dev branch
npm run seed -- you@example.com 'password' 'Your Name'   # applies schema + creates first user
npm run dev                                              # http://localhost:8000
npm test                                                 # in-memory Postgres (PGlite), no DB needed
```

Env: `PORT` (8000), `DATABASE_URL`, `JWT_SECRET` (**required in production**), `JWT_EXPIRES_IN` (7d), `CORS_ORIGINS` (http://localhost:3000; comma-separated, `*` wildcard allowed).

## Deploy (Vercel + Neon)

Two Vercel projects from this one repo:

| Project | Root directory | Notes |
|---|---|---|
| `docflow` (frontend) | `/` | Framework "Other", no build command. Set the API URL in `config.js`. |
| `docflow-api` (this) | `backend` | `api/index.ts` serves the Express app; `vercel.json` routes every path to it. |

1. **Neon:** create a project (region `aws-ap-southeast-1`, Singapore). Copy the **pooled** connection string (host contains `-pooler`).
2. **Vercel → docflow-api → Settings → Environment Variables:**
   - `DATABASE_URL` = pooled Neon URL (add `?sslmode=require`)
   - `JWT_SECRET` = `openssl rand -hex 32`
   - `CORS_ORIGINS` = `https://docflow.vercel.app,https://docflow-*.vercel.app` (+ custom domain)
   - Settings → Functions → region `sin1` (same as Neon).
3. **Schema + first user**, from your machine: `DATABASE_URL='…' npm run seed -- you@example.com 'password' 'Name'` (re-run `npm run migrate` after schema changes).
4. Check `https://docflow-api.vercel.app/health` → `{"ok":true}`, then log in on the frontend.

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
