import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createApp } from '../server.mjs';
import http from 'node:http';

async function launch(options = {}) {
  const server = await createApp({ database: ':memory:', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, async call(path, data, headers = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test('create, edit, complete, reopen and delete tasks; reject invalid input', async () => {
  const app = await launch();
  try {
    assert.equal((await app.call('/api/tasks', { title: ' ', priority: 'normal' })).status, 400);
    assert.equal((await app.call('/api/tasks', { title: 'Task', priority: 'urgent' })).status, 400);
    const created = await app.call('/api/tasks', { title: '  집중할 일  ', priority: 'important' });
    assert.equal(created.status, 200); const task = created.data.tasks[0]; assert.equal(task.title, '집중할 일');
    const path = `/api/tasks/${task.id}`;
    assert.equal((await app.call(path, { title: '수정한 일', priority: 'normal' })).data.tasks[0].title, '수정한 일');
    assert.equal((await app.call(path, { action: 'toggle', done: true })).data.tasks[0].done, true);
    assert.equal((await app.call(path, { action: 'toggle', done: false })).data.tasks[0].done, false);
    assert.equal((await app.call(path, { action: 'toggle', done: 'yes' })).status, 400);
    assert.equal((await app.call(path, { action: 'delete' })).data.tasks.length, 0);
    assert.equal((await app.call(path, { action: 'toggle', done: true })).status, 404);
  } finally { await app.close(); }
});
test('timer pauses without losing progress, resumes, and records exactly one completed session', async () => {
  let clock = Date.parse('2026-10-16T02:00:00Z');
  const app = await launch({ now: () => clock });
  try {
    const task = (await app.call('/api/tasks', { title: '책 읽기', priority: 'normal' })).data.tasks[0];
    assert.equal((await app.call('/api/timer', { action: 'start', minutes: 1 })).status, 400);
    let state = (await app.call('/api/timer', { action: 'start', minutes: 15, taskId: task.id })).data;
    assert.equal(state.timer.status, 'running'); assert.equal(state.timer.remaining, 900000);
    assert.equal((await app.call('/api/timer', { action: 'start', minutes: 15 })).status, 409);
    assert.equal((await app.call(`/api/tasks/${task.id}`, { action: 'delete' })).status, 409);
    clock += 60000;
    state = (await app.call('/api/timer', { action: 'pause' })).data; assert.equal(state.timer.remaining, 840000);
    clock += 300000;
    assert.equal((await app.call('/api/state')).data.timer.remaining, 840000);
    state = (await app.call('/api/timer', { action: 'start' })).data; assert.equal(state.timer.status, 'running');
    clock += 840000;
    state = (await app.call('/api/state')).data; assert.equal(state.sessions.length, 1); assert.equal(state.sessions[0].minutes, 15); assert.equal(state.sessions[0].title, '책 읽기'); assert.equal(state.timer.status, 'idle');
    assert.equal((await app.call('/api/state')).data.sessions.length, 1);
  } finally { await app.close(); }
});
test('reset does not invent a session; invalid and completed task selection is rejected', async () => {
  const app = await launch();
  try {
    await app.call('/api/timer', { action: 'start', minutes: 25 });
    assert.equal((await app.call('/api/timer', { action: 'reset' })).data.sessions.length, 0);
    assert.equal((await app.call('/api/timer', { action: 'pause' })).status, 409);
    assert.equal((await app.call('/api/timer', { action: 'start', minutes: 25, taskId: 'missing' })).status, 400);
    const t = (await app.call('/api/tasks', { title: 'Done', priority: 'normal' })).data.tasks[0];
    await app.call(`/api/tasks/${t.id}`, { action: 'toggle', done: true });
    assert.equal((await app.call('/api/timer', { action: 'start', minutes: 25, taskId: t.id })).status, 400);
  } finally { await app.close(); }
});
test('tasks and an active timer survive server restart; writes reject foreign origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hankan-api-')), database = join(directory, 'db.sqlite');
  let clock = Date.now(), app = await launch({ database, now: () => clock });
  try {
    assert.equal((await app.call('/api/tasks', { title: 'Bad', priority: 'normal' }, { Origin: 'https://example.com' })).status, 403);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      http.get(`${app.base}/api/state`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
    await app.call('/api/tasks', { title: '저장된 일', priority: 'important' });
    await app.call('/api/timer', { action: 'start', minutes: 25 });
    await app.close(); clock += 30000; app = await launch({ database, now: () => clock });
    const state = (await app.call('/api/state')).data;
    assert.equal(state.tasks[0].title, '저장된 일'); assert.equal(state.timer.remaining, 1470000);
  } finally {
    await app.close();
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved).toLowerCase(), (await realpath(tmpdir())).toLowerCase()); assert.ok(basename(resolved).startsWith('hankan-api-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
});
