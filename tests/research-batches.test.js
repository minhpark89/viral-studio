import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { createResearchService } from '../server/research.js';
import { ResearchBatchService } from '../server/research-batches.js';

const today = '2026-11-01T16:00:00.000Z';
const rss = (count, stale = false) => `<rss><channel><title>City News</title>${Array.from({ length: count }, (_, i) => `<item><title>City report ${i}</title><link>https://example.test/story/${i}</link><description>Officials released a verified city report.</description><pubDate>${stale ? 'Fri, 30 Oct 2026 12:00:00 GMT' : 'Sun, 01 Nov 2026 12:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const settings = { requestId: randomUUID(), topic: 'City', niche: 'US news', count: 100, feeds: ['https://example.test/rss'] };
async function fixture(t, fetchImpl) {
  const root = path.resolve('.verification', 'research-batch-' + randomUUID());
  const store = new Store(root); const project = store.createProject('Research batch');
  const research = createResearchService({ now: () => today, fetchImpl });
  const service = new ResearchBatchService(store, research);
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, project, research, service };
}

test('100 requested news stories become 100 distinct research records, with no repeat on next run', async t => {
  const { store, project, service } = await fixture(t, async () => new Response(rss(105)));
  const request = { ...settings, projectId: project.id };
  const batch = service.create(request);
  assert.equal(service.create(request).id, batch.id);
  assert.throws(() => service.create({ ...request, count: 99 }), error => error.code === 'REQUEST_CONFLICT');
  await service.worker;
  assert.equal(batch.status, 'completed');
  assert.equal(batch.items.length, 100);
  assert.equal(store.state.researchResults.length, 100);
  assert.equal(new Set(store.state.researchResults.map(result => result.articles[0].url)).size, 100);
  for (const result of store.state.researchResults) { assert.equal(result.articles.length, 1); assert.equal(result.batchId, batch.id); }
  const next = service.create({ ...request, requestId: randomUUID(), count: 100 });
  await service.worker;
  assert.equal(next.items.length, 5);
  assert.match(next.warnings.join(' '), /5\/100/);
  assert.equal(store.state.researchResults.length, 105);
  const empty = service.create({ ...request, requestId: randomUUID() });
  await service.worker;
  assert.equal(empty.status, 'failed');
  assert.equal(store.state.researchResults.length, 105);
});

test('research batches resume after shutdown without duplicating saved stories', async t => {
  let inFlight;
  let calls = 0;
  const fetched = new Promise(resolve => { inFlight = resolve; });
  const fetchImpl = async (_url, options) => {
    if (options.method !== 'POST') return new Response(rss(3));
    calls++;
    if (calls === 2) { inFlight(); await delay(60000, null, { signal: options.signal }); }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ headline: 'City report', angle: 'Official response', script: 'Officials released the city report today. It sets out findings for public review. Residents can read the complete report. A further decision is still pending. Updates will follow the public response.', imageQueries: ['city hall'] }) } }] });
  };
  const { root, store, project, service, research } = await fixture(t, fetchImpl);
  store.state.settings.llm = { ...store.state.settings.llm, enabled: true, endpoint: 'https://llm.test/v1', model: 'test' };
  const batch = service.create({ ...settings, projectId: project.id, count: 3 });
  await fetched;
  assert.equal(store.state.researchResults.length, 1);
  await service.close();
  assert.equal(batch.status, 'interrupted');
  const recoveredStore = new Store(root);
  const recovered = new ResearchBatchService(recoveredStore, research);
  t.after(() => recovered.close());
  await recovered.worker;
  assert.equal(recoveredStore.require('researchBatches', batch.id).status, 'completed');
  assert.equal(recoveredStore.state.researchResults.length, 3);
  assert.equal(new Set(recoveredStore.state.researchResults.map(result => result.batchItemIndex)).size, 3);
  assert.equal(calls, 4);
});

test('stop cancels active research; retry keeps saved records and skips stale sources', async t => {
  let signalStarted;
  let hold = true;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const { store, project, service } = await fixture(t, async (_url, options) => {
    signalStarted();
    if (hold) await delay(60000, null, { signal: options.signal });
    return new Response(rss(2, true));
  });
  const batch = service.create({ ...settings, projectId: project.id });
  await started;
  service.cancel(batch.id);
  await service.worker;
  assert.equal(batch.status, 'cancelled');
  assert.equal(store.state.researchResults.length, 0);
  hold = false;
  service.retry(batch.id);
  await service.worker;
  assert.equal(batch.status, 'failed');
  assert.match(batch.error, /tin mới/);
  assert.equal(store.state.researchResults.length, 0);
});
