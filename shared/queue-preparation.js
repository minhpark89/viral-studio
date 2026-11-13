export function productionPreparations(data, projectId) {
  const linked = new Set((data.jobs || []).filter(job => job.production?.batchId).map(job => `${job.production.batchId}:${job.production.itemIndex}`));
  const existing = new Set((data.jobs || []).map(job => job.id));
  const research = new Map((data.researchResults || []).map(result => [result.id, result]));
  return (data.productionBatches || []).filter(batch => batch.projectId === projectId).flatMap(batch => (batch.items || [])
    .filter(item => !existing.has(item.jobId) && !linked.has(`${batch.id}:${item.index}`) && ['pending', 'preparing', 'failed', 'interrupted', 'needs_assets'].includes(item.status))
    .map(item => ({
      id: `${batch.id}:${item.index}`, batchId: batch.id, index: item.index, total: batch.items.length,
      name: item.title || research.get(item.researchId || batch.request?.researchId)?.headline || batch.request?.topic || batch.request?.productName || 'Chuẩn bị video',
      contentType: batch.request?.contentType || 'news', status: item.status, createdAt: batch.createdAt,
      activityAt: item.updatedAt || item.stageUpdatedAt || item.preparationFinishedAt || item.preparationStartedAt || item.retryRequestedAt || batch.updatedAt || batch.createdAt,
      stage: item.stage || (item.status === 'pending' ? (batch.status === 'preparing' ? batch.stage || 'Đang chờ tới lượt chuẩn bị' : 'Đang chờ tới lượt chuẩn bị') : 'Đang chuẩn bị nội dung và ảnh'),
      error: item.error || batch.error || '', researchId: item.researchId || batch.request?.researchId || null,
      photoCount: item.imagePreparation?.photoCount || 0, target: item.imagePreparation?.target || 8,
      phaseTimings: item.phaseTimings, phase: item.phase, phaseStartedAt: item.phaseStartedAt,
      avatarMediaId: item.avatarMediaId || batch.request?.avatarMediaId || null,
    }))).sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt) || a.index - b.index);
}
