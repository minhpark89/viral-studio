import test from 'node:test';
import assert from 'node:assert/strict';
import { contentVideoInventory } from '../shared/content-inventory.js';
import { createContentBatch } from '../src/content-creation.js';

const video = (id, extra = {}) => ({ id, projectId: 'p', kind: 'video', generated: true, mediaType: 'news-video', name: 'News · Same title.mp4', production: { contentType: 'news', researchId: 'same-research' }, ...extra });

test('230 renders with 91 exact attachments leave all 139 variants available, regardless of repeated titles or research', () => {
  const media = Array.from({ length: 230 }, (_, i) => video(`v${i}`));
  const posts = media.slice(0, 91).map(m => ({ id: `post-${m.id}`, projectId: 'p', researchId: 'same-research', title: 'Same title', mediaIds: [m.id] }));
  posts.push({ id: 'duplicate', mediaIds: [media[0].id] }, { id: 'text-only', researchId: 'same-research', title: 'Same title', mediaIds: [] });
  const result = contentVideoInventory({ media, socialPosts: posts, jobs: [] }, 'p');
  assert.equal(result.videos.length, 230);
  assert.equal(result.withContent.length, 91);
  assert.equal(result.missing.length, 139);
  assert.deepEqual(new Set(result.missing.map(m => m.id)), new Set(media.slice(91).map(m => m.id)));
});

test('existing published, archived and deleted records never reappear as unassigned; raw assets and other projects are excluded', () => {
  const media = [video('draft'), video('published'), video('archive'), video('deleted'), video('cleaned-post', { metaPublishedAt: '2026-11-16' }), video('unassigned'), video('presenter', { mediaType: 'news-presenter' }), video('legacy-presenter'), video('clip', { mediaType: 'product-clip' }), video('image', { kind: 'image' }), video('upload', { generated: false }), video('other-project', { projectId: 'other' })];
  const socialPosts = [{ mediaIds: ['draft'] }, { mediaIds: ['published'], status: 'published' }, { mediaIds: ['archive'], archivedAt: '2026-11-16' }, { mediaIds: ['deleted'], deletedAt: '2026-11-16' }];
  const result = contentVideoInventory({ media, socialPosts, jobs: [{ type: 'news', payload: { presenterMediaId: 'legacy-presenter' } }] }, 'p');
  assert.equal(result.videos.length, 6);
  assert.equal(result.withContent.length, 4);
  assert.deepEqual(result.publishedWithoutContent.map(m => m.id), ['cleaned-post']);
  assert.deepEqual(result.missing.map(m => m.id), ['unassigned']);
});

test('bulk creation limits concurrency, deduplicates IDs, continues after failure and distinguishes saved Content from website failure', async () => {
  let active = 0, max = 0;
  const calls = [], created = [], snapshots = [];
  const videos = Array.from({ length: 25 }, (_, i) => video(String(i)));
  const result = await createContentBatch({ videos: [...videos, videos[0]], concurrency: 3,
    create: async m => {
      calls.push(m.id); active++; max = Math.max(max, active);
      await new Promise(resolve => setTimeout(resolve, 3)); active--;
      if (m.id === '4') throw Error('LLM unavailable');
      return { id: `post-${m.id}`, ...(m.id === '7' ? { automationStatus: 'website_error', automationError: 'Website unavailable' } : {}) };
    }, onCreated: p => created.push(p.id), onProgress: p => snapshots.push(p),
  });
  assert.equal(calls.length, 25); assert.equal(max, 3);
  assert.equal(result.total, 25); assert.equal(result.completed, 25); assert.equal(result.created, 24); assert.equal(result.active, 0);
  assert.deepEqual(result.failures.map(e => e.id), ['4']); assert.deepEqual(result.websiteErrors.map(e => e.id), ['7']);
  assert.equal(created.length, 24); assert.equal(snapshots[0].completed, 0); assert.equal(snapshots.at(-1).completed, 25);
});

test('stop finishes active requests and leaves every unstarted video available for a later batch', async () => {
  let stop = false;
  const started = [], saved = [];
  const result = await createContentBatch({ videos: Array.from({ length: 20 }, (_, i) => video(String(i))), concurrency: 2,
    create: async m => { started.push(m.id); await new Promise(resolve => setTimeout(resolve, 5)); stop = true; return { id: m.id }; },
    onCreated: p => saved.push(p.id), shouldStop: () => stop,
  });
  assert.equal(result.stopped, true); assert.equal(result.completed, 2); assert.equal(result.active, 0);
  assert.deepEqual(started, ['0', '1']); assert.deepEqual(saved, started);
});
