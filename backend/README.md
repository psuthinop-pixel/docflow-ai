# DocFlow API (Phase 0)

Node 22.13+ · TypeScript · Express · SQLite (`node:sqlite`) · JWT

```bash
npm install
npm run seed -- you@example.com 'password' 'Your Name'   # create first user
npm run dev                                              # http://localhost:8000
npm test
```

Env: `PORT` (8000), `DB_PATH` (docflow.db), `JWT_SECRET` (**required in production**), `JWT_EXPIRES_IN` (7d), `CORS_ORIGINS` (http://localhost:3000).

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
