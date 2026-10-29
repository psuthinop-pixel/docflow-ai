// Create (or reset the password of) a user: npm run seed -- <email> <password> [name]
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { newId, now, openDb } from './db.js';

const [email, password, name = 'Admin'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run seed -- <email> <password> [name]');
  process.exit(1);
}

const db = openDb(config.dbPath);
const hash = bcrypt.hashSync(password, 10);
db.prepare(
  `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name`,
).run(newId(), email.trim().toLowerCase(), name, hash, now());
console.log(`User ${email} ready.`);
