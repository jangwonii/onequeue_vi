import { addDays, dayKey, validateGoal, submitRecord, rankMembers } from './model.js';

export type Goal = { category: string; title: string; frequency: number; minutes: number; bedtime: string; proof: string; reviewed: boolean; start?: string; end?: string };
export type Member = { id: string; name: string; goal: Goal | null; goalVersion: string | null; approvals: string[]; records: { day: string; note: string; minutes: number; bedtime: string }[]; cheers: string[] };
export type Document = { start: string | null; end: string | null; members: Member[] };
export type RoomRow = { id: string; name: string; owner_id: string; invite: string; document: string; version: number; created: number };
export function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
export function text(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label}: ${min}~${max}자로 입력해 주세요.`);
  return value.trim();
}
export function secret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''); }
export function member(id: string, name: string): Member { return { id, name, goal: null, goalVersion: null, approvals: [], records: [], cheers: [] }; }
export function ready(doc: Document) { return doc.members.length >= 2 && doc.members.every(m => m.goal && m.approvals.length === doc.members.length - 1); }
export function snapshot(row: RoomRow, userId: string, today = dayKey()) {
  const doc = JSON.parse(row.document) as Document;
  if (!doc.members.some(m => m.id === userId)) fail(404, '참여 중인 방을 찾을 수 없습니다.');
  const members = doc.members.map(m => ({ ...m, goal: m.goal && { ...m.goal, start: doc.start, end: doc.end }, cheers: m.cheers.length, cheered: m.cheers.includes(userId), completed: m.records.length, planned: m.goal?.frequency || 0 }));
  return { id: row.id, name: row.name, ownerId: row.owner_id, today, start: doc.start, end: doc.end, status: !doc.start ? 'waiting' : today > addDays(doc.end, 1) ? 'finished' : today > doc.end! ? 'settling' : 'active', ready: ready(doc), members, rankings: rankMembers(members.filter(m => m.goal).map(m => ({ id: m.id, name: m.name, completed: m.completed, planned: m.planned }))), invite: !doc.start && row.owner_id === userId ? row.invite : null };
}
export function changeRoom(row: RoomRow, user: { id: string; name: string }, operation: string, data: Record<string, unknown>, today = dayKey()) {
  const doc = JSON.parse(row.document) as Document;
  let me = doc.members.find(m => m.id === user.id);
  if (operation === 'join') {
    if (data.invite !== row.invite) fail(404, '유효하지 않은 초대 링크입니다.');
    if (me) return row;
    if (doc.start) fail(409, '이미 시작한 챌린지에는 새로 참여할 수 없습니다.');
    if (doc.members.length >= 100) fail(409, '방 정원 100명이 모두 찼습니다.');
    doc.members.push(member(user.id, user.name));
  } else {
    if (!me) fail(404, '참여 중인 방을 찾을 수 없습니다.');
    const target = doc.members.find(m => m.id === data.targetId);
    if (operation === 'goal') {
      if (doc.start) fail(409, '시작된 챌린지의 목표는 변경할 수 없습니다.');
      const goal = { category: data.category, title: data.title, frequency: data.frequency, minutes: data.minutes, bedtime: data.bedtime || '', proof: data.proof, reviewed: data.reviewed === true } as Goal;
      validateGoal(goal); goal.title = goal.title.trim(); goal.proof = goal.proof.trim();
      me.goal = goal; me.goalVersion = crypto.randomUUID(); me.approvals = [];
    } else if (operation === 'approve') {
      if (doc.start) fail(409, '이미 시작한 챌린지입니다.');
      if (!target?.goal || target.id === user.id) fail(400, '목표를 제출한 다른 친구만 확인할 수 있습니다.');
      if (data.goalVersion !== target.goalVersion) fail(409, '친구의 목표가 변경되었습니다. 새 목표를 확인해 주세요.');
      if (!target.approvals.includes(user.id)) target.approvals.push(user.id);
    } else if (operation === 'start') {
      if (row.owner_id !== user.id) fail(403, '방장만 시작할 수 있습니다.');
      if (doc.start) fail(409, '이미 시작한 챌린지입니다.');
      if (!ready(doc)) fail(409, '2명 이상 참여하고 모든 친구의 목표를 서로 확인해야 시작할 수 있습니다.');
      doc.start = today; doc.end = addDays(today, 6);
    } else if (operation === 'record') {
      if (!doc.start || !me.goal) fail(409, '방장이 챌린지를 시작한 뒤 인증할 수 있습니다.');
      me.records = submitRecord({ goal: { ...me.goal, start: doc.start, end: doc.end }, records: me.records }, { note: data.note, minutes: data.minutes, bedtime: data.bedtime }, today).records;
    } else if (operation === 'cheer') {
      if (!target || target.id === user.id) fail(400, '이 방의 다른 친구에게 응원을 보내 주세요.');
      if (data.active === true) { if (!target.cheers.includes(user.id)) target.cheers.push(user.id); }
      else if (data.active === false) target.cheers = target.cheers.filter(id => id !== user.id);
      else fail(400, '응원 상태를 지정해 주세요.');
    } else if (operation === 'rotate-invite') {
      if (row.owner_id !== user.id) fail(403, '방장만 초대 링크를 변경할 수 있습니다.');
      if (doc.start) fail(409, '시작한 챌린지에는 초대할 수 없습니다.');
      row = { ...row, invite: secret() };
    } else fail(404, '찾을 수 없습니다.');
  }
  return { ...row, document: JSON.stringify(doc) };
}
