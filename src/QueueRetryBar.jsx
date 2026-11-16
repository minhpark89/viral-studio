import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { Button, Notice } from './components.jsx';
import { queueIssueGroups } from '../shared/queue-issues.js';
import { NewsNarrationRecovery } from './NewsNarrationRecovery.jsx';

export function QueueRetryBar({ projectId, jobs, preparations, selected, onSelect, run, data }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const entries = [...jobs.map(job => ({ id: job.id })), ...preparations];
  const chosen = entries.filter(entry => selected.has(entry.id));
  const groups = queueIssueGroups(jobs, preparations, data);
  const scope = new Set((chosen.length ? chosen : entries).map(entry => entry.id));
  const eligible = new Set(groups.filter(group => group.retryable).flatMap(group => group.ids).filter(id => scope.has(id)));
  const needsReview = groups.filter(group => !group.retryable).reduce((count, group) => count + group.ids.filter(id => scope.has(id)).length, 0);
  const retry = async () => {
    if (busy || !eligible.size) return;
    setBusy(true); setResult(null);
    try {
      const ids = new Set((chosen.length ? chosen : entries).map(entry => entry.id));
      await run(async () => {
        const value = await api('/jobs/retry-failed', { projectId, jobIds: jobs.filter(job => ids.has(job.id)).map(job => job.id), preparations: preparations.filter(item => ids.has(item.id)).map(({ batchId, index }) => ({ batchId, index })) });
        setResult(value); onSelect(new Set());
        return value;
      });
    } finally { setBusy(false); }
  };
  if (!entries.length && !result) return null;
  return <div className="panel queue-retry-bar">
    <div className="inline-actions">
      <label><input type="checkbox" aria-label="Chọn tất cả lỗi đang lọc" checked={entries.length > 0 && chosen.length === entries.length} disabled={busy || !entries.length} onChange={event => onSelect(event.target.checked ? new Set(entries.map(entry => entry.id)) : new Set())} /> Chọn tất cả lỗi đang lọc</label>
      <Button variant="primary" busy={busy} disabled={!eligible.size} onClick={retry}><RefreshCw size={16} /> {needsReview ? eligible.size ? `Chạy lại ${eligible.size} mục có thể xử lý` : `${needsReview} mục cần xử lý trước` : chosen.length ? `Thử lại ${chosen.length} mục đã chọn` : `Thử lại tất cả đang lọc (${entries.length})`}</Button>
    </div>
    <ul className="queue-issue-groups" aria-label="Nguyên nhân và cách xử lý">{groups.map(group => <li key={group.key}><strong>{group.ids.length} mục · {group.title}</strong><p>{group.action}</p></li>)}</ul>
    <NewsNarrationRecovery projectId={projectId} jobs={jobs.filter(job => scope.has(job.id))} data={data} run={run} onComplete={() => onSelect(new Set())} />
    {needsReview > 0 && <p className="warning-text" role="status">{needsReview} mục cần xử lý trước sẽ được giữ lại để kiểm tra; bấm chạy lại không tự giải quyết các mục này.</p>}
    {result && <Notice>Đã xếp lại {result.queued} mục · {result.skipped} mục đã thay đổi · {result.review} mục cần kiểm tra.{result.review > 0 && <details><summary>Xem lý do của {result.review} mục cần kiểm tra</summary><ul>{result.results.filter(row => row.status === 'review').map(row => <li key={row.id}>{jobs.find(job => job.id === row.id)?.name || row.id.slice(0, 8)}: {row.reason}</li>)}</ul></details>}</Notice>}
  </div>;
}
