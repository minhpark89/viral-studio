import { isPublishableVideo } from './output-media.js';

const active = new Set(['pending', 'queued', 'scheduled', 'preparing', 'submitting', 'rendering', 'downloading', 'generating_mc_image']);
const failed = new Set(['failed', 'cancelled', 'interrupted']);
const published = new Set(['published', 'published_comment_error']);

// Derive history instead of storing a second, easily stale "rendered" flag.
// A successful job remains evidence even after its published video is cleaned.
export function researchProgress(data, projectId) {
  const results = new Map((data.researchResults || []).filter(r => r.projectId === projectId).map(r => [r.id, {
    completed: new Set(), available: new Set(), active: 0, failed: 0, posted: false,
    lastAt: '', lastSuccessAt: '', latestBatchId: null, error: '', historicalFailed: 0,
  }]));
  const jobs = (data.jobs || []).filter(j => j.projectId === projectId);
  const byJob = new Map(jobs.map(j => [j.id, j]));
  const batches = (data.productionBatches || []).filter(b => b.projectId === projectId);
  const byBatch = new Map(batches.map(b => [b.id, b]));
  const byMedia = new Map((data.media || []).map(m => [m.id, m]));
  const jobResearch = job => {
    const visited = new Set();
    while (job && !visited.has(job.id)) {
      visited.add(job.id);
      const batch = byBatch.get(job.production?.batchId);
      const id = job.production?.researchId || job.payload?.researchId || batch?.items?.find(i => i.index === job.production?.itemIndex)?.researchId || batch?.request?.researchId;
      if (id) return id;
      job = byJob.get(job.retryOf);
    }
  };
  const jobSlot = job => {
    if (job.production?.batchId && job.production.itemIndex !== undefined) return `${job.production.batchId}:${job.production.itemIndex}`;
    const visited = new Set();
    while (job.retryOf && byJob.has(job.retryOf) && !visited.has(job.id)) { visited.add(job.id); job = byJob.get(job.retryOf); }
    return `job:${job.id}`;
  };
  const touch = (entry, at, batchId) => {
    if (at && (!entry.lastAt || Date.parse(at) >= Date.parse(entry.lastAt))) {
      entry.lastAt = at;
      entry.latestBatchId = batchId || null;
    } else if (!entry.lastAt && batchId) entry.latestBatchId = batchId;
  };
  const mediaResearch = new Map();
  const slots = new Map();
  for (const job of jobs.slice().sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))) {
    const id = jobResearch(job), entry = results.get(id);
    if (!entry || job.payload?.kind === 'image') continue;
    if (job.mediaId) mediaResearch.set(job.mediaId, id);
    if (job.status === 'completed' && (!byMedia.has(job.mediaId) || isPublishableVideo(byMedia.get(job.mediaId), jobs))) {
      entry.completed.add(jobSlot(job));
      const at = job.finishedAt || job.updatedAt || job.createdAt || '';
      if (Date.parse(at) > (Date.parse(entry.lastSuccessAt) || 0)) entry.lastSuccessAt = at;
    }
    touch(entry, job.finishedAt || job.updatedAt || job.createdAt, job.production?.batchId);
    slots.set(jobSlot(job), { id, status: job.status, error: job.error, batchId: job.production?.batchId, at: job.finishedAt || job.updatedAt || job.createdAt });
  }
  for (const batch of batches) for (const item of batch.items || []) {
    const id = item.researchId || batch.request?.researchId, entry = results.get(id);
    if (!entry) continue;
    touch(entry, batch.updatedAt || batch.createdAt, batch.id);
    const key = `${batch.id}:${item.index}`;
    if (slots.has(key) || item.jobId && byJob.has(item.jobId)) continue;
    slots.set(key, { id, status: item.status, error: item.error, batchId: batch.id, at: batch.updatedAt || batch.createdAt });
    if (item.status === 'completed') {
      entry.completed.add(key);
      const at = batch.updatedAt || batch.createdAt;
      if (Date.parse(at) > (Date.parse(entry.lastSuccessAt) || 0)) entry.lastSuccessAt = at;
    }
  }
  for (const media of data.media || []) {
    if (media.projectId && media.projectId !== projectId) continue;
    const id = media.production?.researchId || mediaResearch.get(media.id) || jobResearch(byJob.get(media.jobId));
    const entry = results.get(id);
    if (!entry || !isPublishableVideo(media, jobs)) continue;
    mediaResearch.set(media.id, id);
    const job = byJob.get(media.jobId) || jobs.find(j => j.mediaId === media.id);
    const key = job ? jobSlot(job) : media.production?.batchId && media.production.itemIndex !== undefined ? `${media.production.batchId}:${media.production.itemIndex}` : `media:${media.id}`;
    entry.completed.add(key); entry.available.add(media.id);
    touch(entry, media.createdAt, media.production?.batchId || job?.production?.batchId);
    if (Date.parse(media.createdAt) > (Date.parse(entry.lastSuccessAt) || 0)) entry.lastSuccessAt = media.createdAt;
  }
  for (const item of slots.values()) {
    const entry = results.get(item.id);
    if (active.has(item.status)) entry.active++;
    if (!failed.has(item.status)) continue;
    entry.historicalFailed++;
    // Older failed batches do not turn a later successful story back into a
    // failure. A partial current batch and failures after success still matter.
    if (!entry.completed.size || item.batchId && item.batchId === entry.latestBatchId || !item.at || !entry.lastSuccessAt || Date.parse(item.at) >= Date.parse(entry.lastSuccessAt)) {
      entry.failed++; entry.error = item.error || (item.status === 'cancelled' ? 'Đã hủy' : 'Render bị gián đoạn');
    }
  }
  for (const post of [...(data.socialPosts || []), ...(data.settings?.meta?.publications || [])]) {
    if (post.projectId && post.projectId !== projectId || !published.has(post.status)) continue;
    const ids = [post.researchId, ...(post.mediaIds || []).map(id => mediaResearch.get(id))];
    for (const id of ids) if (results.has(id)) results.get(id).posted = true;
  }
  return new Map([...results].map(([id, entry]) => [id, {
    ...entry, completed: entry.completed.size, available: entry.available.size, mediaIds: [...entry.available],
    state: entry.active ? 'running' : entry.failed ? 'failed' : entry.completed.size ? 'rendered' : 'new',
  }]));
}

export const researchViews = [
  ['work', 'Cần xử lý'], ['not-rendered', 'Chưa có video'], ['running', 'Đang xử lý'],
  ['rendered', 'Đã có video'], ['failed', 'Lỗi / đã dừng'], ['posted', 'Đã đăng'], ['archived', 'Đã lưu trữ'], ['all', 'Tất cả / lịch sử'],
];

export function matchesResearchView(progress, view) {
  if (view === 'work') return progress.state !== 'rendered';
  if (view === 'not-rendered') return progress.completed === 0;
  if (view === 'rendered') return progress.completed > 0;
  if (view === 'posted') return progress.posted;
  if (view === 'running') return progress.active > 0;
  if (view === 'failed') return progress.failed > 0;
  return true;
}
