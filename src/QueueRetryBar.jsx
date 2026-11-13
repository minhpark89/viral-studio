import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { Button, Notice } from './components.jsx';

export function QueueRetryBar({ projectId, jobs, preparations, selected, onSelect, run }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const entries = [...jobs.map(job => ({ id: job.id })), ...preparations];
  const chosen = entries.filter(entry => selected.has(entry.id));
  const retry = async () => {
    if (busy) return;
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
      <Button variant="primary" busy={busy} disabled={!entries.length} onClick={retry}><RefreshCw size={16} /> {chosen.length ? `Thử lại ${chosen.length} mục đã chọn` : `Thử lại tất cả đang lọc (${entries.length})`}</Button>
    </div>
    <p className="muted small">Tái dùng MC đã có; tác vụ đã gửi sẽ được tìm lại kết quả. Mục chưa xác nhận được lần gửi trước sẽ được báo để kiểm tra.</p>
    {result && <Notice>Đã xếp lại {result.queued} mục · {result.skipped} mục đã thay đổi · {result.review} mục cần kiểm tra.{result.review > 0 && <ul>{result.results.filter(row => row.status === 'review').map(row => <li key={row.id}>{jobs.find(job => job.id === row.id)?.name || row.id.slice(0, 8)}: {row.reason}</li>)}</ul>}</Notice>}
  </div>;
}
