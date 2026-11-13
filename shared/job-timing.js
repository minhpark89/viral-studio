export const phaseLabels = { source:'Đọc bài gốc', narration:'Viết lời dẫn', images:'Tìm và chọn ảnh', queue:'Chờ hàng đợi', mc_image:'Tạo ảnh MC', mc:'Tạo video MC', download:'Tải MC', render_wait:'Chờ dựng video', captions:'Tạo phụ đề', render:'Dựng video', content:'Tạo nội dung' };

export function finishPhase(record, now = Date.now()) {
  if (!record.phase || !record.phaseStartedAt) return;
  const elapsed = Math.max(0, now - Date.parse(record.phaseStartedAt));
  record.phaseTimings ||= {};
  record.phaseTimings[record.phase] = (record.phaseTimings[record.phase] || 0) + elapsed;
  record.phaseStartedAt = new Date(now).toISOString();
}

export function changePhase(record, phase, now = Date.now()) {
  if (record.phase === phase) return;
  finishPhase(record, now);
  record.phase = phase;
  record.phaseStartedAt = phase ? new Date(now).toISOString() : null;
}

export function preparationPhase(stage) {
  if (/đọc bài|nguồn|tổng hợp/i.test(stage)) return 'source';
  if (/lời đọc|lời dẫn/i.test(stage)) return 'narration';
  return 'images';
}
