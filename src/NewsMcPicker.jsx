import { useState } from 'react';
import { Field } from './components.jsx';
import { api, uploadFiles } from './api.js';
import { selectableMcImages } from '../shared/output-media.js';
import { MAX_NEWS_VIDEOS, mcRotationPreview } from '../shared/mc-rotation.js';

function SingleMcPicker({ data, projectId, value, onChange, count = 1, notify, label, required = false }) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const candidates = selectableMcImages(data, projectId);
  if (uploaded && !candidates.some(media => media.id === uploaded.id)) candidates.unshift(uploaded);
  const selected = candidates.find(media => media.id === value);
  const upload = async event => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      const results = await uploadFiles(files, projectId, 'news-mc');
      const snapshot = await api('/state', undefined, 'GET');
      const ids = new Set(results.filter(result => result.ok).map(result => result.id));
      const media = snapshot.media.find(media => ids.has(media.id) && media.kind === 'image');
      if (!media) throw new Error('Hãy chọn một tệp ảnh MC.');
      setUploaded(media); onChange(media.id);
      notify('Đã chọn ảnh MC vừa nhập.');
    } catch (error) { notify(error.message, 'error'); }
    finally { setUploading(false); }
  };
  return <div className="production-mc-picker">
    <Field label={label} hint={`Dùng cùng một ảnh MC cho ${count} video; mỗi video vẫn có lời đọc riêng. Chọn profile Auto để chạy nhiều tài khoản.`}>
      <select required={required} value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{required ? 'Chọn ảnh MC…' : 'Tự động · dùng MC của từng profile'}</option>
        {candidates.map(media => <option key={media.id} value={media.id}>{media.name} · {media.id.slice(0, 6)}</option>)}
      </select>
    </Field>
    {selected && <img className="production-mc-preview" src={selected.thumbnailUrl || selected.url} alt="Ảnh MC đã chọn" />}
    <label className="button mc-upload">{uploading ? 'Đang nhập ảnh…' : 'Nhập ảnh MC'}<input type="file" accept="image/*" aria-label="Nhập ảnh MC" disabled={uploading} onChange={upload} /></label>
  </div>;
}

export function NewsMcPicker({ data, projectId, value, onChange, count = 1, notify, label = 'Ảnh MC cho cả lô', rotation = [], onRotationChange }) {
  const candidates = selectableMcImages(data, projectId);
  const update = (index, patch) => onRotationChange(rotation.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const move = (index, delta) => {
    const next = [...rotation];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onRotationChange(next);
  };
  const spans = mcRotationPreview(rotation, count);
  return <div className="news-mc-controls">
    {onRotationChange && <label className="mc-rotation-toggle"><input type="checkbox" checked={rotation.length > 0} onChange={event => onRotationChange(event.target.checked ? [{ avatarMediaId: value || candidates[0]?.id || '', count: 10 }] : [])} /> Xoay vòng ảnh MC theo số video</label>}
    {rotation.length ? <div className="mc-rotation">
      <p>Mỗi ảnh chạy liên tiếp số video bạn nhập, rồi chuyển sang ảnh kế tiếp. Hết danh sách sẽ quay lại ảnh đầu. Áp dụng xuyên suốt các tin trong lượt render.</p>
      {rotation.map((entry, index) => <div className="mc-rotation-row" key={index}>
        <SingleMcPicker data={data} projectId={projectId} value={entry.avatarMediaId} onChange={avatarMediaId => update(index, { avatarMediaId })} count={entry.count} notify={notify} label={`Ảnh MC ${index + 1}`} required />
        <Field label={`Số video cho MC ${index + 1}`}><input type="number" min="1" max={MAX_NEWS_VIDEOS} step="1" required value={entry.count} onChange={event => update(index, { count: event.target.value === '' ? '' : Number(event.target.value) })} /></Field>
        <div className="inline-actions"><button type="button" className="button" disabled={!index} onClick={() => move(index, -1)} aria-label={`Đưa MC ${index + 1} lên`}>↑</button><button type="button" className="button" disabled={index === rotation.length - 1} onClick={() => move(index, 1)} aria-label={`Đưa MC ${index + 1} xuống`}>↓</button><button type="button" className="button" onClick={() => onRotationChange(rotation.filter((_, i) => i !== index))}>Bỏ MC {index + 1}</button></div>
      </div>)}
      <button type="button" className="button" disabled={rotation.length >= 50} onClick={() => onRotationChange([...rotation, { avatarMediaId: candidates.find(media => !rotation.some(entry => entry.avatarMediaId === media.id))?.id || '', count: 10 }])}>Thêm MC vào vòng</button>
      {spans.length > 0 && <div className="mc-rotation-preview" aria-label="Thứ tự MC khi render"><strong>Phân MC cho {count} video</strong>{spans.slice(0, 12).map((span, index) => <span key={index}>Video {span.start}{span.end !== span.start ? `–${span.end}` : ''}: {candidates.find(media => media.id === span.avatarMediaId)?.name || span.avatarMediaId.slice(0, 6)}</span>)}{spans.length > 12 && <small>Tiếp tục theo vòng đã chọn…</small>}</div>}
    </div> : <SingleMcPicker data={data} projectId={projectId} value={value} onChange={onChange} count={count} notify={notify} label={label} />}
  </div>;
}
