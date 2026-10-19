import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRoom, changeRoom, snapshot, eraseUser, current, deadline, addDays, goalInput } from '../lib/domain.mjs';
import { decodePhoto } from '../lib/photos.mjs';
const a = { id: 'owner-a', name: '하나' }, b = { id: 'member-b', name: '두리' }, c = { id: 'outsider-c', name: '세나' };
const start = '2026-10-16', now = deadline(start, '10:00');
const goal = { title: '책 20쪽 읽기', proof: '읽은 내용 한 줄', reason: '꾸준히 읽기', days: [0,1,3,5], cutoff: '23:00', kind: 'note', minutes: 0 };
function ready(timer = false) {
  let r = createRoom(a, { name: '테스트 친구방', start }, now);
  r = changeRoom(r, b, 'join', {}, now);
  r = changeRoom(r, a, 'goal', timer ? { ...goal, kind: 'timer', minutes: 1 } : goal, now);
  r = changeRoom(r, b, 'goal', goal, now);
  r=changeRoom(r,a,'trigger',{mode:'penalty',when:'each-miss',task:'다음 모임 준비하기'},now);
  r = changeRoom(r, a, 'ready', {acceptTrigger:true,agreementVersion:current(r).agreementVersion}, now); r = changeRoom(r, b, 'ready', {acceptTrigger:true,agreementVersion:current(r).agreementVersion}, now);
  return r;
}
test('R02 R03: member and goal changes invalidate consent; strangers cannot read, act, or start', () => {
  const r = ready();
  assert.throws(() => snapshot(r,c.id,now), { status: 404 });
  assert.throws(() => changeRoom(r,c,'start',{},now), { status: 404 });
  assert.throws(() => changeRoom(r,b,'start',{},now), { status: 403 });
  const edited = changeRoom(r,a,'goal',{...goal,title:'새로운 실천'},now);
  assert.ok(current(edited).people.every(p=>!p.ready));
  assert.throws(() => changeRoom(edited,a,'start',{},now), {status:409});
  assert.ok(current(changeRoom(r,c,'join',{},now)).people.every(p=>!p.ready));
});
test('R03: exactly four valid days, valid date and timer bounds', () => {
  for(const days of [[0,1,2],[0,1,2,2],[0,1,2,7]])assert.throws(()=>goalInput({...goal,days}),{status:400});
  assert.throws(()=>goalInput({...goal,cutoff:'25:00'}),{status:400});
  assert.throws(()=>goalInput({...goal,kind:'timer',minutes:0}),{status:400});
  assert.throws(()=>createRoom(a,{name:'테스트',start:'2026-02-30'},now),{status:400});
});
test('R04: locked goals, server timer, duplicate and late record prevention', () => {
  let r = changeRoom(ready(true),a,'start',{},now);
  assert.throws(()=>changeRoom(r,a,'goal',goal,now),{status:409});
  assert.throws(()=>changeRoom(r,c,'join',{},now),{status:409});
  assert.throws(()=>changeRoom(r,a,'record',{photoId:'fixture-photo',note:'읽은 내용 기록'},now),{status:409});
  r=changeRoom(r,a,'timer',{},now);
  assert.throws(()=>changeRoom(r,a,'record',{photoId:'fixture-photo',note:'읽은 내용 기록'},now+59000),{status:409});
  r=changeRoom(r,a,'record',{photoId:'fixture-photo',note:'읽은 내용 기록'},now+60000);
  assert.throws(()=>changeRoom(r,a,'record',{photoId:'fixture-photo',note:'중복된 내용 기록'},now+62000),{status:409});
  assert.throws(()=>changeRoom(r,b,'record',{photoId:'fixture-photo',note:'늦게 온 인증'},deadline(start,'23:01')),{status:409});
  assert.throws(()=>changeRoom(r,b,'record',{photoId:'fixture-photo',note:'쉬는 날 인증'},deadline(addDays(start,2),'12:00')),{status:409});
  assert.equal(snapshot(r,b.id,now).seasons[0].timers[a.id+':'+start],undefined);
});
test('R06: report alone does not deduct points; self-review forbidden; timeout cannot freeze results', () => {
  let r=changeRoom(ready(),a,'start',{},now);
  r=changeRoom(r,a,'record',{photoId:'fixture-photo',note:'실제로 읽은 내용'},now);
  const id=current(r).records[0].id;
  r=changeRoom(r,b,'report',{recordId:id,reason:'완료 조건 확인 요청'},now+1000);
  assert.equal(snapshot(r,a.id,now+2000).seasons[0].people[0].count,1);
  assert.throws(()=>changeRoom(r,a,'review',{recordId:id,decision:'accepted',reason:'내 인증 확인 완료'},now+2000),{status:403});
  const later=snapshot(r,a.id,deadline(addDays(start,8),'10:00'));
  assert.equal(later.seasons[0].phase,'finished');
  assert.equal(later.seasons[0].records[0].review.by,'system');
  assert.equal(later.seasons[0].people[0].count,1);
});
test('R05 R06: reactions toggle, rejected record and 24-hour report window', () => {
  let r=changeRoom(ready(),c,'join',{},now);r=changeRoom(r,c,'goal',goal,now);for(const u of [a,b,c])r=changeRoom(r,u,'ready',{acceptTrigger:true,agreementVersion:current(r).agreementVersion},now);r=changeRoom(r,a,'start',{},now);
  r=changeRoom(r,b,'record',{photoId:'fixture-photo',note:'오늘 실천한 내용'},now);const id=current(r).records[0].id;
  r=changeRoom(r,a,'react',{recordId:id,reaction:'봤어요'},now);
  r=changeRoom(r,a,'react',{recordId:id,reaction:'봤어요'},now);
  assert.deepEqual(current(r).records[0].reactions,{});
  assert.throws(()=>changeRoom(r,a,'report',{recordId:id,reason:'확인 요청 내용'},now+86400001),{status:409});
  r=changeRoom(r,a,'report',{recordId:id,reason:'확인 요청 내용'},now);
  assert.throws(()=>changeRoom(r,a,'review',{recordId:id,decision:'rejected',reason:'내 신고를 직접 판정'},now),{status:403});
  r=changeRoom(r,c,'review',{recordId:id,decision:'rejected',reason:'합의한 조건 미충족'},now);
  assert.equal(snapshot(r,b.id,now).seasons[0].people[1].count,0);
});

