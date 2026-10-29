import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = await openDb(config.databaseUrl);
createApp(db, config.corsOrigins).listen(config.port, () => {
  console.log(`DocFlow API listening on http://localhost:${config.port}`);
});
