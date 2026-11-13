export const retryableStatuses = new Set(['failed', 'interrupted']);

export function latestJobs(jobs) {
  const superseded = new Set(jobs.flatMap(job => [job.retryOf, job.repairOfJobId]).filter(Boolean));
  const slots = new Map();
  for (const job of jobs) {
    if (!job.production?.batchId || job.production.itemIndex == null) continue;
    const key = `${job.production.batchId}:${job.production.itemIndex}`;
    const previous = slots.get(key);
    if (previous) superseded.add(previous.id);
    slots.set(key, job);
  }
  return jobs.filter(job => !superseded.has(job.id));
}

// Shared with the UI; the server repeats this decision against current state.
export function retryAction(job, data) {
  if (!retryableStatuses.has(job.status)) return { action: 'skip', reason: 'Tác vụ không còn lỗi.' };
  if (!latestJobs(data.jobs || []).some(row => row.id === job.id)) return { action: 'skip', reason: 'Đã có lần thử mới hơn.' };
  if (job.type === 'render') return { action: 'render' };
  if (job.type === 'news' && job.payload?.presenterMediaId) {
    const mc = (data.media || []).find(media => media.id === job.payload.presenterMediaId);
    return mc?.kind === 'video' && (!mc.projectId || mc.projectId === job.projectId) ? { action: 'render' } : { action: 'review', reason: 'Video MC không còn trong dự án; cần kiểm tra trước khi tạo MC mới.' };
  }
  const receipt = job.type === 'news' ? job.payload?.newsAvatarRequest : job.payload?.workflow === 'product-video' ? job.payload?.productRequest : null;
  if (receipt?.scriptMismatch) return { action: 'review', reason: 'Lời đọc đã gửi không khớp; cần kiểm tra tác vụ cũ.' };
  if (receipt?.id && !receipt.rejected) return { action: 'recover' };
  if (!receipt?.rejected && (job.submittedAt || receipt?.submittedAt)) return { action: 'review', reason: 'Đã gửi nhưng chưa xác nhận kết quả. Kiểm tra Creations trước để tránh tạo trùng.' };
  return { action: 'retry' };
}
