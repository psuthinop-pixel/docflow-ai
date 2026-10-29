// Vercel serverless entry: every request is rewritten here (see vercel.json).
// Schema is applied with `npm run migrate`, not on cold start.
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export default createApp(openDb(config.databaseUrl), config.corsOrigins);
