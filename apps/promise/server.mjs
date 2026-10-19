import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openStore, hash, token } from './store.mjs';
import { fail, text, dayKey, addDays, deadline, midnight, dateInput, validatePromise, phase, daysFor, rank } from './model.js';
const scrypt = promisify(scryptCallback);
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };

export async function createApp({ database = process.env.DATABASE_PATH || './data/promise.sqlite', origin = process.env.PUBLIC_ORIGIN || '', now = () => Date.now() } = {}) {
  if (origin && (!['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).origin !== origin)) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without trailing slash');
  const db = await openStore(database), { one, all, run, tx } = db;
  const realNow = () => Number(now()), clock = r => r.demo ? r.clock : realNow();
  const cookie = (value, age = 2592000) => `promise_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
  function session(req) {
    const found = /(?:^|;\s*)promise_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    return found ? one('SELECT users.id,username,name,demo FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?', hash(found[1]), realNow()) : undefined;
  }
  function newSession(id, res) {
    const secret = token();
    run('DELETE FROM sessions WHERE expires<?', realNow());
    run('INSERT INTO sessions VALUES(?,?,?)', hash(secret), id, realNow() + 2592000000);
    res.setHeader('Set-Cookie', cookie(secret));
  }
  function limit(key, max, window = 900000) {
    run('DELETE FROM limits WHERE expires<?', realNow());
    if ((one('SELECT count FROM limits WHERE key=?', key)?.count || 0) >= max) fail(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    run('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, realNow() + window);
  }
  const getRoom = (id, user) => one('SELECT rooms.* FROM rooms JOIN members ON members.room=rooms.id WHERE rooms.id=? AND members.user=?', id, user) || fail(404, '참여 중인 친구방을 찾을 수 없습니다.');
  const getSeason = room => one('SELECT * FROM seasons WHERE id=?', room.current);
  const pending = season => one("SELECT count(*) AS n FROM records WHERE season=? AND status='pending'", season).n;
  function invalidate(season) { run('UPDATE promises SET ready=0 WHERE season=?', season); run('UPDATE seasons SET version=version+1 WHERE id=?', season); }
  function insertSeason(room, start, number, previous) {
    const id = randomUUID();
    run('INSERT INTO seasons(id,room,number,start) VALUES(?,?,?,?)', id, room.id, number, start);
    for (const member of all('SELECT user FROM members WHERE room=?', room.id)) {
      const goal = previous ? one('SELECT goal FROM promises WHERE season=? AND user=?', previous, member.user)?.goal : null;
      run('INSERT INTO promises(season,user,goal) VALUES(?,?,?)', id, member.user, goal || null);
    }
    run('UPDATE rooms SET current=? WHERE id=?', id, room.id);
    return id;
  }
  function makeRoom(user, name, start, demo = false, time = null) {
    const id = randomUUID(), room = { id };
    run('INSERT INTO rooms(id,name,owner,invite,demo,clock,created) VALUES(?,?,?,?,?,?,?)', id, name, user, token(), Number(demo), time, realNow());
    run('INSERT INTO members VALUES(?,?)', id, user);
    insertSeason(room, start, 1);
    return one('SELECT * FROM rooms WHERE id=?', id);
  }
  function timerValue(season, user, time) {
    const timer = one('SELECT * FROM timers WHERE season=? AND user=? AND day=?', season, user, dayKey(time));
    return { elapsed: (timer?.elapsed || 0) + (timer?.running != null ? Math.max(0, Math.floor((time - timer.running) / 1000)) : 0), running: timer?.running != null };
  }
  function snapshot(room, viewer, selected) {
    const season = selected ? one('SELECT * FROM seasons WHERE id=? AND room=?', selected, room.id) : getSeason(room);
    if (!season) fail(404, '시즌이 없습니다.');
    const time = clock(room), today = dayKey(time), state = phase(season, time, pending(season.id));
    const records = all('SELECT records.*,users.name FROM records JOIN users ON users.id=records.user WHERE season=? ORDER BY created DESC,records.rowid DESC', season.id).map(record => ({
      ...record, reactions: ['봤어요', '잘했어요', '같이 하자'].map(kind => ({ kind, count: one('SELECT count(*) AS n FROM reactions WHERE record=? AND kind=?', record.id, kind).n, active: !!one('SELECT 1 FROM reactions WHERE record=? AND user=? AND kind=?', record.id, viewer, kind) })),
      canReport: record.user !== viewer && record.status === 'accepted' && !record.reviewer && time <= record.created + 86400000 && state !== 'finished',
      canResolve: record.status === 'pending' && record.user !== viewer && (room.owner === viewer || record.user === room.owner)
    }));
    const members = all('SELECT users.id,users.name,promises.goal,promises.ready,promises.reflection FROM promises JOIN users ON users.id=promises.user WHERE season=? ORDER BY promises.rowid', season.id).map(m => {
      const goal = m.goal ? JSON.parse(m.goal) : null, mine = records.filter(r => r.user === m.id), count = mine.filter(r => r.status !== 'rejected').length, days = daysFor(goal, season, mine, time);
      let recovery = false;
      for (let i = 1; i < days.length; i++) if (days[i].status === 'done' && days.slice(0, i).filter(d => d.scheduled).at(-1)?.status === 'missed') recovery = true;
      return { ...m, goal, count, days, today: days.find(d => d.day === today)?.status || 'rest', due: days.filter(d => d.scheduled && d.day <= today).length, recovery };
    });
    return { id: room.id, name: room.name, owner: room.owner, demo: !!room.demo, current: room.current, season: { ...season, status: state }, today, serverNow: time, members, records,
      canStart: members.length >= 2 && members.every(m => m.goal && m.ready),
      invite: room.owner === viewer && state === 'draft' && !room.demo && season.id === room.current ? room.invite : null,
      total: members.reduce((sum, m) => sum + m.count, 0), pending: records.filter(r => r.status === 'pending').length,
      rankings: state === 'finished' ? rank(members) : [],
      timer: timerValue(season.id, viewer, time),
      history: all('SELECT id,number,start FROM seasons WHERE room=? ORDER BY number DESC', room.id) };
  }
  function activeDay(room, season, user) {
    const time = clock(room), today = dayKey(time), p = one('SELECT goal FROM promises WHERE season=? AND user=?', season.id, user), goal = p?.goal && JSON.parse(p.goal);
    if (phase(season, time) !== 'active' || !goal) fail(409, '시즌 진행 중에 인증할 수 있습니다.');
    const index = Math.round((midnight(today) - midnight(season.start)) / 86400000);
    if (!goal.days.includes(index)) fail(409, '오늘은 쉬는 날입니다. 정해 둔 실천일에 인증해 주세요.');
    if (time > deadline(today, goal.cutoff)) fail(409, '오늘 약속의 마감 시각이 지났습니다. 다음 약속에서 다시 만나요.');
    if (one('SELECT 1 FROM records WHERE season=? AND user=? AND day=?', season.id, user, today)) fail(409, '오늘의 인증은 이미 제출했습니다.');
    return { time, today, goal };
  }
  function createDemo(res) {
    const id = randomUUID(), virtual = deadline(dayKey(realNow()), '12:00');
    run('INSERT INTO users VALUES(?,?,?,?,?,1)', id, 'demo-' + token().slice(0, 16), '나', '', '');
    let room;
    tx(() => {
      room = makeRoom(id, '조금씩, 꾸준히', addDays(dayKey(virtual), -2), true, virtual);
      const people = [{ id, name: '나', title: '책 10쪽 읽고 한 문장 남기기', days: [0, 2, 4, 6], proof: '읽은 페이지와 기억에 남는 문장 한 줄', reason: '잠들기 전, 휴대폰 대신 책을 펴고 싶어서' },
        { id: randomUUID(), name: '민지', title: '전공 문제 10개 풀기', days: [0, 1, 2, 5], proof: '푼 문제 번호와 배운 내용 한 줄', reason: '몰아서 공부하던 습관을 바꾸고 싶어요' },
        { id: randomUUID(), name: '준호', title: '동네 한 바퀴 20분 걷기', days: [0, 2, 4, 6], proof: '걸은 시간과 오늘의 산책 한 줄', reason: '퇴근하고 바깥 공기를 쐬는 시간을 만들려고요' },
        { id: randomUUID(), name: '서연', title: '23시까지 취침 준비 체크인', days: [1, 3, 5, 6], proof: '휴대폰 내려놓기와 내일 준비한 내용을 기록', reason: '편안하게 하루를 마무리하고 싶어서' }];
      people.forEach((p, i) => {
        if (i) { run('INSERT INTO users VALUES(?,?,?,?,?,1)', p.id, 'demo-' + token().slice(0, 16), p.name, '', ''); run('INSERT INTO members VALUES(?,?)', room.id, p.id); run('INSERT INTO promises(season,user) VALUES(?,?)', room.current, p.id); }
        const goal = validatePromise({ ...p, cutoff: '23:00', kind: 'note' });
        run('UPDATE promises SET goal=?,ready=1 WHERE season=? AND user=?', JSON.stringify(goal), room.current, p.id);
        const dates = p.days.filter(d => d < 2 || i === 1 && d === 2);
        for (const d of dates) {
          const day = addDays(dayKey(virtual), d - 2);
          run('INSERT INTO records(id,season,user,day,note,seconds,created) VALUES(?,?,?,?,?,0,?)', randomUUID(), room.current, p.id, day, i === 0 ? '10쪽을 읽었어요. 작은 시작이 하루의 방향을 바꾼다는 문장이 남았습니다.' : i === 1 ? '운영체제 문제 10개 완료! 어제 헷갈렸던 개념이 이제 조금 보이네요.' : i === 2 ? '천천히 20분, 오늘은 공원 끝까지 걸었어요.' : '내일 입을 옷을 준비하고 휴대폰을 내려놓았어요.', deadline(day, i === 1 ? '10:40' : '10:00'));
        }
      });
      run('UPDATE seasons SET started=1 WHERE id=?', room.current);
    });
    newSession(id, res);
    return { user: { id, name: '나', demo: 1 }, room: snapshot(room, id) };
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'JSON 요청이 필요합니다.');
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 20000) fail(413, '입력이 너무 큽니다.'); chunks.push(c); }
    try { const v = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!v || Array.isArray(v) || typeof v !== 'object') throw 0; return v; } catch { fail(400, '요청 형식이 올바르지 않습니다.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host || '';
      if (!origin && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) fail(403, '외부 접속은 PUBLIC_ORIGIN 설정이 필요합니다.');
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return send(200, { ok: true });
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' || !files[path]) fail(404, '페이지를 찾을 수 없습니다.');
        const [file, mime] = files[path]; res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' }); return res.end(await readFile(new URL(file, import.meta.url)));
      }
      let data = {};
      if (req.method !== 'GET') {
        if (req.method !== 'POST') fail(405, '허용되지 않는 요청입니다.');
        if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && req.headers.origin !== (origin || 'http://' + host)) fail(403, '다른 사이트의 변경 요청은 허용되지 않습니다.');
        data = await body(req);
      }
      if (req.method === 'POST' && ['/api/register', '/api/login', '/api/demo'].includes(path)) {
        limit('auth:' + req.socket.remoteAddress, 80);
        if (path === '/api/demo') { if (session(req)) fail(409, '로그아웃한 뒤 체험할 수 있습니다.'); return send(201, createDemo(res)); }
        const username = text(data.username, 3, 32, '아이디').toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(username)) fail(400, '아이디는 영문·숫자·밑줄·하이픈을 사용해 주세요.');
        limit('account:' + username, 15);
        if (typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 128) fail(400, '비밀번호는 10~128자로 입력해 주세요.');
        if (path === '/api/register') {
          const name = text(data.name, 1, 20, '이름'), salt = randomBytes(16).toString('hex'), password = (await scrypt(data.password, salt, 64)).toString('hex');
          if (one('SELECT 1 FROM users WHERE username=?', username)) fail(409, '이미 사용 중인 아이디입니다.');
          const id = randomUUID(); run('INSERT INTO users VALUES(?,?,?,?,?,0)', id, username, name, salt, password);
          newSession(id, res); return send(201, { user: { id, username, name, demo: 0 } });
        }
        const user = one('SELECT * FROM users WHERE username=? AND demo=0', username), calculated = await scrypt(data.password, user?.salt || 'invalid-account-salt', 64);
        if (!user || !timingSafeEqual(calculated, Buffer.from(user.password, 'hex'))) fail(401, '아이디 또는 비밀번호가 일치하지 않습니다.');
        newSession(user.id, res); return send(200, { user: { id: user.id, name: user.name, demo: 0 } });
      }
      const user = session(req);
      if (path === '/api/me' && req.method === 'GET') return send(200, { user: user || null, today: dayKey(realNow()) });
      if (!user) fail(401, '로그인이 필요합니다.');
      if (path === '/api/logout' && req.method === 'POST') {
        const value = /promise_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1]; if (value) run('DELETE FROM sessions WHERE token=?', hash(value));
        res.setHeader('Set-Cookie', cookie('', 0)); return send(200, { ok: true });
      }
      if (req.method === 'POST') limit('write:' + user.id, 160, 60000);
      if (path === '/api/rooms' && req.method === 'GET') return send(200, { rooms: all('SELECT rooms.id,rooms.name,rooms.demo,seasons.number,seasons.start FROM rooms JOIN members ON members.room=rooms.id JOIN seasons ON seasons.id=rooms.current WHERE members.user=? ORDER BY rooms.created DESC', user.id) });
      if (path === '/api/rooms' && req.method === 'POST') {
        if (user.demo) fail(403, '체험에서는 준비된 방을 이용해 주세요.');
        if (one('SELECT count(*) AS n FROM rooms WHERE owner=?', user.id).n >= 20) fail(400, '친구방은 최대 20개까지 만들 수 있습니다.');
        const name = text(data.name, 2, 50, '친구방 이름'), start = dateInput(data.start, dayKey(realNow()));
        return send(201, { room: snapshot(tx(() => makeRoom(user.id, name, start)), user.id) });
      }
      if (path === '/api/join' && req.method === 'POST') {
        limit('join:' + user.id, 20);
        if (user.demo) fail(403, '실제 계정으로 참여해 주세요.');
        const room = one('SELECT * FROM rooms WHERE invite=? AND demo=0', text(data.invite, 64, 64, '초대 코드'));
        if (!room) fail(404, '유효하지 않은 초대 코드입니다.');
        tx(() => {
          if (one('SELECT 1 FROM members WHERE room=? AND user=?', room.id, user.id)) return;
          const season = getSeason(room);
          if (season.started) fail(409, '시즌 시작 후에는 참여할 수 없습니다. 다음 시즌에 함께해 주세요.');
          if (one('SELECT count(*) AS n FROM members WHERE room=?', room.id).n >= 10) fail(409, '친구방 정원은 10명입니다.');
          run('INSERT INTO members VALUES(?,?)', room.id, user.id); run('INSERT INTO promises(season,user) VALUES(?,?)', season.id, user.id); invalidate(season.id);
        });
        return send(200, { room: snapshot(room, user.id) });
      }
      const match = /^\/api\/rooms\/([a-f0-9-]{36})(?:\/([a-z-]+))?$/.exec(path);
      if (!match) fail(404, '요청을 찾을 수 없습니다.');
      const [, id, operation] = match, room = getRoom(id, user.id), season = getSeason(room);
      if (req.method === 'GET' && !operation) return send(200, { room: snapshot(room, user.id, url.searchParams.get('season')) });
      if (req.method !== 'POST' || !operation) fail(405, '허용되지 않는 요청입니다.');
      tx(() => {
        const time = clock(room), today = dayKey(time), status = phase(season, time, pending(season.id));
        if (data.seasonId && data.seasonId !== season.id) fail(409, '새 시즌이 시작되었습니다. 새로고침 후 확인해 주세요.');
        if (['goal', 'ready', 'start', 'date', 'rotate-invite'].includes(operation) && season.started) fail(409, '시작된 시즌의 약속과 일정은 잠겨 있습니다.');
        if (['start', 'date', 'next', 'rotate-invite'].includes(operation) && room.owner !== user.id) fail(403, '방장만 할 수 있습니다.');
        if (operation === 'goal') {
          const goal = validatePromise(data); run('UPDATE promises SET goal=? WHERE season=? AND user=?', JSON.stringify(goal), season.id, user.id); invalidate(season.id);
        } else if (operation === 'date') {
          const start = dateInput(data.start, today); run('UPDATE seasons SET start=? WHERE id=?', start, season.id); invalidate(season.id);
        } else if (operation === 'ready') {
          if (data.version !== season.version) fail(409, '약속이 바뀌었습니다. 최신 카드를 다시 확인해 주세요.');
          if (all('SELECT goal FROM promises WHERE season=?', season.id).some(m => !m.goal)) fail(409, '모두 약속 카드를 작성한 뒤 준비할 수 있습니다.');
          if (typeof data.ready !== 'boolean') fail(400, '준비 상태를 확인해 주세요.');
          run('UPDATE promises SET ready=? WHERE season=? AND user=?', Number(data.ready), season.id, user.id);
        } else if (operation === 'start') {
          if (!snapshot(room, user.id).canStart) fail(409, '2명 이상이 약속 카드를 작성하고 모두 준비 완료해야 합니다.');
          for (const p of all('SELECT goal FROM promises WHERE season=?', season.id)) {
            const goal = JSON.parse(p.goal);
            if (goal.days.some(d => time > deadline(addDays(season.start, d), goal.cutoff))) fail(409, '이미 지난 약속이 있습니다. 시작일을 다시 정해 주세요.');
          }
          run('UPDATE seasons SET started=1 WHERE id=?', season.id);
        } else if (operation === 'rotate-invite') {
          if (room.demo) fail(403, '체험방에는 실제 친구를 초대할 수 없습니다.');
          run('UPDATE rooms SET invite=? WHERE id=?', token(), id);
        } else if (operation === 'timer') {
          const active = activeDay(room, season, user.id);
          if (active.goal.kind !== 'timer') fail(400, '타이머를 사용하는 약속이 아닙니다.');
          if (typeof data.running !== 'boolean') fail(400, '타이머 상태를 확인해 주세요.');
          const timer = timerValue(season.id, user.id, time);
          run('INSERT INTO timers VALUES(?,?,?,?,?) ON CONFLICT(season,user,day) DO UPDATE SET elapsed=excluded.elapsed,running=excluded.running', season.id, user.id, today, timer.elapsed, data.running ? time : null);
        } else if (operation === 'record') {
          const active = activeDay(room, season, user.id), note = text(data.note, 4, 800, '실천 기록'), timer = timerValue(season.id, user.id, time);
          if (active.goal.kind === 'timer' && timer.elapsed < active.goal.minutes * 60) fail(409, '타이머 ' + active.goal.minutes + '분과 실천 기록이 필요합니다.');
          run('INSERT INTO records(id,season,user,day,note,seconds,created) VALUES(?,?,?,?,?,?,?)', randomUUID(), season.id, user.id, active.today, note, active.goal.kind === 'timer' ? timer.elapsed : 0, time);
          run('UPDATE timers SET elapsed=?,running=NULL WHERE season=? AND user=? AND day=?', timer.elapsed, season.id, user.id, today);
        } else if (operation === 'react' || operation === 'report' || operation === 'resolve') {
          const record = one('SELECT * FROM records WHERE id=? AND season=?', typeof data.recordId === 'string' ? data.recordId : '', season.id);
          if (!record) fail(404, '인증 기록이 없습니다.');
          if (operation === 'react') {
            if (!['봤어요', '잘했어요', '같이 하자'].includes(data.kind)) fail(400, '반응을 선택해 주세요.');
            const same = one('SELECT 1 FROM reactions WHERE record=? AND user=? AND kind=?', record.id, user.id, data.kind);
            if (same) run('DELETE FROM reactions WHERE record=? AND user=?', record.id, user.id);
            else run('INSERT INTO reactions VALUES(?,?,?) ON CONFLICT(record,user) DO UPDATE SET kind=excluded.kind', record.id, user.id, data.kind);
          } else if (operation === 'report') {
            if (record.user === user.id || record.status !== 'accepted' || record.reviewer || time > record.created + 86400000 || status === 'finished') fail(409, '다른 친구의 인증에 제출 후 24시간 이내 한 번 이의를 제기할 수 있습니다.');
            run("UPDATE records SET status='pending',reporter=?,reason=? WHERE id=?", user.id, text(data.reason, 4, 400, '확인이 필요한 이유'), record.id);
          } else {
            if (record.status !== 'pending' || record.user === user.id || !(room.owner === user.id || record.user === room.owner)) fail(403, '방장이 검토합니다. 방장 본인의 인증은 다른 참여자가 검토합니다.');
            if (!['accepted', 'rejected'].includes(data.decision)) fail(400, '검토 결과를 선택해 주세요.');
            run('UPDATE records SET status=?,decision=?,reviewer=? WHERE id=?', data.decision, text(data.reason, 4, 400, '판정 근거'), user.id, record.id);
          }
        } else if (operation === 'reflection') {
          if (!['review', 'finished'].includes(status)) fail(409, '시즌이 끝나면 회고를 남길 수 있습니다.');
          run('UPDATE promises SET reflection=? WHERE season=? AND user=?', text(data.reflection, 4, 800, '회고'), season.id, user.id);
        } else if (operation === 'next') {
          if (status !== 'finished') fail(409, '결과가 확정된 뒤 다음 시즌을 열 수 있습니다.');
          insertSeason(room, dateInput(data.start, today), season.number + 1, season.id);
          run('UPDATE rooms SET invite=? WHERE id=?', token(), room.id);
        } else if (operation === 'demo-day') {
          if (!room.demo || room.owner !== user.id) fail(403, '가상 체험에서만 날짜를 이동할 수 있습니다.');
          if (status === 'finished') fail(409, '다음 시즌을 시작해 보세요.');
          run('UPDATE rooms SET clock=clock+86400000 WHERE id=?', room.id);
        } else if (operation === 'demo-ready') {
          if (!room.demo || room.owner !== user.id || season.started) fail(403, '체험방의 준비 화면에서만 사용할 수 있습니다.');
          run('UPDATE promises SET ready=1 WHERE season=? AND user<>? AND goal IS NOT NULL', season.id, user.id);
        } else fail(404, '요청을 찾을 수 없습니다.');
      });
      return send(200, { room: snapshot(getRoom(id, user.id), user.id) });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : '저장 중 문제가 생겼습니다. 다시 시도해 주세요.' }); }
  });
  server.on('close', () => db.close()); server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp(), port = Number(process.env.PORT || 4190);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('우리의 약속: http://127.0.0.1:' + port));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
