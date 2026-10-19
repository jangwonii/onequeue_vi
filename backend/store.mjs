import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label}: ${min}~${max}자로 입력해 주세요.`);
  return value.trim();
}
export async function openStore(path) {
  if (path !== ':memory:') await mkdir(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), invite TEXT UNIQUE NOT NULL, start TEXT, end TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members(room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id), goal TEXT, PRIMARY KEY(room_id,user_id));
    CREATE TABLE IF NOT EXISTS approvals(room_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY(room_id,reviewer_id,target_id), FOREIGN KEY(room_id,reviewer_id) REFERENCES members(room_id,user_id), FOREIGN KEY(room_id,target_id) REFERENCES members(room_id,user_id));
    CREATE TABLE IF NOT EXISTS records(room_id TEXT NOT NULL, user_id TEXT NOT NULL, day TEXT NOT NULL, note TEXT NOT NULL, minutes INTEGER NOT NULL, bedtime TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(room_id,user_id,day), FOREIGN KEY(room_id,user_id) REFERENCES members(room_id,user_id));
    CREATE TABLE IF NOT EXISTS cheers(room_id TEXT NOT NULL, sender_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY(room_id,sender_id,target_id), FOREIGN KEY(room_id,sender_id) REFERENCES members(room_id,user_id), FOREIGN KEY(room_id,target_id) REFERENCES members(room_id,user_id));
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  return {
    all: (query, ...values) => db.prepare(query).all(...values),
    one: (query, ...values) => db.prepare(query).get(...values),
    run: (query, ...values) => db.prepare(query).run(...values),
    transaction: callback => { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    close: () => db.close(),
  };
}
