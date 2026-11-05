import { useState } from 'react';
import { api } from './api.js';
import { Button } from './components.jsx';

const labels = { pending: 'Đang chờ', running: 'Đang research', completed: 'Đã xong', partial: 'Chưa đủ tin', failed: 'Cần kiểm tra', interrupted: 'Chờ tiếp tục', cancelled: 'Đã dừng' };

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
    const missing = Math.max(0, batch.request.count - batch.items.length);
    const discovery = batch.discovery;
    return <article key={batch.id} data-research-batch-id={batch.id}>
      <strong>{batch.status === 'completed' && missing ? 'Chưa đủ tin' : labels[batch.status] || batch.status} · {batch.request.topic}</strong>
      <span>{saved.length}/{batch.request.count} tin đã lưu · {batch.items.length} nguồn mới tìm được</span>
      <progress aria-label="Tiến độ lưu tin research" value={saved.length} max={batch.request.count} />
      {active && discovery && ['searching', 'expanding'].includes(discovery.phase) && <small role="status">{discovery.phase === 'expanding' ? 'Đang tự mở rộng cùng chủ đề' : 'Đang tìm nguồn'} · lượt {discovery.round} · {discovery.found}/{discovery.target} tin{discovery.currentQueries?.length ? ` · ${discovery.currentQueries.join(' / ')}` : ''}</small>}
      {discovery?.suggestions?.length > 0 && <details className="research-discovery-details"><summary>Gợi ý từ khóa cùng chủ đề · {discovery.suggestions.length} góc đang được nhắc đến</summary><small>Xếp theo độ phủ trong các nguồn mới tìm được; không phải thống kê lượt xem hay chia sẻ. App tự dùng các góc này khi cần bổ sung tin. Bấm từ khóa để sao chép.</small><div className="research-keyword-list">{discovery.suggestions.map(suggestion => <button type="button" key={suggestion.query} title={`${suggestion.mentions} tin · ${suggestion.sourceCount} nguồn`} onClick={async () => { try { await navigator.clipboard.writeText(suggestion.query); notify(`Đã sao chép: ${suggestion.query}`); } catch { notify('Không sao chép được. Bạn có thể chọn và sao chép dòng từ khóa.', 'error'); } }}>{suggestion.query}<span>{suggestion.mentions} tin</span></button>)}</div></details>}
      {discovery?.queries?.length > 0 && <details className="research-discovery-details"><summary>Đã tìm {discovery.searches} truy vấn · {discovery.windowHours} giờ qua</summary><ol>{discovery.queries.map(query => <li key={query.url}>{query.query}<small>+{query.added} tin mới</small></li>)}</ol></details>}
      {batch.warnings?.map(warning => <small key={warning}>{warning}</small>)}
      {fallback > 0 && <small>{fallback} tin đang dùng tóm lược từ nguồn; có thể chọn và chạy LLM lại.</small>}
      {batch.error && <small className="danger-text">{batch.error}</small>}
      <div className="inline-actions">
        <Button disabled={!saved.length} onClick={() => onSelect(saved.map(result => result.id))}>Chọn {saved.length} tin của lượt này</Button>
        {active ? <Button busy={busy === batch.id} onClick={() => action(batch, 'cancel')}>Dừng research</Button> : (missing > 0 || ['partial', 'failed', 'interrupted', 'cancelled'].includes(batch.status)) && <Button busy={busy === batch.id} onClick={() => action(batch, 'retry')}>{missing > 0 ? `Tìm tiếp phần thiếu (${missing} tin)` : 'Tiếp tục / thử lại'}</Button>}
      </div>
    </article>;
  })}</div>;
}
