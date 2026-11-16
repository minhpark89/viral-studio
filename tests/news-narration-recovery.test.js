import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { successfulNarrationCandidates } from '../shared/news-narration-recovery.js';
import { retryReviewedNarrations } from '../server/news-narration-recovery.js';
import { newsJobAvatarId } from '../shared/news-avatar.js';

async function fixture(t) {
  const root = path.resolve('.verification', `narration-recovery-${randomUUID()}`), store = new Store(root);
  const project = store.createProject('Narration recovery'); store.state.settings.queuePaused = true;
  const queue = new JobQueue(store, {}, { intervalMs: 0 });
  t.after(async () => { await queue.close(); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'fixture.mp4'); await fs.writeFile(file, 'Only a paused queue fixture; never rendered');
  const media = () => store.add('media', { projectId: project.id, kind: 'video', file });
  const production = { researchId: randomUUID(), batchId: randomUUID(), itemIndex: 0, autoCreateContent: true };
  const plan = { sourceUrl: 'https://news.example/story?id=12', narration: 'This rejected narration keeps repeating on retry.', avatarMediaId: randomUUID(), voiceName: 'Grace' };
  const failed = store.add('jobs', { type: 'news', projectId: project.id, status: 'failed', errorCode: 'PROVIDER_CONTENT_REJECTED',
    production, payload: { newsPlan: plan, avatarMediaId: plan.avatarMediaId, imageMediaIds: [randomUUID(), randomUUID()] } });
  const source = store.add('jobs', { type: 'news', projectId: project.id, status: 'completed', mediaId: media().id,
    production: { ...production, batchId: randomUUID() }, payload: { newsPlan: { ...plan, narration: 'A reviewed factual narration from exactly the same article has completed successfully.' },
      avatarMediaId: plan.avatarMediaId, presenterMediaId: media().id, newsAvatarRequest: { id: 'confirmed-source-receipt' } } });
  const request = () => ({ projectId: project.id, entries: [{ jobId: failed.id, sourceJobId: source.id, narration: source.payload.newsPlan.narration }] });
  return { root, store, queue, project, failed, source, request };
}

test('same-story recovery preserves originals and all images, reuses matching presenter, and is idempotent', async t => {
  const f = await fixture(t), originals = structuredClone(f.store.state.jobs);
  const result = retryReviewedNarrations(f.store, f.queue, { ...f.request(), createContent: false });
  assert.equal(result.queued, 1); assert.equal(result.results[0].reusedPresenter, true);
  const child = f.store.require('jobs', result.results[0].jobId);
  assert.equal(child.status, 'queued'); assert.equal(child.retryOf, f.failed.id);
  assert.equal(child.production.autoCreateContent, false); assert.equal(f.failed.production.autoCreateContent, true);
  assert.deepEqual(child.payload.imageMediaIds, f.failed.payload.imageMediaIds);
  assert.equal(child.payload.avatarMediaId, f.failed.payload.avatarMediaId);
  assert.equal(child.payload.presenterMediaId, f.source.payload.presenterMediaId);
  assert.equal(child.payload.newsPlan.narration, f.source.payload.newsPlan.narration);
  assert.equal(child.narrationRecovery.sourceJobId, f.source.id);
  for (const old of originals) assert.deepEqual(f.store.require('jobs', old.id), old);
  assert.equal(retryReviewedNarrations(f.store, f.queue, f.request()).skipped, 1);
  assert.equal(f.store.state.jobs.length, 3); assert.equal(f.store.state.socialPosts.length, 0);
});

test('different MC image or voice reuses only narration, never the other presenter', async t => {
  for (const field of ['avatarMediaId', 'voiceName']) {
    const f = await fixture(t);
    if (field === 'avatarMediaId') f.source.payload.avatarMediaId = randomUUID();
    else f.source.payload.newsPlan.voiceName = 'Different voice';
    const result = retryReviewedNarrations(f.store, f.queue, f.request());
    assert.equal(result.queued, 1); assert.equal(result.results[0].reusedPresenter, false);
    const child = f.store.require('jobs', result.results[0].jobId);
    assert.equal(child.payload.presenterMediaId, undefined); assert.equal(child.payload.newsAvatarRequest, undefined);
    assert.equal(child.payload.avatarMediaId, f.failed.payload.avatarMediaId);
    assert.equal(child.payload.newsPlan.voiceName, f.failed.payload.newsPlan.voiceName);
  }
});

test('same headline cannot match another project, research, article query ID, or superseded output', async t => {
  for (const kind of ['project', 'research', 'article', 'superseded', 'missing-output', 'same-narration']) {
    const f = await fixture(t);
    if (kind === 'project') f.source.projectId = randomUUID();
    if (kind === 'research') f.source.production.researchId = randomUUID();
    if (kind === 'article') f.source.payload.newsPlan.sourceUrl = 'https://news.example/story?id=13';
    if (kind === 'superseded') f.store.add('jobs', { type: 'news', status: 'failed', retryOf: f.source.id });
    if (kind === 'missing-output') f.source.mediaId = randomUUID();
    if (kind === 'same-narration') f.source.payload.newsPlan.narration = f.failed.payload.newsPlan.narration;
    assert.equal(successfulNarrationCandidates(f.failed, f.store.state).length, 0, kind);
    assert.equal(retryReviewedNarrations(f.store, f.queue, f.request()).queued, 0, kind);
  }
});

test('submission evidence blocks editing even if the stored error says content rejection', async t => {
  for (const evidence of ['submittedAt', 'id', 'receiptSubmittedAt', 'presenter']) {
    const f = await fixture(t);
    if (evidence === 'submittedAt') f.failed.submittedAt = new Date().toISOString();
    if (evidence === 'id') f.failed.payload.newsAvatarRequest = { id: 'uncertain-receipt' };
    if (evidence === 'receiptSubmittedAt') f.failed.payload.newsAvatarRequest = { submittedAt: new Date().toISOString() };
    if (evidence === 'presenter') f.failed.payload.presenterMediaId = f.source.payload.presenterMediaId;
    assert.equal(successfulNarrationCandidates(f.failed, f.store.state).length, 0, evidence);
    assert.equal(retryReviewedNarrations(f.store, f.queue, f.request()).queued, 0);
    assert.equal(f.store.state.jobs.length, 2);
  }
});

test('stale reviewed text and missing video files leave the failed job untouched', async t => {
  for (const kind of ['text', 'file']) {
    const f = await fixture(t), request = f.request();
    if (kind === 'text') f.source.payload.newsPlan.narration = 'The source changed after the review was opened.';
    else await fs.unlink(f.store.require('media', f.source.mediaId).file);
    const result = retryReviewedNarrations(f.store, f.queue, request);
    assert.equal(result.queued, 0); assert.equal(result.review, 1);
    assert.equal(result.results[0].code, kind === 'text' ? 'NEWS_NARRATION_SOURCE_CHANGED' : 'NEWS_NARRATION_MEDIA_MISSING');
    assert.equal(f.store.state.jobs.length, 2); assert.equal(f.failed.status, 'failed');
  }
});

test('reviewed recovery respects selected IDs, project scope, duplicates and paused queue', async t => {
  const f = await fixture(t), other = f.store.add('jobs', { ...structuredClone(f.failed), id: undefined, production: { ...f.failed.production, itemIndex: 1 } });
  const request = f.request(); request.entries.push(request.entries[0], { ...request.entries[0], jobId: randomUUID() });
  const result = retryReviewedNarrations(f.store, f.queue, request);
  assert.equal(result.queued, 1); assert.equal(result.skipped, 1); assert.equal(other.status, 'failed');
  assert.equal(f.store.state.settings.queuePaused, true);
  const foreign = retryReviewedNarrations(f.store, f.queue, { ...request, projectId: f.store.createProject('Foreign').id });
  assert.equal(foreign.queued, 0);
});

test('legacy profile still is pinned on retry and can reuse a matching completed presenter',async t=>{
 const f=await fixture(t),image=f.store.add('media',{kind:'image',mediaType:'news-mc',projectId:null,file:'unused-in-paused-fixture'});
 image.createdAt='2026-11-14T01:00:00Z';
 const account=f.store.add('accounts',{avatarMediaId:image.id,avatarSource:'dreamface-image',avatarGeneratedAt:'2026-11-14T01:00:00Z'});
 for(const job of [f.failed,f.source]){delete job.payload.avatarMediaId;job.payload.newsPlan.avatarMediaId=null;job.accountId=account.id;job.startedAt='2026-11-15T01:00:00Z';}
 assert.equal(newsJobAvatarId(f.failed,f.store.state),image.id);
 const result=retryReviewedNarrations(f.store,f.queue,f.request());assert.equal(result.queued,1);assert.equal(result.results[0].reusedPresenter,true);
 assert.equal(f.store.require('jobs',result.results[0].jobId).payload.avatarMediaId,image.id);
 assert.equal(f.failed.payload.avatarMediaId,undefined);
});

test('legacy MC recovery refuses a newer profile image, another project, page avatar, or absent run date',async t=>{
 for(const kind of ['newer','project','page','undated']){
  const f=await fixture(t),image=f.store.add('media',{kind:'image',mediaType:'news-mc',projectId:null});image.createdAt='2026-11-14T01:00:00Z';
  const account=f.store.add('accounts',{avatarMediaId:image.id,avatarSource:'dreamface-image',avatarGeneratedAt:'2026-11-14T01:00:00Z'});
  delete f.failed.payload.avatarMediaId;f.failed.payload.newsPlan.avatarMediaId=null;f.failed.accountId=account.id;f.failed.startedAt='2026-11-15T01:00:00Z';
  if(kind==='newer')account.avatarGeneratedAt='2026-11-16T01:00:00Z';if(kind==='project')image.projectId=randomUUID();if(kind==='page')image.mediaType='page-avatar';if(kind==='undated')delete f.failed.startedAt;
  assert.equal(newsJobAvatarId(f.failed,f.store.state),null,kind);
 }
});
