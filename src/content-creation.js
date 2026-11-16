// Stop only prevents new requests. Let in-flight requests finish so their saved
// drafts remain visible and a retry cannot accidentally duplicate their work.
export async function createContentBatch({ videos, concurrency = 2, create, onCreated, onProgress, shouldStop = () => false }) {
  const targets = [...new Map(videos.map(video => [video.id, video])).values()];
  const threads = Math.min(8, Math.max(1, Math.floor(Number(concurrency) || 2)));
  const progress = { total: targets.length, completed: 0, created: 0, active: 0, failures: [], websiteErrors: [], stopped: false };
  let cursor = 0;
  const emit = () => onProgress?.({ ...progress, failures: [...progress.failures], websiteErrors: [...progress.websiteErrors] });
  emit();
  const worker = async () => {
    while (cursor < targets.length && !shouldStop()) {
      const video = targets[cursor++];
      progress.active++;
      emit();
      try {
        const post = await create(video);
        onCreated?.(post, video);
        progress.created++;
        if (post.automationStatus === 'website_error') progress.websiteErrors.push({ id: video.id, title: video.production?.title || video.name, message: post.automationError || 'Chưa đăng được website.' });
      } catch (error) {
        progress.failures.push({ id: video.id, title: video.production?.title || video.name, message: error.message || 'Không tạo được Content.' });
      } finally {
        progress.active--;
        progress.completed++;
        emit();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(threads, targets.length) }, worker));
  progress.stopped = cursor < targets.length;
  emit();
  return progress;
}
