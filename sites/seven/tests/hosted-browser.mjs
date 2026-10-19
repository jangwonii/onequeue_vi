import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const base = 'http://127.0.0.1:4174';
// Identity headers simulate the hosting gateway ONLY against this loopback preview.
assert.equal(new URL(base).hostname, '127.0.0.1');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const nonce = crypto.randomUUID();
const contexts = await Promise.all(['host', 'friend', 'stranger'].map(role => browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'oai-authenticated-user-id': `${nonce}-${role}`, 'oai-authenticated-user-email': `${role}@example.test` } })));
const [hostContext, friendContext, strangerContext] = contexts;
const host = await hostContext.newPage(), friend = await friendContext.newPage();
const errors = [];
for (const page of [host, friend]) page.on('pageerror', error => errors.push(error.message));
await mkdir('outputs', { recursive: true });
async function profile(page, name) { await page.locator('[name="name"]').fill(name); await page.getByRole('button', { name: '이 이름으로 시작하기' }).click(); await page.locator('.main-shell').waitFor(); }
async function goal(page, type, frequency) {
  await page.getByRole('button', { name: /내 약속 정하기|내 목표 설정/ }).click();
  await page.locator('dialog [name="category"]').selectOption(type);
  await page.locator('dialog [name="title"]').fill(type === 'study' ? '매일 영어 듣기 공부하기' : '주 4회 30분 달리기');
  await page.locator('dialog [name="frequency"]').fill(String(frequency));
  await page.locator('dialog [name="proof"]').fill('타이머에서 30분 기록을 확인하고 실천 내용 적기');
  await page.locator('dialog [name="reviewed"]').check();
  await page.getByRole('button', { name: '목표 제출하기' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
}
async function review(page) {
  await page.locator('nav').getByRole('button', { name: '친구방', exact: true }).click();
  await page.getByRole('button', { name: '목표 확인하기', exact: true }).click();
  await page.locator('dialog [name="reviewed"]').check();
  await page.getByRole('button', { name: '이 목표 확인하기' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
}
try {
  const anonymous = await browser.newContext(); const landing = await anonymous.newPage();
  await landing.goto(base);
  const login = landing.getByRole('link', { name: 'ChatGPT로 로그인' });
  await login.waitFor(); assert.match(await login.getAttribute('href'), /^\/signin-with-chatgpt\?/);
  assert.equal((await anonymous.request.get(`${base}/api/rooms`)).status(), 401);
  await landing.screenshot({ path: 'outputs/landing.png', fullPage: true });
  await host.goto(base); await profile(host, '민지');
  await host.getByRole('button', { name: '친구방 만들기 +', exact: true }).click();
  await host.locator('dialog [name="name"]').fill('함께하는 7일');
  await host.locator('dialog').getByRole('button', { name: '친구방 만들기', exact: true }).click();
  await host.getByRole('button', { name: '친구 초대' }).click();
  const link = await host.locator('#invite-link').inputValue();
  await host.getByRole('button', { name: '닫기', exact: true }).click();
  await friend.goto(link); await profile(friend, '준호');
  await friend.getByRole('button', { name: '초대받은 방 참여하기' }).click();
  await friend.getByRole('button', { name: '내 목표 설정' }).waitFor();
  await goal(host, 'study', 7); await goal(friend, 'exercise', 4);
  await host.getByRole('button', { name: '준호 응원', exact: true }).waitFor({ timeout: 12000 });
  await review(host); await review(friend);
  await host.waitForFunction(() => !document.querySelector('[data-action="start"]').disabled, null, { timeout: 12000 });
  const rooms = await (await hostContext.request.get(`${base}/api/rooms`)).json();
  const id = rooms.rooms[0].id;
  await strangerContext.request.post(`${base}/api/profile`, { data: { name: '다른 사람' } });
  assert.equal((await strangerContext.request.get(`${base}/api/rooms/${id}`)).status(), 404);
  assert.equal((await friendContext.request.post(`${base}/api/rooms/${id}/start`, { data: {} })).status(), 403);
  await host.getByRole('button', { name: '모두 함께 시작하기' }).click();
  await host.getByRole('button', { name: '지금 함께 시작하기' }).click();
  await host.locator('dialog').waitFor({ state: 'hidden' });
  await host.locator('nav').getByRole('button', { name: '나의 7일' }).click();
  await host.getByRole('button', { name: '오늘 인증하기' }).click();
  await host.locator('dialog [name="note"]').fill('30분 영어 듣기 후 중요한 문장을 노트에 기록했어요.');
  await host.getByRole('button', { name: '실천 기록 저장하기' }).click();
  await host.locator('dialog').waitFor({ state: 'hidden' });
  await friend.getByRole('button', { name: '인증 기록 1개 보기' }).waitFor({ timeout: 12000 });
  await friend.getByRole('button', { name: '인증 기록 1개 보기' }).click();
  assert.match(await friend.locator('dialog').innerText(), /중요한 문장을 노트에/);
  await friend.getByRole('button', { name: '닫기', exact: true }).click();
  const payload = { note: '운동 앱에서 30분 달리기 기록을 확인했어요.', minutes: 30, day: '2000-01-01' };
  const concurrent = await Promise.all([friendContext.request.post(`${base}/api/rooms/${id}/record`, { data: payload }), friendContext.request.post(`${base}/api/rooms/${id}/record`, { data: payload })]);
  assert.deepEqual(concurrent.map(r => r.status()).sort(), [200, 400]);
  assert.equal((await hostContext.request.post(`${base}/api/rooms/${id}/goal`, { data: {} })).status(), 409);
  assert.equal((await strangerContext.request.post(`${base}/api/join`, { data: { invite: new URL(link).hash.slice(8) } })).status(), 409);
  assert.equal((await hostContext.request.post(`${base}/api/rooms/${id}/cheer`, { data: { active: true, targetId: `${nonce}-friend` }, headers: { Origin: 'https://other.invalid' } })).status(), 403);
  await host.screenshot({ path: 'outputs/dashboard.png', fullPage: true });
  await host.setViewportSize({ width: 390, height: 844 });
  for (const name of ['나의 7일', '친구방', '우리 리그']) { await host.locator('nav').getByRole('button', { name, exact: true }).click(); assert.equal(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
  await host.screenshot({ path: 'outputs/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Cloud runtime checks passed: anonymous landing, identity boundary, two users, invitation, mutual approval, shared start, live records, D1 concurrent writes, locked goals, no late joins, origin protection, mobile layout.');
} finally { await browser.close(); }
