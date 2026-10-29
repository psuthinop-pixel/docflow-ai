import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb(config.dbPath);
createApp(db, config.corsOrigins, config).listen(config.port, () => {
  console.log(`DocFlow API listening on http://localhost:${config.port}`);
});
