// Vercel serverless entry: every path is rewritten here (see vercel.json).
// The schema is not migrated per cold start; run `npm run migrate` after schema changes.
import type { IncomingMessage, ServerResponse } from 'node:http';

const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);

// Answer every request with the missing settings instead of crashing with an opaque FUNCTION_INVOCATION_FAILED.
const misconfigured = (_req: IncomingMessage, res: ServerResponse) => {
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ detail: `Server misconfigured: set ${missing.join(', ')} in Vercel environment variables` }));
};

async function load() {
  const { config } = await import('../src/config.js');
  const { connect } = await import('../src/db.js');
  const { createApp } = await import('../src/app.js');
  // One connection per function instance; Neon's pooler (PgBouncer) multiplexes across instances.
  return createApp(connect(config.databaseUrl, 1), config.corsOrigins, config);
}

export default missing.length ? misconfigured : await load();