test('R12: photo conditions lock with the goal; invalid files and oversized photos fail',()=>{
  let r=ready();r=changeRoom(r,a,'goal',{...goal,photoRequired:true},now);assert.ok(current(r).people.every(p=>!p.ready));
  for(const u of [a,b])r=changeRoom(r,u,'ready',{acceptTrigger:true,agreementVersion:current(r).agreementVersion},now);r=changeRoom(r,a,'start',{},now);
  assert.throws(()=>changeRoom(r,a,'record',{note:'사진 없는 필수 인증'},now),{status:400});
  r=changeRoom(r,a,'record',{photoId:'fixture-photo',note:'사진을 첨부한 인증',photoId:'photo-test'},now);assert.equal(current(r).records[0].photoId,'photo-test');
  assert.throws(()=>changeRoom(r,a,'goal',{...goal,photoRequired:false},now),{status:409});
  assert.throws(()=>decodePhoto({type:'image/svg+xml',data:btoa('<svg></svg>')}),{status:400});
  assert.throws(()=>decodePhoto({type:'image/png',data:btoa('not a photo')}),{status:400});
  assert.throws(()=>decodePhoto({type:'image/png',data:'A'.repeat(699996)}),{status:413});
});

test('R13 R15: extra moments never repair missed days or change score; the next success shows recovery',()=>{
  let r=changeRoom(ready(),a,'start',{},now);
  const late=deadline(start,'23:01');r=changeRoom(r,a,'extra',{note:'마감 뒤에도 조금 실천'},late);
  assert.equal(snapshot(r,a.id,late).seasons[0].people[0].days[0].status,'missed');
  for(const i of [1,3,5])r=changeRoom(r,a,'record',{photoId:'fixture-photo',note:'다음 약속을 지킨 기록'},deadline(addDays(start,i),'12:00'));
  r=changeRoom(r,a,'extra',{note:'쉬는 날 추가로 실천'},deadline(addDays(start,6),'12:00'));
  const result=snapshot(r,a.id,deadline(addDays(start,8),'12:00')).seasons[0];
  assert.equal(result.people[0].count,3);assert.equal(result.people[0].recovered,true);
  assert.equal(result.ranking[0].score,75);assert.equal(result.ranking[0].complete,false);
  assert.equal(result.records.filter(x=>x.extra).length,2);
});

