import { useState } from 'react';
import { api } from './api.js';
import { Button, Field } from './components.jsx';
import { successfulNarrationCandidates } from '../shared/news-narration-recovery.js';

export function NewsNarrationRetry({ job, data, run }) {
  const original = job.payload.newsPlan?.narration || '';
  const [narration, setNarration] = useState(original);
  const [busy, setBusy] = useState(false);
  const suggestion = successfulNarrationCandidates(job, data || {})[0];
  const normalized = narration.replace(/\s+/g, ' ').trim();
  const valid = normalized.length >= 20 && normalized.length <= 500 && normalized !== original.replace(/\s+/g, ' ').trim();
  return <details className="job-expanded">
    <summary>Sửa lời dẫn và thử lại</summary>
    <p>DreamFace đã từ chối lời dẫn vì có thể thuộc chủ đề hạn chế, nhưng không chỉ ra từ hoặc câu cụ thể. Hãy đối chiếu nguồn, giữ đúng tên, số liệu và dữ kiện. Nội dung sửa vẫn cần được DreamFace chấp nhận; chạy lại nguyên văn không giải quyết được lỗi này.</p>
    {suggestion && <Button disabled={busy} onClick={() => setNarration(suggestion.payload.newsPlan.narration)}>Điền lời dẫn đã thành công của cùng nguồn tin</Button>}
    <Field label="Lời dẫn đã chỉnh" hint={`${normalized.length}/500 ký tự · giữ nguyên ảnh MC và ảnh tin đã chuẩn bị`}>
      <textarea rows={6} maxLength={500} value={narration} onChange={event => setNarration(event.target.value)} />
    </Field>
    <Button busy={busy} disabled={!valid} onClick={async () => {
      setBusy(true);
      try { await run(() => suggestion && normalized === suggestion.payload.newsPlan.narration.replace(/\s+/g, ' ').trim()
        ? api('/jobs/retry-reviewed-narrations', { projectId: job.projectId, entries: [{ jobId: job.id, sourceJobId: suggestion.id, narration: normalized }] }).then(value => {
          if (!value.queued) throw new Error(value.results[0]?.reason || 'Tác vụ đã thay đổi. Hãy tải lại.'); return value;
        }) : api(`/jobs/${job.id}/retry`, { narration: normalized }), 'Đã tạo lần thử với lời dẫn đã chỉnh.'); }
      finally { setBusy(false); }
    }}>Lưu lời dẫn và thử lại</Button>
  </details>;
}
