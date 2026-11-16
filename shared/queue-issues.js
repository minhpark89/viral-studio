import { retryAction } from './queue-retry.js';

export function queueIssueGroups(jobs, preparations, data) {
  const groups = new Map();
  const add = (key, title, action, entry, retryable) => {
    if (!groups.has(key)) groups.set(key, { key, title, action, ids: [], retryable });
    groups.get(key).ids.push(entry.id);
  };
  for (const job of jobs) {
    const decision = retryAction(job, data);
    if (decision.action === 'skip') continue;
    if (decision.action !== 'review') add('retry', 'Có thể chạy lại', 'Dùng lại MC đã lưu hoặc tải kết quả theo mã tác vụ đã xác nhận.', job, true);
    else if (job.errorCode === 'PROVIDER_CONTENT_REJECTED') add('content', 'DreamFace từ chối lời dẫn', 'Xem bản lời dẫn đã thành công của cùng nguồn tin bên dưới (nếu có), hoặc mở “Sửa lời dẫn và thử lại” ở từng bài. Chạy lại nguyên lời dẫn không xử lý được lỗi này.', job, false);
    else if (job.errorCode === 'PROVIDER_SUBMISSION_UNCONFIRMED' || job.submittedAt || job.payload?.newsAvatarRequest?.submittedAt) add('receipt', 'Chưa xác nhận được MC cũ', 'Mở đúng profile DreamFace để kiểm tra Creations. Bản ghi cũ thiếu mã tác vụ nên app chưa xác minh được video thuộc bài nào; cần đối chiếu trước khi tạo MC mới.', job, false);
    else add('review', 'Cần kiểm tra dữ liệu', decision.reason, job, false);
  }
  for (const item of preparations) add('assets', 'Thiếu ảnh / lỗi chuẩn bị', 'Có thể tìm thêm ảnh. Nếu vẫn thiếu, bổ sung ảnh hoặc chọn dùng số ảnh hiện có ở từng bài.', item, true);
  return [...groups.values()];
}
