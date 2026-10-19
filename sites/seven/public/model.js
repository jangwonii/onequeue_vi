export const STORAGE_KEY = 'seven-routine-v1';
export const categories = {
  study: { label: '공부', icon: '▤', minimum: 20, frequency: 3, unit: '분', example: '매일 영어 단어 공부하기', proof: '공부 시간과 내용이 보이는 타이머 기록' },
  exercise: { label: '운동', icon: '↗', minimum: 20, frequency: 3, unit: '분', example: '20분 이상 가볍게 달리기', proof: '운동 시간과 활동이 보이는 운동 앱 기록' },
  sleep: { label: '수면', icon: '☾', minimum: 0, frequency: 5, unit: '', example: '자정 전에 잠자리에 들기', proof: '다음 날 확인한 전날 취침 시간 기록' },
};
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function addDays(key, days) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function dayIndex(start, today = dayKey()) {
  return Math.round((Date.parse(today) - Date.parse(start)) / 86400000);
}
export function emptyState() { return { version: 1, goal: null, records: [], cheers: [] }; }
export function validateGoal(input) {
  const category = categories[input.category];
  if (!category) throw new Error('목표 종류를 선택해 주세요.');
  if (typeof input.title !== 'string' || input.title.trim().length < 5 || input.title.length > 60) throw new Error('목표를 5~60자로 구체적으로 적어 주세요.');
  if (!Number.isInteger(input.frequency) || input.frequency < category.frequency || input.frequency > 7) throw new Error(`7일 동안 ${category.frequency}~7회로 설정해 주세요.`);
  if (input.category !== 'sleep' && (!Number.isInteger(input.minutes) || input.minutes < category.minimum || input.minutes > 480)) throw new Error(`1회 ${category.minimum}~480분으로 설정해 주세요.`);
  if (input.category === 'sleep' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.bedtime) || input.bedtime < '18:00')) throw new Error('취침 시각은 18:00~23:59 사이로 설정해 주세요.');
  if (typeof input.proof !== 'string' || input.proof.trim().length < 10 || input.proof.length > 200) throw new Error('인증 기준을 10~200자로 구체적으로 적어 주세요.');
  if (!input.reviewed) throw new Error('시작 전 목표와 인증 기준 확인이 필요합니다.');
}
export function startChallenge(state, input, today = dayKey()) {
  if (state.goal) throw new Error('이미 시작된 챌린지의 목표는 바꿀 수 없습니다.');
  validateGoal(input);
  return { ...state, goal: { ...input, title: input.title.trim(), proof: input.proof.trim(), start: today, end: addDays(today, 6) }, records: [] };
}
export function certify(state, input, today = dayKey()) {
  const goal = state.goal;
  if (!goal) throw new Error('먼저 나의 약속을 정하고 챌린지를 시작해 주세요.');
  if (today < goal.start || today > goal.end) throw new Error('챌린지 기간에만 인증할 수 있습니다.');
  // Sleep is reported the following day; the final night remains reportable on day eight.
  const recordDay = goal.category === 'sleep' ? addDays(today, -1) : today;
  if (recordDay < goal.start) throw new Error('수면 목표는 내일 전날의 취침 기록으로 인증해 주세요.');
  return addRecord(state, input, recordDay);
}
function addRecord(state, input, recordDay) {
  const goal = state.goal;
  if (state.records.some(record => record.day === recordDay)) throw new Error('해당 날짜는 이미 인증했습니다.');
  if (state.records.length >= goal.frequency) throw new Error('예정한 인증을 모두 완료했습니다.');
  if (typeof input.note !== 'string' || input.note.trim().length < 10 || input.note.length > 500) throw new Error('인증 기준에 맞춰 기록을 10~500자로 적어 주세요.');
  if (goal.category !== 'sleep' && (!Number.isInteger(input.minutes) || input.minutes < goal.minutes || input.minutes > 480)) throw new Error(`약속한 ${goal.minutes}분 이상 실천해야 합니다.`);
  if (goal.category === 'sleep' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.bedtime) || input.bedtime < '18:00' || input.bedtime > goal.bedtime)) throw new Error(`18:00부터 약속한 ${goal.bedtime}까지의 취침 기록만 인정됩니다.`);
  return { ...state, records: [...state.records, { day: recordDay, note: input.note.trim(), minutes: input.minutes || 0, bedtime: input.bedtime || '' }] };
}
export function submitRecord(state, input, today = dayKey()) {
  if (state.goal?.category === 'sleep' && today === addDays(state.goal.end, 1)) return addRecord(state, input, state.goal.end);
  return certify(state, input, today);
}
export function score(completed, planned) { return planned > 0 ? Math.min(completed, planned) / planned : 0; }
export function rankMembers(members) {
  const sorted = [...members].sort((a, b) => score(b.completed, b.planned) - score(a.completed, a.planned));
  return sorted.map((member, i) => ({ ...member, rank: i && member.completed * sorted[i - 1].planned === sorted[i - 1].completed * member.planned ? null : i + 1 }))
    .reduce((result, member) => [...result, { ...member, rank: member.rank ?? result.at(-1).rank }], []);
}
export function loadState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  const state = JSON.parse(raw);
  if (state.version !== 1 || !Array.isArray(state.records) || !Array.isArray(state.cheers)) throw new Error('저장된 데이터 형식을 읽을 수 없습니다.');
  if (state.goal) {
    validateGoal(state.goal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.goal.start) || state.goal.end !== addDays(state.goal.start, 6)) throw new Error('저장된 기간이 올바르지 않습니다.');
  }
  if (state.records.some(r => typeof r.day !== 'string' || typeof r.note !== 'string') || state.cheers.some(v => typeof v !== 'string')) throw new Error('저장된 인증 형식이 올바르지 않습니다.');
  return state;
}
