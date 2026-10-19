import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : new URL('../../../onequeue-mcp/node_modules/playwright/index.mjs', import.meta.url).href);
const server = await createApp({ database: ':memory:' }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
await mkdir('test-results', { recursive: true });
const closeDetail = () => page.locator('[data-close="detail-dialog"]').click();
async function openBook(title) { await page.getByRole('button', { name: `${title} 자세히`, exact: true }).click(); }
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('나의 첫 책장을 채워볼까요?', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/empty.png', fullPage: true });
  await page.locator('#add-book').click(); await page.locator('#book-title').fill('마음에 남은 책'); await page.locator('#book-author').fill('테스트 저자'); await page.locator('#book-total').fill('200');
  await page.locator('#book-form button[type=submit]').click(); await page.getByText('마음에 남은 책', { exact: true }).first().waitFor();
  await openBook('마음에 남은 책'); await page.locator('#start-reading').click();
  await page.waitForFunction(() => document.querySelector('#detail-status').textContent === '읽는 중');
  await page.locator('#read-pages').fill('75'); await page.locator('#progress-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#detail-percent').textContent === '38%');
  await page.locator('#rating').selectOption('5'); await page.locator('#book-note').fill('오래 기억하고 싶은 문장 <img src=x onerror=alert(1)>'); await page.locator('#review-form button[type=submit]').click();
  await page.getByText('책을 덮고 남은 마음을 저장했어요.', { exact: true }).waitFor();
  await closeDetail(); await page.reload(); await openBook('마음에 남은 책');
  assert.equal(await page.locator('#read-pages').inputValue(), '75'); assert.equal(await page.locator('#rating').inputValue(), '5'); assert.match(await page.locator('#book-note').inputValue(), /오래 기억/);
  await page.locator('#edit-book').click(); await page.locator('#book-title').fill('수정한 책 제목'); await page.locator('#book-form button[type=submit]').click(); await page.getByText('수정한 책 제목', { exact: true }).first().waitFor();
  await page.locator('#finish-reading').click(); await page.waitForFunction(() => document.querySelector('#detail-status').textContent === '다 읽은'); await closeDetail();
  await page.locator('[data-filter=done]').click(); assert.equal(await page.locator('.book-card').count(), 1);
  await page.locator('#search').fill('없는 제목'); assert.equal(await page.locator('.book-card').count(), 0);
  await page.locator('#clear-search').click(); assert.equal(await page.locator('.book-card').count(), 1);
  await page.locator('[data-view=notes]').click(); assert.equal(await page.locator('.note-card').count(), 1); assert.equal(await page.locator('.note-card img').count(), 0);
  await page.locator('.note-card').click(); assert.equal(await page.locator('#rating').inputValue(), '5'); await closeDetail();
  await page.locator('#edit-goal').click(); await page.locator('#goal-input').fill('18'); await page.locator('#goal-form button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#goal-total').textContent === '18');
  const downloading = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloading;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(exported.goal, 18); assert.equal(exported.books[0].pages, 200); assert.equal(exported.books[0].rating, 5);
  await page.locator('[data-view=library]').click(); await openBook('수정한 책 제목');
  await page.locator('#delete-book').click(); await page.locator('#cancel-delete').click(); assert.equal(await page.locator('#delete-confirm').isVisible(), false);
  await page.locator('#delete-book').click(); await page.locator('#confirm-delete').click(); await page.getByText('나의 첫 책장을 채워볼까요?', { exact: true }).waitFor();
  await page.locator('#sample-books').click(); await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 4); assert.equal(await page.locator('.sample-tag').count(), 4);
  await page.locator('#sort').selectOption('title');
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#toast').hidden = true; });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}px: ` + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).map(e => e.className).slice(0, 8))));
    if (width === 390) await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 }); await openBook('느리게 읽는 마음');
  await page.locator('#read-pages').fill('120'); await page.locator('#progress-form button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#detail-percent').textContent === '50%');
  await page.screenshot({ path: 'test-results/mobile-detail.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: create/edit/delete, progress and completion, note/rating persistence, search/filters, goal, export, safe text, labeled examples, desktop and 390/320px mobile.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
