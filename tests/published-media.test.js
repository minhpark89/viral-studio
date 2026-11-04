import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { cleanupPublishedMedia, publishedMediaLineage, PublishedMediaCleanup, deleteLibraryMedia } from '../server/published-media.js';

async function fixture(t) {
  const base = path.resolve('.verification'), root = path.join(base, 'published-media-' + randomUUID());
  const store = new Store(root), project = store.createProject('Cleanup fixture');
  t.after(async () => { assert(root.startsWith(base + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  async function media(type = 'news-presenter', generated = true) {
    const id = randomUUID(), file = path.join(root, 'media', id + '.mp4'), thumbnail = path.join(root, 'thumbs', id + '.jpg');
    await fs.writeFile(file, 'video-fixture'); await fs.writeFile(thumbnail, 'thumbnail-fixture');
    return store.add('media', { id, kind: 'video', generated, mediaType: type, projectId: project.id, file, thumbnail, name: type });
  }
  const presenter = await media(), output = await media('news-video');
  const job = store.add('jobs', { type: 'news', status: 'completed', projectId: project.id, mediaId: output.id, payload: { presenterMediaId: presenter.id } });
  output.jobId = job.id; output.newsPresenterMediaId = presenter.id; presenter.jobId = job.id;
  const publication = { postId: randomUUID(), mediaIds: [output.id], status: 'published', firstCommentStatus: 'published', externalPostId: 'verified-remote-video' };
  store.state.settings.meta.publications.push(publication);
  const service = new PublishedMediaCleanup(store, { intervalMs: 0 }); t.after(() => service.close());
  return { store, root, project, media, presenter, output, job, publication, service };
}
const exists = file => fs.access(file).then(() => true, () => false);

test('confirmed publication removes its final video and generated MC with thumbnails, preserving other assets', async t => {
  const f = await fixture(t), uploaded = await f.media('news-presenter', false), avatar = await f.media('news-mc'); avatar.kind = 'image';
  const before = f.service.preview(); assert.equal(before.candidates, 2); assert.equal(await exists(f.output.file), true);
  const result = await f.service.run(); assert.equal(result.removedCount, 2); assert.equal(result.freedBytes, before.reclaimableBytes);
  for (const m of [f.output, f.presenter]) { assert.equal(await exists(m.file), false); assert.equal(await exists(m.thumbnail), false); }
  assert.equal(await exists(uploaded.file), true); assert.equal(await exists(avatar.file), true);
  assert.equal(f.store.state.jobs[0].payload.presenterMediaId, f.presenter.id, 'History retains provenance');
  assert.equal(f.store.state.settings.meta.publications[0].externalPostId, 'verified-remote-video');
  assert.equal(f.publication.mediaCleanup.complete, true);
});

test('another unpublished output/draft keeps a shared MC until both publications finish', async t => {
  const f = await fixture(t), second = await f.media('news-video');
  const job = f.store.add('jobs', { type: 'news', status: 'completed', mediaId: second.id, payload: { presenterMediaId: f.presenter.id } }); second.jobId = job.id;
  f.store.state.socialPosts.push({ id: 'draft-two', mediaIds: [second.id] });
  assert.equal((await f.service.run()).removedCount, 1); assert.equal(await exists(f.presenter.file), true);
  f.store.state.socialPosts = [];
  f.store.state.settings.meta.publications.push({ postId: 'draft-two', mediaIds: [second.id], status: 'published', firstCommentStatus: 'published', externalPostId: 'second-remote' });
  const result = await f.service.run(); assert.equal(result.removedCount, 2); assert.equal(await exists(f.presenter.file), false);
});

test('queued, active and failed jobs protect MC needed for processing or a manual retry', async t => {
  const f = await fixture(t);
  const retry = f.store.add('jobs', { type: 'news', status: 'queued', payload: { presenterMediaId: f.presenter.id } });
  for (const status of ['queued', 'rendering', 'failed', 'cancelled', 'interrupted']) {
    retry.status = status; await f.service.run(); assert.equal(await exists(f.presenter.file), true, status);
  }
  f.store.state.jobs = f.store.state.jobs.filter(j => j.id !== retry.id);
  assert.equal((await f.service.run()).removedCount, 1); assert.equal(await exists(f.presenter.file), false);
});

test('a timeline reference or second post keeps the published output and its MC', async t => {
  const f = await fixture(t);
  f.project.timeline.clips = [{ mediaId: f.output.id }];
  assert.equal((await f.service.run()).removedCount, 0);
  f.project.timeline.clips = []; f.store.state.socialPosts.push({ id: 'other-post', mediaIds: [f.output.id] });
  assert.equal((await f.service.run()).removedCount, 0);
  f.store.state.socialPosts = []; assert.equal((await f.service.run()).removedCount, 2);
});

test('a failed ancestor stops retaining MC only after its exact retry is completed and published', async t => {
  const f = await fixture(t);
  const ancestor = f.store.add('jobs', { type: 'news', status: 'failed', payload: { presenterMediaId: f.presenter.id } });
  f.job.retryOf = ancestor.id;
  f.publication.status = 'published_comment_error';
  assert.equal((await f.service.run()).removedCount, 0);
  f.publication.status = 'published';
  assert.equal((await f.service.run()).removedCount, 2);
  assert.equal(await exists(f.presenter.file), false);
});

test('video upload alone and first-comment failures never trigger the sweep', async t => {
  const f = await fixture(t);
  f.publication.status = 'published_comment_error'; f.publication.firstCommentStatus = 'error';
  assert.equal(f.service.preview().confirmedPosts, 0); assert.equal((await f.service.run()).removedCount, 0);
  f.publication.status = 'published'; assert.equal((await f.service.run()).removedCount, 0);
  f.publication.firstCommentStatus = 'published'; assert.equal((await f.service.run()).removedCount, 2);
});

test('restart cleans legacy MC whose final output was already removed, without deleting unrelated MC', async t => {
  const f = await fixture(t), other = await f.media();
  await fs.unlink(f.output.file); await fs.unlink(f.output.thumbnail); f.store.state.media = f.store.state.media.filter(m => m.id !== f.output.id);
  f.publication.mediaCleanup = { removed: true, mediaId: f.output.id }; f.store.save();
  const reopened = new Store(f.root), service = new PublishedMediaCleanup(reopened, { intervalMs: 0 }); t.after(() => service.close());
  assert.equal((await service.run()).removedCount, 1); assert.equal(await exists(f.presenter.file), false); assert.equal(await exists(other.file), true);
  const saved = JSON.stringify(reopened.state.settings.meta.publications);
  assert.equal((await service.run()).freedBytes, 0); assert.equal(JSON.stringify(reopened.state.settings.meta.publications), saved);
});

test('explicit presenter provenance works even without an in-memory producer job', async t => {
  const f = await fixture(t); f.store.state.jobs = [];
  assert.deepEqual(publishedMediaLineage(f.store, f.output.id).presenterMediaIds, [f.presenter.id]);
  assert.equal((await f.service.run()).removedCount, 2);
});

test('raw images and manually imported MC videos are never treated as disposable generated MC', async t => {
  const f = await fixture(t); f.presenter.generated = false;
  await f.service.run(); assert.equal(await exists(f.presenter.file), true);
  f.presenter.generated = true; f.presenter.kind = 'image'; await f.service.run(); assert.equal(await exists(f.presenter.file), true);
});

test('all paths are validated before deletion and an external thumbnail keeps the final and MC', async t => {
  const f = await fixture(t), external = path.join(path.dirname(f.root), 'outside-' + randomUUID() + '.png');
  await fs.writeFile(external, 'external'); t.after(() => fs.rm(external, { force: true })); f.output.previewFile = external;
  assert.equal((await f.service.run()).removedCount, 0);
  assert.equal(await exists(f.output.file), true); assert.equal(await exists(external), true); assert.equal(await exists(f.presenter.file), true);
});

test('shared file aliases and junction paths cannot delete another media asset', async t => {
  const f = await fixture(t), alias = await f.media('general'); alias.file = f.output.file;
  assert.equal((await f.service.run()).removedCount, 0);
  alias.file = path.join(f.root, 'media', alias.id + '.mp4');
  const link = path.join(f.root, 'linked-media'); await fs.symlink(path.join(f.root, 'media'), link, 'junction');
  f.output.file = path.join(link, path.basename(f.output.file));
  assert.equal((await f.service.run()).removedCount, 0); assert.equal(await exists(f.output.file), true);
});

test('a new job added after a preview is rechecked before deleting MC', async t => {
  const f = await fixture(t); assert.equal(f.service.preview().candidates, 2);
  f.store.add('jobs', { status: 'preparing', payload: { presenterMediaId: f.presenter.id } });
  assert.equal((await f.service.run()).removedCount, 1); assert.equal(await exists(f.presenter.file), true);
});

test('recorded replacement outputs are removed before their MC but an unrecorded variation stays intact', async t => {
  const f = await fixture(t), old = await f.media('news-video'), unrelated = await f.media('news-video'); old.jobId = f.job.id;
  f.publication.mediaCleanup = { lineage: { jobIds: [f.job.id], presenterMediaIds: [f.presenter.id], supersededMediaIds: [old.id] } };
  assert.equal((await f.service.run()).removedCount, 3); assert.equal(await exists(old.file), false); assert.equal(await exists(unrelated.file), true);
});

test('overlapping sweeps coalesce and closing stops subsequent cleanup', async t => {
  const f = await fixture(t); const a = f.service.run(), b = f.service.run(); assert.equal(a, b); assert.equal((await a).removedCount, 2);
  await f.service.close(); const extra = await f.media('news-video');
  f.store.state.settings.meta.publications.push({ postId: 'later', mediaIds: [extra.id], status: 'published', firstCommentStatus: 'published', externalPostId: 'later' });
  assert.equal(await f.service.run(), null); assert.equal(await exists(extra.file), true);
});

test('published cleanup HTTP preview is read-only and cleanup preserves publication history', async t => {
  const f = await fixture(t); f.store.save();
  const { startServer } = await import('../server/index.js'); const studio = await startServer({ port: 0, dataDir: f.root }); t.after(() => studio.close());
  // Startup is itself a cleanup trigger; use a new independent generated output
  // to verify the two HTTP actions after that initial sweep has settled.
  await studio.publishedMediaCleanup.run();
  const file = path.join(f.root, 'media', 'http-test.mp4'); await fs.writeFile(file, 'http-fixture');
  const media = studio.store.add('media', { kind: 'video', generated: true, mediaType: 'news-video', file });
  studio.store.state.settings.meta.publications.push({ postId: 'http-post', mediaIds: [media.id], status: 'published', firstCommentStatus: 'published', externalPostId: 'http-remote' }); studio.store.save();
  const preview = await fetch(studio.address + '/api/storage/published-media').then(r => r.json()); assert.equal(preview.candidates, 1); assert.equal(await exists(file), true);
  const cleaned = await fetch(studio.address + '/api/storage/published-media/clean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
  assert.equal(cleaned.removedCount, 1); assert.equal(await exists(file), false); assert.equal(studio.store.state.settings.meta.publications.length, 2);
});

test('published editorial images are cleaned with their output while reusable MC images survive', async t => {
  const f=await fixture(t), editorial=await f.media('news-editorial'), avatar=await f.media('news-mc');editorial.kind='image';avatar.kind='image';
  f.job.payload.imageMediaIds=[editorial.id,avatar.id];f.output.newsImageMediaIds=[editorial.id];
  f.store.state.researchResults.push({id:'story',imageMediaIds:[editorial.id,avatar.id],headline:'Keep source text'});
  const result=await f.service.run();assert.equal(result.removedCount,3);assert.equal(await exists(editorial.file),false);assert.equal(await exists(avatar.file),true);
  assert.deepEqual(f.publication.mediaCleanup.lineage.editorialMediaIds,[editorial.id,avatar.id]);assert.deepEqual(f.store.state.researchResults[0].imageMediaIds,[avatar.id]);assert.equal(f.store.state.researchResults[0].headline,'Keep source text');
});

test('shared editorial images stay until every output is published and no draft or preparation still needs the story', async t => {
  const f=await fixture(t), image=await f.media('news-editorial'), second=await f.media('news-video');image.kind='image';f.job.payload.imageMediaIds=[image.id];
  second.newsImageMediaIds=[image.id];const other=f.store.add('jobs',{type:'news',status:'completed',mediaId:second.id,payload:{imageMediaIds:[image.id]}});second.jobId=other.id;
  f.store.state.researchResults.push({id:'story',imageMediaIds:[image.id]});
  await f.service.run();assert.equal(await exists(image.file),true);
  f.store.state.settings.meta.publications.push({postId:'second-post',mediaIds:[second.id],status:'published',firstCommentStatus:'published',externalPostId:'second-remote'});
  f.store.state.socialPosts.push({id:'draft',researchId:'story',mediaIds:[]});await f.service.run();assert.equal(await exists(image.file),true);
  f.store.state.socialPosts=[];await f.service.run();assert.equal(await exists(image.file),false);
});

test('version-two completed cleanup recovers editorial lineage after final output removal', async t => {
  const f=await fixture(t), image=await f.media('news-editorial');image.kind='image';f.job.payload.imageMediaIds=[image.id];
  for(const item of [f.output,f.presenter]){await fs.unlink(item.file);await fs.unlink(item.thumbnail);}f.store.state.media=f.store.state.media.filter(item=>![f.output.id,f.presenter.id].includes(item.id));
  f.publication.mediaCleanup={version:2,complete:true,removed:true,lineage:{jobIds:[f.job.id],presenterMediaIds:[f.presenter.id],supersededMediaIds:[]}};
  const result=await f.service.run();assert.equal(result.removedCount,1);assert.equal(f.publication.mediaCleanup.version,3);assert.equal(await exists(image.file),false);
});

test('bulk library deletion previews without deleting, preserves avatars and rechecks a new draft before confirmation', async t => {
  const f=await fixture(t), removable=await f.media('general'), accountImage=await f.media('news-mc'), pageImage=await f.media('page-avatar');accountImage.kind=pageImage.kind='image';
  f.store.state.accounts.push({id:'account',avatarMediaId:accountImage.id});f.store.state.settings.meta.pages.push({id:'123',avatarMediaId:pageImage.id});
  const ids=[removable.id,accountImage.id,pageImage.id];const preview=await deleteLibraryMedia(f.store,ids,{preview:true});assert.equal(preview.removableCount,1);assert.equal(preview.blockedCount,2);assert.equal(await exists(removable.file),true);
  f.store.state.socialPosts.push({id:'new-draft',mediaIds:[removable.id]});const changed=await deleteLibraryMedia(f.store,ids);assert.equal(changed.removedCount,0);assert.equal(changed.blockedCount,3);
  f.store.state.socialPosts=[];const result=await deleteLibraryMedia(f.store,ids);assert.equal(result.removedCount,1);assert.equal(result.blockedCount,2);assert.equal(await exists(accountImage.file),true);assert.equal(await exists(pageImage.file),true);
});

test('bulk delete detaches finished research images but refuses aliases and files outside the workspace', async t => {
  const f=await fixture(t), image=await f.media('news-editorial'), alias=await f.media('general');image.kind='image';
  f.store.state.researchResults.push({id:'old-story',imageMediaIds:[image.id]});
  const old=alias.file;alias.file=image.file;assert.equal((await deleteLibraryMedia(f.store,[image.id])).removedCount,0);alias.file=old;
  const outside=path.join(path.dirname(f.root),'outside-'+randomUUID()+'.mp4');await fs.writeFile(outside,'keep outside');t.after(()=>fs.unlink(outside));
  const prior=alias.file;alias.file=outside;assert.equal((await deleteLibraryMedia(f.store,[alias.id])).removedCount,0);assert.equal(await exists(outside),true);alias.file=prior;
  assert.equal((await deleteLibraryMedia(f.store,[image.id])).removedCount,1);assert.deepEqual(f.store.state.researchResults[0].imageMediaIds,[]);
});
