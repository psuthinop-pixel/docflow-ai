// Create or update the schema: DATABASE_URL=... npm run migrate
import { config } from './config.js';
import { openDb } from './db.js';

await openDb(config.databaseUrl);
console.log('Schema is up to date.');
process.exit(0);
