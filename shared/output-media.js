export function isNewsPresenterMedia(media, jobs = []) {
  const type = String(media?.mediaType || "").toLowerCase();
  if (["news-presenter", "news-mc", "presenter", "mc"].includes(type)) return true;
  return jobs.some((job) => job?.type === "news" && job?.payload?.presenterMediaId === media?.id);
}

export function isPublishableVideo(media, jobs = []) {
  return media?.kind === "video" && media?.generated && media?.mediaType !== 'product-clip' && !isNewsPresenterMedia(media, jobs);
}

export function mediaOutputType(media, jobs = []) {
  if (isNewsPresenterMedia(media, jobs)) return "other";
  const explicit = String(media?.production?.contentType || media?.mediaType || "").toLowerCase();
  if (explicit === "news" || explicit === "news-video") return "news";
  if (explicit === "product" || explicit === "product-video") return "product";
  if (!explicit && /^news(?:\s|[·-])/i.test(String(media?.name || ""))) return "news";
  return "other";
}

export function isPageAvatar(media, data = {}) {
  if (media?.kind !== 'image') return false;
  if (media.mediaType === 'page-avatar' || /^AI Page Avatar\b/i.test(media.name || '')) return true;
  return (data.settings?.meta?.pages || []).some(page => page.avatarMediaId === media.id);
}

export function isMcImage(media, data = {}) {
  return media?.kind === 'image' && (media.mediaType === 'news-mc'
    || (data.accounts || []).some(account => account.avatarMediaId === media.id)
    || (data.jobs || []).some(job => job.payload?.avatarMediaId === media.id));
}

export function mediaLibraryGroup(media, data = {}) {
  if (isPageAvatar(media, data)) return 'page-avatar';
  if (isMcImage(media, data)) return 'mc-image';
  if (isNewsPresenterMedia(media, data.jobs)) return 'presenter';
  if (isPublishableVideo(media, data.jobs)) return 'finished';
  return 'assets';
}

export function selectableMcImages(data, projectId) {
  const editorialIds = new Set((data.researchResults || []).flatMap(result => result.imageMediaIds || []));
  return (data.media || []).filter(media => media.kind === 'image' && (!media.projectId || media.projectId === projectId)
    && !isPageAvatar(media, data) && (isMcImage(media, data) || media.mediaType !== 'news-editorial' && !editorialIds.has(media.id)))
    .sort((a, b) => Number(isMcImage(b, data)) - Number(isMcImage(a, data)) || Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function jobOutput(job, media, jobs = []) {
  return media.find(item => item.id === job.mediaId && !isNewsPresenterMedia(item, jobs))
    || media.find(item => item.jobId === job.id && isPublishableVideo(item, jobs));
}
