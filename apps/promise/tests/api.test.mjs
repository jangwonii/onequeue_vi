import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { addDays, dayKey, deadline, validatePromise, rank } from '../model.js';
const goal = { title: '책 10쪽 읽기', proof: '읽은 페이지와 기억에 남는 문장 한 줄', reason: '꾸준히 읽으려고요', days: [0, 2, 4, 6], cutoff: '23:00', kind: 'note', minutes: 0 };
async function launch(options = {}) {
  const server = await createApp({ database: ':memory:', ...options }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, url: 'http://127.0.0.1:' + server.address().port, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
function client(url, initial = '') {
  let cookie = initial;
  return { get cookie() { return cookie; }, async call(path, data, headers = {}) {
    const r = await fetch(url + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json(), headers: r.headers };
  }};
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
async function setup(t, options = {}) {
  let time = deadline('2026-10-16', '10:00');
  const instance = await launch({ now: () => time, ...options }); t.after(instance.close);
  const a = client(instance.url), b = client(instance.url), x = client(instance.url);
  const signup = async (c, username, name) => ok(await c.call('/register', { username, name, password: 'test-only-password-123' }), 201).user;
  const au = await signup(a, 'host', '민지'), bu = await signup(b, 'friend', '준호'); await signup(x, 'stranger', '서연');
  const room = ok(await a.call('/rooms', { name: '함께 지키는 약속', start: '2026-10-16' }), 201).room, path = '/rooms/' + room.id;
  ok(await b.call('/join', { invite: room.invite }));
  return { ...instance, a, b, x, au, bu, room, path, set: ms => time = ms, get time() { return time; },
    async prepare(ag = goal, bg = goal) {
      ok(await a.call(path + '/goal', ag)); const state = ok(await b.call(path + '/goal', bg)).room;
      ok(await a.call(path + '/ready', { ready: true, version: state.season.version }));
      ok(await b.call(path + '/ready', { ready: true, version: state.season.version }));
      return ok(await a.call(path + '/start', {})).room;
    }
  };
}
test('rules: exactly four unique days, KST day boundaries, tied ranking separate from completion', () => {
  for (const days of [[0,1,2], [0,0,1,2], [0,1,2,7], [0,1,2,2.5]]) assert.throws(() => validatePromise({ ...goal, days }));
  assert.throws(() => validatePromise({ ...goal, cutoff: '24:00' }));
  assert.throws(() => validatePromise({ ...goal, kind: 'timer', minutes: 0 }));
  assert.equal(dayKey(Date.parse('2026-10-15T15:00:00Z')), '2026-10-16');
  assert.equal(addDays('2026-12-30', 6), '2027-01-05');
  const results = rank([{ id: 'a', count: 3 }, { id: 'b', count: 3 }, { id: 'c', count: 1 }]);
  assert.deepEqual(results.map(r => [r.rank, r.score, r.complete]), [[1,75,false],[1,75,false],[3,25,false]]);
  assert.deepEqual(rank([{ count: 4 }, { count: 4 }]).map(r => [r.rank,r.complete]), [[1,true],[1,true]]);
});
test('room access, invitation rotation, two-party readiness, stale versions and locking', async t => {
  const f = await setup(t), { a,b,x,path,room } = f;
  assert.equal((await client(f.url).call(path)).status, 401);
  assert.equal((await x.call(path)).status, 404);
  assert.equal((await b.call(path + '/start', {})).status, 403);
  assert.equal((await a.call(path + '/start', {})).status, 409);
  assert.equal((await a.call('/rooms', { name: 'bad', start: '2026-02-30' })).status, 400);
  assert.equal((await a.call(path + '/goal', goal, { Origin: 'https://other.example' })).status, 403);
  const foreign = await new Promise((resolve, reject) => { const req = request(f.url + '/api' + path, { headers: { Host: 'other.example', Cookie: a.cookie } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
  assert.equal(foreign, 403);
  const rotated = ok(await a.call(path + '/rotate-invite', {})).room;
  assert.equal((await x.call('/join', { invite: room.invite })).status, 404);
  assert.equal((await b.call(path)).body.room.invite, null);
  ok(await a.call(path + '/goal', goal)); const old = ok(await b.call(path + '/goal', goal)).room;
  ok(await a.call(path + '/ready', { ready: true, version: old.season.version }));
  const edited = ok(await b.call(path + '/goal', { ...goal, title: '전공 문제 10개' })).room;
  assert.ok(edited.members.every(m => !m.ready));
  assert.equal((await a.call(path + '/ready', { ready: true, version: old.season.version })).status, 409);
  await f.prepare();
  assert.equal((await a.call(path + '/goal', goal)).status, 409);
  assert.equal((await a.call(path + '/date', { start: '2026-10-17' })).status, 409);
  assert.equal((await x.call('/join', { invite: rotated.invite })).status, 409);
});
test('new participants and date changes reset every ready flag; expired promises cannot start', async t => {
  const f = await setup(t), { a,b,x,path } = f;
  ok(await a.call(path + '/goal', goal)); let s = ok(await b.call(path + '/goal', goal)).room;
  ok(await a.call(path + '/ready', { ready: true, version: s.season.version }));
  s = ok(await a.call(path + '/date', { start: '2026-10-17' })).room;
  assert.ok(s.members.every(m => !m.ready));
  ok(await a.call(path + '/ready', { ready: true, version: s.season.version }));
  const joined = ok(await x.call('/join', { invite: s.invite })).room;
  assert.ok(joined.members.every(m => !m.ready));
  ok(await x.call(path + '/goal', goal)); s = ok(await a.call(path)).room;
  for (const c of [a,b,x]) ok(await c.call(path + '/ready', { ready: true, version: s.season.version }));
  f.set(deadline('2026-10-18', '00:01'));
  assert.equal((await a.call(path + '/start', {})).status, 409);
});
test('official records use server day/user, reject duplicate races, rest days, late and backfill; recovery earns no bonus', async t => {
  const f = await setup(t), { a,b,path,au,bu } = f; await f.prepare();
  const payload = { note: '10쪽과 한 문장을 남겼어요.', day: '1999-01-01', user: bu.id };
  const concurrent = await Promise.all([a.call(path + '/record', payload), a.call(path + '/record', payload)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200,409]);
  let s = ok(await b.call(path)).room;
  assert.equal(s.records[0].user, au.id); assert.equal(s.records[0].day, '2026-10-16'); assert.deepEqual(s.rankings, []);
  f.set(deadline('2026-10-17', '12:00')); assert.equal((await a.call(path + '/record', payload)).status, 409);
  f.set(deadline('2026-10-18', '23:01')); assert.equal((await a.call(path + '/record', payload)).status, 409);
  f.set(deadline('2026-10-20', '12:00')); s = ok(await a.call(path + '/record', payload)).room;
  assert.equal(s.members.find(m => m.id === au.id).count, 2); assert.equal(s.members.find(m => m.id === au.id).recovery, true);
  f.set(deadline('2026-10-24', '00:00')); s = ok(await a.call(path)).room;
  assert.equal(s.season.status, 'finished'); assert.equal(s.rankings.find(r => r.id === au.id).score, 50);
});
test('server timer counts elapsed time, preserves pause, rejects fake minutes and resets by day', async t => {
  const f = await setup(t), { a,path } = f; await f.prepare({ ...goal, kind: 'timer', minutes: 1 });
  assert.equal((await a.call(path + '/record', { note: '기록했어요', minutes: 300, seconds: 9999 })).status, 409);
  ok(await a.call(path + '/timer', { running: true })); f.set(f.time + 30000);
  let s = ok(await a.call(path + '/timer', { running: false })).room; assert.equal(s.timer.elapsed, 30);
  f.set(f.time + 600000); s = ok(await a.call(path)).room; assert.equal(s.timer.elapsed, 30);
  ok(await a.call(path + '/timer', { running: true })); f.set(f.time + 30000);
  s = ok(await a.call(path + '/record', { note: '앱 타이머를 마치고 실천 내용을 기록했어요' })).room;
  assert.equal(s.records[0].seconds, 60); assert.equal(s.timer.running, false);
  f.set(deadline('2026-10-18', '12:00')); s = ok(await a.call(path)).room; assert.equal(s.timer.elapsed, 0);
});
test('reporting does not remove points; pending review blocks finalization; reviewer cannot judge own evidence', async t => {
  const f = await setup(t), { a,b,path,au,bu } = f; await f.prepare();
  const ar = ok(await a.call(path + '/record', { note: '첫날 실천을 했어요.' })).room.records[0];
  const br = ok(await b.call(path + '/record', { note: '친구도 실천을 했어요.' })).room.records[0];
  assert.equal((await a.call(path + '/report', { recordId: ar.id, reason: '내 인증의 이의제기' })).status, 409);
  let s = ok(await b.call(path + '/report', { recordId: ar.id, reason: '어떤 페이지를 읽었는지 확인이 필요해요' })).room;
  assert.equal(s.members.find(m => m.id === au.id).count, 1);
  assert.equal((await a.call(path + '/resolve', { recordId: ar.id, decision: 'accepted', reason: '스스로 승인하려고 해요' })).status, 403);
  ok(await a.call(path + '/report', { recordId: br.id, reason: '기록된 페이지 확인이 필요해요' }));
  ok(await a.call(path + '/resolve', { recordId: br.id, decision: 'rejected', reason: '잠긴 약속의 필수 기록이 빠져 있어요' }));
  f.set(deadline('2026-10-24', '10:00')); s = ok(await a.call(path)).room;
  assert.equal(s.season.status, 'review'); assert.deepEqual(s.rankings, []); assert.equal(s.members.find(m => m.id === bu.id).count, 0);
  s = ok(await b.call(path + '/resolve', { recordId: ar.id, decision: 'accepted', reason: '제출된 문장과 페이지가 조건에 맞아요' })).room;
  assert.equal(s.season.status, 'finished'); assert.equal(s.rankings[0].score, 25);
});
test('report window is 24 hours, final result requires 24 hours after season; reflection and next season retain history', async t => {
  const f = await setup(t), { a,b,path,au } = f; await f.prepare();
  let s = ok(await a.call(path + '/record', { note: '첫 기록입니다' })).room, id = s.records[0].id, oldSeason = s.season.id;
  f.set(f.time + 86400001); assert.equal((await b.call(path + '/report', { recordId: id, reason: '늦은 확인 요청이에요' })).status, 409);
  f.set(deadline('2026-10-23', '00:00')); s = ok(await a.call(path)).room; assert.equal(s.season.status, 'review');
  assert.equal((await a.call(path + '/next', { start: '2026-10-23' })).status, 409);
  ok(await a.call(path + '/reflection', { reflection: '한 번 놓쳐도 다음 약속으로 돌아오겠습니다.' }));
  f.set(deadline('2026-10-24', '00:00')); s = ok(await a.call(path)).room; assert.equal(s.season.status, 'finished');
  s = ok(await a.call(path + '/next', { start: '2026-10-25', seasonId: oldSeason })).room;
  assert.equal(s.season.number, 2); assert.equal(s.season.status, 'draft'); assert.equal(s.members.length, 2);
  assert.ok(s.members.every(m => !m.ready && m.goal && m.count === 0));
  const old = ok(await a.call(path + '?season=' + oldSeason)).room;
  assert.equal(old.members.find(m => m.id === au.id).count, 1); assert.match(old.members.find(m => m.id === au.id).reflection, /다음 약속/);
  assert.equal((await a.call(path + '/goal', { ...goal, seasonId: oldSeason })).status, 409);
});
test('reactions are one choice per person, private to room; demo dates cannot affect real rooms', async t => {
  const f = await setup(t), { a,b,x,path } = f; await f.prepare();
  const s = ok(await a.call(path + '/record', { note: '<img src=x onerror=alert(1)> 이것은 텍스트' })).room, id = s.records[0].id;
  ok(await b.call(path + '/react', { recordId: id, kind: '봤어요' }));
  let next = ok(await b.call(path + '/react', { recordId: id, kind: '잘했어요' })).room;
  assert.equal(next.records[0].reactions.reduce((sum,r) => sum+r.count,0), 1);
  next = ok(await b.call(path + '/react', { recordId: id, kind: '잘했어요' })).room;
  assert.equal(next.records[0].reactions.reduce((sum,r) => sum+r.count,0), 0);
  assert.equal((await x.call(path + '/react', { recordId: id, kind: '봤어요' })).status, 404);
  assert.equal((await a.call(path + '/demo-day', {})).status, 403);
  const dc = client(f.url), demo = ok(await dc.call('/demo', {}), 201).room;
  assert.equal(demo.demo, true); assert.equal(demo.members.length, 4);
  assert.equal((await dc.call('/join', { invite: f.room.invite })).status, 403);
  assert.equal((await dc.call('/rooms', { name: '가짜 친구방', start: '2026-10-16' })).status, 403);
  assert.equal((await a.call('/rooms/' + demo.id)).status, 404);
});
test('accounts, session invalidation and SQLite records survive server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promise-test-')), database = join(directory, 'state.sqlite');
  let instance = await launch({ database });
  try {
    const c = client(instance.url), demo = ok(await c.call('/demo', {}), 201);
    const saved = c.cookie, id = demo.room.id;
    await instance.close(); instance = await launch({ database });
    const reopened = client(instance.url, saved);
    const room = ok(await reopened.call('/rooms/' + id)).room;
    assert.equal(room.members.length, 4); assert.equal(room.records.length, demo.room.records.length);
    ok(await reopened.call('/logout', {})); assert.equal((await client(instance.url, saved).call('/rooms/' + id)).status, 401);
    const account = client(instance.url);
    const registered = ok(await account.call('/register', { name: '실제 계정', username: 'real-user', password: 'persistent-password-123' }), 201);
    assert.match(registered.user.id, /-/); ok(await account.call('/logout', {}));
    assert.equal((await account.call('/login', { username: 'real-user', password: 'wrong-password' })).status, 401);
    ok(await account.call('/login', { username: 'real-user', password: 'persistent-password-123' }));
  } finally { await instance.close(); await rm(directory, { recursive: true, force: true }); }
});
