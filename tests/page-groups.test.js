import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { mountMetaRoutes, autoAssignTokenGroup } from '../server/meta.js';
import { mountSocialRoutes, autoScheduleWarehousePosts } from '../server/social.js';
import { SocialScheduler } from '../server/social-scheduler.js';
import { resolvePageToken } from '../server/page-routing.js';
import { pageRows } from '../server/management.js';

async function fixture(t, pageCount = 3, tokenCount = 2) {
  const root = path.resolve('.verification', `groups-${randomUUID()}`), store = new Store(root);
  const project = store.createProject('Groups QA');
  const media = store.add('media', { projectId: project.id, name: 'fixture.mp4', kind: 'video', generated: true, mediaType: 'product-video', file: path.join(root, 'media', 'fixture.mp4') });
  await fs.writeFile(media.file, 'synthetic-media-preserve');
  const meta = store.state.settings.meta;
  meta.tokens = Array.from({ length: tokenCount }, (_, i) => ({ id: `token-${i}`, name: `Token ${i + 1}`, status: 'ACTIVE', token: `synthetic-secret-${i}`, totalCalls: 0 }));
  meta.pages = Array.from({ length: pageCount }, (_, i) => ({ id: String(10000 + i), name: `Page ${i + 1}`, verification: { status: 'passed' }, accessToken: `synthetic-page-${i}`, tokenBindings: Object.fromEntries(meta.tokens.map(token => [token.id, { status: 'VERIFIED', pageToken: `synthetic-page-${i}-${token.id}`, credentialFingerprint: createHash('sha256').update(token.token).digest('hex') }])) }));
  store.state.socialPages = meta.pages.map(page => ({ id: randomUUID(), externalId: page.id, name: page.name, archived: false, revision: 1 }));
  const group = { id: 'group', name: 'Nhóm đăng', pageIds: meta.pages.map(p => p.id), scheduleConfig: { enabled: true, autoPublish: true, times: ['09:00', '10:00', '11:00'], dailyLimit: 1, timezone: 'UTC', staggerMinutes: 0, sameTokenMinutes: 0, crossTokenMinutes: 0, samePageMinutes: 0 } };
  meta.pageGroups = [group]; meta.enabled = true; meta.accessToken = meta.tokens[0].token;
  store.save();
  const app = express(); app.use(express.json()); mountSocialRoutes(app, store);
  const service = mountMetaRoutes(app, store, { client: { pageStatus: async ({ pageId }) => ({ id: pageId, is_published: true }) } });
  app.use((e, req, res, next) => res.status(e.status || 400).json({ error: e.message, code: e.code }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await service.close(); await new Promise(resolve => server.close(resolve)); });
  const request = async (url, body) => { const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const stock = (count = 1) => Array.from({ length: count }, (_, i) => store.add('socialPosts', { projectId: project.id, title: `Bài ${i + 1}`, caption: 'Nội dung', firstComment: 'Bình luận', mediaIds: [media.id], contentType: 'product', status: 'ready', pageId: '', pageGroupId: '', revision: 1, createdAt: new Date(i * 1000).toISOString() }));
  return { store, meta, group, media, request, stock, root };
}

test('pool preview is read-only; 30 shared tokens split 100 Pages 3/4, cap failures explain capacity, edits keep identity and exact scope', async t => {
  const f = await fixture(t, 100, 30);
  const input = { name: '100 Page / 30 token', tokenIds: f.meta.tokens.map(t => t.id), strategy: 'round_robin', maxPagesPerToken: 0, pageScope: 'all' };
  const before = JSON.stringify(f.meta);
  const preview = await f.request('/api/meta/token-groups/preview', input);
  assert.equal(preview.status, 200); assert.equal(JSON.stringify(f.meta), before);
  assert.equal(preview.body.group.assignedPageCount, 100);
  const loads = Object.values(preview.body.group.assignmentLoads);
  assert.equal(loads.filter(n => n === 4).length, 10); assert.equal(loads.filter(n => n === 3).length, 20);
  assert.ok(!JSON.stringify(preview.body).includes('synthetic-secret'));
  const cap = await f.request('/api/meta/token-groups/preview', { ...input, maxPagesPerToken: 3 });
  assert.equal(cap.body.group.assignmentBlockedCount, 10); assert.ok(cap.body.group.assignmentBlocked.every(row => row.code === 'token_capacity'));
  const saved = (await f.request('/api/meta/token-groups', input)).body.group;
  const edited = await f.request('/api/meta/token-groups', { ...input, id: saved.id, name: 'Đã sửa', pageScope: 'selected', selectedPageIds: f.meta.pages.slice(0, 7).map(p => p.id) });
  assert.equal(edited.status, 200); assert.equal(edited.body.group.id, saved.id); assert.equal(f.meta.tokenGroups.length, 1);
  assert.equal(edited.body.group.assignedPageCount, 7);
  const repeated = await f.request(`/api/meta/token-groups/${saved.id}/auto-assign`, {});
  assert.equal(repeated.body.group.assignedPageCount, 7);
});

test('pruning moves faulty Pages into the management filter, preserves enabled schedule and content, permits repair/re-add/new membership', async t => {
  const f = await fixture(t), originalConfig = { ...f.group.scheduleConfig };
  const pool = (await f.request('/api/meta/token-groups', { name: 'Scoped', tokenIds: f.meta.tokens.map(t => t.id), pageScope: 'group', pageGroupId: 'group' })).body.group;
  f.group.scheduleConfig.tokenGroupId = pool.id;
  const [waiting, healthy] = f.stock(2);
  Object.assign(waiting, { pageGroupId: 'group', pageId: f.store.state.socialPages[0].id, status: 'scheduled', scheduledAt: '2027-01-01T09:00:00Z' });
  f.meta.pages[0].publishingHealth = { blocked: true, message: 'Cần xác minh danh tính', details: { code: 368, subcode: 4854002 } };
  const pruned = await f.request('/api/meta/page-groups/group/prune', {});
  assert.equal(pruned.status, 200); assert.deepEqual(pruned.body.removedPageIds, ['10000']);
  assert.equal(f.group.scheduleConfig.enabled, true); assert.deepEqual(f.group.scheduleConfig.times, originalConfig.times);
  assert.equal(f.meta.pages.length, 3); assert.equal(waiting.status, 'draft'); assert.equal(waiting.warehouse.previousExternalPageId, '10000');
  assert.equal(await fs.readFile(f.media.file, 'utf8'), 'synthetic-media-preserve');
  const row = pageRows(f.store).find(p => p.id === '10000'); assert.equal(row.lifecycle, 'review'); assert.equal(row.health, 'identity');
  assert.equal(autoScheduleWarehousePosts(f.store, 'group', { nowValue: Date.parse('2026-11-04T00:00:00Z') }).scheduled[0].id, healthy.id);
  assert.notEqual(healthy.pageId, f.store.state.socialPages[0].id);
  const rejected = await f.request('/api/meta/page-groups', { id: 'group', name: 'Nhóm đăng', pageIds: ['10000', ...f.group.pageIds] });
  assert.equal(rejected.status, 409);
  const restored = await f.request('/api/management/pages/bulk', { action: 'return_group', groupId: 'group', confirmResolved: true, items: [{ id: row.id, revision: row.revision }] });
  assert.equal(restored.body.changed, 1); assert.equal(f.meta.pages[0].publishingHealth.blocked, false);
  assert.ok(f.group.pageIds.includes('10000')); assert.ok(f.meta.tokenGroups[0].pageTokenBindings['10000']);
  const newPage = { ...f.meta.pages[1], id: '20000', name: 'Page mới' };
  f.meta.pages.push(newPage);
  const added = await f.request('/api/meta/page-groups', { id: 'group', name: 'Nhóm đăng', pageIds: [...f.group.pageIds, '20000'] });
  assert.equal(added.status, 200); assert.ok(f.meta.tokenGroups[0].pageTokenBindings['20000']); assert.equal(f.group.scheduleConfig.enabled, true);
});

test('automatic rotation persists across restart and counts published posts toward the group daily limit', async t => {
  const f = await fixture(t); f.stock(6);
  const calls = [];
  for (let day = 0; day < 6; day++) {
    const nowValue = Date.parse('2026-11-04T00:00:00Z') + day * 86400000;
    const scheduled = autoScheduleWarehousePosts(f.store, 'group', { nowValue }).scheduled;
    assert.equal(scheduled.length, 1);
    const post = scheduled[0]; calls.push(f.store.state.socialPages.find(page => page.id === post.pageId).externalId);
    f.meta.publications.push({ postId: post.id, pageGroupId: 'group', pageId: calls.at(-1), externalPostId: `published-${day}`, publishedAt: post.scheduledAt });
    f.store.state.socialPosts = f.store.state.socialPosts.filter(p => p.id !== post.id);
    f.store.save();
    const restarted = new Store(f.root);
    assert.equal(restarted.state.settings.meta.pageGroups[0].lastScheduledPageId, calls.at(-1));
    if (day === 0) {
      const next = autoScheduleWarehousePosts(restarted, 'group', { nowValue: Date.parse(post.scheduledAt) + 1000 }).scheduled[0];
      assert.ok(Date.parse(next.scheduledAt) >= Date.parse('2026-11-05T00:00:00Z'));
      assert.equal(restarted.state.socialPages.find(page => page.id === next.pageId).externalId, '10001');
    }
  }
  assert.deepEqual(calls, ['10000', '10001', '10002', '10000', '10001', '10002']);
});

test('overlapping groups honor Page/token/pool spacing after restart, and Auto Post off holds its due automatic queue', async t => {
  const f = await fixture(t, 3, 2), at = Date.parse('2026-11-04T08:00:00Z'); let now = at;
  f.group.scheduleConfig = { ...f.group.scheduleConfig, enabled: false, sameTokenMinutes: 10, crossTokenMinutes: 1, samePageMinutes: 30, times: [], tokenGroupId: 'pool' };
  const pool = { id: 'pool', tokenIds: f.meta.tokens.map(t => t.id), pageIds: f.meta.pages.map(p => p.id), strategy: 'round_robin' }; autoAssignTokenGroup(f.meta, pool); f.meta.tokenGroups = [pool];
  const second = { ...f.group, id: 'other', scheduleConfig: { ...f.group.scheduleConfig, sameTokenMinutes: 0, crossTokenMinutes: 0, samePageMinutes: 0 } }; f.meta.pageGroups.push(second);
  const posts = f.stock(3);
  posts.forEach((post, i) => Object.assign(post, { status: 'scheduled', pageId: f.store.state.socialPages[i === 2 ? 0 : i].id, pageGroupId: i ? 'other' : 'group', tokenGroupId: 'pool', scheduledAt: new Date(at - 1000 + i).toISOString() }));
  const calls = [], publish = async ({ postId }) => { calls.push({ postId, now }); f.store.state.socialPosts = f.store.state.socialPosts.filter(p => p.id !== postId); return { status: 'published' }; };
  let scheduler = new SocialScheduler(f.store, publish, { intervalMs: 0, now: () => now }); await Promise.all([...scheduler.pending]);
  assert.equal(calls.length, 1); await scheduler.close(); f.store.save();
  now += 60000; scheduler = new SocialScheduler(f.store, publish, { intervalMs: 0, now: () => now }); await Promise.all([...scheduler.pending]);
  assert.equal(calls.length, 2);
  now = at + 29 * 60000; await scheduler.tick(); assert.equal(calls.length, 2);
  now = at + 30 * 60000; await scheduler.tick(); assert.equal(calls.length, 3); await scheduler.close();
  const [automatic] = f.stock(); Object.assign(automatic, { pageId: f.store.state.socialPages[0].id, pageGroupId: 'group', status: 'scheduled', scheduledAt: new Date(at).toISOString(), automationSource: 'daily-automation' });
  scheduler = new SocialScheduler(f.store, publish, { intervalMs: 0, now: () => now + 3600000 }); await scheduler.close();
  assert.equal(calls.length, 3); assert.equal(automatic.status, 'scheduled');
});

test('a fixed pool never falls back to an outside credential or stale fingerprint', async t => {
  const f = await fixture(t, 1, 2), page = f.meta.pages[0];
  f.meta.tokenGroups = [{ id: 'pool', tokenIds: ['token-0'], pageTokenBindings: { [page.id]: 'token-0' } }];
  f.meta.tokens[0].status = 'ERROR'; assert.equal(resolvePageToken(f.meta, page, 'pool'), null);
  assert.equal(resolvePageToken(f.meta, page).tokenId, 'token-1');
  f.meta.tokens[0].status = 'ACTIVE'; page.tokenBindings['token-0'].credentialFingerprint = 'old-token';
  assert.equal(resolvePageToken(f.meta, page, 'pool'), null); assert.equal(resolvePageToken(f.meta, page, 'missing'), null);
});

test('an existing 79-Page pool keeps its boundary when upgrading and editing, even when tokens manage 100 Pages', async t => {
  const f = await fixture(t, 100, 30);
  const originalIds = f.meta.pages.slice(0, 79).map(page => page.id);
  f.meta.tokenGroups = [{ id: 'legacy', name: 'Pool 79 Page', tokenIds: f.meta.tokens.map(token => token.id), pageIds: originalIds, strategy: 'round_robin' }];
  const current = (await f.request('/api/meta')).body.tokenGroups[0];
  assert.equal(current.pageScope, 'selected'); assert.deepEqual(current.selectedPageIds, originalIds);
  const assigned = (await f.request('/api/meta/token-groups/legacy/auto-assign', {})).body.group;
  assert.equal(assigned.assignedPageCount, 79); assert.deepEqual(assigned.pageIds, originalIds);
  const edited = (await f.request('/api/meta/token-groups', { id: 'legacy', name: 'Đổi tên', tokenIds: f.meta.tokens.map(token => token.id) })).body.group;
  assert.equal(edited.assignedPageCount, 79); assert.deepEqual(edited.selectedPageIds, originalIds);
});

test('removing a failed Page refills its pending slot while healthy scheduled posts keep their slots', async t => {
  const f = await fixture(t), at = Date.parse('2027-01-04T00:00:00Z'); f.group.scheduleConfig.dailyLimit = 3;
  f.stock(6);
  const first = autoScheduleWarehousePosts(f.store, 'group', { nowValue: at }).scheduled;
  assert.equal(first.length, 3);
  const slots = first.map(p => p.scheduledAt);
  f.meta.pages[0].publishingHealth = { blocked: true, message: 'Page bị hạn chế' };
  const second = autoScheduleWarehousePosts(f.store, 'group', { nowValue: at + 1000 }).scheduled;
  assert.equal(second.length, 1);
  assert.equal(first[0].status, 'draft'); assert.ok(first[0].warehouse);
  assert.equal(second[0].scheduledAt, slots[0]);
  assert.notEqual(second[0].pageId, f.store.state.socialPages[0].id);
  assert.deepEqual(first.slice(1).map(p => p.scheduledAt), slots.slice(1));
  assert.equal(f.group.scheduleConfig.enabled, true);
});

test('editing group membership rejects in-flight removals, returns only unsent posts and keeps published comment retries', async t => {
  const f = await fixture(t), [pending, comment] = f.stock(2), local = f.store.state.socialPages[0];
  for (const post of [pending, comment]) Object.assign(post, { pageId: local.id, pageGroupId: 'group', status: 'scheduled', scheduledAt: '2027-01-04T09:00:00Z' });
  comment.publication = { externalPostId: 'already-posted', firstCommentStatus: 'error' };
  pending.automationStatus = 'publishing';
  const input = { id: 'group', name: 'Nhóm đăng', pageIds: f.group.pageIds.slice(1) };
  assert.equal((await f.request('/api/meta/page-groups', input)).status, 409);
  assert.equal(f.group.pageIds.length, 3);
  pending.automationStatus = null;
  assert.equal((await f.request('/api/meta/page-groups', input)).status, 200);
  assert.ok(pending.warehouse); assert.equal(pending.caption, 'Nội dung'); assert.equal(comment.publication.externalPostId, 'already-posted');
  assert.equal(comment.status, 'scheduled'); assert.equal(comment.warehouse, undefined);
});
