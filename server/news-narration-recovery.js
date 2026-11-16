import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { successfulNarrationCandidates, normalizeNewsNarration, canReuseNewsPresenter } from '../shared/news-narration-recovery.js';
import { latestJobs } from '../shared/queue-retry.js';
import { StudioError } from './store.js';

const requestSchema = z.object({
  projectId: z.string().uuid(),
  entries: z.array(z.object({ jobId: z.string().uuid(), sourceJobId: z.string().uuid(), narration: z.string().min(20).max(500) })).min(1).max(2000),
  createContent: z.literal(false).optional(),
});

export function retryReviewedNarrations(store, queue, input) {
  const request = requestSchema.parse(input);
  store.require('projects', request.projectId);
  const results = [], seen = new Set();
  for (const entry of request.entries) {
    if (seen.has(entry.jobId)) continue;
    seen.add(entry.jobId);
    const job = store.state.jobs.find(row => row.id === entry.jobId && row.projectId === request.projectId);
    if (!job || !latestJobs(store.state.jobs).some(row => row.id === job.id)) {
      results.push({ id: entry.jobId, status: 'skipped', reason: 'Tác vụ đã thay đổi hoặc đã có lần thử mới.' }); continue;
    }
    try {
      const source = successfulNarrationCandidates(job, store.state).find(row => row.id === entry.sourceJobId);
      if (!source || normalizeNewsNarration(entry.narration) !== normalizeNewsNarration(source.payload.newsPlan.narration))
        throw new StudioError('Bản lời dẫn đã xem không còn hợp lệ cho đúng nguồn tin này. Hãy tải lại và kiểm tra.', 'NEWS_NARRATION_SOURCE_CHANGED', 409);
      for (const id of [source.mediaId, source.payload.presenterMediaId]) {
        const media = store.require('media', id);
        if (!media.file || !fs.existsSync(media.file) || fs.statSync(media.file).size === 0)
          throw new StudioError('Không tìm thấy video của bản lời dẫn đã thành công trên ổ đĩa.', 'NEWS_NARRATION_MEDIA_MISSING', 409);
      }
      const narration = normalizeNewsNarration(entry.narration);
      const retried = queue.retry(job.id, false, narration);
      const reusePresenter = canReuseNewsPresenter(job, source, store.state);
      const payload = { ...retried.payload, newsPlan: { ...retried.payload.newsPlan,
        estimatedSeconds: Math.max(15, Math.round(narration.split(/\s+/u).length / 2.35 * 10) / 10) } };
      if (reusePresenter) {
        payload.presenterMediaId = source.payload.presenterMediaId;
        if (source.payload.newsAvatarRequest) payload.newsAvatarRequest = structuredClone(source.payload.newsAvatarRequest);
      }
      store.patch('jobs', retried.id, {
        payload,
        ...(request.createContent === false && retried.production ? { production: { ...retried.production, autoCreateContent: false } } : {}),
        narrationRecovery: { sourceJobId: source.id, sourceMediaId: source.mediaId, reviewedAt: new Date().toISOString(),
          narrationHash: createHash('sha256').update(narration).digest('hex'), reusedPresenter: reusePresenter },
      });
      store.log(retried, reusePresenter ? 'Dùng lời dẫn và MC đã thành công của đúng nguồn tin, cùng ảnh MC và giọng đọc; giữ ảnh tin của mục này.'
        : 'Dùng lời dẫn đã thành công của đúng nguồn tin; giữ ảnh MC, giọng đọc và ảnh tin của mục này.');
      results.push({ id: job.id, jobId: retried.id, sourceJobId: source.id, status: 'queued', reusedPresenter: reusePresenter });
    } catch (error) { results.push({ id: entry.jobId, status: 'review', code: error.code, reason: error.message }); }
  }
  queue.tick();
  return { results, queued: results.filter(row => row.status === 'queued').length,
    review: results.filter(row => row.status === 'review').length, skipped: results.filter(row => row.status === 'skipped').length };
}
