const failed = new Set(['failed', 'cancelled', 'interrupted']);
const active = new Set(['pending', 'preparing', 'queued', 'scheduled', 'submitting', 'rendering', 'downloading', 'generating_mc_image']);

// Both Research and Render use the same latest job for each production slot.
// A successful retry replaces the old failure; a cleaned video still counts.
export function productionBatchProgress(batch, allJobs = []) {
  const byId = new Map(allJobs.map(job => [job.id, job]));
  const latest = new Map();
  for (const job of allJobs) {
    if (job.production?.batchId !== batch.id) continue;
    const previous = latest.get(job.production.itemIndex);
    if (!previous || (Date.parse(job.createdAt) || 0) >= (Date.parse(previous.createdAt) || 0)) latest.set(job.production.itemIndex, job);
  }
  const slots = (batch.items || []).map(item => {
    const job = latest.get(item.index) || byId.get(item.jobId);
    return { item, job, status: job?.status || item.status, error: job?.error || item.error || '' };
  });
  return {
    slots, total: batch.request?.count || slots.length,
    complete: slots.filter(slot => slot.status === 'completed').length,
    active: slots.filter(slot => active.has(slot.status)).length,
    failed: slots.filter(slot => failed.has(slot.status)).length,
    canRetryPreparation: slots.some(slot => !slot.job && ['failed', 'interrupted'].includes(slot.item.status)),
  };
}
