import fs from 'node:fs';
import path from 'node:path';

export const PUBLISHED_MEDIA_SWEEP_MS = 5 * 60 * 1000;
const unique = values => [...new Set(values.filter(Boolean))];
const references = (value, id) => value === id || Boolean(value && typeof value === 'object' && Object.values(value).some(child => references(child, id)));
const normalized = file => process.platform === 'win32' ? file.toLowerCase() : file;
const filesOf = media => unique([media.file, media.thumbnail, media.previewFile]);
export const isConfirmedPublication = record => record.status === 'published' && record.firstCommentStatus === 'published' && Boolean(record.externalPostId);

// Persist these IDs before deleting the final output. A later sweep/restart can
// then find the presenter even after the output's media record has gone away.
export function publishedMediaLineage(store, mediaId, previous = {}) {
  const media = store.state.media.find(item => item.id === mediaId);
  const jobIds = unique([...(previous.jobIds || []), ...store.state.jobs.filter(job => job.mediaId === mediaId || job.id === media?.jobId).map(job => job.id)]);
  const jobs = store.state.jobs.filter(job => jobIds.includes(job.id) && job.type === 'news');
  return {
    jobIds,
    presenterMediaIds: unique([...(previous.presenterMediaIds || []), media?.newsPresenterMediaId, ...jobs.map(job => job.payload?.presenterMediaId)]),
    editorialMediaIds: unique([...(previous.editorialMediaIds || []), ...(media?.newsImageMediaIds || []), ...jobs.flatMap(job => job.payload?.imageMediaIds || [])]),
    supersededMediaIds: unique(previous.supersededMediaIds || []).filter(id => id !== mediaId),
  };
}

function retirement(store, lineage) {
  const successful = (store.state.settings.meta?.publications || []).filter(isConfirmedPublication);
  return {
    outputs: new Set(successful.flatMap(record => record.mediaIds || [])),
    jobs: new Set([...(lineage.jobIds || []), ...successful.flatMap(record => record.mediaCleanup?.lineage?.jobIds || [])]),
  };
}

function retryWasPublished(store, job, retired) {
  if (!['failed', 'cancelled', 'interrupted'].includes(job.status)) return false;
  const seen = new Set(); let current = job;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    const next = store.state.jobs.filter(candidate => candidate.retryOf === current.id);
    if (!next.length) return current !== job && current.status === 'completed' && (retired.jobs.has(current.id) || retired.outputs.has(current.mediaId));
    if (next.length !== 1) return false;
    current = next[0];
  }
  return false;
}

function directlyReferenced(store, mediaId, postId, lineage) {
  const retired = retirement(store, lineage);
  return store.state.projects.some(project => references(project.timeline, mediaId))
    || store.state.socialPosts.some(post => post.id !== postId && references(post.mediaIds, mediaId))
    || store.state.jobs.some(job => job.status !== 'completed' && references(job.payload, mediaId) && !retryWasPublished(store, job, retired))
    || (store.state.productionBatches || []).some(batch => !['completed', 'cancelled'].includes(batch.status) && references(batch.request, mediaId))
    || store.state.accounts.some(account => account.avatarMediaId === mediaId)
    || (store.state.settings.meta?.pages || []).some(page => page.avatarMediaId === mediaId);
}

function presenterReferenced(store, mediaId, postId, lineage, omitted = new Set()) {
  const retired = retirement(store, lineage);
  const dependants = store.state.jobs.filter(job => references(job.payload, mediaId));
  if (dependants.some(job => job.status !== 'completed' ? !retryWasPublished(store, job, retired) : !retired.jobs.has(job.id) && !retired.outputs.has(job.mediaId))) return true;
  const dependantIds = new Set(dependants.map(job => job.id));
  return store.state.media.some(media => media.id !== mediaId && !omitted.has(media.id)
    && media.kind === 'video' && (media.newsPresenterMediaId === mediaId || media.newsImageMediaIds?.includes(mediaId) || dependantIds.has(media.jobId)));
}

function editorialResearchReferenced(store, mediaId, lineage) {
  const researchIds = (store.state.researchResults || []).filter(row => row.imageMediaIds?.includes(mediaId)).map(row => row.id);
  const retired = retirement(store, lineage);
  return researchIds.some(id => store.state.socialPosts.some(post => references(post.researchId, id))
    || store.state.jobs.some(job => job.status !== 'completed' && !retryWasPublished(store, job, retired) && (references(job.production, id) || references(job.payload, id)))
    || (store.state.productionBatches || []).some(batch => !['completed', 'cancelled'].includes(batch.status) && (references(batch.request, id) || (batch.items || []).some(item => !['completed', 'cancelled'].includes(item.status) && references(item, id)))));
}

function forgetMedia(store, id) {
  store.state.media = store.state.media.filter(media => media.id !== id);
  for (const research of store.state.researchResults || []) if (research.imageMediaIds?.includes(id)) research.imageMediaIds = research.imageMediaIds.filter(value => value !== id);
}

