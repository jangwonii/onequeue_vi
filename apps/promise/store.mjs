import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export async function openStore(path) {
  if (path !== ':memory:') await mkdir(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT REFERENCES users(id),invite TEXT UNIQUE NOT NULL,current TEXT,demo INTEGER NOT NULL DEFAULT 0,clock INTEGER,created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members(room TEXT REFERENCES rooms(id),user TEXT REFERENCES users(id),PRIMARY KEY(room,user));
  CREATE TABLE IF NOT EXISTS seasons(id TEXT PRIMARY KEY,room TEXT REFERENCES rooms(id),number INTEGER NOT NULL,start TEXT NOT NULL,started INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS promises(season TEXT REFERENCES seasons(id),user TEXT REFERENCES users(id),goal TEXT,ready INTEGER NOT NULL DEFAULT 0,reflection TEXT NOT NULL DEFAULT '',PRIMARY KEY(season,user));
  CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,season TEXT REFERENCES seasons(id),user TEXT REFERENCES users(id),day TEXT NOT NULL,note TEXT NOT NULL,seconds INTEGER NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'accepted',reporter TEXT,reason TEXT,decision TEXT,reviewer TEXT,UNIQUE(season,user,day));
  CREATE TABLE IF NOT EXISTS reactions(record TEXT REFERENCES records(id),user TEXT REFERENCES users(id),kind TEXT NOT NULL,PRIMARY KEY(record,user));
  CREATE TABLE IF NOT EXISTS timers(season TEXT,user TEXT,day TEXT,elapsed INTEGER NOT NULL DEFAULT 0,running INTEGER,PRIMARY KEY(season,user,day));
  CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  return { one: (sql, ...v) => db.prepare(sql).get(...v), all: (sql, ...v) => db.prepare(sql).all(...v), run: (sql, ...v) => db.prepare(sql).run(...v),
    tx: f => { db.exec('BEGIN IMMEDIATE'); try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }, close: () => db.close() };
}
