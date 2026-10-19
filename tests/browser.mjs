import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const server = await createApp({ database: ':memory:' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const first = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const second = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const host = await first.newPage(), friend = await second.newPage();
const errors = [];
for (const page of [host, friend]) page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
async function register(page, username, name) {
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="username"]').fill(username);
  await page.locator('[name="password"]').fill('browser-test-only-123');
  await page.locator('[name="confirmation"]').fill('browser-test-only-123');
  await page.getByRole('button', { name: '계정 만들기' }).click();
  await page.locator('.main-shell').waitFor();
}
async function goal(page, kind, title, frequency) {
  await page.getByRole('button', { name: /내 약속 정하기|내 목표 설정/ }).click();
  await page.locator('dialog [name="category"]').selectOption(kind);
  await page.locator('dialog [name="title"]').fill(title);
  await page.locator('dialog [name="frequency"]').fill(String(frequency));
  await page.locator('dialog [name="proof"]').fill('타이머 기록에서 시간을 확인하고 실천 내용 적기');
  await page.locator('dialog [name="reviewed"]').check();
  await page.getByRole('button', { name: '목표 제출하기' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
}
async function reopen(page) {
  await page.reload();
  await page.getByRole('button', { name: /브라우저 친구방/ }).click();
}
async function review(page) {
  await page.locator('nav').getByRole('button', { name: '친구방', exact: true }).click();
  await page.getByRole('button', { name: '목표 확인하기', exact: true }).click();
  await page.locator('dialog [name="reviewed"]').check();
  await page.getByRole('button', { name: '이 목표 확인하기' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
}
try {
  assert.equal((await host.goto(base)).status(), 200);
  await host.getByRole('button', { name: '회원가입', exact: true }).waitFor();
  await host.screenshot({ path: 'test-results/auth-desktop.png', fullPage: true });
  await register(host, 'browser-host', '민지');
  await host.getByRole('button', { name: '친구방 만들기 +', exact: true }).click();
  await host.locator('dialog [name="name"]').fill('브라우저 친구방');
  await host.locator('dialog').getByRole('button', { name: '친구방 만들기', exact: true }).click();
  await host.getByRole('button', { name: '친구 초대' }).click();
  const link = await host.locator('#invite-link').inputValue();
  await host.getByRole('button', { name: '닫기', exact: true }).click();
  await friend.goto(link);
  await register(friend, 'browser-friend', '준호');
  await friend.getByRole('button', { name: '초대받은 방 참여하기' }).click();
  await friend.getByRole('button', { name: '내 목표 설정' }).waitFor();
  await reopen(host);
  assert.equal(await host.getByRole('button', { name: '모두 함께 시작하기' }).isDisabled(), true);
  await goal(host, 'study', '매일 영어 듣기 공부하기', 7);
  await goal(friend, 'exercise', '꾸준히 30분 달리기', 4);
  await reopen(host);
  await review(host);
  await review(friend);
  await host.getByRole('button', { name: '모두 함께 시작하기' }).waitFor();
  // Polling shares approval changes without a refresh.
  await host.waitForFunction(() => !document.querySelector('[data-action="start"]').disabled, null, { timeout: 12000 });
  await host.getByRole('button', { name: '모두 함께 시작하기' }).click();
  await host.getByRole('button', { name: '지금 함께 시작하기' }).click();
  await host.locator('dialog').waitFor({ state: 'hidden' });
  await host.locator('nav').getByRole('button', { name: '나의 7일' }).click();
  await host.getByRole('button', { name: '오늘 인증하기' }).click();
  await host.locator('dialog [name="note"]').fill('30분 동안 영어 듣기를 하고 학습 노트에 요약을 적었어요.');
  await host.getByRole('button', { name: '실천 기록 저장하기' }).click();
  await host.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(await host.locator('.record').count(), 1);
  assert.equal(await host.getByRole('button', { name: '인증 완료 / 대기' }).isDisabled(), true);
  await friend.getByRole('button', { name: '인증 기록 1개 보기' }).waitFor({ timeout: 12000 });
  await friend.getByRole('button', { name: '인증 기록 1개 보기' }).click();
  assert.match(await friend.locator('dialog').innerText(), /영어 듣기를 하고/);
  await friend.getByRole('button', { name: '닫기', exact: true }).click();
  await friend.getByRole('button', { name: '민지 응원', exact: true }).click();
  await friend.locator('nav').getByRole('button', { name: '우리 리그' }).click();
  assert.equal(await friend.locator('tbody tr').count(), 2);
  assert.match(await friend.locator('tbody tr').first().innerText(), /민지/);
  await host.screenshot({ path: 'test-results/shared-desktop.png', fullPage: true });
  await host.setViewportSize({ width: 390, height: 844 });
  for (const name of ['나의 7일', '친구방', '우리 리그']) {
    await host.locator('nav').getByRole('button', { name, exact: true }).click();
    assert.equal(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Mobile overflow: ${name}`);
  }
  await host.locator('nav').getByRole('button', { name: '친구방', exact: true }).click();
  await host.screenshot({ path: 'test-results/shared-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: two accounts, invitation, shared goal review, polling, common start, record sharing, ranking, mobile layout.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
