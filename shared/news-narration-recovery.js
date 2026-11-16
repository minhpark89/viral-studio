import { latestJobs } from './queue-retry.js';
import { newsJobAvatarId } from './news-avatar.js';

export const normalizeNewsNarration = value => String(value || '').replace(/\s+/g, ' ').trim();

export function canReviewRejectedNarration(job) {
  const payload = job?.payload || {}, receipt = payload.newsAvatarRequest;
  return job?.type === 'news' && job.status === 'failed' && job.errorCode === 'PROVIDER_CONTENT_REJECTED'
    && Boolean(payload.newsPlan) && !payload.presenterMediaId && !job.submittedAt && !receipt?.id && !receipt?.submittedAt;
}

// A similar headline is not evidence that two reports have the same facts.
// Require the same research record AND the exact article URL, including its ID.
export function successfulNarrationCandidates(job, data) {
  if (!canReviewRejectedNarration(job) || !job.production?.researchId || !job.payload.newsPlan.sourceUrl) return [];
  const latest = latestJobs(data.jobs || []);
  if (!latest.some(row => row.id === job.id)) return [];
  const media = new Map((data.media || []).map(row => [row.id, row]));
  const usable = id => {
    const row = media.get(id);
    return row?.kind === 'video' && (!row.projectId || row.projectId === job.projectId);
  };
  return latest.filter(source => {
    const plan = source.payload?.newsPlan, narration = normalizeNewsNarration(plan?.narration);
    return source.type === 'news' && source.status === 'completed' && source.projectId === job.projectId
      && source.production?.researchId === job.production.researchId && plan?.sourceUrl === job.payload.newsPlan.sourceUrl
      && narration.length >= 20 && narration.length <= 500 && narration !== normalizeNewsNarration(job.payload.newsPlan.narration)
      && usable(source.payload?.presenterMediaId) && usable(source.mediaId);
  }).sort((a, b) => Number(canReuseNewsPresenter(job, b, data)) - Number(canReuseNewsPresenter(job, a, data))
    || Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
}

export function canReuseNewsPresenter(job, source, data = {}) {
  const original = job.payload || {}, existing = source.payload || {};
  const avatar = newsJobAvatarId(job, data);
  return Boolean(avatar && avatar === newsJobAvatarId(source, data)
    && original.newsPlan?.voiceName && original.newsPlan.voiceName === existing.newsPlan?.voiceName
    && existing.presenterMediaId);
}
