import { useEffect, useState } from 'react';
import { Field } from './components.jsx';
import { newsDurationSchema, newsImageCountSchema } from '../shared/news-format.js';

export function useNewsVideoOptions(projectId) {
  const key = `studio-news-format:${projectId}`;
  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      return { newsDuration: newsDurationSchema.catch('auto').parse(saved.newsDuration), newsImageCount: newsImageCountSchema.catch('auto').parse(saved.newsImageCount) };
    } catch { return { newsDuration: 'auto', newsImageCount: 'auto' }; }
  };
  const [value, setValue] = useState(read);
  useEffect(() => setValue(read()), [key]);
  const update = next => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* A storage restriction must not block rendering. */ }
  };
  return [value, update];
}

export function NewsVideoOptions({ value, onChange }) {
  const change = (key, text) => onChange({ ...value, [key]: text === 'auto' ? text : Number(text) });
  return <div className="news-video-options">
    <div className="form-grid">
      <Field label="Độ dài clip tóm tắt" hint="Mục tiêu theo lời đọc, tối thiểu 15 giây. Tốc độ MC có thể làm độ dài thực tế chênh vài giây.">
        <select aria-label="Độ dài clip tóm tắt" value={value.newsDuration} onChange={event => change('newsDuration', event.target.value)}>
          <option value="auto">Theo tin · khoảng 15–30 giây</option>
          <option value="15">Khoảng 15 giây</option><option value="20">Khoảng 20 giây</option><option value="30">Khoảng 30 giây</option>
        </select>
      </Field>
      <Field label="Ảnh minh họa" hint="Ưu tiên đúng nội dung và khác nhau; nếu nguồn thiếu, dùng ít ảnh hơn và báo số thực tế.">
        <select aria-label="Ảnh minh họa" value={value.newsImageCount} onChange={event => change('newsImageCount', event.target.value)}>
          <option value="auto">Theo độ dài clip · 5–10 ảnh</option>
          <option value="6">Tối đa 6 ảnh</option><option value="8">Tối đa 8 ảnh</option><option value="10">Tối đa 10 ảnh</option>
        </select>
      </Field>
    </div>
    <p className="muted small">Clip chỉ nêu ý chính và mời xem bài đầy đủ qua link ở bình luận đầu tiên. Không kéo dài lời đọc bằng chi tiết ngoài nguồn.</p>
    <p className="muted small">Theo tin nhắm khoảng 24 giây, lời đọc tối đa 500 ký tự. DreamFace Free tiêu chuẩn giới hạn 30 giây; Avatar 3.0 Fast có lượt miễn phí riêng, hết lượt cần credits.</p>
  </div>;
}
