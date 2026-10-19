import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const colors = ['sage', 'wine', 'sand', 'navy', 'lavender'];
function text(value, max, label, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.trim().length > max) fail(400, `${label}은 ${empty ? '0' : '1'}~${max}자로 입력해 주세요.`);
  return value.trim();
}
const integer = (value, min, max, label) => { if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label}은 ${min}~${max} 사이의 정수여야 합니다.`); return value; };
const yearOf = timestamp => new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(timestamp));

export async function createApp({ database = process.env.DATABASE_PATH || './data/bookmark.sqlite', now = () => Date.now() } = {}) {
  if (database !== ':memory:') await mkdir(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,total INTEGER NOT NULL,pages INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'planned',genre TEXT NOT NULL,color TEXT NOT NULL,rating INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL,finished INTEGER,sample INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),goal INTEGER NOT NULL);
    INSERT OR IGNORE INTO settings VALUES(1,12);`);
  function snapshot() {
    const books = db.prepare('SELECT * FROM books ORDER BY updated DESC,rowid DESC').all();
    return { books, goal: db.prepare('SELECT goal FROM settings WHERE id=1').get().goal, year: yearOf(now()),
      stats: { total: books.length, reading: books.filter(b => b.status === 'reading').length, finished: books.filter(b => b.status === 'done').length,
        yearFinished: books.filter(b => b.finished !== null && yearOf(b.finished) === yearOf(now())).length, pages: books.reduce((sum, b) => sum + b.pages, 0), notes: books.filter(b => b.note).length }, serverNow: now() };
  }
  function bookInput(data) {
    const title = text(data.title, 120, '제목'), author = text(data.author, 80, '저자');
    const total = integer(data.total, 1, 20000, '전체 페이지');
    if (!['소설', '에세이', '인문', '실용', '기타'].includes(data.genre)) fail(400, '분류를 선택해 주세요.');
    if (!colors.includes(data.color)) fail(400, '표지 색상을 선택해 주세요.');
    return { title, author, total, genre: data.genre, color: data.color };
  }
  function addBook(data, sample = false) {
    const b = bookInput(data);
    if (db.prepare('SELECT count(*) AS n FROM books').get().n >= 500) fail(400, '책은 500권까지 등록할 수 있습니다.');
    const id = randomUUID();
    db.prepare('INSERT INTO books(id,title,author,total,genre,color,created,updated,sample) VALUES(?,?,?,?,?,?,?,?,?)').run(id, b.title, b.author, b.total, b.genre, b.color, now(), now(), Number(sample));
    return id;
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON 요청이 필요합니다.');
    let bytes = 0; const chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 20000) fail(413, '입력이 너무 큽니다.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
    catch { fail(400, '입력 형식을 확인해 주세요.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) fail(403, '이 컴퓨터에서만 사용할 수 있습니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) fail(403, '다른 사이트의 요청은 허용되지 않습니다.');
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') return send(200, { ok: true });
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' || !files[path]) fail(404, '페이지가 없습니다.');
        const [file, type] = files[path]; const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      if (path === '/api/state' && req.method === 'GET') return send(200, snapshot());
      if (req.method !== 'POST') fail(405, '지원하지 않는 요청입니다.');
      const data = await body(req);
      const match = /^\/api\/books\/([a-f0-9-]{36})\/(edit|progress|review|delete)$/.exec(path);
      if (path === '/api/books') addBook(data);
      else if (path === '/api/goal') db.prepare('UPDATE settings SET goal=? WHERE id=1').run(integer(data.goal, 1, 200, '연간 목표'));
      else if (path === '/api/sample') {
        if (db.prepare('SELECT count(*) AS n FROM books').get().n) fail(409, '예시 책장은 빈 서재에서만 추가할 수 있습니다.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const reading = addBook({ title: '느리게 읽는 마음', author: '김서온 · 가상 저자', total: 240, genre: '에세이', color: 'sage' }, true);
          db.prepare("UPDATE books SET pages=86,status='reading' WHERE id=?").run(reading);
          addBook({ title: '어느 작은 숲의 기록', author: '이여름 · 가상 저자', total: 320, genre: '소설', color: 'wine' }, true);
          const done = addBook({ title: '좋아하는 것을 오래', author: '박이음 · 가상 저자', total: 192, genre: '인문', color: 'sand' }, true);
          db.prepare("UPDATE books SET pages=total,status='done',finished=?,rating=4,note='예시 메모: 서두르지 않고 내가 좋아하는 것을 알아가는 시간.' WHERE id=?").run(now(), done);
          addBook({ title: '내일을 위한 작은 질문', author: '최다정 · 가상 저자', total: 280, genre: '실용', color: 'navy' }, true);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } else if (match) {
        const [, id, action] = match, book = db.prepare('SELECT * FROM books WHERE id=?').get(id);
        if (!book) fail(404, '책을 찾을 수 없습니다.');
        if (action === 'delete') db.prepare('DELETE FROM books WHERE id=?').run(id);
        else if (action === 'edit') {
          const b = bookInput(data);
          if (b.total < book.pages) fail(400, '전체 페이지는 읽은 페이지보다 작을 수 없습니다. 먼저 진행 기록을 수정해 주세요.');
          const status = book.pages === b.total ? 'done' : book.status === 'done' ? 'reading' : book.status;
          db.prepare('UPDATE books SET title=?,author=?,total=?,genre=?,color=?,status=?,finished=?,updated=? WHERE id=?').run(b.title, b.author, b.total, b.genre, b.color, status, status === 'done' ? book.finished ?? now() : null, now(), id);
        } else if (action === 'progress') {
          const pages = integer(data.pages, 0, book.total, '읽은 페이지');
          if (data.start !== undefined && typeof data.start !== 'boolean') fail(400, '독서 상태가 올바르지 않습니다.');
          const status = pages === book.total ? 'done' : pages > 0 || data.start || book.status !== 'planned' ? 'reading' : 'planned';
          db.prepare('UPDATE books SET pages=?,status=?,finished=?,updated=? WHERE id=?').run(pages, status, status === 'done' ? book.finished ?? now() : null, now(), id);
        } else if (action === 'review') {
          const rating = integer(data.rating, 0, 5, '별점'), note = text(data.note, 4000, '메모', true);
          db.prepare('UPDATE books SET rating=?,note=?,updated=? WHERE id=?').run(rating, note, now(), id);
        }
      } else fail(404, '경로가 없습니다.');
      send(200, snapshot());
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : '저장 중 문제가 발생했습니다.' }); }
  });
  server.on('close', () => db.close()); return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  server.listen(Number(process.env.PORT || 4189), '127.0.0.1', () => console.log(`책갈피: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
