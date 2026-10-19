import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

const goal = { category: 'study', title: '매일 영어 단어 공부하기', frequency: 7, minutes: 30, bedtime: '', proof: '타이머 기록에서 공부 시간을 확인하고 학습 내용 적기', reviewed: true };
async function launch(options) {
  const server = await createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const stop = server => new Promise(resolve => server.close(resolve));
function client(base) {
  let cookie = '';
  return { get cookie() { return cookie; }, async call(path, data, headers = {}) {
    const response = await fetch(`${base}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json(), headers: response.headers };
  } };
}
async function register(account, username, name) {
  const result = await account.call('/api/register', { username, name, password: 'only-test-password-123' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  return result.body.user;
}
test('two actual users share an invite-only challenge; server enforces permissions, locks and persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seven-api-'));
  const database = join(directory, 'test.sqlite');
  let date = new Date('2026-10-15T01:00:00Z');
  let instance = await launch({ database, now: () => date });
  try {
    const host = client(instance.url), friend = client(instance.url), stranger = client(instance.url), anonymous = client(instance.url);
    const hostUser = await register(host, 'host-test', '민지');
    const friendUser = await register(friend, 'friend-test', '준호');
    await register(stranger, 'stranger-test', '서연');
    assert.equal((await anonymous.call('/api/rooms')).status, 401);
    assert.equal((await host.call('/api/rooms', { name: '우리의 작은 도전' }, { Origin: 'https://other.example' })).status, 403);
    const created = await host.call('/api/rooms', { name: '우리의 작은 도전' });
    assert.equal(created.status, 201);
    const room = created.body.room, path = `/api/rooms/${room.id}`;
    assert.equal(room.members.length, 1);
    assert.equal((await stranger.call(path)).status, 404);
    assert.equal((await stranger.call(`${path}/goal`, goal)).status, 404);
    assert.equal((await host.call(`${path}/start`, {})).status, 409);
    const rotated = await host.call(`${path}/rotate-invite`, {});
    assert.equal((await friend.call('/api/join', { invite: room.invite })).status, 404);
    const invite = rotated.body.room.invite;
    assert.equal((await friend.call('/api/join', { invite })).status, 200);
    assert.equal((await friend.call('/api/join', { invite })).body.room.members.length, 2);
    assert.equal((await friend.call(path)).body.room.invite, null);
    assert.equal((await friend.call(`${path}/rotate-invite`, {})).status, 403);
    assert.equal((await friend.call(`${path}/start`, {})).status, 403);
    assert.equal((await host.call(`${path}/record`, { note: '아직 시작하지 않은 인증 기록입니다.', minutes: 30 })).status, 409);
    assert.equal((await host.call(`${path}/goal`, { ...goal, frequency: 2 })).status, 400);
    await host.call(`${path}/goal`, goal);
    await friend.call(`${path}/goal`, { ...goal, category: 'exercise', title: '주 4회 30분 운동하기', frequency: 4 });
    let snapshot = (await host.call(path)).body.room;
    const oldGoal = snapshot.members.find(m => m.id === hostUser.id).goalVersion;
    assert.equal((await friend.call(`${path}/approve`, { targetId: hostUser.id, goalVersion: oldGoal })).status, 200);
    await host.call(`${path}/goal`, { ...goal, title: '매일 영어 듣기 공부하기' });
    assert.equal((await friend.call(`${path}/approve`, { targetId: hostUser.id, goalVersion: oldGoal })).status, 409);
    snapshot = (await host.call(path)).body.room;
    assert.equal(snapshot.members.find(m => m.id === hostUser.id).approvals.length, 0);
    for (const [reviewer, target] of [[host, friendUser], [friend, hostUser]]) {
      const version = snapshot.members.find(m => m.id === target.id).goalVersion;
      assert.equal((await reviewer.call(`${path}/approve`, { targetId: target.id, goalVersion: version })).status, 200);
    }
    const started = await host.call(`${path}/start`, {});
    assert.equal(started.status, 200);
    assert.equal(started.body.room.start, '2026-10-15');
    assert.equal(started.body.room.end, '2026-10-21');
    assert.equal((await host.call(`${path}/goal`, goal)).status, 409);
    assert.equal((await stranger.call('/api/join', { invite })).status, 409);
    const record = { note: '타이머에서 30분 공부 기록을 확인했어요.', minutes: 30, day: '1999-01-01', userId: friendUser.id };
    const simultaneous = await Promise.all([host.call(`${path}/record`, record), host.call(`${path}/record`, record)]);
    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 400]);
    snapshot = (await friend.call(path)).body.room;
    assert.equal(snapshot.members.find(m => m.id === hostUser.id).records[0].day, '2026-10-15');
    assert.equal(snapshot.members.find(m => m.id === friendUser.id).records.length, 0);
    assert.equal(snapshot.rankings[0].id, hostUser.id);
    assert.equal((await friend.call(`${path}/cheer`, { targetId: hostUser.id, active: true })).status, 200);
    await friend.call(`${path}/cheer`, { targetId: hostUser.id, active: true });
    assert.equal((await host.call(path)).body.room.members.find(m => m.id === hostUser.id).cheers, 1);
    const savedCookie = host.cookie;
    await stop(instance.server);
    instance = await launch({ database, now: () => date });
    const persisted = await fetch(`${instance.url}${path}`, { headers: { Cookie: savedCookie } });
    assert.equal(persisted.status, 200);
    assert.equal((await persisted.json()).room.members.find(m => m.id === hostUser.id).records.length, 1);
    date = new Date('2026-10-23T01:00:00Z');
    const closed = await fetch(`${instance.url}${path}`, { headers: { Cookie: savedCookie } });
    assert.equal((await closed.json()).room.status, 'finished');
    const late = await fetch(`${instance.url}${path}/record`, { method: 'POST', headers: { Cookie: savedCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    assert.equal(late.status, 400);
    const restored = client(instance.url);
    assert.equal((await restored.call('/api/login', { username: 'host-test', password: 'wrong-password-here' })).status, 401);
    assert.equal((await restored.call('/api/login', { username: 'host-test', password: 'only-test-password-123' })).status, 200);
    await restored.call('/api/logout', {});
    assert.equal((await restored.call('/api/me')).body.user, null);
  } finally { await stop(instance.server); await rm(directory, { recursive: true, force: true }); }
});
