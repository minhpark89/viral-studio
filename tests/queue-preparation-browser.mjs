import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const root = path.resolve('.verification', `queue-preparation-ui-${Date.now()}`);
const studio = await startServer({ port: 0, dataDir: root });
const store = studio.store;
const project = store.state.projects[0];
const other = store.createProject('Other project');
store.state.settings.queuePaused = true;
store.state.jobs = [];
const research = store.add('researchResults', { projectId: project.id, headline: 'Bitcoin queue visibility QA', topic: 'Bitcoin', articles: [], warnings: [] });
const batch = store.add('productionBatches', {
  projectId: project.id, status: 'preparing', warnings: [], sources: [],
  request: { researchId: research.id, projectId: project.id, topic: 'Bitcoin queue visibility QA', contentType: 'news', count: 3 },
  items: [
    { index: 0, researchId: research.id, status: 'preparing', stage: 'Đang tìm ảnh liên quan' },
    { index: 1, researchId: research.id, status: 'pending' },
    { index: 2, researchId: research.id, status: 'failed', error: 'Image service offline QA' },
  ],
});
store.add('productionBatches', { projectId: other.id, status: 'preparing', request: { topic: 'Hidden other project', contentType: 'news' }, items: [{ index: 0, status: 'preparing' }] });
store.save();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const report = { passed: false, root, checks: [], errors: [] };
page.on('pageerror', e => report.errors.push(e.message));
const card = page.locator(`[data-preparation-batch-id="${batch.id}"]`);
const queueTab = label => page.locator('.queue-page .segmented').getByRole('button', { name: label, exact: true });
try {
  await page.goto(studio.address);
  await page.locator('nav').getByRole('button', { name: 'Hàng đợi', exact: true }).click();
  await queueTab('Đang xử lý').click();
  await card.getByText('Đang tìm ảnh liên quan · Video 1/3', { exact: true }).waitFor();
  assert.equal(await page.getByText('Hàng đợi trống', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Hidden other project', { exact: true }).count(), 0);
  assert.match(await page.locator('.queue-stats').innerText(), /1 đang chạy/);
  assert.match(await card.innerText(), /2 video chưa vào/);
  report.checks.push('Preparing and pending items appear immediately in Active, scoped to project, without contradictory empty state');
  batch.items[0].stage = 'Đang viết lời đọc cho MC'; store.save();
  await card.getByText('Đang viết lời đọc cho MC · Video 1/3', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'preparing.png'), fullPage: true });
  report.checks.push('Preparation stage updates live over SSE');

  await queueTab('Có lỗi').click();
  await card.getByText(/Image service offline QA/).waitFor();
  let retried = false;
  await page.route(`**/api/production/batches/${batch.id}/retry`, async route => {
    assert.equal(route.request().method(), 'POST'); retried = true;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(batch) });
  });
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/production/batches/${batch.id}/retry`)),
    card.getByRole('button', { name: 'Thử lại bước chuẩn bị', exact: true }).click(),
  ]);
  assert.equal(retried, true);
  await page.screenshot({ path: path.join(root, 'failed.png'), fullPage: true });
  report.checks.push('Failure before a render job is visible in Errors and retry targets the exact batch');

  await page.getByLabel('Tìm tác vụ').fill('unmatched headline');
  await page.getByText('Hàng đợi trống', { exact: true }).waitFor();
  assert.equal(await card.count(), 0);
  await page.getByLabel('Tìm tác vụ').fill('Bitcoin');
  await card.waitFor();
  await queueTab('Product').click();
  await page.getByText('Hàng đợi trống', { exact: true }).waitFor();
  await queueTab('News').click();
  await card.waitFor();
  report.checks.push('Search and content-type filters apply to preparation failures');

  const linkedJob = store.add('jobs', { projectId: project.id, type: 'news', name: 'Bitcoin ready for MC', status: 'queued', progress: 0, payload: {}, logs: [], production: { batchId: batch.id, itemIndex: 0, contentType: 'news', researchId: research.id } });
  batch.items[0].status = 'queued'; batch.items[0].jobId = linkedJob.id;
  batch.items[1].status = 'failed'; batch.items[1].error = 'Second preparation QA';
  store.save();
  await queueTab('Đang xử lý').click();
  await page.getByText('Bitcoin ready for MC', { exact: true }).waitFor();
  assert.equal(await card.count(), 0);
  assert.equal(await page.getByText('Hàng đợi trống', { exact: true }).count(), 0);
  report.checks.push('Queued job replaces preparation without duplicate cards');
  await queueTab('Có lỗi').click();
  await card.getByRole('button', { name: 'Mở lượt render', exact: true }).click();
  await page.getByTestId('render-record').waitFor();
  assert.equal(await page.getByTestId('render-record').getAttribute('data-production-batch-id'), batch.id);
  report.checks.push('Open render navigates to the correct preparation batch');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1;
  await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(path.resolve('.verification/queue-preparation-ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await studio.close();
}