test('R14: nudges are limited across senders per recipient, can be disabled, and are private',()=>{
  let r=changeRoom(ready(),c,'join',{},now);r=changeRoom(r,c,'goal',goal,now);for(const u of [a,b,c])r=changeRoom(r,u,'ready',{acceptTrigger:true,agreementVersion:current(r).agreementVersion},now);r=changeRoom(r,a,'start',{},now);
  assert.throws(()=>changeRoom(r,a,'nudge',{memberId:a.id},now),{status:409});
  r=changeRoom(r,a,'nudge',{memberId:b.id},now);r=changeRoom(r,c,'nudge',{memberId:b.id},now+1000);
  assert.throws(()=>changeRoom(r,c,'nudge',{memberId:b.id},now+2000),{status:429});
  assert.equal(snapshot(r,a.id,now).seasons[0].nudges.length,0);assert.equal(snapshot(r,b.id,now).seasons[0].nudges.length,2);
  r=changeRoom(r,b,'read-nudges',{},now+3000);assert.ok(current(r).nudges.every(n=>n.readAt));
  r=changeRoom(r,c,'nudge-settings',{enabled:false},now);assert.throws(()=>changeRoom(r,a,'nudge',{memberId:c.id},now),{status:409});
  r=changeRoom(r,a,'record',{photoId:'fixture-photo',note:'오늘의 약속 완료'},now);assert.throws(()=>changeRoom(r,b,'nudge',{memberId:a.id},now),{status:409});
  assert.ok(!JSON.stringify(eraseUser(r,b.id)).includes(b.id));
});
test('R07: full season, tied rank separate from completion, reflection and next season', () => {
  let r=changeRoom(ready(),a,'start',{},now);
  for(const i of [0,1,3])for(const u of [a,b])r=changeRoom(r,u,'record',{photoId:'fixture-photo',note:'약속을 지킨 기록'},deadline(addDays(start,i),'12:00'));
  const end=deadline(addDays(start,8),'10:00');
  const result=snapshot(r,a.id,end).seasons[0];
  assert.deepEqual(result.ranking.map(p=>[p.rank,p.score,p.complete]),[[1,75,false],[1,75,false]]);
  r=changeRoom(r,a,'reflection',{note:'다음 주에는 늦지 않기'},end);
  r=changeRoom(r,a,'next',{start:addDays(start,8)},end);
  assert.equal(r.seasons.length,2);assert.equal(current(r).records.length,0);
  assert.ok(current(r).people.every(p=>!p.ready));assert.equal(r.seasons[0].records.length,6);
});
test('R02 R08: transfer, leave, archive boundaries and erasure across histories', () => {
  let r=ready();r=changeRoom(r,a,'transfer',{memberId:b.id},now);r=changeRoom(r,a,'leave',{},now);
  assert.equal(r.ownerId,b.id);assert.throws(()=>snapshot(r,a.id,now),{status:404});
  r=changeRoom(r,b,'archive',{archived:true},now);assert.throws(()=>changeRoom(r,c,'join',{},now),{status:409});
  let active=changeRoom(ready(),a,'start',{},now);active=changeRoom(active,a,'record',{photoId:'fixture-photo',note:'지울 개인정보'},now);
  const erased=eraseUser(active,a.id);
  assert.equal(erased.ownerId,b.id);assert.equal(current(erased).records.length,0);
  assert.ok(!JSON.stringify(erased).includes(a.id));
  const unaffected=ready();assert.deepEqual(eraseUser(unaffected,c.id),unaffected);
});
test('R10: migration, independent snapshot backup and restore preserve records and version', () => {
  const db=new DatabaseSync(':memory:'), restored=new DatabaseSync(':memory:');
  try{
    const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();
    for(const file of migrations){const sql=readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8');db.exec(sql);restored.exec(sql);}
    db.prepare('INSERT INTO profiles(id,name,created) VALUES(?,?,?)').run(a.id,a.name,now);
    db.prepare('INSERT INTO rooms(id,invite,document,version,created) VALUES(?,?,?,?,?)').run('room-id','secret-invite',JSON.stringify(ready()),7,now);
    const backup={format:'promise-db-v1',profiles:db.prepare('SELECT * FROM profiles').all(),rooms:db.prepare('SELECT * FROM rooms').all()};
    for(const p of backup.profiles)restored.prepare('INSERT INTO profiles(id,name,state,created) VALUES(?,?,?,?)').run(p.id,p.name,p.state,p.created);
    for(const r of backup.rooms)restored.prepare('INSERT INTO rooms(id,invite,document,version,created) VALUES(?,?,?,?,?)').run(r.id,r.invite,r.document,r.version,r.created);
    assert.deepEqual(restored.prepare('SELECT * FROM rooms').all(),db.prepare('SELECT * FROM rooms').all());
    const room=JSON.parse(restored.prepare('SELECT document FROM rooms').get().document);
    assert.equal(snapshot(room,b.id,now).members.length,2);
    assert.equal(current(changeRoom(room,a,'start',{},now)).started,true);
  }finally{db.close();restored.close();}
});

const agreeAll=r=>{for(const p of current(r).people)r=changeRoom(r,p,'ready',{acceptTrigger:true,agreementVersion:current(r).agreementVersion},now);return r;};
const outcome=(r,time=now)=>snapshot(r,a.id,time).seasons[0].triggerOutcome;
test('R16: explicit current consent, owner-only terms, valid amounts and start lock',()=>{
  let r=ready();
  assert.throws(()=>changeRoom(r,b,'trigger',{mode:'prize',amount:10000},now),{status:403});
  for(const amount of [0,-1,999,1000001,1000.5,'10000'])assert.throws(()=>changeRoom(r,a,'trigger',{mode:'prize',amount},now),{status:400});
  const oldVersion=current(r).agreementVersion;
  r=changeRoom(r,a,'trigger',{mode:'prize',amount:10000},now);
  assert.ok(current(r).people.every(p=>!p.ready));
  assert.throws(()=>changeRoom(r,a,'ready',{},now),{status:409});
  assert.throws(()=>changeRoom(r,a,'ready',{acceptTrigger:true,agreementVersion:oldVersion},now),{status:409});
  assert.throws(()=>changeRoom(r,a,'start',{},now),{status:409});
  r=changeRoom(agreeAll(r),a,'start',{},now);
  assert.throws(()=>changeRoom(r,a,'trigger',{mode:'penalty',when:'season',task:'다음 모임 준비'},now),{status:409});
  const legacy=ready();delete current(legacy).trigger;
  assert.throws(()=>changeRoom(legacy,a,'start',{},now),{status:409});
});
test('R12: disabling the photo flag cannot bypass new submissions; old records survive',()=>{
  let r=changeRoom(ready(),a,'start',{},now);current(r).people[0].goal.photoRequired=false;
  assert.throws(()=>changeRoom(r,a,'record',{note:'텍스트만 보내는 우회'},now),{status:400});
  current(r).records.push({id:'legacy',userId:b.id,day:start,at:now,status:'accepted',note:'기존 사진 없는 기록',reactions:{}});
  assert.equal(snapshot(r,a.id,now).seasons[0].people[1].count,1);
});
test('R17: per-miss triggers at server cutoff once, pending reports wait, two-party progress is idempotent',()=>{
  let r=changeRoom(ready(),a,'start',{},now),cutoff=deadline(start,'23:00');
  r=changeRoom(r,b,'record',{photoId:'fixture',note:'검토할 사진 인증'},now);
  r=changeRoom(r,a,'report',{recordId:current(r).records[0].id,reason:'완료 조건 확인 요청'},now+1);
  assert.equal(outcome(r,cutoff).items.length,0);
  const first=outcome(r,cutoff+1).items;assert.equal(first.length,1);assert.equal(first[0].from,a.id);
  assert.deepEqual(outcome(r,cutoff+100).items,first);
  const payload={seasonId:1,itemId:first[0].id};
  assert.throws(()=>changeRoom(r,b,'trigger-progress',{...payload,step:'claim'},cutoff+1),{status:403});
  assert.throws(()=>changeRoom(r,b,'trigger-progress',{...payload,step:'confirm'},cutoff+1),{status:409});
  r=changeRoom(r,a,'trigger-progress',{...payload,step:'claim'},cutoff+1);
  assert.throws(()=>changeRoom(r,a,'trigger-progress',{...payload,step:'confirm'},cutoff+2),{status:403});
  r=changeRoom(r,b,'trigger-progress',{...payload,step:'confirm'},cutoff+2);
  assert.equal(outcome(r,cutoff+2).items[0].progress.status,'confirmed');
  const again=changeRoom(r,b,'trigger-progress',{...payload,step:'confirm'},cutoff+3);assert.deepEqual(again,r);
});
test('R17: season penalty waits for review and never counts extra activity as completion',()=>{
  let r=ready();r=changeRoom(r,a,'trigger',{mode:'penalty',when:'season',task:'다음 모임 준비하기'},now);r=changeRoom(agreeAll(r),a,'start',{},now);
  for(const i of [0,1,3])r=changeRoom(r,a,'record',{photoId:'fixture',note:'완료한 공식 인증'},deadline(addDays(start,i),'12:00'));
  r=changeRoom(r,a,'extra',{note:'네 번째인 추가 기록'},deadline(addDays(start,5),'12:00'));
  assert.equal(outcome(r,deadline(addDays(start,7),'12:00')).state,'waiting');
  assert.equal(outcome(r,deadline(addDays(start,8),'12:00')).items.length,2);
});
test('R17: prize exact split, receiver-only acknowledgement and earlier-season settlement',()=>{
  const d={id:'member-d',name:'네리'};let r=ready();
  for(const u of [c,d]){r=changeRoom(r,u,'join',{},now);r=changeRoom(r,u,'goal',goal,now);}
  r=changeRoom(r,a,'trigger',{mode:'prize',amount:1001},now);r=changeRoom(agreeAll(r),a,'start',{},now);
  for(const i of [0,1,3,5])for(const u of [a,b])r=changeRoom(r,u,'record',{photoId:'fixture',note:'사진으로 인증 완료'},deadline(addDays(start,i),'12:00'));
  const end=deadline(addDays(start,8),'12:00');assert.equal(outcome(r,end-86400000).state,'waiting');
  const items=outcome(r,end).items;assert.deepEqual(items.map(i=>i.amount),[501,500,501,500]);assert.equal(items.reduce((n,i)=>n+i.amount,0),2002);
  const item=items[0],payload={seasonId:1,itemId:item.id};
  r=changeRoom(r,a,'next',{start:addDays(start,8)},end);
  assert.equal(current(r).trigger.amount,1001);assert.ok(current(r).people.every(p=>!p.ready));
  r=changeRoom(r,c,'trigger-progress',{...payload,step:'claim'},end);
  assert.throws(()=>changeRoom(r,b,'trigger-progress',{...payload,step:'confirm'},end),{status:403});
  r=changeRoom(r,a,'trigger-progress',{...payload,step:'confirm'},end);
  assert.equal(outcome(r,end).items[0].progress.status,'confirmed');
  const erased=eraseUser(r,c.id);assert.equal(outcome(erased,end).state,'suspended');assert.ok(!JSON.stringify(erased).includes(c.id));
});
test('R17: no winners or all winners require no transfer; new terms never apply to legacy seasons',()=>{
  let r=ready();r=changeRoom(r,a,'trigger',{mode:'prize',amount:10000},now);r=changeRoom(agreeAll(r),a,'start',{},now);
  const end=deadline(addDays(start,8),'12:00');assert.deepEqual(outcome(r,end).items,[]);
  for(const i of [0,1,3,5])for(const u of [a,b])r=changeRoom(r,u,'record',{photoId:'fixture',note:'완주 사진 인증'},deadline(addDays(start,i),'12:00'));
  assert.deepEqual(outcome(r,end).items,[]);
  delete current(r).trigger;assert.equal(outcome(r,end).state,'legacy');assert.deepEqual(outcome(r,end).items,[]);
});
