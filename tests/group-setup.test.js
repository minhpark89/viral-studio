import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { mountMetaRoutes } from '../server/meta.js';
import { autoScheduleWarehousePosts } from '../server/social.js';
import { resolvePageToken } from '../server/page-routing.js';

async function fixture(t) {
  const store = new Store(path.resolve('.verification', `group-setup-${randomUUID()}`));
  const meta = store.state.settings.meta;
  meta.tokens = Array.from({ length: 20 }, (_, i) => ({ id: `token-${i}`, name: i < 10 ? 'N 1' : 'N 2', status: 'ACTIVE', token: `synthetic-secret-${i}` }));
  meta.pages = Array.from({ length: 60 }, (_, i) => ({ id: String(10000 + i), name: `Page ${i + 1}`, verification: { status: 'passed' }, tokenBindings: Object.fromEntries(meta.tokens.slice(i < 30 ? 0 : 10, i < 30 ? 10 : 20).map(token => [token.id, { status: 'VERIFIED', pageToken: `synthetic-page-${i}-${token.id}`, credentialFingerprint: createHash('sha256').update(token.token).digest('hex') }])) }));
  store.state.socialPages = meta.pages.map(page => ({ id: randomUUID(), externalId: page.id, name: page.name, archived: false, revision: 1 }));
  meta.pageGroups = [{ id: 'old-group', name: 'Nhóm cũ', pageIds: ['10000'], scheduleConfig: { enabled: false, autoPublish: false, times: [] } }];
  const tokenIds = meta.tokens.slice(10).map(token => token.id), pageIds = meta.pages.slice(30).map(page => page.id);
  store.save();
  const app = express(); app.use(express.json());
  const service = mountMetaRoutes(app, store, { client: {} });
  app.use((error, req, res, next) => res.status(error.status || 400).json({ error: error.message, code: error.code }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { await service.close(); await new Promise(resolve => server.close(resolve)); });
  const request = async (route, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/meta/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const input = { requestId: randomUUID(), name: 'N 2', tokenIds, pageIds, scheduleConfig: { enabled: false, autoPublish: false, times: [], timezone: 'Asia/Ho_Chi_Minh' } };
  return { store, meta, request, input, tokenIds, pageIds };
}

test('10 newly imported tokens yield 30 distinct Pages, one group and a balanced isolated pool; disabled setup leaves warehouse untouched', async t => {
  const f = await fixture(t);
  f.store.state.socialPosts.push({ id: 'warehouse-untouched', status: 'ready', caption: 'Synthetic', firstComment: 'Synthetic', mediaIds: ['synthetic-media'], pageId: '', pageGroupId: '' });
  const beforePreview = JSON.stringify(f.store.state), posts = structuredClone(f.store.state.socialPosts), oldGroup = structuredClone(f.meta.pageGroups[0]);
  const preview = await f.request('group-setup/preview', { tokenIds: [...f.tokenIds, f.tokenIds[0]] });
  assert.equal(preview.status, 200); assert.deepEqual(preview.body.readyPageIds, f.pageIds);
  assert.equal(preview.body.pages.length, 30); assert.equal(JSON.stringify(f.store.state), beforePreview);
  assert.ok(!JSON.stringify(preview.body).includes('synthetic-secret')); assert.ok(!JSON.stringify(preview.body).includes('synthetic-page'));
  const saved = await f.request('group-setup', { ...f.input, pageIds: [...f.pageIds, f.pageIds[0]] });
  assert.equal(saved.status, 201); assert.equal(saved.body.group.pageIds.length, 30);
  assert.equal(saved.body.group.readyPageCount, 30); assert.equal(saved.body.group.scheduleConfig.enabled, false);
  assert.equal(saved.body.group.scheduleConfig.autoPublish, false); assert.equal(saved.body.group.scheduleConfig.timezone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(Object.values(saved.body.pool.assignmentLoads), Array(10).fill(3));
  assert.equal(saved.body.pool.pageScope, 'group'); assert.equal(saved.body.pool.pageGroupId, saved.body.group.id);
  assert.equal(saved.body.group.scheduleConfig.tokenGroupId, saved.body.pool.id);
  for (const id of f.pageIds) { const page = f.meta.pages.find(page => page.id === id); assert.ok(page.groupIds.includes(saved.body.group.id)); assert.ok(f.tokenIds.includes(resolvePageToken(f.meta, page, saved.body.pool.id).tokenId)); }
  assert.deepEqual(f.meta.pageGroups[0], oldGroup); assert.deepEqual(f.store.state.socialPosts, posts);
  const restarted = new Store(f.store.root);
  assert.equal(restarted.state.settings.meta.pageGroups.length, 2); assert.equal(restarted.state.settings.meta.tokenGroups.length, 1);
  const replay = await f.request('group-setup', { ...f.input, pageIds: [...f.pageIds, f.pageIds[0]] });
  assert.equal(replay.status, 200); assert.equal(replay.body.reused, true); assert.equal(f.meta.tokenGroups.length, 1); assert.equal(f.meta.pageGroups.length, 2);
  assert.equal((await f.request('group-setup', { ...f.input, name: 'Different request' })).status, 409);
});

test('preview explains unavailable Pages and save rejects stale, unrelated or empty selections without partial groups', async t => {
  const f = await fixture(t);
  f.meta.pages[30].publishingHealth = { blocked: true };
  f.store.state.socialPages[31].archived = true;
  f.meta.pages[32].verification = { status: 'unknown' };
  const preview = await f.request('group-setup/preview', { tokenIds: f.tokenIds });
  assert.equal(preview.body.pages.length, 30); assert.equal(preview.body.blocked.length, 3); assert.equal(preview.body.readyPageIds.length, 27);
  assert.ok(preview.body.blocked.every(page => page.reason));
  const before = JSON.stringify(f.store.state);
  for (const pageIds of [f.pageIds, ['10000'], []]) {
    const result = await f.request('group-setup', { ...f.input, pageIds });
    assert.ok(result.status >= 400); assert.equal(JSON.stringify(f.store.state), before);
  }
  f.meta.tokens[10].status = 'ERROR';
  assert.equal((await f.request('group-setup', { ...f.input, pageIds: preview.body.readyPageIds })).status, 409);
  assert.equal(f.meta.tokenGroups.length, 0); assert.equal(f.meta.pageGroups.length, 1);
});

test('existing pool keeps assignments and scope; group setup cannot use a Page outside the pool', async t => {
  const f = await fixture(t);
  const pool = (await f.request('token-groups', { name: 'Existing pool', tokenIds: f.tokenIds, pageScope: 'selected', selectedPageIds: f.pageIds.slice(0, 5) })).body.group;
  const before = JSON.stringify(f.meta.tokenGroups);
  const preview = await f.request('group-setup/preview', { poolId: pool.id });
  assert.equal(preview.body.readyPageIds.length, 5);
  const input = { ...f.input, tokenIds: [], poolId: pool.id, pageIds: preview.body.readyPageIds };
  assert.equal((await f.request('group-setup', { ...input, pageIds: f.pageIds })).status, 409);
  const result = await f.request('group-setup', input);
  assert.equal(result.status, 201); assert.equal(f.meta.tokenGroups.length, 1); assert.equal(JSON.stringify(f.meta.tokenGroups), before);
  assert.equal(result.body.group.scheduleConfig.tokenGroupId, pool.id);
  assert.equal((await f.request('group-setup/preview', { poolId: 'missing' })).status, 409);
});

test('save failure rolls back group, pool, memberships and revisions; retry creates exactly one pair', async t => {
  const f = await fixture(t), before = JSON.stringify(f.store.state), save = f.store.save;
  f.store.save = () => { throw Error('Synthetic write failure'); };
  assert.ok((await f.request('group-setup', f.input)).status >= 400);
  assert.equal(JSON.stringify(f.store.state), before);
  f.store.save = save;
  assert.equal((await f.request('group-setup', f.input)).status, 201);
  assert.equal(f.meta.pageGroups.length, 2); assert.equal(f.meta.tokenGroups.length, 1);
});

test('invalid schedules are rejected; explicit Auto Post schedule uses the selected token pool', async t => {
  const f = await fixture(t);
  for (const scheduleConfig of [{ enabled: true, times: [] }, { times: ['25:00'] }, { timezone: 'Invalid/Zone' }]) {
    assert.ok((await f.request('group-setup', { ...f.input, scheduleConfig })).status >= 400);
    assert.equal(f.meta.pageGroups.length, 1); assert.equal(f.meta.tokenGroups.length, 0);
  }
  const saved = await f.request('group-setup', { ...f.input, scheduleConfig: { enabled: true, autoPublish: true, times: ['09:00', '15:00'], timezone: 'Asia/Ho_Chi_Minh', dailyLimit: 2 } });
  assert.equal(saved.status, 201);
  const project = f.store.createProject('Schedule QA');
  const media = f.store.add('media', { name: 'synthetic.mp4', projectId: project.id, kind: 'video', mediaType: 'product-video', generated: true });
  f.store.add('socialPosts', { projectId: project.id, caption: 'Synthetic', firstComment: 'Synthetic comment', mediaIds: [media.id], status: 'ready', contentType: 'product', pageId: '', pageGroupId: '' });
  const scheduled = autoScheduleWarehousePosts(f.store, saved.body.group.id, { nowValue: Date.parse('2026-11-17T00:00:00Z') }).scheduled;
  assert.equal(scheduled.length, 1); assert.equal(scheduled[0].tokenGroupId, saved.body.pool.id);
  const externalId = f.store.state.socialPages.find(page => page.id === scheduled[0].pageId).externalId;
  assert.ok(f.pageIds.includes(externalId));
});
