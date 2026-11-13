import { useState } from 'react';
import { ArrowRight, RefreshCw, Video } from 'lucide-react';
import { api } from './api.js';
import { Button, Modal } from './components.jsx';
import { newsRenderStyleLabel } from '../shared/news-format.js';
import { productionBatchProgress } from '../shared/production-progress.js';
import { isPublishableVideo } from '../shared/output-media.js';
import './pages/workspace.css';

export function ProductionBatchRecords({ batches, data, notify, navigate, focusedIds = [] }) {
  const [retrying, setRetrying] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const research = new Map((data.researchResults || []).map(result => [result.id, result]));
  const videos = batch => {
    const ids = new Set(productionBatchProgress(batch, data.jobs).slots.map(slot => slot.job?.mediaId).filter(Boolean));
    return (data.media || []).filter(media => (ids.has(media.id) || media.production?.batchId === batch.id) && isPublishableVideo(media, data.jobs || []));
  };
  const retry = async batch => {
    setRetrying(batch.id);
    try {
      await api(`/production/batches/${batch.id}/retry`, {});
      notify('Đã thử lại phần chuẩn bị lỗi, giữ style và nguồn của lượt đã lưu.');
    } catch (error) { notify(error.message, 'error'); }
    finally { setRetrying(''); }
  };
  const preview = batches.find(batch => batch.id === previewId);
  return <div className="production-batch-records">
    {batches.map(batch => {
      const request = batch.request || {}, progress = productionBatchProgress(batch, data.jobs), result = research.get(request.researchId);
      const title = result?.headline || request.topic || request.sourceUrl || request.productName || 'Lượt render';
      const sources = new Set([request.researchId, ...(request.researchIds || []), ...(batch.items || []).map(item => item.researchId)].filter(Boolean));
      const available = videos(batch);
      const status = progress.failed ? `${progress.failed} video cần xử lý` : progress.active ? `${progress.active} video đang xử lý` : progress.complete === progress.total ? 'Đã hoàn tất' : 'Đang chuẩn bị';
      const errors = progress.slots.filter(slot => slot.error && ['failed', 'interrupted', 'cancelled', 'needs_assets'].includes(slot.status));
      return <article className={`production-batch${focusedIds.includes(batch.id) ? ' is-focused' : ''}`} data-production-batch-id={batch.id} key={batch.id}>
        <div className="production-batch-copy">
          <strong><Video size={15} /> {title}</strong>
          <p>{progress.complete}/{progress.total} video hoàn tất · {status}{sources.size ? ` · ${sources.size} tin` : ''}</p>
          <progress value={progress.complete} max={Math.max(1, progress.total)} aria-label="Tiến độ hoàn tất lượt render" />
          {request.contentType === 'news' && <small className="production-batch-source">Style đã lưu: {newsRenderStyleLabel(request.newsRenderStyle || 'classic')}{request.newsDuration && request.newsDuration !== 'auto' ? ` · khoảng ${request.newsDuration}s` : ''}{request.newsImageCount && request.newsImageCount !== 'auto' ? ` · tối đa ${request.newsImageCount} ảnh` : ''}</small>}
          <small>{request.autoCreateContent ? 'Content: tự tạo sau render' : 'Content: tạo sau trong Content Studio'}</small>
          {batch.stage && progress.active > 0 && <small>{batch.stage}</small>}
          {batch.error && <small className="danger-text">{batch.error}</small>}
          {errors.length > 0 && <details className="production-batch-errors"><summary>Chi tiết {errors.length} lỗi</summary>{errors.map(slot => <small key={slot.item.index}>Video {slot.item.index + 1}: {slot.error}</small>)}</details>}
          {batch.warnings?.length > 0 && <details className="production-batch-errors"><summary>Lưu ý của lượt render</summary>{batch.warnings.map((warning, index) => <small key={index}>{warning}</small>)}</details>}
        </div>
        <div className="inline-actions">
          {available.length > 0 && <Button onClick={() => setPreviewId(batch.id)}>Xem {available.length} video</Button>}
          {progress.canRetryPreparation && <Button onClick={() => retry(batch)} busy={retrying === batch.id} disabled={Boolean(retrying)}><RefreshCw size={14} /> Thử lại phần chuẩn bị lỗi</Button>}
          <Button onClick={() => navigate?.('queue')}>{progress.failed ? 'Xử lý lỗi trong Queue' : 'Chi tiết Queue'}<ArrowRight size={14} /></Button>
          {progress.complete > 0 && <Button onClick={() => navigate?.('content')}>Mở Content</Button>}
        </div>
      </article>;
    })}
    {preview && <Modal title="Video của lượt render" wide onClose={() => setPreviewId(null)}><div className="production-video-previews">{videos(preview).map(media => <div key={media.id}><h3>{media.name}</h3><video src={media.url} controls playsInline preload="metadata" /></div>)}</div></Modal>}
  </div>;
}
