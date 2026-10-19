import { triggerInput, triggerOutcome } from './triggers.mjs';
export const RELEASE = 'promise-2.2.0';
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, label + ': ' + min + '~' + max + '자로 입력해 주세요.');
  return value.trim();
}
export const dayKey = ms => new Date(Number(ms) + 32400000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const deadline = (day, time = '23:59') => Date.parse(day + 'T' + time + ':00+09:00');
export const midnight = day => deadline(day, '00:00');
export const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export function dateInput(value, now) {
  const today = dayKey(now);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(midnight(value)) || dayKey(midnight(value)) !== value || value < today || value > addDays(today, 30)) fail(400, '시작일은 오늘부터 30일 이내로 선택해 주세요.');
  return value;
}
export function goalInput(d) {
  const title = text(d.title, 2, 80, '행동'), proof = text(d.proof, 4, 240, '완료 조건'), reason = text(d.reason || '', 0, 240, '이유');
  if (!Array.isArray(d.days) || d.days.length !== 4 || new Set(d.days).size !== 4 || d.days.some(n => !Number.isInteger(n) || n < 0 || n > 6)) fail(400, '서로 다른 실천일 4일을 선택해 주세요.');
  if (typeof d.cutoff !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.cutoff)) fail(400, '마감 시각을 확인해 주세요.');
  if (!['note', 'timer'].includes(d.kind)) fail(400, '인증 방법을 선택해 주세요.');
  if (d.kind === 'timer' && (!Number.isInteger(d.minutes) || d.minutes < 1 || d.minutes > 240)) fail(400, '타이머는 1~240분으로 설정해 주세요.');
  return { title, proof, reason, days: [...d.days].sort(), cutoff: d.cutoff, kind: d.kind, minutes: d.kind === 'timer' ? d.minutes : 0, photoRequired: true };
}
export const current = room => room.seasons.at(-1);
export function phase(s, now) {
  if (!s.started) return 'draft';
  if (now < midnight(s.start)) return 'scheduled';
  if (now < midnight(addDays(s.start, 7))) return 'active';
  if (now < midnight(addDays(s.start, 8)) || s.records.some(r => r.status === 'pending')) return 'review';
  return 'finished';
}
function settle(room, now) {
  for (const s of room.seasons) for (const r of s.records) if (r.status === 'pending' && now >= r.report.at + 48 * 3600000) {
    r.status = 'accepted'; r.review = { at: now, by: 'system', reason: '48시간 내 판정 없음: 원래 인증을 유지합니다.' };
  }
}
export function createRoom(user, data, now) {
  return { id: crypto.randomUUID(), name: text(data.name, 2, 60, '친구방 이름'), ownerId: user.id, archived: false,
    members: [{ id: user.id, name: user.name }], seasons: [{ id: 1, start: dateInput(data.start, now), started: false,
      people: [{ id: user.id, name: user.name, goal: null, ready: false }], records: [], timers: {}, reflections: {} }] };
}
const member = (room, id) => room.members.find(m => m.id === id) || fail(404, '참여 중인 방을 찾을 수 없습니다.');
const owner = (room, id) => { if (room.ownerId !== id) fail(403, '방장만 할 수 있습니다.'); };
const resetReady = s => {s.agreementVersion=(s.agreementVersion || 0)+1;s.people.forEach(p => { p.ready = false; });};
export function changeRoom(input, user, op, data = {}, now = Date.now()) {
  const room = structuredClone(input); settle(room, now);
  const s = current(room);
  if (op === 'join') {
    if (room.members.some(m => m.id === user.id)) return room;
    if (room.archived || s.started || room.members.length >= 10) fail(409, '시작 전인 10명 미만의 방에만 참여할 수 있습니다.');
    room.members.push({ id: user.id, name: user.name }); s.people.push({ id: user.id, name: user.name, goal: null, ready: false }); resetReady(s); return room;
  }
  member(room, user.id);
  const me = s.people.find(m => m.id === user.id), state = phase(s, now);
  if (room.archived && !['archive', 'leave', 'transfer','read-nudges','nudge-settings','trigger-progress'].includes(op)) fail(409, '보관한 방입니다. 방장이 다시 열 수 있습니다.');
  if (op === 'trigger') {
    owner(room,user.id);if(s.started)fail(409,'시작한 시즌의 실패 조건은 바꿀 수 없습니다.');
    s.trigger=triggerInput(data);resetReady(s);
  } else if(op === 'trigger-progress') {
    const season=room.seasons.find(x=>x.id===data.seasonId) || fail(404,'시즌을 찾을 수 없습니다.');
    const item=triggerOutcome(season,phase(season,now),now).items.find(x=>x.id===data.itemId) || fail(409,'확정된 벌칙·정산 항목이 아닙니다.');
    if(data.step==='claim'){
      if(item.from!==user.id)fail(403,'본인의 이행·송금만 신고할 수 있습니다.');
      if(item.progress.status!=='pending')return room;
      season.triggerProgress ||= {};season.triggerProgress[item.id]={status:'claimed',claimedAt:now};
    }else if(data.step==='confirm'){
      if(item.from===user.id || (item.kind==='prize' && item.to!==user.id))fail(403,'벌칙은 다른 친구가, 송금은 수령자만 확인할 수 있습니다.');
      if(item.progress.status==='confirmed')return room;
      if(item.progress.status!=='claimed')fail(409,'당사자가 이행·송금을 신고한 뒤 확인해 주세요.');
      season.triggerProgress[item.id]={...item.progress,status:'confirmed',confirmedAt:now,confirmedBy:user.id};
    }else fail(400,'이행 신고 또는 확인을 선택해 주세요.');
  } else if (op === 'goal') {
    if (s.started) fail(409, '시작한 시즌의 약속은 바꿀 수 없습니다.');
    me.goal = goalInput(data); resetReady(s);
  } else if (op === 'ready') {
    if (s.started || !s.trigger || !s.people.every(m => m.goal)) fail(409, '모두의 미션과 실패 조건을 정한 후 확인해 주세요.');
    if(data.acceptTrigger!==true || data.agreementVersion!==(s.agreementVersion || 0))fail(409,'최신 미션과 실패 조건을 다시 확인하고 동의해 주세요.');
    me.ready = true;
  } else if (op === 'start') {
    owner(room, user.id);
    if (s.started || !s.trigger || room.members.length < 2 || !s.people.every(m => m.ready && m.goal)) fail(409, '2명 이상, 실패 조건과 전원의 동의가 필요합니다.');
    if (s.start < dayKey(now)) fail(409, '시작일이 지났습니다. 날짜를 다시 정해 주세요.');
    s.started = true; s.startedAt = now;
  } else if (op === 'date') {
    owner(room, user.id); if (s.started) fail(409, '시작 전만 변경할 수 있습니다.');
    s.start = dateInput(data.start, now); resetReady(s);
  } else if (op === 'extra') {
    if (state !== 'active') fail(409, '진행 중인 시즌에서 추가 실천을 남길 수 있습니다.');
    const day = dayKey(now);
    if (s.records.filter(r => r.userId === user.id && r.day === day && r.extra).length >= 3) fail(409, '추가 실천은 하루 3개까지 남길 수 있습니다.');
    s.records.push({ id: crypto.randomUUID(), userId: user.id, day, at: now, note: text(data.note, 4, 600, '추가 실천'), extra: true, status: 'accepted', reactions: {}, minutes: 0, ...(data.photoId ? {photoId:data.photoId} : {}) });
  } else if (op === 'timer' || op === 'record') {
    const day = dayKey(now), index = Math.round((midnight(day) - midnight(s.start)) / 86400000);
    if (state !== 'active' || !me.goal.days.includes(index)) fail(409, '오늘은 약속을 실천하는 날이 아닙니다.');
    if (now > deadline(day, me.goal.cutoff)) fail(409, '오늘의 마감 시간이 지났습니다.');
    if (s.records.some(r => r.userId === user.id && r.day === day && !r.extra)) fail(409, '오늘의 인증을 이미 제출했습니다.');
    const key = user.id + ':' + day;
    if (op === 'timer') {
      if (me.goal.kind !== 'timer') fail(400, '타이머 약속이 아닙니다.');
      s.timers[key] ??= now;
    } else {
      if (me.goal.kind === 'timer' && (!s.timers[key] || now - s.timers[key] < me.goal.minutes * 60000)) fail(409, '정한 타이머 시간이 아직 지나지 않았습니다.');
      if (!data.photoId) fail(400, '미션 인증에는 실천 사진 1장이 필요합니다.');
      s.records.push({ id: crypto.randomUUID(), userId: user.id, day, at: now, note: text(data.note, 4, 600, '실천한 내용'), status: 'accepted', reactions: {}, minutes: me.goal.minutes, ...(data.photoId ? {photoId:data.photoId} : {}) });
    }
  } else if (op === 'react' || op === 'report' || op === 'review') {
    const r = s.records.find(r => r.id === data.recordId) || fail(404, '인증을 찾을 수 없습니다.');
    if (op === 'react') {
      if (!['봤어요', '잘했어요', '같이 하자'].includes(data.reaction)) fail(400, '반응을 선택해 주세요.');
      if (r.reactions[user.id] === data.reaction) delete r.reactions[user.id]; else r.reactions[user.id] = data.reaction;
    } else if (op === 'report') {
      if (r.extra || r.userId === user.id || now > r.at + 86400000 || r.report) fail(409, '다른 사람의 공식 인증에 24시간 이내 한 번 이의를 제기할 수 있습니다.');
      r.report = { by: user.id, at: now, reason: text(data.reason, 4, 400, '이유') }; r.status = 'pending';
    } else {
      if (r.status !== 'pending') fail(409, '판정 대기 중인 인증이 아닙니다.');
      if (r.userId === user.id || r.report.by === user.id || (r.userId !== room.ownerId && r.report.by !== room.ownerId && room.ownerId !== user.id)) fail(403, '작성자와 신고자는 판정할 수 없습니다. 이해관계가 없는 방장 또는 다른 참여자가 확인합니다.');
      if (!['accepted', 'rejected'].includes(data.decision)) fail(400, '판정을 선택해 주세요.');
      r.status = data.decision; r.review = { by: user.id, at: now, reason: text(data.reason, 4, 400, '판정 근거') };
    }
  } else if (op === 'nudge-settings') {
    member(room,user.id).nudgesEnabled = data.enabled !== false;
  } else if (op === 'read-nudges') {
    for (const n of s.nudges || []) if (n.to === user.id && !n.readAt) n.readAt = now;
  } else if (op === 'nudge') {
    const recipient = member(room,data.memberId), p = s.people.find(p=>p.id===recipient.id), day=dayKey(now);
    if (recipient.id===user.id || recipient.nudgesEnabled===false) fail(409, '이 친구에게 알림을 보낼 수 없습니다.');
    const index=Math.round((midnight(day)-midnight(s.start))/86400000);
    if (state!=='active' || !p?.goal?.days.includes(index) || now>deadline(day,p.goal.cutoff) || s.records.some(r=>!r.extra && r.userId===recipient.id && r.day===day)) fail(409, '오늘 예정된 약속이 남아 있는 친구에게 보낼 수 있습니다.');
    s.nudges ||= [];
    if (s.nudges.filter(n=>n.to===recipient.id && dayKey(n.at)===day).length>=2) fail(429, '이 친구는 오늘 이 방의 알림을 이미 2번 받았어요.');
    s.nudges.push({id:crypto.randomUUID(),from:user.id,to:recipient.id,at:now,readAt:null});
  } else if (op === 'reflection') {
    if (!['review', 'finished'].includes(state)) fail(409, '일주일이 끝난 뒤 회고를 남길 수 있습니다.');
    s.reflections[user.id] = text(data.note, 4, 600, '회고');
  } else if (op === 'next') {
    owner(room, user.id); if (state !== 'finished') fail(409, '결과가 확정된 뒤 다음 시즌을 시작해 주세요.');
    if (room.seasons.length >= 104) fail(409, '이 방의 시즌을 내보낸 뒤 새 방을 만들어 주세요. 최대 104시즌을 보관합니다.');
    room.seasons.push({ id: s.id + 1, start: dateInput(data.start, now), started: false,
      people: room.members.map(m => ({ ...m, goal: s.people.find(p => p.id === m.id)?.goal || null, ready: false })), trigger:s.trigger ? structuredClone(s.trigger) : null, records: [], timers: {}, reflections: {} });
  } else if (op === 'transfer') {
    owner(room, user.id); member(room, data.memberId); if (data.memberId === user.id) fail(400, '다른 친구를 선택해 주세요.'); room.ownerId = data.memberId;
  } else if (op === 'leave') {
    if (!['draft', 'finished'].includes(state)) fail(409, '진행 중에는 나갈 수 없습니다. 개인정보 삭제는 계정 설정에서 언제든 할 수 있습니다.');
    if (room.ownerId === user.id) fail(409, '방장을 넘기거나 방을 삭제한 뒤 나가 주세요.');
    if(room.seasons.some(x=>triggerOutcome(x,phase(x,now),now).items.some(i=>(i.from===user.id || i.to===user.id) && i.progress.status!=='confirmed')))fail(409,'남은 벌칙·상금 정산을 확인한 뒤 나가 주세요.');
    room.members = room.members.filter(m => m.id !== user.id);
    if (!s.started) { s.people = s.people.filter(m => m.id !== user.id); resetReady(s); }
  } else if (op === 'archive') {
    owner(room, user.id);
    if (!['draft', 'finished'].includes(state)) fail(409, '진행 중인 방은 보관할 수 없습니다.');
    room.archived = !!data.archived;
  } else if (op !== 'rotate') fail(404, '지원하지 않는 동작입니다.');
  if (op === 'rotate') owner(room, user.id);
  return room;
}
export function eraseUser(input, id) {
  if (!JSON.stringify(input).includes(JSON.stringify(id))) return input;
  const room = structuredClone(input);
  room.members = room.members.filter(m => m.id !== id);
  if (room.ownerId === id) room.ownerId = room.members[0]?.id || '';
  for (const s of room.seasons) {
    if(s.started && s.trigger && s.people.some(p=>p.id===id))s.triggerSuspended=true;
    if(s.triggerProgress)for(const [key,value] of Object.entries(s.triggerProgress)){
      if(key.includes(':'+id+':') || key.endsWith(':'+id))delete s.triggerProgress[key];
      else if(value.confirmedBy===id)value.confirmedBy='deleted';
    }
    s.people = s.people.filter(p => p.id !== id); s.records = s.records.filter(r => r.userId !== id);
    for (const r of s.records) {
      delete r.reactions[id];
      if (r.report?.by === id) { delete r.report; r.status = 'accepted'; }
      if (r.review?.by === id) r.review = { at: r.review.at, by: 'deleted', reason: '판정자 계정 삭제' };
    }
    delete s.reflections[id];
    s.nudges=(s.nudges || []).filter(n=>n.from!==id && n.to!==id);
    for (const key of Object.keys(s.timers)) if (key.startsWith(id + ':')) delete s.timers[key];
    if (!s.started) resetReady(s);
  }
  return room;
}
export function snapshot(input, userId, now = Date.now()) {
  const room = structuredClone(input); member(room, userId); settle(room, now);
  for (const s of room.seasons) {
    s.phase = phase(s, now);
    s.triggerOutcome=triggerOutcome(s,s.phase,now);
    for (const p of s.people) {
      p.count = s.records.filter(r => r.userId === p.id && !r.extra && r.status !== 'rejected').length;
      p.days = Array.from({ length: 7 }, (_, index) => {
        const day = addDays(s.start, index), scheduled = !!p.goal?.days.includes(index), r = s.records.find(r => r.userId === p.id && r.day === day && !r.extra);
        return { day, index, status: !scheduled ? 'rest' : r ? ({ accepted: 'done', rejected: 'missed', pending: 'pending' })[r.status] : s.started && now > deadline(day, p.goal.cutoff) ? 'missed' : 'planned' };
      });
      const scheduled=p.days.filter(d=>d.status!=='rest'), due=scheduled.filter(d=>d.day<=dayKey(now));
      p.dueCount=due.length; p.dueDone=due.filter(d=>['done','pending'].includes(d.status)).length;
      p.nextPromise=scheduled.find(d=>d.day>=dayKey(now) && d.status==='planned')?.day || null;
      p.recovered=scheduled.some((d,i)=>d.status==='done' && scheduled[i-1]?.status==='missed');
      p.canNudge=p.id!==userId && room.members.find(m=>m.id===p.id)?.nudgesEnabled!==false && s.phase==='active' && p.days.some(d=>d.day===dayKey(now) && d.status==='planned') && (s.nudges || []).filter(n=>n.to===p.id && dayKey(n.at)===dayKey(now)).length<2;
    }
    s.ranking = s.phase === 'finished' ? s.people.map(p => ({ id: p.id, name: p.name, count: p.count, score: p.count * 25, complete: p.count === 4 }))
      .sort((a, b) => b.count - a.count).map((p, _, all) => ({ ...p, rank: all.findIndex(x => x.count === p.count) + 1 })) : [];
    s.timers = Object.fromEntries(Object.entries(s.timers).filter(([k]) => k.startsWith(userId + ':')));
    s.nudges=(s.nudges || []).filter(n=>n.to===userId);
  }
  return { ...room, now, today: dayKey(now) };
}
