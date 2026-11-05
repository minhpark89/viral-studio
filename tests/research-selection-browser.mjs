import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const root = path.resolve('.verification', `research-selection-${Date.now()}`);
const studio = await startServer({ port: 0, dataDir: root }); const store = studio.store;
const project = store.state.projects[0]; store.state.settings.queuePaused = true;
const stories = Array.from({ length: 27 }, (_, index) => store.add('researchResults', {
  projectId: project.id, topic: `Story ${String(index + 1).padStart(2, '0')}`, headline: `Selection story ${String(index + 1).padStart(2, '0')}`,
  niche: 'Selection QA', contentSource: 'llm', articles: [], warnings: [], imageQueries: [],
  createdAt: new Date(Date.now() - index * 1000).toISOString(),
}));
stories.forEach((story, index) => { story.createdAt = new Date(Date.now() - index * 1000).toISOString(); });
const active = stories[25]; const preparing = stories[26];
store.add('jobs', { projectId: project.id, status: 'queued', type: 'news', name: 'Active QA', payload: {}, production: { researchId: active.id }, logs: [] });
store.add('productionBatches', { projectId: project.id, status: 'preparing', request: { contentType: 'news', researchId: preparing.id }, items: [{ index: 0, status: 'preparing', researchId: preparing.id }] });
const keepJobs = structuredClone(store.state.jobs);
const avatar = store.add('media', { projectId: project.id, kind: 'image', name: 'Selected MC', mediaType: 'mc-image', file: path.join(root, 'mc.png') });
const otherProject = store.createProject('Other project');
const foreign = store.add('researchResults', { projectId: otherProject.id, headline: 'Other project story' });
store.save();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
const report = { passed: false, root, checks: [], errors: [], renderRequests: [], deleteRequests: 0 };
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('/api/research/delete')) report.deleteRequests++; });
let acceptDelete = true; let dialogCount = 0;
page.on('dialog', dialog => { dialogCount++; return acceptDelete ? dialog.accept() : dialog.dismiss(); });
const card = story => page.locator(`[data-research-id="${story.id}"]`);
const toolbar = page.getByRole('region', { name: 'Chọn và xử lý tin', exact: true });
const goResearch = async () => { await page.locator('nav').getByRole('button', { name: 'Research & News', exact: true }).click(); await toolbar.waitFor(); };
const count = n => page.waitForFunction(value => document.querySelectorAll('.research-result-card').length === value, n);
try {
  await page.route('**/api/production/batches', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON(); report.renderRequests.push(request);
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: randomUUID(), items: Array.from({ length: request.count }, (_, index) => ({ index, status: 'pending' })) }) });
  });
  await page.goto(studio.address); await goResearch(); await count(12);
  assert.equal(await page.locator('.research-result-card.is-compact').count(), 12);
  await toolbar.getByRole('checkbox', { name: 'Chọn trang này', exact: true }).check();
  await toolbar.getByText('12 tin đã chọn · 27 tin trong bộ lọc', { exact: true }).waitFor();
  await card(stories[0]).getByRole('checkbox', { name: 'Chọn tin', exact: true }).uncheck();
  assert.equal(await toolbar.getByRole('checkbox', { name: 'Chọn trang này', exact: true }).evaluate(input => input.indeterminate), true);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await card(stories[12]).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  await toolbar.getByText('12 tin đã chọn · 27 tin trong bộ lọc', { exact: true }).waitFor();
  await page.getByLabel('Số tin mỗi trang').selectOption('48'); await count(27);
  assert.equal(await page.locator('.research-result-card.is-selected').count(), 12);
  report.checks.push('Compact rows, partial page checkbox, cross-page selection and page-size changes preserve exact selection');
  await toolbar.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click();
  assert.equal(await toolbar.getByRole('button', { name: 'Xóa 0 tin đã chọn', exact: true }).isDisabled(), true);
  await page.getByLabel('Tìm tin Research', { exact: true }).fill('story 0'); await count(9);
  await toolbar.getByRole('button', { name: 'Chọn tất cả 9 tin theo bộ lọc', exact: true }).click();
  await toolbar.getByText('9 tin đã chọn · 9 tin trong bộ lọc', { exact: true }).waitFor();
  await page.getByLabel('Tìm tin Research', { exact: true }).fill('story 1'); await count(10);
  await toolbar.getByText('0 tin đã chọn · 10 tin trong bộ lọc', { exact: true }).waitFor();
  report.checks.push('Select-all targets only current filter, clear works, changing filter clears previous selection');

  await page.getByLabel('Tìm tin Research', { exact: true }).fill(''); await count(27);
  for (const story of [stories[0], stories[1], active, preparing]) await card(story).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  assert.equal(await card(active).getByRole('button', { name: 'Xóa tin', exact: true }).isDisabled(), true);
  assert.equal(await card(preparing).getByRole('button', { name: 'Xóa tin', exact: true }).isDisabled(), true);
  await toolbar.screenshot({ path: path.join(root, 'bulk-selection.png') });
  await toolbar.getByRole('button', { name: 'Xóa 4 tin đã chọn', exact: true }).click(); await count(25);
  assert.equal(dialogCount, 1); assert.equal(report.deleteRequests, 1);
  assert.equal(store.state.researchResults.some(result => result.id === stories[0].id), false);
  assert.ok(store.state.researchResults.some(result => result.id === active.id));
  assert.ok(store.state.researchResults.some(result => result.id === preparing.id));
  assert.ok(store.state.researchResults.some(result => result.id === foreign.id));
  assert.deepEqual(store.state.jobs, keepJobs);
  report.checks.push('One confirmed API request deletes selected idle stories and preserves both active stages, other projects and existing jobs');
  const legacy = await fetch(studio.address + '/api/research/' + preparing.id, { method: 'DELETE' });
  assert.equal(legacy.status, 409);
  report.checks.push('Legacy single-delete API also rejects a story still preparing before job creation');

  acceptDelete = false;
  await card(stories[2]).getByRole('button', { name: 'Xóa tin', exact: true }).click();
  assert.equal(report.deleteRequests, 1); assert.equal(await card(stories[2]).count(), 1);
  acceptDelete = true;
  await card(stories[2]).getByRole('button', { name: 'Xóa tin', exact: true }).click(); await count(24);
  assert.equal(report.deleteRequests, 2); assert.equal(await card(stories[3]).count(), 1);
  report.checks.push('Per-story delete supports cancellation and removes only its target even when other stories are selected');

  await toolbar.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click();
  for (const story of [stories[3], stories[4], active]) await card(story).getByRole('checkbox', { name: 'Chọn tin', exact: true }).check();
  await page.locator('.research-render-settings').evaluate(element => { element.open = true; });
  await page.getByLabel('Ảnh MC cho cả lô', { exact: true }).selectOption(avatar.id);
  await page.getByLabel('Số video mỗi tin', { exact: true }).fill('2');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/production/batches') && response.request().method() === 'POST'), toolbar.getByRole('button', { name: 'Render 2 tin chưa có video · 4 video', exact: true }).click()]);
  assert.equal(await page.locator('.research-page').count(), 1);
  assert.deepEqual(report.renderRequests.at(-1).researchIds, [stories[3].id, stories[3].id, stories[4].id, stories[4].id]);
  assert.equal(report.renderRequests.at(-1).avatarMediaId, avatar.id);
  report.checks.push('Bulk render submits exactly the selected eligible stories, per-story counts and MC, skipping active story');

  await goResearch();
  await page.getByLabel('Số video mỗi tin', { exact: true }).fill('1');
  await page.getByLabel('Ảnh MC cho cả lô', { exact: true }).selectOption(avatar.id);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/production/batches') && response.request().method() === 'POST'), card(stories[5]).getByRole('button', { name: 'Render 1 video', exact: true }).click()]);
  assert.equal(await page.locator('.research-page').count(), 1);
  assert.equal(report.renderRequests.at(-1).researchId, stories[5].id); assert.equal(report.renderRequests.at(-1).avatarMediaId, avatar.id);
  await goResearch();
  await card(stories[5]).getByRole('button', { name: 'Chi tiết & MC', exact: true }).click();
  await card(stories[5]).getByLabel('Ảnh MC cho tin này', { exact: true }).waitFor();
  await card(stories[5]).getByRole('button', { name: 'Thu gọn', exact: true }).click();
  await toolbar.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(root, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await toolbar.screenshot({ path: path.join(root, 'mobile-selection.png') });
  assert.deepEqual(report.errors, []);
  report.checks.push('Quick single render uses selected MC; per-story settings expand; desktop/mobile remain usable without script errors');
  report.passed = true;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1;
  await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(path.resolve('.verification/research-selection-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await studio.close();
}
