import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createResearchService } from '../server/research.js';
import { ResearchBatchService } from '../server/research-batches.js';
import { Store } from '../server/store.js';
import { researchBatchRequestSchema } from '../shared/research-contracts.js';

const now = '2026-11-04T02:00:00.000Z';
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const story = (i, overrides = {}) => ({ title: `Trump war negotiations report ${i}`, url: `https://reports.test/${i}`, source: `Publisher ${i % 4}`, publishedAt: '2026-11-03T20:00:00.000Z', summary: 'Military negotiations and ceasefire diplomacy.', ...overrides });
const rss = articles => `<rss><channel><title>Search</title>${articles.map(a => `<item><title>${esc(a.title)}</title><link>${esc(a.url)}</link><source>${esc(a.source)}</source><description>${esc(a.summary)}</description><pubDate>${a.publishedAt}</pubDate></item>`).join('')}</channel></rss>`;
const make = fetchImpl => createResearchService({ now: () => now, fetchImpl });
const entries = (count, start = 0) => Array.from({ length: count }, (_, i) => story(start + i));

test('23 initial reports expand to 50 real reports, with observable keyword and source evidence', async () => {
  const calls = [], progress = [];
  const service = make(async input => {
    const q = new URL(input).searchParams.get('q'); calls.push(q);
    return new Response(rss(q.startsWith('donal ') ? entries(23) : entries(50)));
  });
  const found = await service.discover({ topic: 'donal trump wars', count: 50, onProgress: state => progress.push(state) });
  assert.equal(found.articles.length, 50);
  assert.equal(new Set(found.articles.map(a => a.url)).size, 50);
  assert.ok(progress.some(state => state.found === 23 && state.phase === 'expanding'));
  assert.ok(calls.some(query => query.startsWith('Donald Trump')));
  assert.ok(found.discovery.suggestions.some(s => s.query.includes('negotiations') && s.sourceCount === 4));
  assert.equal(found.discovery.exhausted, false);
});

test('sufficient exact results stop immediately; source URL/title duplicates and off-topic or stale reports never fill a quota', async () => {
  let calls = 0;
  const service = make(async () => { calls++; return new Response(rss([
    story(0), story(0, { url: 'https://reports.test/0?utm_source=copy' }),
    story(1, { title: `${story(0).title} - Other publisher`, source: 'Other publisher' }),
    story(2, { title: 'Unrelated hurricane update', summary: 'Local weather bulletin.' }),
    story(3, { title: 'Ukraine war negotiations', summary: 'Ukraine war.' }),
    story(4, { title: 'Trump recipe book', summary: 'A cooking recipe.' }),
    story(5, { publishedAt: '2026-11-01T02:00:00.000Z' }),
    story(6, { publishedAt: '2026-11-05T02:00:00.000Z' }), story(7),
  ])); });
  const found = await service.discover({ topic: 'Trump wars', count: 2 });
  assert.deepEqual(found.articles.map(a => a.url), [story(0).url, story(7).url]);
  assert.equal(calls, 1);
});

test('24-hour discovery crosses midnight and a wider explicit window admits older reports', async () => {
  const service = make(async () => new Response(rss([story(1), story(2, { publishedAt: '2026-11-02T15:00:00.000Z' })])));
  const fresh = await service.discover({ topic: 'Trump war', count: 2 });
  assert.equal(fresh.articles.length, 1);
  assert.equal(fresh.discovery.exhausted, true);
  const wider = await service.discover({ topic: 'Trump war', count: 2, windowHours: 72 });
  assert.equal(wider.articles.length, 2);
  assert.equal(wider.discovery.windowHours, 72);
});

test('feed failure or a short custom RSS falls through to same-topic search', async () => {
  const calls = [];
  const service = make(async input => { calls.push(String(input)); if (String(input).includes('broken.test')) throw Error('offline'); return new Response(rss(entries(5))); });
  const found = await service.discover({ topic: 'Trump wars', count: 5, feeds: ['https://broken.test/rss'] });
  assert.equal(found.articles.length, 5);
  assert.ok(found.warnings.length > 0);
  assert.ok(calls.some(url => url.startsWith('https://news.google.com/')));
});

test('discovery scales beyond a single 150-item feed and the former 100-story limit', async () => {
  let call = 0;
  const service = make(async () => new Response(rss(entries(150, call++ * 150))));
  const found = await service.discover({ topic: 'Trump war', count: 1000 });
  assert.equal(found.articles.length, 1000);
  assert.equal(new Set(found.articles.map(a => a.url)).size, 1000);
  assert.ok(call > 6);
  assert.equal(researchBatchRequestSchema.parse({ projectId: randomUUID(), requestId: randomUUID(), topic: 'Trump war', count: 1000 }).count, 1000);
});

async function fixture(t, fetchImpl) {
  const root = path.resolve('.verification', `discovery-${randomUUID()}`);
  const store = new Store(root), project = store.createProject('Adaptive research QA');
  const research = make(fetchImpl), service = new ResearchBatchService(store, research);
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, project, research, service };
}

test('a legacy completed 23/50 batch can fill only its 27 missing slots without touching saved results', async t => {
  let available = 23;
  const { root, store, project, service, research } = await fixture(t, async () => new Response(rss(entries(available))));
  const batch = service.create({ projectId: project.id, requestId: randomUUID(), topic: 'Trump wars', count: 50 });
  await service.worker;
  assert.equal(batch.status, 'partial');
  const previous = store.state.researchResults.map(r => JSON.stringify(r));
  batch.status = 'completed'; delete batch.request.windowHours; store.save();
  await service.close();
  const recoveredStore = new Store(root), recovered = new ResearchBatchService(recoveredStore, research);
  t.after(() => recovered.close());
  assert.equal(recovered.worker, null);
  assert.equal(recoveredStore.require('researchBatches', batch.id).status, 'partial');
  available = 50; recovered.retry(batch.id); await recovered.worker;
  const finished = recoveredStore.require('researchBatches', batch.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.items.length, 50);
  assert.equal(recoveredStore.state.researchResults.length, 50);
  assert.deepEqual(recoveredStore.state.researchResults.slice(0, 23).map(r => JSON.stringify(r)), previous);
  assert.equal(new Set(finished.items.map(item => item.index)).size, 50);
  assert.ok(!finished.warnings.some(warning => warning.includes('23/50')));
});

test('closing during expansion checkpoints discovered articles and resumes missing work after restart', async t => {
  let expansionStarted, block = true, calls = 0;
  const started = new Promise(resolve => { expansionStarted = resolve; });
  const { root, store, project, service, research } = await fixture(t, async (_url, options) => {
    calls++;
    if (block && calls > 1) { expansionStarted(); await delay(60000, null, { signal: options.signal }); }
    return new Response(rss(entries(block ? 2 : 5)));
  });
  const batch = service.create({ projectId: project.id, requestId: randomUUID(), topic: 'Trump wars', count: 5 });
  await started;
  assert.equal(batch.items.length, 2);
  assert.equal(store.state.researchResults.length, 0);
  await service.close(); block = false;
  assert.equal(batch.status, 'interrupted');
  const recoveredStore = new Store(root), recovered = new ResearchBatchService(recoveredStore, research);
  t.after(() => recovered.close()); await recovered.worker;
  assert.equal(recoveredStore.require('researchBatches', batch.id).status, 'completed');
  assert.equal(recoveredStore.state.researchResults.length, 5);
  assert.equal(new Set(recoveredStore.state.researchResults.map(r => r.articles[0].url)).size, 5);
});
