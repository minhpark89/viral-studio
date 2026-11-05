import { useEffect, useRef, useState } from 'react';
import { fold, healthLabels, lifecycleLabels } from '../../shared/management.js';
import './groups.css';

export function PageAvatar({ page }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [page.avatar]);
  return page.avatar && !failed
    ? <img className="group-avatar" src={page.avatar} alt="" loading="lazy" draggable="false" onError={() => setFailed(true)} />
    : <span className="group-avatar fallback" aria-label="Chưa có avatar">{(page.name || 'P').slice(0, 1).toUpperCase()}</span>;
}

export const pageCanJoin = page => page.lifecycle === 'active' && page.hasUsableToken && !['identity', 'restricted', 'unpublished', 'token'].includes(page.health);

export function GroupMemberPicker({ items, selected, onChange, kind = 'page', groups = [], allowIssues = false, label }) {
  const [query, setQuery] = useState(''), [health, setHealth] = useState('all'), [group, setGroup] = useState('all');
  const anchor = useRef(null), drag = useRef(null), selectAll = useRef(null), list = useRef(null), frame = useRef(null);
  const ids = new Set(selected);
  const visible = items.filter(item => fold(`${item.name} ${item.id} ${item.error || ''}`).includes(fold(query))
    && (health === 'all' || health === 'selected' && ids.has(item.id) || health === 'ready' && (kind === 'token' ? item.status === 'ACTIVE' : pageCanJoin(item)) || health === 'issues' && (kind === 'token' ? item.status !== 'ACTIVE' : !pageCanJoin(item)))
    && (group === 'all' || item.groupIds?.includes(group)));
  const canSelect = item => allowIssues || (kind === 'token' ? item.status === 'ACTIVE' : pageCanJoin(item));
  const eligible = visible.filter(canSelect), all = eligible.length > 0 && eligible.every(item => ids.has(item.id));
  const visibleRef = useRef(visible), selectedRef = useRef(selected), changeRef = useRef(onChange);
  visibleRef.current = visible; selectedRef.current = selected; changeRef.current = onChange;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = !all && eligible.some(item => ids.has(item.id)); });
  useEffect(() => { anchor.current = null; drag.current = null; }, [query, health, group]);
  useEffect(() => {
    const end = () => { drag.current = null; cancelAnimationFrame(frame.current); };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end);
    return () => { end(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); };
  }, []);
  const selectRange = (start, end, selecting, base = selectedRef.current) => {
    const next = new Set(base);
    visibleRef.current.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(item => {
      if (selecting && canSelect(item)) next.add(item.id); else if (!selecting) next.delete(item.id);
    });
    onChange([...next]);
  };
  const start = (event, index) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    const item = visible[index], selecting = !ids.has(item.id);
    const from = event.shiftKey && anchor.current !== null ? anchor.current : index;
    selectRange(from, index, selecting);
    anchor.current = from;
    drag.current = { start: from, selecting, base: [...selected], last: index };
  };
  const extend = index => {
    if (!drag.current) return;
    drag.current.last = index;
    selectRange(drag.current.start, index, drag.current.selecting, drag.current.base);
  };
  const move = event => {
    if (!drag.current) return;
    cancelAnimationFrame(frame.current);
    const y = event.clientY, x = event.clientX;
    const scroll = () => {
      if (!drag.current || !list.current) return;
      const bounds = list.current.getBoundingClientRect();
      const delta = y < bounds.top + 28 ? -10 : y > bounds.bottom - 28 ? 10 : 0;
      if (!delta) return;
      list.current.scrollTop += delta;
      const row = document.elementFromPoint(x, Math.max(bounds.top + 3, Math.min(bounds.bottom - 3, y)))?.closest('[data-picker-index]');
      if (row) extend(Number(row.dataset.pickerIndex));
      frame.current = requestAnimationFrame(scroll);
    };
    scroll();
  };
  return <section className="group-picker" aria-label={label || `Chọn ${kind === 'token' ? 'token' : 'Page'}`}>
    <div className="group-picker-filters">
      <input aria-label={`Tìm ${kind === 'token' ? 'token trong pool' : 'Page trong nhóm'}`} placeholder="Tìm tên hoặc ID…" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Lọc thành viên" value={health} onChange={event => setHealth(event.target.value)}><option value="all">Tất cả tình trạng</option><option value="ready">Sẵn sàng</option><option value="issues">Cần xử lý</option><option value="selected">Đã chọn</option></select>
      {kind === 'page' && groups.length > 0 && <select aria-label="Lọc theo nhóm Page" value={group} onChange={event => setGroup(event.target.value)}><option value="all">Mọi nhóm Page</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    </div>
    <div className="group-picker-toolbar">
      <label><input ref={selectAll} type="checkbox" aria-label="Chọn tất cả kết quả lọc" checked={all} disabled={!eligible.length} onChange={() => { const next = new Set(selected); eligible.forEach(item => all ? next.delete(item.id) : next.add(item.id)); onChange([...next]); }} /> Chọn tất cả kết quả lọc ({eligible.length})</label>
      <strong aria-live="polite">{selected.length} đã chọn · {visible.length} hiển thị</strong>
      <button type="button" className="mg-text-button" disabled={!selected.length} onClick={() => onChange([])}>Bỏ chọn tất cả</button>
    </div>
    <p className="group-picker-help">Tick từng dòng, giữ Shift để chọn một dải hoặc kéo chuột qua các dòng. Lựa chọn ngoài bộ lọc được giữ lại.</p>
    <div className="group-picker-list" ref={list} onPointerMove={move}>
      {visible.map((item, index) => <div className={`group-picker-row ${ids.has(item.id) ? 'selected' : ''} ${!canSelect(item) ? 'unavailable' : ''}`} key={item.id} data-picker-id={item.id} data-picker-index={index} onPointerDown={event => start(event, index)} onPointerEnter={() => extend(index)} onClick={event => { if (event.detail !== 0 && !event.target.closest('input') && !drag.current && event.nativeEvent.pointerType === 'touch') selectRange(index, index, !ids.has(item.id)); }}>
        <input type="checkbox" aria-label={`Chọn ${kind === 'token' ? 'token' : 'Page'} ${item.name}`} checked={ids.has(item.id)} disabled={!canSelect(item) && !ids.has(item.id)} onClick={event => { if (event.detail && event.nativeEvent.pointerType !== 'touch') event.preventDefault(); }} onChange={() => selectRange(index, index, !ids.has(item.id))} />
        <span className="group-row-number">{index + 1}</span>
        {kind === 'page' && <PageAvatar page={item} />}
        <span className="group-picker-name"><strong>{item.name || item.id}</strong><small>{item.id}</small></span>
        <span className="group-picker-health">{kind === 'token' ? `${item.status === 'ACTIVE' ? 'Hoạt động' : 'Cần xử lý'} · ${item.pagesCount || 0} Page` : `${healthLabels[item.health] || 'Chưa kiểm tra'} · ${lifecycleLabels[item.lifecycle] || 'Đang dùng'}`}</span>
      </div>)}
      {!visible.length && <p className="hub-empty">Không có kết quả phù hợp.</p>}
    </div>
  </section>;
}
