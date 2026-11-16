import { isPublishableVideo } from './output-media.js';

export function mediaContentType(media) {
  const type = String(media?.production?.contentType || media?.contentType || media?.mediaType || '').toLowerCase();
  if (type === 'news' || type === 'news-video') return 'news';
  return /^news(?:\s|[·-])/i.test(String(media?.name || '')) ? 'news' : 'product';
}

export function contentVideoInventory(data, projectId, posts = data.socialPosts || []) {
  const videos = (data.media || [])
    .filter(media => (media.projectId === projectId || !media.projectId) && isPublishableVideo(media, data.jobs))
    .slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  // A title or research can supply several distinct renders. Only an exact media
  // attachment covers a video; retained/archived posts still own that attachment.
  const attachedIds = new Set(posts.flatMap(post => post.mediaIds || []));
  return {
    videos,
    withContent: videos.filter(video => attachedIds.has(video.id)),
    publishedWithoutContent: videos.filter(video => !attachedIds.has(video.id) && video.metaPublishedAt),
    missing: videos.filter(video => !attachedIds.has(video.id) && !video.metaPublishedAt),
  };
}
