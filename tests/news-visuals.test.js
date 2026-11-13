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
import { articleImageFromHtml, articleImagesFromHtml, newsVisualQueries } from '../server/news-visuals.js';
import { newsImageCandidates } from '../server/image-search.js';
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

test('explicit source-card opt-in yields a reusable card after zero usable downloads', async t => {
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
  const request = { projectId: project.id, newsVisualPolicy: 'allow-source-card' }; const narration = { headline: research.headline, narration: 'A verified report.', imageQueries: ['Bitcoin'] };
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

test('source galleries retain distinct photos and captions, excluding sidebar photos and small author images', () => {
  const images = articleImagesFromHtml(`<meta property="og:image" content="/cover.jpg"><script type="application/ld+json">{"@type":"NewsArticle","image":[{"url":"/cover.jpg","caption":"Mayor at the council meeting"},{"url":"/city.jpg","caption":"The named city"}]}</script><article><figure><img src="/small.jpg" srcset="/small.jpg 400w, /hall.jpg 1200w"><figcaption>City hall in the named city</figcaption></figure><figure><img width="64" height="64" src="/author.jpg" alt="The author"></figure></article><aside><figure><img src="/unrelated.jpg" alt="A different event"></figure></aside>`, { id: 'story', title: 'Council report', url: 'https://news.test/story' });
  assert.deepEqual(images.map(image => image.imageUrl), ['https://news.test/cover.jpg', 'https://news.test/city.jpg', 'https://news.test/hall.jpg']);
  assert.equal(images[0].imageDescription, 'Mayor at the council meeting');
  const candidates = newsImageCandidates(images);
  assert.equal(new Set(candidates.map(image => image.id)).size, 3);
  assert.equal(candidates[2].description, 'City hall in the named city');
  assert.ok(newsVisualQueries({ headline: 'Salina report' }, { imageQueries: ['Donald Trump Salina Kansas'] }).includes('Donald Trump Salina Kansas'));
});

test('one usable source photo is supplemented with relevant context, preserving multiple images from the same page', async t => {
  const root = path.resolve('.verification', 'more-news-images-' + randomUUID()); const store = new Store(root); const project = store.createProject('More photos');
  const queue = new JobQueue(store, {}, { intervalMs: 0 }); let searches = 0;
  const service = new ProductionService(store, queue, {
    fetchImpl: async () => new Response('<article><figure><img src="/second.jpg" alt="The named town hall"></figure></article>', { headers: { 'content-type': 'text/html' } }),
    imageSearch: async queries => { searches++; assert.ok(queries.every(q => q !== 'Donald')); return { images: Array.from({ length: 9 }, (_, i) => ({ id: `context-${i}`, title: `Named subject view ${i}`, imageUrl: `https://images.test/${i}.jpg` })), warnings: [] }; },
    downloadImage: async ({ image }) => store.add('media', { projectId: project.id, kind: 'image', file: image.imageUrl, sourceUrl: image.pageUrl, sourceImageUrl: image.imageUrl, contentHash: image.id === 'context-1' ? 'context-0' : image.id }),
  });
  t.after(async () => { await service.close(); await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const research = store.add('researchResults', { projectId: project.id, headline: 'Named subject report', articles: [{ id: 'story', title: 'Named subject report', imageUrl: 'https://news.test/first.jpg', url: 'https://news.test/story' }] });
  const batch = store.add('productionBatches', { projectId: project.id, request: {}, items: [], warnings: [] });
  const result = await service.prepareNewsMedia(batch, { projectId: project.id, newsImageCount: 10 }, research, { headline: research.headline, narration: 'A confirmed development.', imageQueries: ['Donald Trump Salina Kansas'] }, async (_store, _prompt, input) => ({ selectedImageIds: input.candidates.map(image => image.id) }));
  assert.equal(searches, 1);
  assert.equal(result.visualMode, 'illustration');
  assert.equal(result.diagnostics.target, 10);
  assert.ok(result.imageMediaIds.length >= 8, 'Images beyond the old five-image cap survive preparation');
  const selected = result.imageMediaIds.map(id => store.require('media', id));
  assert.equal(new Set(selected.map(image => image.contentHash)).size, selected.length, 'Identical downloads do not occupy two shots');
  assert.equal(selected.filter(image => image.sourceUrl === 'https://news.test/story').length, 2, 'A page URL is not a unique photo key');
});
