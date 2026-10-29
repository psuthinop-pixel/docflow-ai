// Apply the schema to DATABASE_URL: npm run migrate
import { config } from './config.js';
import { migrate, openDb } from './db.js';

await migrate(openDb(config.databaseUrl));
console.log('Schema up to date.');
process.exit(0);
