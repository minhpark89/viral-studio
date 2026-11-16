// Older auto-profile jobs did not persist the reused still on the job. Only
// recover that identity when the profile's current still demonstrably predates
// the recorded run; a later profile replacement must never be guessed as it.
export function newsJobAvatarId(job, data = {}) {
  const selected = job?.payload?.avatarMediaId || job?.payload?.newsPlan?.avatarMediaId;
  if (selected) return selected;
  const account = (data.accounts || []).find(row => row.id === job?.accountId);
  if (!account || !['highlight-endpoint', 'dreamface-image'].includes(account.avatarSource)) return null;
  const started = Date.parse(job.startedAt), generated = Date.parse(account.avatarGeneratedAt);
  if (!Number.isFinite(started) || !Number.isFinite(generated) || generated > started) return null;
  const media = (data.media || []).find(row => row.id === account.avatarMediaId);
  const created = Date.parse(media?.createdAt);
  return media?.kind === 'image' && media.mediaType === 'news-mc'
    && (!media.projectId || media.projectId === job.projectId)
    && Number.isFinite(created) && created <= started ? media.id : null;
}
