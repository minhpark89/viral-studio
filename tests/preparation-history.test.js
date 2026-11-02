import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { ProductionService } from '../server/production.js';
import { productionPreparations } from '../shared/queue-preparation.js';

test('opening the app preserves historical failure dates instead of making them look new', async t => {
  const root = path.resolve('.verification', 'preparation-history-' + randomUUID());
  const store = new Store(root); const project = store.createProject('History');
  const batch = store.add('productionBatches', { projectId: project.id, request: { contentType: 'news', topic: 'Old report' }, status: 'failed', items: [{ index: 0, status: 'failed', error: 'LLM returned HTTP 503.' }] });
  batch.createdAt = batch.updatedAt = '2026-10-27T16:59:03.000Z'; store.save();
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); const service = new ProductionService(store, queue);
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const [entry] = productionPreparations(store.state, project.id);
  assert.equal(entry.createdAt, batch.createdAt); assert.equal(entry.activityAt, batch.createdAt);
  assert.equal(batch.updatedAt, '2026-10-27T16:59:03.000Z');
});

test('retry records current activity, keeps original creation date and hands off to a single new job', async t => {
  const root = path.resolve('.verification', 'preparation-retry-date-' + randomUUID());
  const store = new Store(root); const project = store.createProject('Retry');
  store.state.settings.llm.enabled = true; store.state.settings.queuePaused = true;
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); let failing = true;
  const service = new ProductionService(store, queue, { llm: async () => {
    if (failing) throw new Error('Temporary provider failure');
    return { productName: 'Desk lamp', productBrief: 'Adjustable desk lamp', prompt: 'Show the supplied desk lamp from a different camera angle.' };
  } });
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const batch = service.create({ requestId: randomUUID(), projectId: project.id, contentType: 'product', autoResearch: false, productName: 'Desk lamp', count: 1 });
  await service.worker;
  assert.equal(batch.items[0].status, 'failed');
  assert.ok(batch.items[0].preparationStartedAt); assert.ok(batch.items[0].preparationFinishedAt);
  batch.createdAt = batch.updatedAt = '2026-10-27T16:59:03.000Z';
  for (const key of ['updatedAt', 'preparationStartedAt', 'preparationFinishedAt', 'stageUpdatedAt']) delete batch.items[0][key];
  failing = false;
  const before = Date.now(); service.retry(batch.id);
  const [entry] = productionPreparations(store.state, project.id);
  assert.equal(entry.createdAt, '2026-10-27T16:59:03.000Z');
  assert.ok(Date.parse(entry.activityAt) >= before);
  await service.worker;
  assert.equal(batch.items[0].status, 'queued'); assert.ok(Date.parse(batch.items[0].preparationFinishedAt) >= before);
  assert.equal(productionPreparations(store.state, project.id).length, 0);
  assert.equal(store.state.jobs.length, 1);
  const lastActivity = batch.updatedAt; service.retry(batch.id); await service.worker;
  assert.equal(store.state.jobs.length, 1); assert.equal(batch.updatedAt, lastActivity);
});

test('queue orders an old retried batch by its actual item activity', () => {
  const item = { index: 0, status: 'failed', error: 'Failure' };
  const data = { jobs: [], productionBatches: [
    { id: 'older', projectId: 'p', createdAt: '2026-10-27T00:00:00Z', items: [{ ...item, updatedAt: '2026-11-02T02:00:00Z' }] },
    { id: 'yesterday', projectId: 'p', createdAt: '2026-11-01T00:00:00Z', items: [item] },
  ] };
  assert.deepEqual(productionPreparations(data, 'p').map(entry => entry.batchId), ['older', 'yesterday']);
});
