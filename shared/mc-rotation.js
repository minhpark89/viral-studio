export const MAX_NEWS_VIDEOS = 100;
export const MAX_RESEARCH_STORIES = 100;

// Assignment follows video order, never worker completion or account order.
export function mcForVideo(request, index) {
  const rotation = request.mcRotation || [];
  if (!rotation.length) return request.avatarMediaId || null;
  const cycle = rotation.reduce((total, entry) => total + Number(entry.count), 0);
  let position = index % cycle;
  for (const entry of rotation) {
    if (position < entry.count) return entry.avatarMediaId;
    position -= entry.count;
  }
  return null;
}

export function mcRotationPreview(rotation, count) {
  if (!rotation.length || rotation.some(entry => !entry.avatarMediaId || !Number.isInteger(Number(entry.count)) || Number(entry.count) < 1)) return [];
  const spans = [];
  for (let index = 0; index < Math.min(MAX_NEWS_VIDEOS, Number(count) || 0); index++) {
    const id = mcForVideo({ mcRotation: rotation }, index);
    const last = spans.at(-1);
    if (last?.avatarMediaId === id) last.end = index + 1;
    else spans.push({ avatarMediaId: id, start: index + 1, end: index + 1 });
  }
  return spans;
}
