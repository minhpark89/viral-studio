import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const root = path.resolve('.verification', `research-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const studio = await startServer({ port: 0, dataDir: root });
const store = studio.store;
store.state.settings.queuePaused = true;
const project = store.state.projects[0];
const date = n => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;
const stories = [];
const story = (headline, extra = {}) => {
  const result = { id: randomUUID(), projectId: project.id, headline, topic: headline, niche: 'QA', contentSource: 'llm',
    createdAt: date(20), language: 'en', articles: [], imageQueries: [], warnings: [], ...extra };
  stories.push(result);
  return result;
};
for (let i = 1; i <= 25; i++) story(`Fresh story ${String(i).padStart(2, '0')}`, i === 1 ? { contentSource: 'feed' } : {});
const done = story('Finished available video');
const cleaned = story('Published video cleaned');
const broken = story('Failed preparation');
const running = story('Rendering in progress');
const partial = story('Partial render failure');
const job = (research, status, extra = {}) => ({ id: randomUUID(), projectId: project.id, type: 'news', status, progress: 0,
  createdAt: date(21), production: { researchId: research.id }, payload: { kind: 'video', provider: 'dreamface' }, ...extra });
const runningJob = job(running, 'rendering');
const doneJob = job(done, 'completed', { mediaId: randomUUID() });
const cleanedJob = job(cleaned, 'completed', { mediaId: randomUUID() });
const batch = (research, items) => ({ id: randomUUID(), projectId: project.id, status: 'failed', createdAt: date(21), updatedAt: date(21),
  request: { researchId: research.id, topic: research.topic, count: items.length, contentType: 'news', engine: 'dreamface' }, items });
const failedBatch = batch(broken, [{ index: 0, researchId: broken.id, status: 'failed', error: 'Preparation QA failed' }]);
const partialBatch = batch(partial, [{ index: 0, researchId: partial.id, status: 'completed' }, { index: 1, researchId: partial.id, status: 'failed', error: 'Second output failed' }]);
const videoFile = path.join(root, 'sample.mp4');
await promisify(execFile)(path.resolve('bin/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoFile], { windowsHide: true });
store.state.researchResults = stories;
store.state.jobs = [doneJob, cleanedJob, runningJob];
store.state.productionBatches = [failedBatch, partialBatch];
store.state.media = [{ id: doneJob.mediaId, projectId: project.id, name: 'QA final video', kind: 'video', generated: true, file: videoFile,
  createdAt: date(21), production: { researchId: done.id }, jobId: doneJob.id }];
store.state.settings.meta.publications = [{ id: randomUUID(), projectId: project.id, mediaIds: [cleanedJob.mediaId], status: 'published' }];
store.save();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const report = { passed: false, root, checks: [], errors: [], batches: [] };
page.on('pageerror', e => report.errors.push(e.message));
const cards = page.locator('.research-result-card');
const card = result => page.locator(`[data-research-id="${result.id}"]`);
const tab = name => page.locator('.research-status-tabs').getByRole('button', { name: new RegExp(`^${name}`) });
const goResearch = async () => {
  await page.locator('nav').getByRole('button', { name: 'Research & News', exact: true }).click();
  await page.locator('.research-manager').waitFor();
};
const waitCards = count => page.waitForFunction(n => document.querySelectorAll('.research-result-card').length === n, count);
try {
  await page.route('**/api/production/batches', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON();
    report.batches.push(...(request.researchIds || [request.researchId]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: randomUUID(), items: [{ index: 0, status: 'pending' }] }) });
  });
  await page.goto(studio.address);
  await goResearch();
  await waitCards(12);
  assert.equal(await tab('Cần xử lý').getAttribute('aria-pressed'), 'true');
  assert.equal(await tab('Cần xử lý').locator('b').innerText(), '28');
  assert.equal(await tab('Đã có video').locator('b').innerText(), '3');
  assert.equal(await tab('Đã đăng').locator('b').innerText(), '1');
  assert.equal(await card(done).count(), 0);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await page.getByText('Trang 2/3 · 28 tin', { exact: true }).waitFor();
  assert.equal(await cards.count(), 12);
  report.checks.push('Default work view hides completed history; counts and pagination match 30 stories');

  await page.getByLabel('Tìm tin Research', { exact: true }).fill('Fresh story 01');
  await waitCards(1);
  await page.getByText('Trang 1/1 · 1 tin', { exact: true }).waitFor();
  await page.getByLabel('Chất lượng nội dung').selectOption('llm');
  await waitCards(0);
  await page.getByLabel('Chất lượng nội dung').selectOption('needs-llm');
  await waitCards(1);
  await page.getByLabel('Chất lượng nội dung').selectOption('all');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/production/batches') && response.request().method() === 'POST'), page.getByRole('button', { name: 'Render 1 tin chưa có video', exact: true }).click()]);
  assert.equal(await page.locator('.research-page').count(), 1);
  assert.deepEqual(report.batches.splice(0), [stories[0].id]);
  report.checks.push('Search, quality filter and bulk render target only the matching story');

  await goResearch();
  await page.getByLabel('Tìm tin Research', { exact: true }).fill('');
  await tab('Tất cả').click();
  await page.getByLabel('Số tin mỗi trang').selectOption('48');
  await waitCards(30);
  await card(stories[1]).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  await card(done).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  await card(running).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/production/batches') && response.request().method() === 'POST'), page.getByRole('button', { name: 'Render 1 tin chưa có video', exact: true }).click()]);
  assert.equal(await page.locator('.research-page').count(), 1);
  assert.deepEqual(report.batches.splice(0), [stories[1].id]);
  report.checks.push('Mixed selection renders only selected unfinished idle stories, skipping completed and running ones');

  await goResearch();
  await tab('Đã đăng').click();
  await waitCards(1);
  assert.match(await card(cleaned).innerText(), /Đã render · 1 video/);
  assert.match(await card(cleaned).innerText(), /đã dọn khỏi thư viện/);
  assert.equal(await page.getByRole('button', { name: 'Render 0 tin chưa có video', exact: true }).isDisabled(), true);
  await tab('Đã có video').click();
  await card(done).getByRole('button', { name: 'Xem video', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] video')?.readyState >= 1);
  assert.equal(await page.getByRole('dialog').locator('video').getAttribute('src'), `/api/media/${doneJob.mediaId}/file`);
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).click();
  report.checks.push('Published cleaned video remains in history; available final video opens with playable metadata');

  await tab('Lỗi').click();
  await waitCards(2);
  await card(broken).getByRole('button', { name: 'Xem lượt render' }).click();
  const focusedRecord = page.locator('.research-render-history .production-batch.is-focused');
  await focusedRecord.waitFor();
  assert.equal(await focusedRecord.getAttribute('data-production-batch-id'), failedBatch.id);
  assert.equal(await page.locator('.research-page').count(), 1);
  await goResearch();
  await tab('Đang xử lý').click();
  await waitCards(1);
  assert.equal(await card(running).getByRole('button', { name: 'Render 1 video', exact: true }).isDisabled(), true);
  store.patch('jobs', runningJob.id, { status: 'completed', finishedAt: new Date().toISOString() });
  await waitCards(0);
  await tab('Đã có video').click();
  await waitCards(4);
  assert.match(await card(running).innerText(), /Đã render · 1 video/);
  report.checks.push('Failure opens the correct batch; live SSE completion updates filters and prevents duplicate render while active');

  await page.locator('.research-manager').screenshot({ path: path.join(root, 'filters.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  report.overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, className: el.className, parent: el.parentElement?.className, type: el.getAttribute('type'), text: el.textContent?.slice(0, 60), right: el.getBoundingClientRect().right })).filter(el => el.right > innerWidth + 1).slice(0, 15) }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.research-manager').screenshot({ path: path.join(root, 'filters-mobile.png') });
  assert.deepEqual(report.errors, []);
  report.checks.push('Desktop and narrow layout have no horizontal overflow or JavaScript errors');
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
  await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(path.resolve('.verification/research-ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await studio.close();
}
