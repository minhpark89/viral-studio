import { useState } from 'react';
import { api } from './api.js';
import { Button } from './components.jsx';

const labels = { pending: 'Đang chờ', running: 'Đang research', completed: 'Đã xong', partial: 'Có tin cần thử lại', failed: 'Cần kiểm tra', interrupted: 'Chờ tiếp tục', cancelled: 'Đã dừng' };

export function ResearchBatchProgress({ batches, results, onSelect, notify }) {
  const [busy, setBusy] = useState('');
  const action = async (batch, command) => {
    setBusy(batch.id);
    try { await api(`/research/batches/${batch.id}/${command}`, {}); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(''); }
  };
  return <div className="research-batch-progress">{batches.slice().reverse().slice(0, 3).map(batch => {
    const saved = results.filter(result => result.batchId === batch.id);
    const fallback = saved.filter(result => result.contentSource !== 'llm').length;
    const active = ['pending', 'running'].includes(batch.status);
    return <article key={batch.id} data-research-batch-id={batch.id}>
      <strong>{labels[batch.status] || batch.status} · {batch.request.topic}</strong>
      <span>{saved.length}/{batch.request.count} tin đã lưu · {batch.items.length} nguồn mới tìm được</span>
      <progress value={batch.items.filter(item => ['completed', 'failed'].includes(item.status)).length} max={batch.items.length || batch.request.count} />
      {batch.warnings?.map(warning => <small key={warning}>{warning}</small>)}
      {fallback > 0 && <small>{fallback} tin đang dùng tóm lược từ nguồn; có thể chọn và chạy LLM lại.</small>}
      {batch.error && <small className="danger-text">{batch.error}</small>}
      <div className="inline-actions">
        <Button disabled={!saved.length} onClick={() => onSelect(saved.map(result => result.id))}>Chọn {saved.length} tin của lượt này</Button>
        {active ? <Button busy={busy === batch.id} onClick={() => action(batch, 'cancel')}>Dừng research</Button> : ['partial', 'failed', 'interrupted', 'cancelled'].includes(batch.status) && <Button busy={busy === batch.id} onClick={() => action(batch, 'retry')}>Tiếp tục / thử lại</Button>}
      </div>
    </article>;
  })}</div>;
}
