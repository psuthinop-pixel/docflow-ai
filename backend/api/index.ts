// Vercel serverless entry: every path is rewritten here (see vercel.json).
// The schema is not migrated per cold start; run `npm run migrate` after schema changes.
import { config } from '../src/config.js';
import { connect } from '../src/db.js';
import { createApp } from '../src/app.js';

// One connection per function instance; Neon's pooler (PgBouncer) multiplexes across instances.
export default createApp(connect(config.databaseUrl, 1), config.corsOrigins);
