import fs from 'node:fs';
import { z } from 'zod';
import { retryAction } from '../shared/queue-retry.js';

const requestSchema = z.object({
  projectId: z.string().uuid(),
  jobIds: z.array(z.string().uuid()).max(2000).default([]),
  preparations: z.array(z.object({ batchId: z.string().uuid(), index: z.number().int().min(0) })).max(2000).default([]),
});

export function retryFailedSelection(store, queue, production, input) {
  const request = requestSchema.parse(input);
  store.require('projects', request.projectId);
  const results = [];
  for (const id of new Set(request.jobIds)) {
    const job = store.state.jobs.find(row => row.id === id && row.projectId === request.projectId);
    if (!job) { results.push({ id, status: 'skipped', reason: 'Không tìm thấy tác vụ trong dự án.' }); continue; }
    const decision = retryAction(job, store.state);
    if (['skip', 'review'].includes(decision.action)) { results.push({ id, status: decision.action === 'review' ? 'review' : 'skipped', reason: decision.reason }); continue; }
    try {
      if (decision.action === 'render' && job.type === 'news') {
        const mc = store.require('media', job.payload.presenterMediaId);
        if (!mc.file || !fs.existsSync(mc.file)) { results.push({ id, status: 'review', reason: 'Không tìm thấy tệp MC trên ổ đĩa; không tự tạo MC mới.' }); continue; }
      }
      const retried = decision.action === 'recover' ? queue.recoverSubmitted(id) : queue.retry(id, false);
      results.push({ id, jobId: retried.id, status: 'queued', action: decision.action });
    } catch (error) { results.push({ id, status: 'review', reason: error.message, code: error.code }); }
  }
  const seen = new Set();
  for (const entry of request.preparations) {
    const id = `${entry.batchId}:${entry.index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const batch = store.state.productionBatches.find(row => row.id === entry.batchId && row.projectId === request.projectId);
    const item = batch?.items.find(row => row.index === entry.index);
    if (!item || item.jobId || !['failed', 'interrupted', 'needs_assets'].includes(item.status)) {
      results.push({ id, status: 'skipped', reason: 'Mục chuẩn bị đã thay đổi hoặc đã có tác vụ.' }); continue;
    }
    try { production.retry(batch.id, { indexes: [item.index] }); results.push({ id, status: 'queued', action: 'prepare' }); }
    catch (error) { results.push({ id, status: 'review', reason: error.message, code: error.code }); }
  }
  queue.tick();
  return { results, queued: results.filter(row => row.status === 'queued').length, review: results.filter(row => row.status === 'review').length, skipped: results.filter(row => row.status === 'skipped').length };
}

export function mountQueueRetry(app, store, queue, production) {
  app.post('/api/jobs/retry-failed', (req, res) => res.status(202).json(retryFailedSelection(store, queue, production, req.body)));
}
