import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export async function createApp({ database = process.env.DATABASE_PATH || './data/hankan.sqlite', now = () => Date.now() } = {}) {
  if (database !== ':memory:') await mkdir(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,priority TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,task_id TEXT,title TEXT,minutes INTEGER NOT NULL,finished INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS timer(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,minutes INTEGER NOT NULL,remaining INTEGER NOT NULL,deadline INTEGER,task_id TEXT,title TEXT);
    INSERT OR IGNORE INTO timer VALUES(1,'idle',25,1500000,NULL,NULL,'자유 집중');`);
  const timer = () => db.prepare('SELECT * FROM timer WHERE id=1').get();
  function settle() {
    const t = timer();
    if (t.status === 'running' && t.deadline <= now()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(randomUUID(), t.task_id, t.title, t.minutes, t.deadline);
        db.prepare("UPDATE timer SET status='idle',remaining=minutes*60000,deadline=NULL WHERE id=1").run();
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  }
  function snapshot() {
    settle();
    const t = timer();
    return { tasks: db.prepare('SELECT * FROM tasks ORDER BY created DESC,rowid DESC').all().map(t => ({ ...t, done: !!t.done })),
      timer: { ...t, remaining: t.status === 'running' ? Math.max(0, t.deadline - now()) : t.remaining },
      sessions: db.prepare('SELECT * FROM sessions ORDER BY finished DESC LIMIT 100').all(), serverNow: now() };
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON 요청이 필요합니다.');
    let bytes = 0; const chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) fail(413, '입력이 너무 큽니다.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
    catch { fail(400, '입력 형식을 확인해 주세요.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      // Local personal app: refuse cross-site requests and DNS-rebinding hosts.
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) fail(403, '이 컴퓨터에서만 사용할 수 있습니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) fail(403, '다른 사이트의 요청은 허용되지 않습니다.');
      if (url.pathname === '/api/health' && req.method === 'GET') return send(200, { ok: true });
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' || !files[url.pathname]) fail(404, '페이지가 없습니다.');
        const [path, type] = files[url.pathname]; const content = await readFile(new URL(path, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      if (url.pathname === '/api/state' && req.method === 'GET') return send(200, snapshot());
      if (req.method !== 'POST') fail(405, '지원하지 않는 요청입니다.');
      const data = await body(req); settle();
      const taskMatch = /^\/api\/tasks\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (url.pathname === '/api/tasks' || taskMatch) {
        if (taskMatch && !db.prepare('SELECT id FROM tasks WHERE id=?').get(taskMatch[1])) fail(404, '할 일을 찾을 수 없습니다.');
        if (taskMatch && data.action === 'delete') {
          const t = timer();
          if (t.task_id === taskMatch[1] && t.status !== 'idle') fail(409, '집중을 끝내거나 초기화한 뒤 삭제해 주세요.');
          db.prepare('DELETE FROM tasks WHERE id=?').run(taskMatch[1]);
          if (t.task_id === taskMatch[1]) db.prepare("UPDATE timer SET task_id=NULL,title='자유 집중' WHERE id=1").run();
        } else if (taskMatch && data.action === 'toggle') {
          if (typeof data.done !== 'boolean') fail(400, '완료 상태를 확인해 주세요.');
          db.prepare('UPDATE tasks SET done=? WHERE id=?').run(Number(data.done), taskMatch[1]);
        } else {
          if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 120) fail(400, '할 일은 1~120자로 적어 주세요.');
          if (!['normal', 'important'].includes(data.priority)) fail(400, '중요도를 확인해 주세요.');
          if (taskMatch) db.prepare('UPDATE tasks SET title=?,priority=? WHERE id=?').run(data.title.trim(), data.priority, taskMatch[1]);
          else {
            if (db.prepare('SELECT count(*) AS n FROM tasks').get().n >= 200) fail(400, '할 일은 200개까지 저장할 수 있습니다.');
            db.prepare('INSERT INTO tasks VALUES(?,?,?,0,?)').run(randomUUID(), data.title.trim(), data.priority, now());
          }
        }
      } else if (url.pathname === '/api/timer') {
        const t = timer();
        if (data.action === 'start') {
          if (t.status === 'running') fail(409, '이미 집중 중입니다.');
          if (t.status === 'paused') db.prepare("UPDATE timer SET status='running',deadline=? WHERE id=1").run(now() + t.remaining);
          else {
            if (![15, 25, 50].includes(data.minutes)) fail(400, '집중 시간은 15·25·50분 중 선택해 주세요.');
            const task = data.taskId ? db.prepare('SELECT * FROM tasks WHERE id=?').get(data.taskId) : null;
            if (data.taskId && (!task || task.done)) fail(400, '진행할 할 일을 다시 선택해 주세요.');
            db.prepare("UPDATE timer SET status='running',minutes=?,remaining=?,deadline=?,task_id=?,title=? WHERE id=1").run(data.minutes, data.minutes * 60000, now() + data.minutes * 60000, task?.id || null, task?.title || '자유 집중');
          }
        } else if (data.action === 'pause') {
          if (t.status !== 'running') fail(409, '현재 집중 중이 아닙니다.');
          db.prepare("UPDATE timer SET status='paused',remaining=?,deadline=NULL WHERE id=1").run(Math.max(0, t.deadline - now()));
        } else if (data.action === 'reset') db.prepare("UPDATE timer SET status='idle',remaining=minutes*60000,deadline=NULL WHERE id=1").run();
        else fail(400, '지원하지 않는 타이머 동작입니다.');
      } else fail(404, '경로가 없습니다.');
      send(200, snapshot());
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : '저장 중 문제가 발생했습니다.' }); }
  });
  server.on('close', () => db.close()); return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  server.listen(Number(process.env.PORT || 4188), '127.0.0.1', () => console.log(`한 칸: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
