import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, startChallenge, submitRecord, rankMembers, score, loadState, dayKey, addDays } from '../model.js';
const goal = { category: 'exercise', title: '매주 꾸준히 달리기', frequency: 4, minutes: 30, proof: '운동 앱에서 시간과 거리를 확인하기', reviewed: true };
const note = { minutes: 30, note: '운동 앱에서 30분 달리기 기록을 확인했어요.' };
const start = () => startChallenge(emptyState(), goal, '2026-10-15');
test('start locks goal and creates exactly seven Korean calendar dates', () => {
  const state = start();
  assert.equal(state.goal.end, '2026-10-21');
  assert.throws(() => startChallenge(state, { ...goal, frequency: 3 }), /바꿀 수 없/);
  assert.equal(dayKey(new Date('2026-10-14T15:01:00Z')), '2026-10-15');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('minimum frequency, duration, proof and pre-start review are enforced', () => {
  for (const invalid of [{ frequency: 2 }, { frequency: 8 }, { frequency: 3.5 }, { minutes: 19 }, { minutes: 600 }, { proof: '운동' }, { reviewed: false }]) assert.throws(() => startChallenge(emptyState(), { ...goal, ...invalid }));
});
test('certification is bounded to period, once daily and planned count', () => {
  const initial = start();
  assert.throws(() => submitRecord(initial, note, '2026-10-14'), /기간/);
  assert.throws(() => submitRecord(initial, note, '2026-10-22'), /기간/);
  assert.throws(() => submitRecord(initial, { ...note, minutes: 20 }, '2026-10-15'), /30분/);
  assert.throws(() => submitRecord(initial, { ...note, note: '완료' }, '2026-10-15'), /10~500/);
  let state = submitRecord(initial, note, '2026-10-15');
  assert.equal(initial.records.length, 0);
  assert.throws(() => submitRecord(state, note, '2026-10-15'), /이미/);
  for (const date of ['2026-10-16', '2026-10-17', '2026-10-18']) state = submitRecord(state, note, date);
  assert.throws(() => submitRecord(state, note, '2026-10-19'), /모두 완료/);
  assert.equal(score(state.records.length, state.goal.frequency), 1);
});
test('sleep is reported the next day, including final night on day eight', () => {
  let state = startChallenge(emptyState(), { ...goal, category: 'sleep', frequency: 7, bedtime: '23:30', minutes: 0 }, '2026-10-15');
  const record = { note: '수면 기록에서 전날 취침 시간을 확인했어요.', bedtime: '23:20' };
  assert.throws(() => submitRecord(state, record, '2026-10-15'), /내일/);
  assert.throws(() => submitRecord(state, { ...record, bedtime: '00:30' }, '2026-10-16'), /취침 기록/);
  assert.throws(() => submitRecord(state, { ...record, bedtime: '23:40' }, '2026-10-16'), /취침 기록/);
  for (let i = 1; i <= 7; i++) state = submitRecord(state, record, addDays('2026-10-15', i));
  assert.equal(state.records.length, 7);
  assert.equal(state.records.at(-1).day, '2026-10-21');
  assert.throws(() => submitRecord(state, record, '2026-10-23'), /기간/);
});
test('equal fractions share ranks independent of goal volume', () => {
  const ranks = rankMembers([{ completed: 3, planned: 6 }, { completed: 2, planned: 4 }, { completed: 1, planned: 7 }, { completed: 3, planned: 3 }]);
  assert.deepEqual(ranks.map(r => r.rank), [1, 2, 2, 4]);
  assert.equal(score(0, 0), 0);
  assert.equal(score(8, 7), 1);
});
test('storage round trip preserves locked goal and certification', () => {
  const state = submitRecord(start(), note, '2026-10-15');
  assert.deepEqual(loadState({ getItem: () => JSON.stringify(state) }), state);
  assert.throws(() => loadState({ getItem: () => 'corrupted' }));
  assert.throws(() => loadState({ getItem: () => JSON.stringify({ ...state, goal: { ...state.goal, end: '2026-12-31' } }) }));
});
