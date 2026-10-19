import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server.mjs';
import { deadline } from '../model.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : new URL('../../../onequeue-mcp/node_modules/playwright/index.mjs', import.meta.url).href);
let time = deadline('2026-10-16', '10:00');
const server = await createApp({ database: ':memory:', now: () => time });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' }), hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), friendContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const demo = await demoContext.newPage(), host = await hostContext.newPage(), friend = await friendContext.newPage(), errors = [];
for (const p of [demo,host,friend]) { p.on('pageerror', e => errors.push(e.message)); p.setDefaultTimeout(12000); }
await mkdir('test-results', { recursive: true });
const submit = async (page, id) => { await page.locator('#' + id + ' [type=submit]').click(); await page.locator('dialog').waitFor({ state: 'hidden' }); };
const tab = (page, view) => page.locator('[data-tab=' + view + ']:visible').first().click();
async function signup(page, username, name) {
  await page.locator('#auth-form [name=name]').fill(name);
  await page.locator('#auth-form [name=username]').fill(username);
  await page.locator('#auth-form [name=password]').fill('browser-test-password-123');
  await page.locator('#auth-form [type=submit]').click();
  await page.locator('.shell').waitFor();
}
async function goal(page, timer = false) {
  await page.locator('[data-action=goal]:visible').first().click();
  await page.locator('#goal-form [name=title]').fill(timer ? '책을 읽고 한 문장 남기기' : '전공 문제 10개 풀기');
  for (const d of [0,2,4,6]) await page.locator('#goal-form [name=days][value="' + d + '"]').check();
  await page.locator('#goal-form [name=proof]').fill('실천한 내용과 배운 것을 한 줄로 제출');
  if (timer) { await page.locator('#goal-form [name=kind]').selectOption('timer'); await page.locator('#goal-form [name=minutes]').fill('1'); }
  await submit(page, 'goal-form');
}
async function ready(page) {
  await tab(page, 'promises');
  await page.locator('#ready').click();
  await page.locator('#ready-form [name=agree]').check();
  await submit(page, 'ready-form');
}
async function noOverflow(page, width) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Horizontal overflow at ' + width);
}
try {
  await demo.goto(base); await demo.locator('#demo').waitFor();
  await demo.screenshot({ path: 'test-results/welcome-desktop.png', fullPage: true });
  await demo.locator('#demo').click(); await demo.locator('.friend').first().waitFor();
  assert.equal(await demo.locator('.friend').count(), 4);
  await demo.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await demo.locator('#record-today').click();
  await demo.locator('#record-note').fill('오늘 10쪽, 기억하고 싶은 문장을 남겼어요. <img src=x onerror=alert(1)>');
  await demo.locator('#record-form [name=honest]').check(); await submit(demo, 'record-form');
  await demo.waitForFunction(() => document.querySelector('#my-count')?.textContent === '2');
  await demo.reload(); await demo.waitForFunction(() => document.querySelector('#my-count')?.textContent === '2');
  assert.equal(await demo.locator('.feed-note img').count(), 0);
  await demo.locator('.reaction[data-react="잘했어요"]').first().click();
  await demo.locator('.reaction.active').first().waitFor();
  await demo.reload(); await demo.locator('.reaction.active').first().waitFor();
  await noOverflow(demo,390);
  assert.equal(await demo.evaluate(() => document.querySelector('.friends-card').getBoundingClientRect().top < document.querySelector('.feed').getBoundingClientRect().top), true, 'Mobile friends must appear before the feed');
  await demo.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await tab(demo,'promises'); await noOverflow(demo,320);
  await tab(demo,'results'); assert.equal(await demo.locator('.rank-row').count(),0);
  await demo.setViewportSize({ width:1440,height:1000 });
  for (let i=0;i<6;i++) {
    const old = await demo.locator('.demo-bar').textContent();
    await demo.locator('[data-action=demo-day]').click();
    await demo.waitForFunction(old => document.querySelector('.demo-bar').textContent !== old,old);
  }
  await demo.locator('.rank-row').first().waitFor();
  await demo.locator('[data-action=reflection]').click();
  await demo.locator('#reflection-form textarea').fill('한 번 놓쳐도 다시 돌아오겠습니다.');
  await submit(demo,'reflection-form'); await demo.getByText('한 번 놓쳐도 다시 돌아오겠습니다.',{exact:true}).waitFor();
  await demo.screenshot({ path:'test-results/results.png',fullPage:true });
  await demo.locator('#next-season').click(); await submit(demo,'next-form');
  await demo.locator('#ready').waitFor();
  assert.equal(await demo.locator('.promise-card').count(),4);
  await demo.locator('[data-action=demo-ready]').click();
  await ready(demo);
  await demo.locator('#start-season').click(); await submit(demo,'start-form');
  await demo.waitForFunction(() => document.querySelector('#my-count')?.textContent === '0');
  await tab(demo,'results'); await demo.locator('#history').selectOption({ index:1 });
  await demo.locator('.rank-row').first().waitFor();
  assert.equal(await demo.locator('#next-season').count(),0);
  await host.goto(base); await signup(host,'browser-host','민지');
  await host.locator('main [data-action=create]').click();
  await host.locator('#create-form [name=name]').fill('함께 지키는 브라우저 약속'); await submit(host,'create-form');
  await host.locator('[data-action=invite]').click(); const link = await host.locator('#invite-link').inputValue();
  await host.locator('[data-action=close]').click();
  await friend.goto(link); await signup(friend,'browser-friend','준호');
  await friend.locator('[data-action=join-invite]').click(); await friend.locator('.promise-card').first().waitFor();
  await host.reload(); await goal(host,true); await goal(friend);
  await host.reload(); await ready(host); await friend.reload(); await ready(friend);
  await host.waitForFunction(() => !document.querySelector('#start-season')?.disabled);
  await host.locator('#start-season').click(); await submit(host,'start-form');
  await host.locator('#record-today').click(); await host.locator('#timer-toggle').click();
  await host.getByRole('button',{name:'일시정지',exact:true}).waitFor();
  time += 61000; await host.reload(); await host.locator('#record-today').click();
  assert.match(await host.locator('#timer-display').textContent(),/^01:/);
  await host.locator('#record-note').fill('한 문장을 골라 오늘의 기록을 남겼어요.'); await host.locator('#record-form [name=honest]').check();
  await submit(host,'record-form');
  await host.waitForFunction(() => document.querySelector('#my-count')?.textContent === '1');
  await friend.reload(); await friend.locator('.feed-note').first().waitFor();
  assert.match(await friend.locator('.feed-note').first().textContent(),/오늘의 기록/);
  await friend.locator('[data-report]').first().click(); await friend.locator('#report-form [name=reason]').fill('제출한 문장 내용을 함께 확인하고 싶어요.'); await submit(friend,'report-form');
  await friend.locator('[data-resolve]').first().click(); await friend.locator('#resolve-form [name=reason]').fill('잠긴 완료 조건에 맞는 기록을 확인했어요.'); await submit(friend,'resolve-form');
  await friend.locator('.badge').filter({hasText:'약속 완료'}).first().waitFor();
  await host.reload(); await tab(host,'promises');
  assert.equal(await host.locator('[data-action=goal]').count(),0);
  await noOverflow(host,390); await host.screenshot({path:'test-results/real-promises-mobile.png',fullPage:true});
  await noOverflow(host,320);
  time = deadline('2026-10-24','00:00'); await host.reload(); await tab(host,'results');
  await host.locator('.rank-row').first().waitFor();
  await host.locator('#next-season').click(); await submit(host,'next-form');
  await host.locator('#ready').waitFor(); assert.equal(await host.locator('#start-season').isDisabled(),true);
  await host.locator('[data-action=logout]:visible').first().click(); await host.locator('#auth-form').waitFor();
  await noOverflow(host,320);
  assert.deepEqual(errors,[]);
  console.log('Browser passed: isolated demo full season + restart/archive; two real accounts invite/agree/start/server timer/record/report/review; persistence; safe text; desktop and 390/320px.');
} catch(e) { await host.screenshot({path:'test-results/failure-host.png',fullPage:true}).catch(()=>{}); await demo.screenshot({path:'test-results/failure-demo.png',fullPage:true}).catch(()=>{}); throw e; }
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