// Check the complete file set before deleting anything. Use a synchronous final
// reference/path check and unlink so another app request cannot add a reference
// in the middle of deleting one media item. No recursive deletion is performed.
function safeFiles(store, media, context) {
  const root = context.root ||= fs.realpathSync(store.root), logicalRoot = path.resolve(store.root), files = [];
  if (!context.paths) {
    const index = new Map();
    for (const other of store.state.media) for (const file of filesOf(other)) {
      let actual;
      try { actual = fs.realpathSync(file); } catch (error) {
        if (error.code !== 'ENOENT') return { reason: 'unverified_media_path' };
        actual = path.resolve(file);
      }
      const key = normalized(actual);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(other.id);
    }
    context.paths = index;
  }
  for (const file of filesOf(media)) {
    const relative = path.relative(logicalRoot, path.resolve(file));
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return { reason: 'outside_data_directory' };
    let cursor = logicalRoot;
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) return { reason: 'unsafe_media_path' }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let actual;
    try { actual = fs.realpathSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const resolved = path.relative(root, actual);
    if (!resolved || resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) return { reason: 'outside_data_directory' };
    const stat = fs.statSync(actual);
    if (!stat.isFile()) return { reason: 'not_a_file' };
    if ([...(context.paths.get(normalized(actual)) || [])].some(id => id !== media.id && store.state.media.some(other => other.id === id))) return { reason: 'media_still_referenced' };
    if (!files.some(item => normalized(item.file) === normalized(actual))) files.push({ file: actual, bytes: stat.size });
  }
  return { files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

function inspectItem(store, mediaId, postId, role, lineage, omitted = new Set(), context = {}) {
  const media = store.state.media.find(item => item.id === mediaId);
  const result = { mediaId, role, bytes: 0, name: media?.name || '', removable: false };
  if (!media) return { ...result, reason: 'media_not_found' };
  if (role === 'presenter' && !(media.generated && media.kind === 'video' && media.mediaType === 'news-presenter')) return { ...result, reason: 'not_generated_presenter' };
  if (role === 'superseded' && !(media.generated && media.kind === 'video' && media.mediaType === 'news-video')) return { ...result, reason: 'not_generated_output' };
  if (role === 'editorial' && !(media.kind === 'image' && media.mediaType === 'news-editorial')) return { ...result, reason: 'not_editorial_image' };
  if (directlyReferenced(store, mediaId, postId, lineage)
    || ['presenter', 'editorial'].includes(role) && presenterReferenced(store, mediaId, postId, lineage, omitted)
    || role === 'editorial' && editorialResearchReferenced(store, mediaId, lineage)) return { ...result, reason: 'media_still_referenced' };
  try {
    const checked = safeFiles(store, media, context);
    if (checked.reason) return { ...result, reason: checked.reason };
    return { ...result, removable: true, bytes: checked.bytes, files: checked.files };
  } catch { return { ...result, reason: 'media_cleanup_failed' }; }
}

const candidates = (mediaId, lineage) => [
  { mediaId, role: 'output' },
  ...lineage.supersededMediaIds.map(mediaId => ({ mediaId, role: 'superseded' })),
  ...lineage.presenterMediaIds.map(mediaId => ({ mediaId, role: 'presenter' })),
  ...(lineage.editorialMediaIds || []).map(mediaId => ({ mediaId, role: 'editorial' })),
].filter((item, index, all) => item.mediaId && all.findIndex(other => other.mediaId === item.mediaId) === index);

export function previewPublishedMedia(store, record, context = {}) {
  const mediaId = record.mediaIds?.[0];
  const lineage = publishedMediaLineage(store, mediaId, record.mediaCleanup?.lineage);
  const omitted = new Set(), items = [];
  for (const candidate of candidates(mediaId, lineage)) {
    const item = inspectItem(store, candidate.mediaId, record.postId, candidate.role, lineage, omitted, context);
    if (item.removable || item.reason === 'media_not_found') omitted.add(item.mediaId);
    const { files, ...publicItem } = item;
    items.push(publicItem);
  }
  return { postId: record.postId, lineage, items };
}

export async function cleanupPublishedMedia(store, mediaId, postId, previous = {}) {
  const lineage = publishedMediaLineage(store, mediaId, previous.lineage);
  const results = [];
  const context = {};
  let freedBytes = 0;
  for (const candidate of candidates(mediaId, lineage)) {
    const media = store.state.media.find(item => item.id === candidate.mediaId);
    if (media && candidate.role === 'output') media.metaPublishedAt ||= new Date().toISOString();
    const inspected = inspectItem(store, candidate.mediaId, postId, candidate.role, lineage, new Set(), context);
    const { files, removable, ...result } = inspected;
    result.removed = false;
    if (removable) {
      try {
        for (const file of files) { fs.unlinkSync(file.file); freedBytes += file.bytes; }
        forgetMedia(store, candidate.mediaId);
        result.removed = true;
      } catch { result.reason = 'media_cleanup_failed'; }
    }
    const prior = candidate.role === 'output' ? previous : previous.related?.find(item => item.mediaId === candidate.mediaId);
    if (result.reason === 'media_not_found' && prior?.removed) {
      result.removed = true; result.name = prior.name || ''; result.bytes = prior.bytes || 0; delete result.reason;
    }
    results.push(result);
  }
  const output = results[0] || { mediaId, removed: false, reason: 'media_not_found' };
  const result = { ...output, version: 3, lineage, related: results.slice(1), freedBytes: (previous.freedBytes || 0) + freedBytes };
  result.complete = candidates(mediaId, lineage).every(item => !store.state.media.some(media => media.id === item.mediaId));
  return result;
}

export class PublishedMediaCleanup {
  constructor(store, { intervalMs = PUBLISHED_MEDIA_SWEEP_MS } = {}) {
    this.store = store; this.stopping = false; this.pending = null; this.lastRun = null;
    this.timer = intervalMs ? setInterval(() => this.run().catch(() => {}), intervalMs) : null;
    this.timer?.unref?.();
  }
  preview() {
    const context = {};
    const records = (this.store.state.settings.meta?.publications || []).filter(isConfirmedPublication).map(record => previewPublishedMedia(this.store, record, context));
    const items = [...new Map(records.flatMap(record => record.items).map(item => [item.mediaId, item])).values()];
    return { intervalMs: PUBLISHED_MEDIA_SWEEP_MS, confirmedPosts: records.length, candidates: items.filter(item => item.removable).length, reclaimableBytes: items.filter(item => item.removable).reduce((sum, item) => sum + item.bytes, 0), items, lastRun: this.lastRun };
  }
  run() {
    if (this.pending) return this.pending;
    if (this.stopping) return Promise.resolve(null);
    this.pending = Promise.resolve().then(async () => {
      const removed = [];
      let changed = false, freedBytes = 0;
      for (const record of this.store.state.settings.meta?.publications || []) {
        if (this.stopping) break;
        if (!isConfirmedPublication(record)) continue;
        const previous = record.mediaCleanup || {}, before = new Set(this.store.state.media.map(media => media.id));
        if (previous.version === 3 && previous.complete && candidates(record.mediaIds?.[0], previous.lineage).every(item => !before.has(item.mediaId))) continue;
        const result = await cleanupPublishedMedia(this.store, record.mediaIds?.[0], record.postId, previous);
        freedBytes += result.freedBytes - (previous.freedBytes || 0);
        removed.push(...[...before].filter(id => !this.store.state.media.some(media => media.id === id)));
        if (JSON.stringify(previous) !== JSON.stringify(result)) { record.mediaCleanup = result; changed = true; }
        await new Promise(resolve => setImmediate(resolve));
      }
      if (changed) this.store.save();
      this.lastRun = { at: new Date().toISOString(), removedMediaIds: unique(removed), removedCount: unique(removed).length, freedBytes };
      return this.lastRun;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async close() { this.stopping = true; clearInterval(this.timer); await this.pending; }
}

// Manual library deletion uses the same path guards and rechecks each ID at the
// moment of deletion. Completed research image lists are detached, not deleted.
export async function deleteLibraryMedia(store, ids, { preview = false } = {}) {
  const results = []; let context = {};
  for (const mediaId of unique(ids)) {
    const media = store.state.media.find(item => item.id === mediaId);
    const item = inspectItem(store, mediaId, '', 'manual', {}, new Set(), context);
    if (item.removable && media?.kind === 'image' && editorialResearchReferenced(store, mediaId, {})) { item.removable = false; item.reason = 'media_still_referenced'; }
    // Raw MC still needed by an unposted output must survive bulk deletion.
    if (item.removable && media?.mediaType === 'news-presenter' && presenterReferenced(store, mediaId, '', {})) { item.removable = false; item.reason = 'media_still_referenced'; }
    const { files, ...result } = item;
    if (!preview && item.removable) {
      try { for (const file of files) fs.unlinkSync(file.file); forgetMedia(store, mediaId); result.removed = true; }
      catch { result.removed = false; result.reason = 'media_cleanup_failed'; }
    }
    results.push(result);
    if (results.length % 20 === 0) { await new Promise(resolve => setImmediate(resolve)); context = {}; }
  }
  const removed = results.filter(item => item.removed);
  if (removed.length) store.save();
  return { results, removedIds: removed.map(item => item.mediaId), removedCount: removed.length, freedBytes: removed.reduce((sum, item) => sum + item.bytes, 0), removableCount: results.filter(item => item.removable).length, blockedCount: results.filter(item => preview ? !item.removable : !item.removed).length };
}
