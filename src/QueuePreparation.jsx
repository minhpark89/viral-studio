import { Button, Badge } from './components.jsx';
import { api } from './api.js';
import { formatDateTime } from '../shared/source-context.js';
import { JobTimings } from './JobTimings.jsx';

export function QueuePreparation({ items, data, run, navigate, selected, onSelect }) {
  const batches = [...new Set(items.map(item => item.batchId))];
  return <div className="queue-preparations">{batches.map(batchId => {
    const entries = items.filter(item => item.batchId === batchId);
    const current = entries.find(item => item.status === 'preparing') || entries.find(item => item.status === 'pending') || entries[0];
    const failed = entries.filter(item => ['failed', 'interrupted', 'needs_assets'].includes(item.status));
    const active = entries.some(item => ['pending', 'preparing'].includes(item.status));
    const historical = !active && Date.parse(current.activityAt) < new Date().setHours(0, 0, 0, 0);
    const avatar = data.media.find(media => media.id === current.avatarMediaId);
    return <article className="panel preparation-card" key={batchId} data-preparation-batch-id={batchId}>
      <div className="preparation-heading"><div><small>CHUẨN BỊ {current.contentType === 'news' ? 'NEWS' : 'PRODUCT'} · {batchId.slice(0, 8)}</small><h3>{current.name}</h3></div><Badge status={active ? 'preparing' : current.status === 'needs_assets' ? 'needs_assets' : 'failed'} /></div>
      <p className="muted small preparation-dates">Lượt tạo: {formatDateTime(current.createdAt)} · Cập nhật: {formatDateTime(current.activityAt)}</p>
      {historical && <p className="muted small preparation-history">Lỗi đã lưu từ trước hôm nay. Bấm thử lại để kiểm tra bằng cấu hình hiện tại.</p>}
      <p>{active ? current.stage : 'Không thể chuẩn bị video'} · Video {current.index + 1}/{current.total}</p>
      <JobTimings record={current} />
      <p className="muted small">{entries.length} video chưa vào bước tạo MC/xuất video{avatar ? ` · MC: ${avatar.name}` : ''}</p>
      {failed.length > 0 && <p className="danger-text">{failed.length} video cần xử lý: {failed[0].error || 'Bước chuẩn bị bị gián đoạn.'}</p>}
      {entries.length > 1 && <details><summary>Xem {entries.length} video đang chuẩn bị / lỗi</summary>{entries.map(item => <p key={item.id}>Video {item.index + 1}: {item.name} · {item.error || item.stage}</p>)}</details>}
      <div className="inline-actions"><Button onClick={() => navigate('news', { view:'automatic', focusBatchId: batchId, researchId: current.researchId })}>Mở lượt render</Button>{failed.length > 0 && <Button onClick={() => run(() => api(`/production/batches/${batchId}/retry`, {}))}>Thử lại bước chuẩn bị</Button>}</div>
      {failed.map(item => <div className="inline-actions" key={item.id}>
        {selected && <label><input type="checkbox" aria-label={`Chọn chuẩn bị video ${item.index + 1}`} checked={selected.has(item.id)} onChange={event => onSelect(previous => { const next = new Set(previous); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })} /> Video {item.index + 1}</label>}
        {item.status === 'needs_assets' && <><span>{item.photoCount} ảnh thật đã chọn.</span><Button onClick={() => run(() => api(`/production/batches/${batchId}/retry`, { indexes: [item.index] }))}>Tìm thêm ảnh</Button><Button onClick={() => run(() => api(`/production/batches/${batchId}/retry`, { indexes: [item.index], visualPolicy: item.photoCount ? 'allow-fewer' : 'allow-source-card' }))}>{item.photoCount ? 'Dùng số ảnh hiện có' : 'Cho phép dùng thẻ tin'}</Button></>}
      </div>)}
    </article>;
  })}</div>;
}
