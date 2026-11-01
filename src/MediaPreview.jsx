import { useState } from 'react';
import { Button, Modal } from './components.jsx';
import { api } from './api.js';
import { outputContext, sourceDateLabel, formatDateTime } from '../shared/source-context.js';

export function MediaPreview({ media, data, onClose, children }) {
  const [error, setError] = useState('');
  const [location, setLocation] = useState(null);
  const context = outputContext(media, data);
  const reveal = async () => {
    try {
      const details = await api(`/media/${media.id}/location`, undefined, 'GET');
      setLocation(details);
      await api('/desktop/reveal', { mediaId: media.id });
    } catch (failure) { setError(failure.message); }
  };
  return <Modal title={`Xem ${media.kind === 'video' ? 'video' : 'media'} · ${media.name}`} wide onClose={onClose}>
    <div className="preview-modal">
      {media.kind === 'video' ? <video key={media.id} src={media.url} poster={media.thumbnailUrl || undefined} controls autoPlay playsInline onError={() => setError('Không mở được video. Hãy kiểm tra tệp đã lưu.')} />
        : media.kind === 'audio' ? <audio src={media.url} controls autoPlay /> : <img src={media.url} alt={media.name} />}
    </div>
    <div className="output-context">
      <strong>{media.name}</strong>
      <span>{media.generated ? 'Hoàn tất' : 'Nhập lúc'}: {formatDateTime(context.renderedAt)} · Mã {media.id.slice(0, 8)}{context.variant ? ` · Phiên bản ${context.variant}` : ''}</span>
      {context.research && <><span>Tin: {context.research.headline || context.research.topic}</span><span>{sourceDateLabel(context.research)}</span></>}
      {context.avatar && <span>Ảnh MC: {context.avatar.name} · {context.avatar.id.slice(0, 8)}</span>}
      {location && <code>{location.file}</code>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="modal-actions">
      {data.capabilities?.desktop && <Button onClick={reveal}>Chọn đúng tệp trong thư mục</Button>}
      <a className="button" href={`${media.url}?download=1`}>Tải tệp này</a>
      {children}
    </div>
  </Modal>;
}
