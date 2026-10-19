import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp as hankan } from '../../apps/hankan/server.mjs';
import { createApp as bookmark } from '../../apps/bookmark/server.mjs';
import { createRoom,snapshot,deadline } from '../../sites/promise/lib/domain.mjs';
import { assertMobileAction,assertFocusSurvives,assertContrast,assertLiveTransition,assertDownload } from '../src/quality-checks.mjs';

// Historical app probe, separate from the stable MCP suite: update this probe when these app defects are fixed.
test('quality helpers reproduce the audited app defects and accept working controls', {timeout:30000}, async t=>{
  const browser=await chromium.launch({channel:'msedge'}),servers=[];
  async function pageFor(create){const s=await create({database:':memory:'});servers.push(s);await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=await browser.newPage({viewport:{width:390,height:844}});await p.goto('http://127.0.0.1:'+s.address().port);return p;}
  try{
    await t.test('hidden mobile export and faint text are rejected',async()=>{
      const page=await pageFor(bookmark);await page.locator('#sample-books').click();await page.locator('.book-card').first().waitFor();
      await assert.rejects(assertMobileAction(page,{selector:'#export'}),/숨겨져/);
      await assert.rejects(assertContrast(page,'.book-author'),/텍스트 대비/);
      await assertContrast(page,'.book-title');
      await page.setViewportSize({width:1440,height:1000});await assertDownload(page,'#export');await page.close();
    });
    await t.test('actual polling focus loss is rejected',async()=>{
      const page=await pageFor(hankan);await page.locator('#task-title').fill('격리된 포커스 검사');await page.getByRole('button',{name:'할 일 저장',exact:true}).click();await page.locator('.task-check').waitFor();
      await assert.rejects(assertFocusSurvives(page,'.task-check',{trigger:()=>page.waitForResponse(r=>r.url().endsWith('/api/state')),settleMs:100}),/포커스/);
      await assertFocusSurvives(page,'#task-title',{trigger:()=>page.waitForResponse(r=>r.url().endsWith('/api/state')),settleMs:100});await page.close();
    });
    await t.test('repaired promise frontend updates at cutoff without reload',async()=>{
      const before=deadline('2026-10-16','22:59'),after=deadline('2026-10-16','23:01'),user={id:'synthetic-test',name:'가상 검토자'};
      const room=createRoom(user,{name:'격리 검증방',start:'2026-10-16'},before);room.seasons[0].started=true;
      room.seasons[0].people[0].goal={title:'한 줄 기록',proof:'오늘 한 일 기록하기',days:[0,1,3,5],cutoff:'23:00',kind:'note',minutes:0};
      const source=await readFile(new URL('../../sites/promise/public/client.js',import.meta.url),'utf8');
      const page=await browser.newPage();let crossed=false;
      // Accelerate polling only. Server state still uses the same date, version and phase on both sides of cutoff.
      await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=(fn,ms,...args)=>original(fn,ms===15000?50:ms,...args);});
      await page.route('http://127.0.0.1:9/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:'<div id="app"></div><dialog id="modal"></dialog><div id="toast"></div><script type="module" src="/client.js"></script>'});
        if(path==='/client.js')return route.fulfill({contentType:'text/javascript',body:source});
        let data;
        if(path==='/api/me')data={user};
        else if(path==='/api/rooms')data={rooms:[{id:room.id,name:room.name}]};
        else if(path==='/api/rooms/'+room.id)data={room:{...snapshot(room,user.id,crossed?after:before),version:1,invite:'0'.repeat(64)}};
        else return route.fulfill({status:404,body:''});
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto('http://127.0.0.1:9/');await page.locator('.my-action .pill').waitFor();
      await assertLiveTransition(page,{selector:'.my-action .pill',before:'예정',after:'미달',advance:async()=>{crossed=true;},timeoutMs:5000});
      await page.reload();await page.locator('.my-action .pill').waitFor();assert.equal(await page.locator('.my-action .pill').innerText(),'미달');
      await page.setContent('<div id="state">예정</div>');
      await assertLiveTransition(page,{selector:'#state',before:'예정',after:'미달',advance:()=>page.evaluate(()=>{document.querySelector('#state').textContent='미달';})});await page.close();
    });
  }finally{await browser.close();for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}}
});
