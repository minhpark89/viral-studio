import { Button, Field } from './components.jsx';
import { DEFAULT_NEWS_RENDER_STYLE, NEWS_RENDER_STYLES, NEWS_FONTS } from '../shared/news-format.js';
export { useNewsVideoOptions } from './useNewsVideoOptions.js';

export function NewsStyleSelect({ value, onChange, disabled = false, compact = false }) {
  return <Field label="Style render tin tức" hint={compact ? undefined : NEWS_RENDER_STYLES.find(style => style.id === value.newsRenderStyle)?.description || NEWS_RENDER_STYLES[0].description}>
    <select aria-label="Style render tin tức" disabled={disabled} value={value.newsRenderStyle || DEFAULT_NEWS_RENDER_STYLE} onChange={event => onChange({ ...value, newsRenderStyle: event.target.value })}>
      {NEWS_RENDER_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
    </select>
  </Field>;
}

export function NewsFontSelect({ value, onChange, disabled = false }) {
  return <Field label="Font chữ"><select disabled={disabled} value={value.fontStyle || 'news'} onChange={event => onChange({ ...value, fontStyle: event.target.value })}>{NEWS_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select></Field>;
}

export function NewsOptionsSaveState({ state }) {
  return <div className="news-options-save-state" aria-live="polite">
    {state?.error ? <span role="alert">Chưa lưu lựa chọn: {state.error} <Button type="button" onClick={state.retry}>Lưu lại lựa chọn</Button></span> : state?.saving ? 'Đang lưu lựa chọn…' : 'Style, font, độ dài và số ảnh dùng chung trong News Studio theo dự án. Chỉ áp dụng cho lượt mới.'}
  </div>;
}

export function NewsVideoOptions({ value, onChange, showStyle = true, showFont = false, disabled = false, saveState }) {
  const change = (key, text) => onChange({ ...value, [key]: text === 'auto' ? text : Number(text) });
  return <div className="news-video-options">
    {showStyle && <NewsStyleSelect value={value} onChange={onChange} disabled={disabled} />}
    {saveState && <NewsOptionsSaveState state={saveState} />}
    {showFont && <NewsFontSelect value={value} onChange={onChange} disabled={disabled} />}
    <div className="form-grid">
      <Field label="Độ dài clip tóm tắt" hint="Mục tiêu theo lời đọc, tối thiểu 15 giây. Tốc độ MC có thể làm độ dài thực tế chênh vài giây.">
        <select aria-label="Độ dài clip tóm tắt" disabled={disabled} value={value.newsDuration} onChange={event => change('newsDuration', event.target.value)}>
          <option value="auto">Theo tin · khoảng 15–30 giây</option>
          <option value="15">Khoảng 15 giây</option><option value="20">Khoảng 20 giây</option><option value="30">Khoảng 30 giây</option>
        </select>
      </Field>
      <Field label="Ảnh minh họa" hint="Ưu tiên đúng nội dung và khác nhau; nếu nguồn thiếu, dùng ít ảnh hơn và báo số thực tế.">
        <select aria-label="Ảnh minh họa" disabled={disabled} value={value.newsImageCount} onChange={event => change('newsImageCount', event.target.value)}>
          <option value="auto">Theo tin · thường 8 ảnh, khoảng 6–10 ảnh</option>
          <option value="6">Tối đa 6 ảnh</option><option value="8">Tối đa 8 ảnh</option><option value="10">Tối đa 10 ảnh</option>
        </select>
      </Field>
    </div>
    <p className="muted small">Clip chỉ nêu ý chính và mời xem bài đầy đủ qua link ở bình luận đầu tiên. Không kéo dài lời đọc bằng chi tiết ngoài nguồn.</p>
    <p className="muted small">Theo tin nhắm khoảng 24 giây, lời đọc tối đa 500 ký tự. DreamFace Free tiêu chuẩn giới hạn 30 giây; Avatar 3.0 Fast có lượt miễn phí riêng, hết lượt cần credits.</p>
  </div>;
}
