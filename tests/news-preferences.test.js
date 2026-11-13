import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/index.js';
import { Store } from '../server/store.js';
import { productionBatchProgress } from '../shared/production-progress.js';

test('project News choices persist across restart, reject invalid values and leave submitted batches unchanged', async t => {
  const root = path.resolve('.verification', 'project-news-' + randomUUID());
  const server = await startServer({ port: 0, dataDir: root }), store = server.store;
  let closed = false;
  t.after(async () => { if (!closed) await server.close(); assert(root.startsWith(path.resolve('.verification') + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const project = store.state.projects[0], other = store.createProject('Independent project');
  const timeline = structuredClone(project.timeline);
  const batch = store.add('productionBatches', { projectId: project.id, request: { contentType: 'news', newsRenderStyle: 'classic', count: 1 }, status: 'completed', items: [{ index: 0, status: 'completed' }] });
  const savedBatch = structuredClone(batch);
  const options = { newsRenderStyle: 'v3-fast', newsDuration: 20, newsImageCount: 10, newsVisualPolicy: 'require-photos', fontStyle: 'viral' };
  const patch = value => fetch(server.address + '/api/projects/' + project.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newsVideoOptions: value }) });
  assert.equal((await patch(options)).status, 200);
  assert.equal((await patch({ ...options, newsRenderStyle: 'unknown' })).status, 400);
  assert.equal((await patch({ ...options, newsImageCount: 999 })).status, 400);
  assert.deepEqual(project.newsVideoOptions, options);
  assert.deepEqual(project.timeline, timeline);
  assert.equal(other.newsVideoOptions, undefined);
  assert.deepEqual(batch, savedBatch);
  await server.close(); closed = true;
  const reopened = new Store(root);
  assert.deepEqual(reopened.require('projects', project.id).newsVideoOptions, options);
  assert.deepEqual(reopened.require('productionBatches', batch.id), savedBatch);
});

test('Research and Render progress count the latest retry once and retain completed outputs after cleanup', () => {
  const batch = { id: 'batch', request: { count: 3 }, items: [
    { index: 0, jobId: 'old', status: 'failed', error: 'Old failure' },
    { index: 1, jobId: 'second', status: 'queued' },
    { index: 2, status: 'failed', error: 'No source image' },
  ] };
  const jobs = [
    { id: 'retry', status: 'completed', production: { batchId: 'batch', itemIndex: 0 }, createdAt: '2026-11-05T02:00:00Z' },
    { id: 'old', status: 'failed', production: { batchId: 'batch', itemIndex: 0 }, createdAt: '2026-11-05T01:00:00Z' },
    { id: 'second', status: 'rendering', production: { batchId: 'batch', itemIndex: 1 } },
  ];
  const progress = productionBatchProgress(batch, jobs);
  assert.deepEqual([progress.total, progress.complete, progress.active, progress.failed], [3, 1, 1, 1]);
  assert.equal(progress.canRetryPreparation, true);
  assert.equal(progress.slots[0].job.id, 'retry');
});

test('provider failures stay actionable in Queue and do not masquerade as preparation retries', () => {
  const batch = { id: 'batch', items: [{ index: 0, jobId: 'job', status: 'failed' }] };
  const progress = productionBatchProgress(batch, [{ id: 'job', status: 'failed', error: 'MC render failed' }]);
  assert.equal(progress.failed, 1); assert.equal(progress.canRetryPreparation, false);
  assert.equal(progress.slots[0].error, 'MC render failed');
});
