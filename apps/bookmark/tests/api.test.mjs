import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createApp } from '../server.mjs';

const book = { title: '나의 첫 책', author: '테스트 저자', total: 240, genre: '에세이', color: 'sage' };
async function launch(options = {}) {
  const server = await createApp({ database: ':memory:', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, async call(path, data, headers = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test('book creation, editing, validation and deletion preserve coherent page counts', async () => {
  const app = await launch();
  try {
    for (const patch of [{ title: ' ' }, { author: '' }, { total: 0 }, { total: 1.5 }, { genre: 'unknown' }, { color: 'invalid' }]) assert.equal((await app.call('/api/books', { ...book, ...patch })).status, 400);
    const created = (await app.call('/api/books', book)).data.books[0];
    assert.equal(created.status, 'planned'); assert.equal(created.pages, 0);
    const base = `/api/books/${created.id}`;
    await app.call(`${base}/progress`, { pages: 100 });
    assert.equal((await app.call(`${base}/edit`, { ...book, total: 99 })).status, 400);
    const edited = await app.call(`${base}/edit`, { ...book, title: '수정한 제목', total: 300, color: 'wine' });
    assert.equal(edited.data.books[0].title, '수정한 제목'); assert.equal(edited.data.books[0].pages, 100);
    assert.equal((await app.call(`${base}/delete`, {})).data.books.length, 0);
    assert.equal((await app.call(`${base}/progress`, { pages: 1 })).status, 404);
  } finally { await app.close(); }
});
test('progress transitions and repeated completion do not inflate annual totals', async () => {
  let clock = Date.parse('2026-10-16T01:00:00Z'); const app = await launch({ now: () => clock });
  try {
    const id = (await app.call('/api/books', book)).data.books[0].id, path = `/api/books/${id}/progress`;
    assert.equal((await app.call(path, { pages: 0, start: true })).data.books[0].status, 'reading');
    for (const pages of [-1, 241, 2.5, '30']) assert.equal((await app.call(path, { pages })).status, 400);
    let state = (await app.call(path, { pages: 240 })).data;
    assert.equal(state.books[0].status, 'done'); assert.equal(state.stats.yearFinished, 1); const finished = state.books[0].finished;
    clock += 60000; state = (await app.call(path, { pages: 240 })).data;
    assert.equal(state.stats.yearFinished, 1); assert.equal(state.books[0].finished, finished);
    state = (await app.call(path, { pages: 150 })).data; assert.equal(state.books[0].status, 'reading'); assert.equal(state.stats.yearFinished, 0); assert.equal(state.books[0].finished, null);
    await app.call(path, { pages: 240 }); clock = Date.parse('2027-01-01T01:00:00Z');
    state = (await app.call('/api/state')).data; assert.equal(state.stats.finished, 1); assert.equal(state.stats.yearFinished, 0); assert.equal(state.year, '2027');
  } finally { await app.close(); }
});
test('notes, ratings and goal are validated and stored; increasing total reopens a finished book', async () => {
  const app = await launch();
  try {
    const id = (await app.call('/api/books', book)).data.books[0].id, path = `/api/books/${id}`;
    assert.equal((await app.call(`${path}/review`, { rating: 6, note: 'x' })).status, 400);
    assert.equal((await app.call(`${path}/review`, { rating: 2, note: 'x'.repeat(4001) })).status, 400);
    const state = (await app.call(`${path}/review`, { rating: 5, note: '오래 기억할 문장' })).data;
    assert.equal(state.books[0].rating, 5); assert.equal(state.stats.notes, 1);
    assert.equal((await app.call('/api/goal', { goal: 0 })).status, 400);
    assert.equal((await app.call('/api/goal', { goal: 18 })).data.goal, 18);
    await app.call(`${path}/progress`, { pages: 240 });
    const edit = (await app.call(`${path}/edit`, { ...book, total: 260 })).data.books[0];
    assert.equal(edit.status, 'reading'); assert.equal(edit.finished, null); assert.equal(edit.note, '오래 기억할 문장');
  } finally { await app.close(); }
});
test('sample bookshelf is explicit, labeled and can only be added to an empty library', async () => {
  const app = await launch();
  try {
    assert.equal((await app.call('/api/state')).data.books.length, 0);
    const sample = await app.call('/api/sample', {}); assert.equal(sample.data.books.length, 4); assert.ok(sample.data.books.every(b => b.sample === 1));
    assert.equal(sample.data.stats.reading, 1); assert.equal(sample.data.stats.finished, 1);
    assert.equal((await app.call('/api/sample', {})).status, 409);
  } finally { await app.close(); }
});
test('records survive a server restart and cross-site/foreign host requests are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bookmark-api-')), database = join(dir, 'books.sqlite'); let app = await launch({ database });
  try {
    assert.equal((await app.call('/api/books', book, { Origin: 'https://example.com' })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => http.get(app.base + '/api/state', { headers: { Host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
    assert.equal(hostStatus, 403);
    const id = (await app.call('/api/books', book)).data.books[0].id;
    await app.call(`/api/books/${id}/progress`, { pages: 86 });
    await app.call(`/api/books/${id}/review`, { rating: 4, note: '다시 읽고 싶은 책' });
    await app.call('/api/goal', { goal: 20 });
    await app.close(); app = await launch({ database });
    const state = (await app.call('/api/state')).data;
    assert.equal(state.goal, 20); assert.equal(state.books[0].pages, 86); assert.equal(state.books[0].note, '다시 읽고 싶은 책');
  } finally {
    await app.close(); const target = await realpath(dir);
    assert.equal(dirname(target).toLowerCase(), (await realpath(tmpdir())).toLowerCase()); assert.ok(basename(target).startsWith('bookmark-api-'));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  }
});
