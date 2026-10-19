import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertMobileAction, assertContrast, assertFocusSurvives, assertLiveTransition } from '../src/quality-checks.mjs';

test('quality helpers reject reproduced failure patterns and accept repaired behavior', {timeout:20000}, async t => {
  const browser=await chromium.launch({channel:'msedge'}),page=await browser.newPage();
  try {
    await t.test('an export action must remain reachable on mobile',async()=>{
      await page.setContent('<style>@media(max-width:850px){#export{display:none}}</style><button id="export">내보내기</button>');
      await assert.rejects(assertMobileAction(page,{selector:'#export'}),/숨겨져/);
      await page.locator('style').evaluate(e=>e.remove());
      await assertMobileAction(page,{selector:'#export'});
    });
    await t.test('body text must meet contrast and unsupported effects cannot silently pass',async()=>{
      await page.setContent('<style>body{background:white}p{color:#aaa;font-size:8px}</style><p>작가 설명</p>');
      await assert.rejects(assertContrast(page,'p'),/텍스트 대비/);
      await page.locator('p').evaluate(e=>e.style.color='#111');await assertContrast(page,'p');
      await page.locator('p').evaluate(e=>e.style.opacity='0.5');
      await assert.rejects(assertContrast(page,'p'),/별도 대비 검사/);
    });
    await t.test('refresh must preserve the focused action',async()=>{
      await page.setContent('<div id="list"><button id="task">완료</button></div><div id="count">0</div>');
      await assert.rejects(assertFocusSurvives(page,'#task',{trigger:()=>page.evaluate(()=>{
        document.querySelector('#list').innerHTML='<button id="task">완료</button>';
      })}),/포커스/);
      await assertFocusSurvives(page,'#task',{trigger:()=>page.evaluate(()=>{document.querySelector('#count').textContent='1';})});
    });
    await t.test('a changed server state must update the open screen without reload',async()=>{
      await page.setContent('<div id="state">예정</div>');
      await assert.rejects(assertLiveTransition(page,{selector:'#state',before:'예정',after:'미달',advance:async()=>{},timeoutMs:150}));
      await assertLiveTransition(page,{selector:'#state',before:'예정',after:'미달',advance:()=>page.evaluate(()=>{document.querySelector('#state').textContent='미달';})});
      let crossed=false;
      await page.route('http://127.0.0.1:9999/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="state">${crossed?'미달':'예정'}</div>`}));
      await page.goto('http://127.0.0.1:9999/');
      await assert.rejects(assertLiveTransition(page,{selector:'#state',before:'예정',after:'미달',advance:async()=>{crossed=true;await page.reload();}}),/새로고침 없이/);
    });
  } finally {await browser.close();}
});
