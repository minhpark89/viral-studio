import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { ProductionService } from '../server/production.js';
import { productionRequestSchema } from '../shared/production-contracts.js';
import { mcForVideo } from '../shared/mc-rotation.js';

test('100 videos keep exact MC blocks across stories, failure, retry and restart', async t => {
  const root = path.resolve('.verification', 'rotation-' + randomUUID());
  const store = new Store(root);
  const project = store.createProject('MC rotation');
  store.state.settings.llm.enabled = true;
  const queue = new JobQueue(store, {}, { intervalMs: 0 });
  const hosts = Array.from({ length: 3 }, (_, i) => store.add('media', { projectId: project.id, kind: 'image', mediaType: 'news-mc', file: `mc-${i}.jpg`, name: `MC ${i}` }));
  const stories = Array.from({ length: 20 }, (_, i) => {
    const photo = store.add('media', { projectId: project.id, kind: 'image', file: `story-${i}.jpg` });
    return store.add('researchResults', { projectId: project.id, topic: `City report ${i}`, headline: `City report ${i}`, script: 'Officials have released a new transport report. The public review will inform the next decision.',
      articles: [{ title: `Story ${i}`, url: `https://example.test/${i}`, source: 'City News', summary: 'A verified report.' }], imageMediaIds: [photo.id], warnings: [] });
  });
  let fail = true;
  const llm = async (_system, input) => {
    if (input.candidates) return { selectedImageIds: input.candidates.map(image => image.id) };
    if (input.headline === 'City report 10' && input.variation === 1 && fail) throw new Error('Transient preparation failure');
    return { headline: input.headline, summary: ['Officials released a transport report. The next decision will depend on residents.', 'The public review examines how passengers reach their destinations.', 'Road maintenance forms another section of this newly released assessment.', 'Bus routes feature prominently in proposals awaiting local approval.', 'Residents can read the findings before any final policy is adopted.'][input.variation - 1], imageQueries: ['city transport'] };
  };
  const options = { llm, sourceLoader:async research=>({articles:research.articles,warnings:[]}), imageSearch:async()=>({images:[],warnings:[]}), fetchImpl: async () => { throw new Error('External calls forbidden'); } };
  let service = new ProductionService(store, queue, options);
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = { requestId: randomUUID(), projectId: project.id, contentType: 'news', topic: 'City news', newsVisualPolicy:'allow-fewer', count: 100,
    researchIds: stories.flatMap(story => Array(5).fill(story.id)), mcRotation: hosts.map((host, i) => ({ avatarMediaId: host.id, count: [10, 20, 5][i] })) };
  const batch = service.create(request);
  assert.equal(service.create(request).id, batch.id);
  await service.worker;
  assert.equal(store.state.jobs.length, 99);
  assert.equal(batch.items[50].avatarMediaId, hosts[1].id);
  assert.equal(batch.items[50].status, 'failed');
  await service.close();
  fail = false;
  const reloaded = new Store(root);
  const recoveredQueue = new JobQueue(reloaded, {}, { intervalMs: 0 });
  t.after(() => recoveredQueue.close());
  service = new ProductionService(reloaded, recoveredQueue, options);
  service.retry(batch.id);
  await service.worker;
  const recovered = reloaded.require('productionBatches', batch.id);
  assert.equal(reloaded.state.jobs.length, 100);
  assert.equal(recovered.status, 'queued');
  for (const item of recovered.items) {
    const cycleIndex = item.index % 35;
    const expectedHost = hosts[cycleIndex < 10 ? 0 : cycleIndex < 30 ? 1 : 2].id;
    const story = stories[Math.floor(item.index / 5)];
    const job = reloaded.require('jobs', item.jobId);
    assert.equal(item.avatarMediaId, expectedHost);
    assert.equal(job.payload.avatarMediaId, expectedHost);
    assert.equal(job.payload.newsPlan.avatarMediaId, expectedHost);
    assert.equal(job.production.researchId, story.id);
    assert.equal(job.production.sources[0].url, story.articles[0].url);
    assert.deepEqual(job.payload.imageMediaIds, story.imageMediaIds);
    assert.equal(job.payload.newsPlan.visualVariant, item.index % 5 + 1);
  }
  service.retry(batch.id); await service.worker;
  assert.equal(reloaded.state.jobs.length, 100);
});

test('rotation rejects invalid counts and mixed projects before creating any work', async t => {
  const root = path.resolve('.verification', 'rotation-validation-' + randomUUID());
  const store = new Store(root); const project = store.createProject('Here'); const other = store.createProject('Other');
  store.state.settings.llm.enabled = true;
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); const service = new ProductionService(store, queue);
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const foreign = store.add('media', { projectId: other.id, kind: 'image' });
  const avatar = store.add('media', { projectId: project.id, kind: 'image', mediaType: 'page-avatar' });
  const request = { requestId: randomUUID(), projectId: project.id, contentType: 'news', topic: 'City news', count: 100 };
  for (const count of [0, 1.5, 101]) assert.equal(productionRequestSchema.safeParse({ ...request, mcRotation: [{ avatarMediaId: foreign.id, count }] }).success, false);
  for (const host of [foreign, avatar]) assert.throws(() => service.create({ ...request, mcRotation: [{ avatarMediaId: host.id, count: 10 }] }), error => error.code === 'INVALID_AVATAR_IMAGE');
  const story = store.add('researchResults', { projectId: other.id });
  assert.throws(() => service.create({ ...request, count: 1, researchIds: [story.id] }), error => error.code === 'RESEARCH_PROJECT_MISMATCH');
  assert.equal(store.state.productionBatches.length, 0);
  assert.equal(productionRequestSchema.safeParse({ ...request, researchIds: [story.id] }).success, false);
  assert.equal(mcForVideo({ avatarMediaId: foreign.id }, 99), foreign.id);
});
