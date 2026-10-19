import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { chromium } from '../../../onequeue-mcp/node_modules/playwright/index.mjs';
import { dayKey, RELEASE, createRoom, changeRoom, addDays, deadline } from '../lib/domain.mjs';
import { createCheckReport } from '../../../onequeue-mcp/src/check-report.mjs';
import { assertMobileAction, assertContrast } from '../../../onequeue-mcp/src/quality-checks.mjs';
const report=createCheckReport();
const photo={type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='};
const root=resolve(import.meta.dirname,'..'), results=resolve(root,'test-results'), nonce=crypto.randomUUID();
const storage='.wrangler/qa-'+nonce, cli='node_modules/wrangler/bin/wrangler.js';
const args=['--import','./scripts/sites-env.mjs',cli];
await mkdir(results,{recursive:true});
function command(tail) { return new Promise((done,fail)=>{const p=spawn(process.execPath,[...args,...tail],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',fail);p.on('exit',code=>code===0?done(output):fail(new Error(output)));});}
for(const migration of (await readdir(resolve(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort())await command(['d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to',storage,'--file','drizzle/'+migration]);
const listener=createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));
const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,[...args,'dev','--name','promise-qa-'+nonce,'--config','dist/server/wrangler.json','--local','--persist-to',storage,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',b=>serverLog=(serverLog+b).slice(-12000));server.stderr.on('data',b=>serverLog=(serverLog+b).slice(-12000));
const auth=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@local.test'});
const userA='qa-a-'+nonce,userB='qa-b-'+nonce,userC='qa-c-'+nonce;
async function request(id,path,data,expected=200,extra={}) {
  assert.equal(new URL(origin).hostname,'127.0.0.1');
  const r=await fetch(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{...(id?auth(id):{}),...(data===undefined?{}:{'Content-Type':'application/json','Origin':origin}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(body));return body;
}
const checks=[];let browser;
try{
  for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health');if(r.ok)break;}catch{}if(i===99)throw new Error('Preview failed: '+serverLog);await new Promise(r=>setTimeout(r,150));}
  await new Promise(resolve=>setTimeout(resolve,2000));
  browser=await chromium.launch({channel:'msedge',headless:true});
  const assetPage=await browser.newPage();photo.data=await assetPage.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d');ctx.fillStyle='#94af52';ctx.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});await assetPage.close();
  await report.case('worker-auth-photo-account-lifecycle',['authorization','account-lifecycle'],async()=>{
  assert.equal((await request(null,'/health')).release,RELEASE);
  await request(null,'/rooms',undefined,401);
  for(const [id,name] of [[userA,'하나'],[userB,'두리'],[userC,'외부인']])await request(id,'/profile',{name});
  const start=dayKey(Date.now());
  let room=(await request(userA,'/rooms',{name:'통합 검증 방',start},201)).room;
  await request(userC,'/rooms/'+room.id,undefined,404);
  await request(userB,'/rooms/'+room.id+'/start',{},404);
  await request(userA,'/rooms/'+room.id+'/rotate',{},403,{Origin:'https://attacker.example'});
  const oldInvite=room.invite;room=(await request(userA,'/rooms/'+room.id+'/rotate',{})).room;
  await request(userB,'/join',{invite:oldInvite},404);
  room=(await request(userB,'/join',{invite:room.invite})).room;
  const goal={title:'책 읽기 20쪽',proof:'읽은 내용 한 줄 남기기',reason:'꾸준히 읽기',days:[0,1,3,5],cutoff:'23:59',kind:'note',minutes:0};
  for(const id of [userA,userB])await request(id,'/rooms/'+room.id+'/goal',goal);
  room=(await request(userA,'/rooms/'+room.id+'/trigger',{mode:'penalty',when:'each-miss',task:'다음 모임 준비하기'})).room;
  await request(userB,'/rooms/'+room.id+'/trigger',{mode:'prize',amount:10000},403);
  await request(userA,'/rooms/'+room.id+'/ready',{},409);
  for(const id of [userA,userB])await request(id,'/rooms/'+room.id+'/ready',{acceptTrigger:true,agreementVersion:room.seasons[0].agreementVersion});
  await request(userB,'/rooms/'+room.id+'/start',{},403);await request(userA,'/rooms/'+room.id+'/start',{});
  await request(userA,'/rooms/'+room.id+'/extra',{note:'잘못된 사진은 거절',photo:{type:'image/png',data:btoa('bad image')}},400);
  await request(userA,'/rooms/'+room.id+'/record',{note:'사진 없는 인증',photoId:'forged-photo-id'},400);
  const attempts=await Promise.all(Array.from({length:8},()=>fetch(origin+'/api/rooms/'+room.id+'/record',{method:'POST',headers:{...auth(userA),'Content-Type':'application/json'},body:JSON.stringify({note:'동시 인증도 딱 한 번',photo})})));
  assert.equal(attempts.filter(r=>r.status===200).length,1);assert.equal(attempts.filter(r=>r.status===409).length,7);
  const saved=(await request(userB,'/rooms/'+room.id)).room;assert.equal(saved.seasons[0].records.length,1);
  const photoUrl=origin+'/api/rooms/'+room.id+'/photo/'+saved.seasons[0].records[0].photoId;
  assert.equal((await fetch(photoUrl)).status,401);assert.equal((await fetch(photoUrl,{headers:auth(userC)})).status,404);
  const imageResponse=await fetch(photoUrl,{headers:auth(userB)});assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('content-type'),'image/png');assert.ok((await imageResponse.arrayBuffer()).byteLength>20);
  await request(userB,'/rooms/'+room.id+'/record',{note:'친구의 인증은 보존',photo});
  await request(userA,'/account/delete',{confirm:'잘못된 문구'},400);
  await request(userA,'/account/delete',{confirm:'내 기록 삭제'});
  assert.equal((await fetch(photoUrl,{headers:auth(userB)})).status,404);
  const erased=(await request(userB,'/rooms/'+room.id)).room;
  assert.equal(erased.ownerId,userB);assert.equal(erased.seasons[0].records.length,1);assert.ok(!JSON.stringify(erased).includes(userA));
  const exported=await request(userB,'/account/export');assert.equal(exported.rooms[0].seasons[0].records[0].note,'친구의 인증은 보존');assert.ok(!JSON.stringify(exported).includes(userA));
  checks.push('Built Worker + D1: auth, membership isolation, CSRF, invite rotation, consent, concurrent duplicate prevention, erasure and personal export');
  console.log('PASS API: authorization, concurrency, persistence and erasure');
  });
  await report.case('independent-users-mobile-downloads-and-new-features',['multi-user','reload-persistence','mobile-actions','export-download'],async()=>{
  const anonymous=await browser.newContext({viewport:{width:1440,height:1000}}), page=await anonymous.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('heading',{name:/미루지 못할 이유/}).waitFor();
  await page.screenshot({path:resolve(results,'welcome-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'먼저 둘러보기'}).click();await page.getByRole('heading',{name:'우리의 오늘',exact:true}).waitFor();
  await page.screenshot({path:resolve(results,'journal-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(results,'journal-mobile.png'),fullPage:true});
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+width+' '+JSON.stringify(overflow));}
  assert.deepEqual(errors,[]);
  const contextA=await browser.newContext({extraHTTPHeaders:auth('ui-a-'+nonce),viewport:{width:1280,height:950}});
  const contextB=await browser.newContext({extraHTTPHeaders:auth('ui-b-'+nonce),viewport:{width:390,height:844}});
  const pa=await contextA.newPage(),pb=await contextB.newPage();
  for(const [p,name] of [[pa,'가온'],[pb,'나래']]){p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);await p.getByLabel('표시 이름',{exact:true}).fill(name);await p.getByRole('button',{name:'이 이름으로 시작'}).click();await p.getByRole('heading',{name:'첫 약속은 함께할 사람부터.'}).waitFor();}
  await pa.getByRole('button',{name:'새 친구방 만들기',exact:true}).click();await pa.getByLabel('친구방 이름').fill('브라우저 친구방');await pa.getByRole('button',{name:'친구방 만들기',exact:true}).click();
  await pa.getByRole('heading',{name:'미션과 실패 조건'}).waitFor();
  const uiRoom=(await request('ui-a-'+nonce,'/rooms')).rooms[0];const invite=(await request('ui-a-'+nonce,'/rooms/'+uiRoom.id)).room.invite;
  await pb.getByRole('button',{name:'초대 코드로 참여',exact:true}).first().click();await pb.getByLabel('초대 링크 또는 코드').fill(origin+'/?invite='+invite);await pb.getByRole('button',{name:'참여하기',exact:true}).click();await pb.getByRole('heading',{name:'미션과 실패 조건'}).waitFor();
  for(const [p,title] of [[pa,'전공 공부 30분'],[pb,'퇴근 후 산책하기']]){await p.getByRole('button',{name:'내 약속 작성',exact:true}).click();await p.getByLabel('실천할 행동').fill(title);await p.getByLabel('무엇을 하면 완료인가요?').fill('실천한 내용 한 줄 남기기');await p.getByRole('button',{name:'약속 저장',exact:true}).click();await p.locator('#modal').waitFor({state:'hidden'});}
  await pa.getByRole('button',{name:'벌칙·상금 정하기',exact:true}).click();await pa.getByLabel('동기부여 방식').selectOption('prize');await pa.getByLabel('미완주자 1인당 약정액 · 원').fill('10000');await pa.getByRole('button',{name:'조건 저장',exact:true}).click();await pa.locator('#modal').waitFor({state:'hidden'});
  for(const p of [pa,pb]){await p.reload();await p.locator('[data-tab="promises"]:visible').first().click();await p.getByRole('button',{name:'미션·실패 조건에 동의',exact:true}).click();await p.getByLabel('모두의 미션과 실패 조건을 확인하고 동의합니다.').check();await p.getByRole('button',{name:'동의하고 준비 완료',exact:true}).click();await p.getByRole('button',{name:'조건에 동의했어요 ✓'}).waitFor();}
  await pa.reload();await pa.locator('.tabs [data-tab="promises"]').click();await pa.getByRole('button',{name:'함께 시작하기',exact:true}).click();await pa.getByRole('button',{name:'약속 잠그고 시작'}).click();await pa.locator('#modal').waitFor({state:'hidden'});
  await pa.locator('.tabs [data-tab="today"]').click();await pa.getByRole('button',{name:'사진으로 미션 인증 ↗'}).click();await pa.getByLabel('오늘 무엇을 했나요?').fill('오늘은 운영체제의 스케줄링을 복습했어요.');
  assert.equal(await pa.locator('input[name=photo]').getAttribute('required'),'');
  await pa.locator('input[name=photo]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from(photo.data,'base64')});
  await pa.locator('#photo-status').filter({hasText:'준비 완료'}).waitFor();
  await pa.route('**/api/rooms/*/record',route=>route.abort());
  await pa.getByRole('button',{name:'오늘의 약속 인증',exact:true}).click();await pa.locator('.form-error').filter({hasText:'연결이 불안정'}).waitFor();assert.equal(await pa.getByLabel('오늘 무엇을 했나요?').inputValue(),'오늘은 운영체제의 스케줄링을 복습했어요.');
  await pa.unroute('**/api/rooms/*/record');await pa.getByRole('button',{name:'오늘의 약속 인증',exact:true}).click();await pa.locator('#modal').waitFor({state:'hidden'});await pa.locator('.feed-item .note').filter({hasText:'스케줄링'}).waitFor();
  assert.ok(await pa.locator('.proof-photo img').evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
  await pb.reload();await pb.locator('.feed-item .note').filter({hasText:'스케줄링'}).waitFor();await pb.locator('[data-action=react][data-reaction="잘했어요"]').click();
  await assertMobileAction(pb,{selector:'[data-action=extra]'});await pb.locator('[data-action=extra]').click();await pb.getByLabel('오늘 무엇을 했나요?').fill('오늘은 약속 외에도 스트레칭했어요.');await pb.getByRole('button',{name:'추가 실천 저장',exact:true}).click();await pb.locator('#modal').waitFor({state:'hidden'});
  assert.equal((await request('ui-b-'+nonce,'/rooms/'+uiRoom.id)).room.seasons[0].people.find(p=>p.id==='ui-b-'+nonce).count,0);
  await pa.reload();await pa.getByRole('button',{name:'나래님에게 약속 알림 보내기'}).click();
  await pb.reload();await pb.getByRole('button',{name:'알림',exact:true}).click();await pb.getByText('가온님이 같이 하자고 했어요.').waitFor();await pb.keyboard.press('Escape');
  await pb.locator('[data-tab=settings]:visible').click();await pb.getByRole('button',{name:'친구 알림 끄기',exact:true}).click();
  await request('ui-a-'+nonce,'/rooms/'+uiRoom.id+'/nudge',{memberId:'ui-b-'+nonce},409);
  const calendarEvent=pb.waitForEvent('download');await pb.getByRole('button',{name:'캘린더 파일 받기',exact:true}).click();const calendar=await calendarEvent;
  assert.equal((await readFile(await calendar.path(),'utf8')).match(/BEGIN:VEVENT/g).length,4);
  await pb.getByRole('button',{name:'계정 설정',exact:true}).click();const mobileExport=pb.waitForEvent('download');await pb.getByRole('button',{name:'내 기록 JSON 내보내기'}).click();
  const personal=JSON.parse(await readFile(await (await mobileExport).path(),'utf8'));assert.ok(personal.rooms[0].seasons[0].records.some(r=>r.extra));await pb.keyboard.press('Escape');
  await pb.locator('[data-tab=today]:visible').click();
  await pb.screenshot({path:resolve(results,'real-room-mobile.png'),fullPage:true});
  await pa.reload();await pa.locator('.feed-item .note').filter({hasText:'스케줄링'}).waitFor();await pa.screenshot({path:resolve(results,'real-room-desktop.png'),fullPage:true});
  await pa.getByRole('button',{name:'알림',exact:true}).click();await pa.getByRole('heading',{name:'나를 위한 알림'}).waitFor();await pa.keyboard.press('Escape');assert.equal(await pa.locator('#modal').isVisible(),false);
  await pa.locator('.tabs [data-tab=settings]').click();await pa.getByRole('button',{name:'계정 설정',exact:true}).click();const downloadEvent=pa.waitForEvent('download');await pa.getByRole('button',{name:'내 기록 JSON 내보내기'}).click();assert.match((await downloadEvent).suggestedFilename(),/내기록/);
  assert.deepEqual(errors,[]);
  checks.push('Real browser / isolated local identities: onboarding, create, invite, promises, consent, start, offline form recovery, record, reaction, download, keyboard dialog, 320–1440px');
  console.log('PASS browser: two independent local identities complete the primary journey');
  });
  await report.case('trigger-terms-and-two-party-settlement',['authorization','multi-user','reload-persistence','mobile-actions'],async()=>{
    // Seed only the isolated local D1 with a historical synthetic season; production has no time override.
    const ids=['settle-a-'+nonce,'settle-b-'+nonce,'settle-c-'+nonce],users=ids.map((id,i)=>({id,name:['완주한 친구','미완주한 친구','다른 참여자'][i]}));
    for(const u of users)await request(u.id,'/profile',{name:u.name});
    const start=addDays(dayKey(Date.now()),-9),then=deadline(start,'10:00');
    let doc=createRoom(users[0],{name:'정산 검증 친구방',start},then);
    for(const u of users.slice(1))doc=changeRoom(doc,u,'join',{},then);
    for(const u of users)doc=changeRoom(doc,u,'goal',{title:'책 20쪽 읽기',proof:'읽은 책 사진 남기기',days:[0,1,3,5],cutoff:'23:00',kind:'note'},then);
    doc=changeRoom(doc,users[0],'trigger',{mode:'prize',amount:10001},then);
    for(const u of users)doc=changeRoom(doc,u,'ready',{acceptTrigger:true,agreementVersion:doc.seasons[0].agreementVersion},then);
    doc=changeRoom(doc,users[0],'start',{},then);
    for(const i of [0,1,3,5])doc=changeRoom(doc,users[0],'record',{note:'격리된 과거 시즌 검증',photoId:'synthetic-proof'},deadline(addDays(start,i),'12:00'));
    const sqlPath=resolve(results,'settlement-fixture-'+nonce+'.sql'),quote=x=>"'"+String(x).replaceAll("'","''")+"'";
    await writeFile(sqlPath,`INSERT INTO rooms(id,invite,document,version,created) VALUES(${quote(doc.id)},${quote(crypto.randomUUID())},${quote(JSON.stringify(doc))},0,${Date.now()});`);
    await command(['d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to',storage,'--file',sqlPath]);
    try{
      let room=(await request(ids[0],'/rooms/'+doc.id)).room;const item=room.seasons[0].triggerOutcome.items.find(i=>i.from===ids[1]);assert.equal(item.amount,10001);
      const progress={seasonId:1,itemId:item.id};
      await request(userC,'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'claim'},404);
      await request(ids[0],'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'claim'},403);
      await request(ids[0],'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'confirm'},409);
      const sender=await browser.newContext({extraHTTPHeaders:auth(ids[1]),viewport:{width:390,height:844}}),receiver=await browser.newContext({extraHTTPHeaders:auth(ids[0]),viewport:{width:390,height:844}});
      try{
        const sp=await sender.newPage(),rp=await receiver.newPage();
        for(const p of [sp,rp]){await p.goto(origin);await p.locator('[data-tab=results]:visible').click();}
        await assertMobileAction(sp,{selector:'[data-action=trigger-progress]'});await sp.getByRole('button',{name:'송금했어요',exact:true}).click();await sp.getByRole('button',{name:'확인하여 기록',exact:true}).click();await sp.locator('#modal').waitFor({state:'hidden'});
        await request(ids[2],'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'confirm'},403);
        await request(ids[1],'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'confirm'},403);
        await rp.reload();await rp.locator('[data-tab=results]:visible').click();await rp.getByRole('button',{name:'받았어요 · 수령 확인',exact:true}).click();await rp.getByRole('button',{name:'확인하여 기록',exact:true}).click();await rp.locator('#modal').waitFor({state:'hidden'});
        await sp.reload();await sp.locator('[data-tab=results]:visible').click();await sp.locator('.trigger-item .pill').filter({hasText:'확인 완료'}).waitFor();
        await sp.screenshot({path:resolve(results,'settlement-mobile.png'),fullPage:true});
      }finally{await sender.close();await receiver.close();}
      room=(await request(ids[0],'/rooms/'+doc.id)).room;assert.equal(room.seasons[0].triggerOutcome.items.find(i=>i.id===item.id).progress.status,'confirmed');
      await request(ids[1],'/rooms/'+doc.id+'/trigger-progress',{...progress,step:'claim'});
      assert.equal((await request(ids[0],'/rooms/'+doc.id)).room.seasons[0].triggerOutcome.items.find(i=>i.id===item.id).progress.status,'confirmed');
      const exported=await request(ids[1],'/account/export');assert.equal(exported.rooms[0].seasons[0].trigger.amount,10001);assert.ok(Object.keys(exported.rooms[0].seasons[0].triggerProgress).length);
      await request(ids[1],'/account/delete',{confirm:'내 기록 삭제'});assert.equal((await request(ids[0],'/rooms/'+doc.id)).room.seasons[0].triggerOutcome.state,'suspended');
      checks.push('Synthetic historical local season: exact prize amount, independent mobile sender and receiver, unauthorized acknowledgement denied, reload persistence, export and deletion suspension');
    }finally{
      await command(['d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to',storage,'--command',`DELETE FROM rooms WHERE id=${quote(doc.id)};`]);
    }
  });
  await report.case('real-local-d1-backup-restore',['recovery'],async()=>{
  const dbDir=resolve(root,storage,'v3/d1/miniflare-D1DatabaseObject');
  const file=(await readdir(dbDir)).find(x=>x.endsWith('.sqlite'));assert.ok(file);
  const original=new DatabaseSync(resolve(dbDir,file),{readOnly:true}), backupFile=resolve(results,'qa-backup-'+nonce+'.sqlite');
  await backup(original,backupFile);original.close();
  const restored=new DatabaseSync(backupFile);
  const count=restored.prepare("SELECT COUNT(*) AS rooms, SUM(json_array_length(json_extract(document,'$.members'))) AS members FROM rooms").get();
  assert.equal(count.rooms,2);assert.equal(count.members,3);
  const records=restored.prepare("SELECT SUM(json_array_length(json_extract(document,'$.seasons[0].records'))) AS count FROM rooms").get();assert.equal(records.count,3);
  restored.prepare('UPDATE rooms SET version=version+1').run();restored.close();
  checks.push('Consistent SQLite backup of actual local D1 store opened as independent restored database; room, membership and record counts plus writes verified');
  await writeFile(resolve(results,'integration.json'),JSON.stringify({ok:report.report.cases.every(c=>c.status==='passed'),release:RELEASE,at:new Date().toISOString(),checks,limitations:['Test identity headers are used only on loopback. This is not verification of real hosted ChatGPT login.','Local D1 recovery does not attest a hosted D1 or R2 backup/restore.']},null,2));
  console.log('PASS backup: actual local D1 snapshot restored into an independent writable store');
  });
  await report.finish(process.env.ONEQUEUE_REPORT_PATH || resolve(results,'integration-cases.json'));
}catch(e){await writeFile(resolve(results,'failure-log.txt'),serverLog);throw e;}
finally{await browser?.close();if(process.platform==='win32')await new Promise((done,fail)=>{const p=spawn(resolve(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),['/pid',String(server.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});p.on('exit',done);p.on('error',fail);});else server.kill('SIGTERM');}
