import { config } from './config.js';
import { migrate, openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb(config.databaseUrl);
await migrate(db);
createApp(db, config.corsOrigins).listen(config.port, () => {
  console.log(`DocFlow API listening on http://localhost:${config.port}`);
});
