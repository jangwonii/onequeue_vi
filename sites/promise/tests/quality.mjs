import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../../../onequeue-mcp/node_modules/playwright/index.mjs';
import { createCheckReport } from '../../../onequeue-mcp/src/check-report.mjs';
import { assertMobileAction,assertContrast,assertFocusSurvives,assertLiveTransition } from '../../../onequeue-mcp/src/quality-checks.mjs';
import { createRoom,changeRoom,snapshot,deadline } from '../lib/domain.mjs';
const report=createCheckReport(),out=resolve('test-results');await mkdir(out,{recursive:true});
const user={id:'quality-a',name:'하나'},friend={id:'quality-b',name:'두리'},date='2026-10-16';
let now=deadline(date,'22:59'),version=1,room=createRoom(user,{name:'새 기준으로 함께',start:date},now);
room=changeRoom(room,friend,'join',{},now);
for(const u of [user,friend])room=changeRoom(room,u,'goal',{title:'전공 공부 한 단원',proof:'배운 내용 한 줄 남기기',reason:'조금씩 꾸준히 해 보고 싶어서',days:[0,1,3,5],cutoff:'23:00',kind:'note'},now);
room=changeRoom(room,user,'trigger',{mode:'penalty',when:'each-miss',task:'다음 모임 준비하기'},now);
for(const u of [user,friend])room=changeRoom(room,u,'ready',{acceptTrigger:true,agreementVersion:room.seasons[0].agreementVersion},now);room=changeRoom(room,user,'start',{},now);
const client=await readFile('public/client.js','utf8'),css=await readFile('public/styles.css','utf8');
const browser=await chromium.launch({channel:'msedge'}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const interval=window.setInterval;window.setInterval=(fn,ms,...args)=>interval(fn,ms===15000?200:ms,...args);});
await page.route('http://127.0.0.1:9999/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><dialog id="modal"></dialog><div id="toast"></div><script type="module" src="/client.js"></script></html>'});
  if(url.pathname==='/client.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:client});
  if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
  if(url.pathname==='/icon.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>'});
  let data;if(url.pathname==='/api/me')data={user};else if(url.pathname==='/api/rooms')data={rooms:[{id:room.id,name:room.name}]};else if(url.pathname==='/api/rooms/'+room.id)data={room:{...snapshot(room,user.id,now),version,invite:'0'.repeat(64)}};
  else return route.fulfill({status:404,body:'{}'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
try{
  await page.goto('http://127.0.0.1:9999/');await page.locator('.my-action h2').waitFor();
  await report.case('readable-responsive-actions',['mobile-actions','contrast','keyboard'],async()=>{
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await assertContrast(page,'.my-action h2, .my-action .muted, .person-status, .person-progress, .promise-progress p');
    }
    await assertMobileAction(page,{selector:'[data-action=record]',width:390});await assertMobileAction(page,{selector:'[data-action=extra]'});
    await assertContrast(page,'.trigger-panel h2, .trigger-panel .muted');
    await assertMobileAction(page,{selector:'.trigger-panel [data-action=show-results]'});
    assert.equal(await page.locator('.tabs').isVisible(),false);assert.equal(await page.locator('.mobile-nav').isVisible(),true);
    await page.locator('.mobile-nav [data-tab=today]').focus();await page.keyboard.press('Tab');
    assert.ok(await page.locator('.mobile-nav [data-tab=promises]').evaluate(el=>el===document.activeElement));
    await page.screenshot({path:resolve(out,'quality-mobile.png'),fullPage:true});
  });
  await report.case('polling-focus-and-draft-retention',['focus-retention','live-update'],async()=>{
    await assertFocusSurvives(page,'[data-action=extra]',{trigger:async()=>{room=changeRoom(room,friend,'record',{photoId:'fixture-photo',note:'친구가 새로 남긴 실천'},now);version++;await page.locator('.feed-item .note').filter({hasText:'새로 남긴'}).waitFor();},settleMs:50});
    await page.locator('[data-action=record]').click();const input=page.getByLabel('오늘 무엇을 했나요?');await input.fill('작성 중인 글은 그대로 있어야 합니다.');
    await input.focus();version++;await page.waitForTimeout(700);assert.equal(await input.inputValue(),'작성 중인 글은 그대로 있어야 합니다.');assert.ok(await input.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Escape');
  });
  await report.case('same-version-deadline-updates-open-ui',['time-boundary','live-update'],async()=>{
    const originalVersion=version;
    await assertLiveTransition(page,{selector:'.my-action .pill',before:'예정',after:'미달',advance:async()=>{now=deadline(date,'23:01');},timeoutMs:5000});
    assert.equal(version,originalVersion);assert.equal(await page.locator('[data-action=record]').count(),0);
    await page.locator('.trigger-status').filter({hasText:'약속한 조건이 발동했습니다.'}).waitFor();
    await page.locator('.trigger-panel [data-action=show-results]').click();
    await page.getByRole('button',{name:'벌칙을 이행했어요',exact:true}).waitFor();
    await assertMobileAction(page,{selector:'[data-action=trigger-progress]'});
    await page.screenshot({path:resolve(out,'penalty-mobile.png'),fullPage:true});
    await page.locator('[data-tab=today]:visible').click();
    await assertMobileAction(page,{selector:'[data-action=extra]'});
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:resolve(out,'quality-desktop.png'),fullPage:true});
  });
  await report.case('browser-runtime-errors',[],()=>assert.deepEqual(errors,[]));
  await report.finish(process.env.ONEQUEUE_REPORT_PATH || resolve(out,'quality-cases.json'));
}finally{await browser.close();}
