export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label}: ${min}~${max}자로 입력해 주세요.`);
  return value.trim();
}
export const dayKey = ms => new Date(Number(ms) + 9 * 3600000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const deadline = (day, time = '23:59') => Date.parse(`${day}T${time}:00+09:00`);
export const midnight = day => deadline(day, '00:00');
export function dateInput(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(midnight(value)) || dayKey(midnight(value)) !== value || value < today || value > addDays(today, 30)) fail(400, '시작일은 오늘부터 30일 이내로 선택해 주세요.');
  return value;
}
export function validatePromise(data) {
  const title = text(data.title, 2, 80, '실천할 행동'), proof = text(data.proof, 4, 240, '완료 조건'), reason = text(data.reason || '', 0, 240, '이유');
  if (!Array.isArray(data.days) || data.days.length !== 4 || new Set(data.days).size !== 4 || data.days.some(n => !Number.isInteger(n) || n < 0 || n > 6)) fail(400, '서로 다른 실천일 4일을 선택해 주세요.');
  if (typeof data.cutoff !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.cutoff)) fail(400, '올바른 마감 시각을 선택해 주세요.');
  if (!['note', 'timer'].includes(data.kind)) fail(400, '인증 방법을 선택해 주세요.');
  if (data.kind === 'timer' && (!Number.isInteger(data.minutes) || data.minutes < 1 || data.minutes > 240)) fail(400, '타이머는 1~240분 사이로 설정해 주세요.');
  return { title, proof, reason, days: [...data.days].sort(), cutoff: data.cutoff, kind: data.kind, minutes: data.kind === 'timer' ? data.minutes : 0 };
}
export function phase(season, now, pending = 0) {
  if (!season.started) return 'draft';
  if (now < midnight(season.start)) return 'scheduled';
  if (now < midnight(addDays(season.start, 7))) return 'active';
  if (now < midnight(addDays(season.start, 8)) || pending) return 'review';
  return 'finished';
}
export function daysFor(goal, season, records, now) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(season.start, index), scheduled = !!goal?.days.includes(index), record = records.find(r => r.day === day);
    const status = !scheduled ? 'rest' : record ? record.status === 'rejected' ? 'missed' : record.status === 'pending' ? 'pending' : 'done' : season.started && now > deadline(day, goal.cutoff) ? 'missed' : 'planned';
    return { day, index, scheduled, status };
  });
}
export function rank(members) {
  const list = members.map(m => ({ id: m.id, name: m.name, count: m.count, score: m.count * 25, complete: m.count === 4 })).sort((a, b) => b.count - a.count);
  return list.map((m, i) => ({ ...m, rank: i && m.count === list[i - 1].count ? list.findIndex(x => x.count === m.count) + 1 : i + 1 }));
}
