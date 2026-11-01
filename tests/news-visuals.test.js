import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { ProductionService } from '../server/production.js';
import { createNewsSourceCard } from '../server/news-render.js';
import { parseWikimediaImages, searchImageQueries } from '../server/image-search.js';
import { articleImageFromHtml, newsVisualQueries } from '../server/news-visuals.js';
import { productionPreparations } from '../shared/queue-preparation.js';

test('Wikimedia candidates retain relevance order rather than ascending numeric page IDs', () => {
  const image = (index, title) => ({ index, title, imageinfo: [{ url: `https://images.test/${index}.jpg`, mime: 'image/jpeg' }] });
  const actual = parseWikimediaImages({ query: { pages: { 1: image(3, 'Goat'), 2: image(2, 'Old event'), 9999: image(1, 'Bitcoin token') } } }, 'Bitcoin', 2);
  assert.deepEqual(actual.map(image => image.title), ['Bitcoin token', 'Old event']);
});

test('search cache shares network work without reusing per-story image decisions', async () => {
  let calls = 0; const cache = new Map();
  const fetchImpl = async () => { calls++; return Response.json({ query: { pages: { 1: { title: 'Bitcoin token', imageinfo: [{ url: 'https://images.test/coin.jpg', mime: 'image/jpeg' }] } } } }); };
  await Promise.all([searchImageQueries(['Bitcoin'], { cache, fetchImpl }), searchImageQueries(['Bitcoin'], { cache, fetchImpl })]);
  assert.equal(calls, 1);
  assert.deepEqual(newsVisualQueries({ headline: 'Binance hacker swaps Solana for Bitcoin', articles: [] }).slice(0, 3), ['Bitcoin coin', 'Solana cryptocurrency', 'Binance']);
  assert.equal(articleImageFromHtml('<meta content="/report.jpg?a=1&amp;b=2" property="og:image">', { url: 'https://news.test/report' }).imageUrl, 'https://news.test/report.jpg?a=1&b=2');
});

test('rejected cached imagery triggers fresh search, labeled context images, and correct prepared-job handoff', async t => {
  const root = path.resolve('.verification', 'visual-retry-' + randomUUID()); const store = new Store(root); const project = store.createProject('Coin');
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); let searches = 0;
  const image = { id: 'bitcoin', title: 'Bitcoin token', imageUrl: 'https://images.test/btc.jpg' };
  const service = new ProductionService(store, queue, { imageSearch: async () => { searches++; return { images: [image], warnings: [] }; }, downloadImage: async () => store.add('media', { projectId: project.id, kind: 'image', file: 'coin.png' }) });
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const research = store.add('researchResults', { projectId: project.id, headline: 'Bitcoin report', topic: 'coin', articles: [], imageSearchResults: Array.from({ length: 5 }, (_, i) => ({ id: 'goat' + i, title: 'Goat', imageUrl: `https://images.test/goat${i}.jpg` })) });
  const batch = store.add('productionBatches', { projectId: project.id, request: { contentType: 'news' }, warnings: [], items: [{ index: 0, researchId: research.id, status: 'preparing' }] });
  const llm = async (_store, prompt) => ({ selectedImageIds: prompt.includes('Context images of the exact') ? ['bitcoin'] : [] });
  const result = await service.prepareNewsMedia(batch, { projectId: project.id }, research, { headline: 'Bitcoin report', narration: 'Verified Bitcoin report', imageQueries: ['Bitcoin'] }, llm);
  assert.equal(searches, 1); assert.equal(result.visualMode, 'illustration'); assert.equal(result.imageMediaIds.length, 1);
  assert.equal(productionPreparations(store.state, project.id).length, 1);
  const job = queue.enqueueNews({ projectId: project.id, plan: { visualMode: result.visualMode }, imageMediaIds: result.imageMediaIds, production: { batchId: batch.id, itemIndex: 0 } });
  assert.equal(productionPreparations(store.state, project.id).length, 0, 'A linked job replaces preparation even before item.jobId is written');
  assert.equal(job.status, 'queued');
});

test('zero usable downloads yields a reusable source card, never an unrelated photo', async t => {
  const root = path.resolve('.verification', 'visual-card-' + randomUUID()); const store = new Store(root); const project = store.createProject('News');
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); let cards = 0;
  const service = new ProductionService(store, queue, {
    imageSearch: async () => ({ images: [], warnings: ['Search unavailable'] }),
    downloadImage: async () => { throw new Error('HTTP 429'); },
    sourceCard: async (_store, research, signal) => { cards++; return createNewsSourceCard(store, research, signal); },
  });
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const research = store.add('researchResults', { projectId: project.id, headline: 'Bitcoin report: 10% change under review', topic: 'Bitcoin', articles: [], imageSearchResults: [{ id: 'btc', title: 'Bitcoin token', imageUrl: 'https://images.test/coin.jpg' }] });
  const batch = store.add('productionBatches', { projectId: project.id, items: [], request: {}, warnings: [] });
  const request = { projectId: project.id }; const narration = { headline: research.headline, narration: 'A verified report.', imageQueries: ['Bitcoin'] };
  const llm = async () => ({ selectedImageIds: ['btc'] });
  const result = await service.prepareNewsMedia(batch, request, research, narration, llm);
  assert.equal(result.visualMode, 'source-card'); assert.equal(result.diagnostics.downloadErrors.length, 1);
  assert.deepEqual(result.selectedImageIds, []);
  const media = store.require('media', result.imageMediaIds[0]);
  assert.equal(media.width, 1200); assert.equal(media.height, 1120); assert.equal(media.visualRole, 'source-card');
  const cached = await service.prepareNewsMedia(batch, request, research, narration, llm);
  assert.equal(cached.visualMode, 'source-card'); assert.equal(cards, 1);
});

test('Queue includes unqueued failures and pending preparation, scoped to the project', () => {
  const data = { jobs: [], productionBatches: [{ id: 'a', projectId: 'p', request: { topic: 'Coin', contentType: 'news' }, items: [{ index: 0, status: 'pending' }, { index: 1, status: 'failed', error: 'Could not write narration' }] }, { id: 'b', projectId: 'other', items: [{ index: 0, status: 'preparing' }] }] };
  const items = productionPreparations(data, 'p');
  assert.equal(items.length, 2); assert.equal(items[1].error, 'Could not write narration');
});
