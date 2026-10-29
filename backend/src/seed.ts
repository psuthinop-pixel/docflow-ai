// Create (or reset the password of) a user: npm run seed -- <email> <password> [name]
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { migrate, newId, now, openDb } from './db.js';

const [email, password, name = 'Admin'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run seed -- <email> <password> [name]');
  process.exit(1);
}

const db = openDb(config.databaseUrl);
await migrate(db);
const hash = bcrypt.hashSync(password, 10);
await db.query(
  `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name`,
  [newId(), email.trim().toLowerCase(), name, hash, now()],
);
console.log(`User ${email} ready.`);
process.exit(0);
