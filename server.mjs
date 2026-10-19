import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { dayKey, addDays, validateGoal, submitRecord, rankMembers } from './model.js';
import { openStore, hash, token, fail, text } from './backend/store.mjs';
const scrypt = promisify(scryptCallback);
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'] };

export async function createApp({ database = process.env.DATABASE_PATH || './data/seven.sqlite', origin = process.env.PUBLIC_ORIGIN || '', now = () => new Date() } = {}) {
  if (origin) { const parsed = new URL(origin); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('PUBLIC_ORIGIN must be an http(s) origin without a trailing slash.'); }
  const db = await openStore(database);
  const { all, one, run, transaction } = db;
  const millis = () => now().getTime();
  const today = () => dayKey(now());
  function limited(key, maximum, window = 15 * 60000) {
    run('DELETE FROM rate_limits WHERE expires < ?', millis());
    if (one('SELECT count FROM rate_limits WHERE key=?', key)?.count >= maximum) fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    run('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, millis() + window);
  }
  function sessionUser(req) {
    const cookie = /(?:^|;\s*)seven_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    return cookie ? one('SELECT users.id,username,name FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?', hash(cookie[1]), millis()) : undefined;
  }
  const sessionCookie = (value, maxAge = 30 * 86400) => `seven_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  function newSession(userId, res) {
    const secret = token();
    run('DELETE FROM sessions WHERE expires < ?', millis());
    run('INSERT INTO sessions VALUES(?,?,?)', hash(secret), userId, millis() + 30 * 86400000);
    res.setHeader('Set-Cookie', sessionCookie(secret));
  }
  function roomFor(id, userId) {
    const room = one('SELECT rooms.* FROM rooms JOIN members ON members.room_id=rooms.id WHERE rooms.id=? AND members.user_id=?', id, userId);
    if (!room) fail(404, '참여 중인 방을 찾을 수 없습니다.');
    return room;
  }
  function snapshot(room, userId) {
    const members = all('SELECT users.id,users.name,members.goal FROM members JOIN users ON users.id=members.user_id WHERE room_id=? ORDER BY users.rowid', room.id).map(member => {
      const goal = member.goal ? JSON.parse(member.goal) : null;
      const records = all('SELECT day,note,minutes,bedtime FROM records WHERE room_id=? AND user_id=? ORDER BY day', room.id, member.id);
      return { id: member.id, name: member.name, goal: goal && { ...goal, start: room.start, end: room.end }, goalVersion: member.goal ? hash(member.goal) : null, records, completed: records.length, planned: goal?.frequency || 0, approvals: all('SELECT reviewer_id FROM approvals WHERE room_id=? AND target_id=?', room.id, member.id).map(a => a.reviewer_id), cheers: one('SELECT COUNT(*) AS total FROM cheers WHERE room_id=? AND target_id=?', room.id, member.id).total, cheered: !!one('SELECT 1 FROM cheers WHERE room_id=? AND sender_id=? AND target_id=?', room.id, userId, member.id) };
    });
    const ready = members.length >= 2 && members.every(m => m.goal && m.approvals.length === members.length - 1);
    const finished = room.end && today() > addDays(room.end, 1);
    return { id: room.id, name: room.name, ownerId: room.owner_id, start: room.start, end: room.end, today: today(), status: !room.start ? 'waiting' : finished ? 'finished' : today() > room.end ? 'settling' : 'active', ready, members, rankings: rankMembers(members.filter(m => m.goal).map(m => ({ id: m.id, name: m.name, completed: m.completed, planned: m.planned }))), invite: !room.start && room.owner_id === userId ? room.invite : null };
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON 요청만 허용됩니다.');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, '요청 내용이 너무 큽니다.'); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; } catch { fail(400, '올바르지 않은 요청입니다.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) || !files[pathname]) fail(404, '찾을 수 없습니다.');
        const [file, mime] = files[pathname];
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      if (pathname === '/api/health' && req.method === 'GET') { respond(200, { ok: true }); return; }
      let data = {};
      if (req.method !== 'GET') {
        if (req.method !== 'POST') fail(405, '허용되지 않는 요청입니다.');
        const expectedOrigin = origin || `http://${req.headers.host}`;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== expectedOrigin)) fail(403, '다른 사이트의 변경 요청은 허용되지 않습니다.');
        data = await body(req);
      }
      if (['/api/register', '/api/login'].includes(pathname) && req.method === 'POST') {
        limited(`auth:${req.socket.remoteAddress}`, 300);
        const username = text(data.username, 3, 32, '아이디').toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(username)) fail(400, '아이디는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.');
        limited(`user:${username}`, 15);
        if (typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 128) fail(400, '비밀번호는 10~128자로 입력해 주세요.');
        if (pathname === '/api/register') {
          const name = text(data.name, 1, 20, '이름');
          const salt = randomBytes(16).toString('hex');
          const password = (await scrypt(data.password, salt, 64)).toString('hex');
          if (one('SELECT 1 FROM users WHERE username=?', username)) fail(409, '이미 사용 중인 아이디입니다.');
          const id = randomUUID(); run('INSERT INTO users VALUES(?,?,?,?,?)', id, username, name, salt, password);
          newSession(id, res); respond(201, { user: { id, username, name } }); return;
        }
        const user = one('SELECT * FROM users WHERE username=?', username);
        const calculated = await scrypt(data.password, user?.salt || 'invalid-account-salt', 64);
        if (!user || !timingSafeEqual(calculated, Buffer.from(user.password, 'hex'))) fail(401, '아이디 또는 비밀번호가 일치하지 않습니다.');
        newSession(user.id, res); respond(200, { user: { id: user.id, username: user.username, name: user.name } }); return;
      }
      const user = sessionUser(req);
      if (pathname === '/api/me' && req.method === 'GET') { respond(200, { user: user || null }); return; }
      if (!user) fail(401, '로그인이 필요합니다.');
      if (pathname === '/api/logout' && req.method === 'POST') {
        const cookie = /seven_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
        if (cookie) run('DELETE FROM sessions WHERE token=?', hash(cookie[1]));
        res.setHeader('Set-Cookie', sessionCookie('', 0)); respond(200, { ok: true }); return;
      }
      if (req.method === 'POST') limited(`write:${user.id}`, 150, 60000);
      if (pathname === '/api/rooms' && req.method === 'GET') {
        respond(200, { rooms: all('SELECT rooms.id,name,start,end,owner_id AS ownerId,(SELECT COUNT(*) FROM members m WHERE m.room_id=rooms.id) AS count FROM rooms JOIN members ON members.room_id=rooms.id WHERE members.user_id=? ORDER BY created DESC', user.id) }); return;
      }
      if (pathname === '/api/rooms' && req.method === 'POST') {
        const name = text(data.name, 2, 60, '친구방 이름');
        if (one('SELECT COUNT(*) AS count FROM rooms WHERE owner_id=?', user.id).count >= 30) fail(400, '계정당 최대 30개의 방을 만들 수 있습니다.');
        const id = randomUUID();
        transaction(() => { run('INSERT INTO rooms VALUES(?,?,?,?,NULL,NULL,?)', id, name, user.id, token(), millis()); run('INSERT INTO members VALUES(?,?,NULL)', id, user.id); });
        respond(201, { room: snapshot(roomFor(id, user.id), user.id) }); return;
      }
      if (pathname === '/api/join' && req.method === 'POST') {
        limited(`join:${user.id}`, 20);
        const room = one('SELECT * FROM rooms WHERE invite=?', text(data.invite, 64, 64, '초대 코드'));
        if (!room) fail(404, '유효하지 않은 초대 링크입니다.');
        transaction(() => {
          if (one('SELECT 1 FROM members WHERE room_id=? AND user_id=?', room.id, user.id)) return;
          if (room.start) fail(409, '이미 시작한 챌린지에는 새로 참여할 수 없습니다.');
          if (one('SELECT COUNT(*) AS count FROM members WHERE room_id=?', room.id).count >= 100) fail(409, '방 정원 100명이 모두 찼습니다.');
          run('INSERT INTO members VALUES(?,?,NULL)', room.id, user.id);
        });
        respond(200, { room: snapshot(room, user.id) }); return;
      }
      const match = /^\/api\/rooms\/([a-f0-9-]{36})(?:\/(goal|approve|start|record|cheer|rotate-invite))?$/.exec(pathname);
      if (!match) fail(404, '찾을 수 없습니다.');
      const [, id, operation] = match;
      const room = roomFor(id, user.id);
      if (req.method === 'GET' && !operation) { respond(200, { room: snapshot(room, user.id) }); return; }
      if (req.method !== 'POST' || !operation) fail(405, '허용되지 않는 요청입니다.');
      transaction(() => {
        const member = one('SELECT * FROM members WHERE room_id=? AND user_id=?', id, user.id);
        if (operation === 'goal') {
          if (room.start) fail(409, '시작된 챌린지의 목표는 변경할 수 없습니다.');
          const goal = { category: data.category, title: data.title, frequency: data.frequency, minutes: data.minutes, bedtime: data.bedtime || '', proof: data.proof, reviewed: data.reviewed === true };
          validateGoal(goal); goal.title = goal.title.trim(); goal.proof = goal.proof.trim();
          run('UPDATE members SET goal=? WHERE room_id=? AND user_id=?', JSON.stringify(goal), id, user.id);
          run('DELETE FROM approvals WHERE room_id=? AND target_id=?', id, user.id);
        } else if (operation === 'approve') {
          if (room.start) fail(409, '이미 시작한 챌린지입니다.');
          const target = one('SELECT goal FROM members WHERE room_id=? AND user_id=?', id, data.targetId || '');
          if (!target?.goal || data.targetId === user.id) fail(400, '목표를 제출한 다른 친구만 확인할 수 있습니다.');
          if (data.goalVersion !== hash(target.goal)) fail(409, '친구의 목표가 변경되었습니다. 새 목표를 확인해 주세요.');
          run('INSERT OR IGNORE INTO approvals VALUES(?,?,?)', id, user.id, data.targetId);
        } else if (operation === 'start') {
          if (room.owner_id !== user.id) fail(403, '방장만 시작할 수 있습니다.');
          if (room.start) fail(409, '이미 시작한 챌린지입니다.');
          if (!snapshot(room, user.id).ready) fail(409, '2명 이상 참여하고 모든 친구의 목표를 서로 확인해야 시작할 수 있습니다.');
          run('UPDATE rooms SET start=?,end=? WHERE id=?', today(), addDays(today(), 6), id);
        } else if (operation === 'record') {
          if (!room.start || !member.goal) fail(409, '방장이 챌린지를 시작한 뒤 인증할 수 있습니다.');
          const existing = all('SELECT day,note,minutes,bedtime FROM records WHERE room_id=? AND user_id=?', id, user.id);
          const next = submitRecord({ goal: { ...JSON.parse(member.goal), start: room.start, end: room.end }, records: existing }, { note: data.note, minutes: data.minutes, bedtime: data.bedtime }, today());
          const record = next.records.at(-1);
          run('INSERT INTO records VALUES(?,?,?,?,?,?,?)', id, user.id, record.day, record.note, record.minutes, record.bedtime, millis());
        } else if (operation === 'cheer') {
          if (data.targetId === user.id || !one('SELECT 1 FROM members WHERE room_id=? AND user_id=?', id, data.targetId || '')) fail(400, '이 방의 다른 친구에게 응원을 보내 주세요.');
          if (data.active === true) run('INSERT OR IGNORE INTO cheers VALUES(?,?,?)', id, user.id, data.targetId);
          else if (data.active === false) run('DELETE FROM cheers WHERE room_id=? AND sender_id=? AND target_id=?', id, user.id, data.targetId);
          else fail(400, '응원 상태를 지정해 주세요.');
        } else if (operation === 'rotate-invite') {
          if (room.owner_id !== user.id) fail(403, '방장만 초대 링크를 변경할 수 있습니다.');
          if (room.start) fail(409, '시작한 챌린지에는 초대할 수 없습니다.');
          run('UPDATE rooms SET invite=? WHERE id=?', token(), id);
        }
      });
      respond(200, { room: snapshot(roomFor(id, user.id), user.id) });
    } catch (error) {
      const status = error.status || (error.code ? 500 : 400);
      respond(status, { error: status >= 500 ? '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' : error.message });
    }
  });
  server.on('close', () => db.close());
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 4173);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`SEVEN is ready: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
