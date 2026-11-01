import { Button, Badge } from './components.jsx';
import { api } from './api.js';

export function QueuePreparation({ items, data, run, navigate }) {
  const batches = [...new Set(items.map(item => item.batchId))];
  return <div className="queue-preparations">{batches.map(batchId => {
    const entries = items.filter(item => item.batchId === batchId);
    const current = entries.find(item => item.status === 'preparing') || entries.find(item => item.status === 'pending') || entries[0];
    const failed = entries.filter(item => ['failed', 'interrupted'].includes(item.status));
    const active = entries.some(item => ['pending', 'preparing'].includes(item.status));
    const avatar = data.media.find(media => media.id === current.avatarMediaId);
    return <article className="panel preparation-card" key={batchId} data-preparation-batch-id={batchId}>
      <div className="preparation-heading"><div><small>CHUẨN BỊ {current.contentType === 'news' ? 'NEWS' : 'PRODUCT'} · {batchId.slice(0, 8)}</small><h3>{current.name}</h3></div><Badge status={active ? 'preparing' : 'failed'} /></div>
      <p>{active ? current.stage : 'Không thể chuẩn bị video'} · Video {current.index + 1}/{current.total}</p>
      <p className="muted small">{entries.length} video chưa vào bước tạo MC/xuất video{avatar ? ` · MC: ${avatar.name}` : ''}</p>
      {failed.length > 0 && <p className="danger-text">{failed.length} video cần xử lý: {failed[0].error || 'Bước chuẩn bị bị gián đoạn.'}</p>}
      {entries.length > 1 && <details><summary>Xem {entries.length} video đang chuẩn bị / lỗi</summary>{entries.map(item => <p key={item.id}>Video {item.index + 1}: {item.name} · {item.error || item.stage}</p>)}</details>}
      <div className="inline-actions"><Button onClick={() => navigate('editor', { focusBatchId: batchId, researchId: current.researchId })}>Mở lượt render</Button>{failed.length > 0 && <Button onClick={() => run(() => api(`/production/batches/${batchId}/retry`, {}))}>Thử lại bước chuẩn bị</Button>}</div>
    </article>;
  })}</div>;
}
