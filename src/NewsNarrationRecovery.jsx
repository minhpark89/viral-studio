import { useState } from 'react';
import { api } from './api.js';
import { Button, Notice } from './components.jsx';
import { successfulNarrationCandidates, canReuseNewsPresenter } from '../shared/news-narration-recovery.js';

export function NewsNarrationRecovery({ projectId, jobs, data, run, onComplete }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const proposals = jobs.flatMap(job => {
    const source = successfulNarrationCandidates(job, data)[0];
    return source ? [{ job, source }] : [];
  });
  if (!proposals.length && !result) return null;
  return <details className="job-expanded narration-recovery">
    <summary>{proposals.length} mục có lời dẫn đã thành công · Xem và khôi phục</summary>
    <p>Mỗi lời dẫn dưới đây đã tạo video thành công cho đúng bài báo trong dự án. Kiểm tra nội dung trước khi dùng lại. Ảnh tin, ảnh MC và giọng đọc của từng mục được giữ nguyên; MC chỉ được dùng lại khi cùng ảnh và giọng đọc.</p>
    <ul>{proposals.map(({ job, source }) => <li key={job.id}>
      <details>
        <summary>{job.name}</summary>
        <p><strong>Lời dẫn đang lỗi:</strong> {job.payload.newsPlan.narration}</p>
        <p><strong>Lời dẫn đề xuất:</strong> {source.payload.newsPlan.narration}</p>
        <p>Bản đã thành công: {source.name}. {canReuseNewsPresenter(job, source, data) ? 'Dùng lại MC đã có.' : 'Tạo MC với ảnh và giọng đọc của mục này.'}</p>
        <a href={source.payload.newsPlan.sourceUrl} target="_blank" rel="noreferrer">Mở nguồn tin</a>
      </details>
    </li>)}</ul>
    <Button busy={busy} disabled={!proposals.length} onClick={async () => {
      setBusy(true); setResult(null);
      const entries = proposals.map(({ job, source }) => ({ jobId: job.id, sourceJobId: source.id, narration: source.payload.newsPlan.narration }));
      try {
        await run(async () => {
          const value = await api('/jobs/retry-reviewed-narrations', { projectId, entries });
          setResult(value); onComplete?.(); return value;
        });
      } finally { setBusy(false); }
    }}>Dùng lời dẫn đề xuất cho {proposals.length} mục</Button>
    {result && <Notice>Đã xếp lại {result.queued} mục · {result.skipped} mục đã thay đổi · {result.review} mục cần kiểm tra.
      {result.review > 0 && <ul>{result.results.filter(row => row.status === 'review').map(row => <li key={row.id}>{row.reason}</li>)}</ul>}
    </Notice>}
  </details>;
}
