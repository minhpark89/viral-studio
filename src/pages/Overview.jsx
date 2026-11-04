import { useEffect, useRef, useState } from 'react';
import { BarChart3, RefreshCw, Users, Eye, MousePointerClick, ExternalLink, Search, Square } from 'lucide-react';
import { Button, Empty, Field } from '../components.jsx';
import { api } from '../api.js';
import { INSIGHT_MESSAGES } from '../../shared/meta-insights.js';
import './overview.css';

const labels = { followers: 'Người theo dõi', views: 'Lượt xem', engagement: 'Tương tác bài đăng' };
const format = value => typeof value === 'number' ? new Intl.NumberFormat('vi-VN').format(value) : '—';
const when = value => value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'Chưa đồng bộ';
const shortDate = date => date ? date.slice(8,10) + '/' + date.slice(5,7) : '';
const initialScope = { days: 7, pageId: '', groupId: '', query: '', status: 'all', sort: 'views', page: 1 };

export function OverviewPage({ notify, navigate }) {
  const [scope, setScope] = useState(initialScope), [query, setQuery] = useState('');
  const [payload, setPayload] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(() => localStorage.getItem('studio-meta-overview-auto') !== 'false');
  const [metric, setMetric] = useState('views'), [revision, setRevision] = useState(0);
  const attempts = useRef(new Map()), requestKey = JSON.stringify(scope);
  useEffect(() => { const timer = setTimeout(() => setScope(current => ({ ...current, query, page: 1 })), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { localStorage.setItem('studio-meta-overview-auto', String(auto)); }, [auto]);
  useEffect(() => {
    let stopped = false, timer; const controller = new AbortController();
    const load = async () => {
      if (document.hidden) { timer = setTimeout(load, 10000); return; }
      let next;
      try {
        const response = await fetch('/api/meta/overview?' + new URLSearchParams(scope), { signal: controller.signal });
        const value = await response.json(); if (!response.ok) throw new Error(value.error?.message || value.error || 'Chưa tải được tổng quan Meta.');
        next = value; if (stopped) return; setPayload(value); setError('');
        const attemptKey = scope.days + ':' + scope.pageId + ':' + scope.groupId;
        if (auto && value.needsRefresh && !value.progress.running && Date.now() - (attempts.current.get(attemptKey) || 0) > 15 * 60 * 1000) {
          attempts.current.set(attemptKey, Date.now());
          const result = await api('/meta/overview/refresh', scope);
          if (result.started && !stopped) { next = { ...value, progress: result.progress }; setPayload(next); }
        }
      } catch (failure) { if (!stopped && failure.name !== 'AbortError') setError(failure.message); }
      if (!stopped) timer = setTimeout(load, next?.progress.running ? 1500 : 60000);
    };
    load();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [requestKey, auto, revision]);
  const change = (key, value) => setScope(current => ({ ...current, [key]: value, page: 1 }));
  const refresh = async () => {
    setBusy(true);
    try { const result = await api('/meta/overview/refresh', scope); if (result.message) notify(result.message); setRevision(value => value + 1); }
    catch (failure) { notify(failure.message, 'error'); }
    finally { setBusy(false); }
  };
  const cancel = async () => { setBusy(true); try { await api('/meta/overview/cancel', {}); setRevision(value => value + 1); } catch (failure) { notify(failure.message,'error'); } finally { setBusy(false); } };
  const progress = payload?.progress, stats = payload?.metrics || {}, chart = stats[metric]?.series || [];
  const maximum = Math.max(1, ...chart.map(point => point.value || 0));
  const updateAge = payload?.rows.map(row => row.checkedAt).filter(Boolean) || [];
  return <div className="page meta-overview">
    <div className="page-heading"><div><div className="eyebrow">META · DỮ LIỆU THẬT</div><h1>Tổng quan Meta</h1><p>Theo dõi toàn bộ Page đã kết nối, độc lập với dự án đang dựng video.</p></div><div className="overview-actions"><Button busy={busy} disabled={progress?.running || !payload?.filteredPages} onClick={refresh}><RefreshCw size={15} /> Cập nhật {payload?.filteredPages || ''} Page</Button>{progress?.running && <Button busy={busy} onClick={cancel}><Square size={14} /> Dừng đồng bộ</Button>}</div></div>
    <div className="overview-controls">
      <Field label="Khoảng theo dõi"><select value={scope.days} onChange={event => change('days', Number(event.target.value))}><option value={7}>7 ngày đã hoàn tất</option><option value={28}>28 ngày đã hoàn tất</option></select></Field>
      <Field label="Page Meta"><select value={scope.pageId} onChange={event => change('pageId',event.target.value)}><option value="">Tất cả Page</option>{payload?.pageOptions.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select></Field>
      <Field label="Nhóm Page"><select value={scope.groupId} onChange={event => change('groupId',event.target.value)}><option value="">Mọi nhóm</option>{payload?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
      <label className="overview-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /> Tự cập nhật khi mở tổng quan · 15 phút</label>
    </div>
    {error && <div className="overview-alert" role="alert">{error} <Button onClick={() => setRevision(value => value + 1)}>Tải lại</Button></div>}
    {payload?.cacheWarning && <div className="overview-alert" role="status">{payload.cacheWarning}</div>}
    {progress?.running && <div className="overview-progress" role="status"><div><strong>Đang đọc Meta · {progress.completed}/{progress.total} Page</strong><span>{progress.errors ? `${progress.errors} Page có chỉ số cần xem lại · ` : ''}{progress.calls} lượt gọi · hiển thị ngay dữ liệu đã nhận</span></div><progress value={progress.completed} max={progress.total || 1} /></div>}
    <div className="overview-stat-grid">{[['followers',Users],['views',Eye],['engagement',MousePointerClick]].map(([key,Icon]) => <button key={key} className={'overview-stat ' + (metric === key ? 'selected' : '')} aria-pressed={metric === key} onClick={() => setMetric(key)}><span><Icon size={18} />{labels[key]}</span><strong>{format(stats[key]?.value)}</strong><small>{stats[key]?.coverage || 0}/{payload?.filteredPages || 0} Page có dữ liệu{stats[key]?.stale ? ` · ${stats[key].stale} Page dùng dữ liệu cũ` : ''}{stats[key]?.incomplete ? ` · ${stats[key].incomplete} Page thiếu ngày` : ''}</small><em>{key === 'followers' ? 'Số hiện tại · không phải số tăng mới' : `${scope.days} ngày báo cáo Meta`}</em></button>)}<div className="overview-stat overview-coverage"><span><BarChart3 size={18} /> Page đã cập nhật gần đây</span><strong>{payload?.freshPages || 0}<small> / {payload?.filteredPages || 0}</small></strong><small>Cache tối đa 15 phút trước khi đọc lại</small><em>Chưa có dữ liệu hiển thị “—”; số 0 là Meta trả về 0.</em></div></div>
    {payload && !payload.totalPages ? <Empty icon={BarChart3} title="Kết nối Page để xem tổng quan" action={<Button onClick={() => navigate('pages')}>Mở Channels &amp; Tokens</Button>}>Tổng quan dùng các Page và Token đã xác minh trong Viral Studio.</Empty> : <>
      <section className="overview-chart-panel" aria-label="Biểu đồ dữ liệu Meta"><div className="overview-panel-heading"><div><h2>{labels[metric]} theo ngày</h2><p>{metric === 'followers' ? 'Lịch sử bắt đầu từ ngày app đọc Meta; các ngày chưa thu thập không được điền giả.' : `${shortDate(payload?.period.since)} – ${shortDate(payload?.period.dates.at(-1))} · ngày Pacific theo Meta`}</p></div><span>{payload?.filteredPages || 0} Page trong bộ lọc</span></div>
      {chart.some(point => point.value !== null) ? <div className="overview-chart" style={{ gridTemplateColumns: `repeat(${chart.length}, minmax(14px, 1fr))` }}>{chart.map(point => <div className="overview-chart-column" key={point.date} title={`${point.date}: ${format(point.value)} · ${point.coverage}/${point.total} Page`}><span className="overview-chart-value">{format(point.value)}</span><div className="overview-chart-track">{point.value === null ? <span className="overview-no-point">—</span> : <div className={'overview-chart-bar ' + (point.coverage < point.total ? 'partial' : '')} style={{ height: Math.max(2, point.value / maximum * 100) + '%' }} />}</div><small>{shortDate(point.date)}</small></div>)}</div> : <div className="overview-empty-chart">{progress?.running ? 'Đang nhận dữ liệu Meta…' : 'Chưa có đủ dữ liệu để vẽ biểu đồ.'}</div>}
      <p className="overview-chart-note">Di chuột vào cột để xem số liệu và số Page đóng góp. Cột nhạt có dữ liệu chưa đủ tất cả Page.</p></section>
      <section className="overview-pages"><div className="overview-panel-heading"><div><h2>Chi tiết từng Page</h2><p>{payload?.filteredPages || 0}/{payload?.totalPages || 0} Page · dữ liệu thật, kèm thời điểm kiểm tra</p></div><Button onClick={() => navigate('pages')}>Quản lý Page / Token</Button></div><div className="overview-table-filters"><div className="search-field"><Search size={16} /><input aria-label="Tìm Page trong tổng quan" placeholder="Tên hoặc ID Page…" value={query} onChange={event => setQuery(event.target.value)} /></div><Field label="Trạng thái dữ liệu"><select value={scope.status} onChange={event => change('status', event.target.value)}><option value="all">Mọi trạng thái</option><option value="ready">Đủ dữ liệu</option><option value="attention">Cần xem lại</option><option value="not_synced">Chưa đồng bộ</option></select></Field><Field label="Sắp xếp"><select value={scope.sort} onChange={event => change('sort', event.target.value)}><option value="views">Lượt xem giảm dần</option><option value="followers">Người theo dõi giảm dần</option><option value="engagement">Tương tác giảm dần</option><option value="name">Tên Page</option></select></Field></div>
      <div className="overview-table-wrap"><table><thead><tr><th>Page</th><th>Người theo dõi</th><th>Lượt xem</th><th>Tương tác</th><th>Đồng bộ / tình trạng</th></tr></thead><tbody>{payload?.rows.map(row => <tr key={row.id} data-page-id={row.id}><td><button className="overview-page-name" onClick={() => change('pageId',row.id)}>{row.name}</button><small>{row.id} <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Mở Page ${row.name}`}><ExternalLink size={12} /></a></small></td>{['followers','views','engagement'].map(key => <td key={key} className="overview-number"><strong>{format(row.metrics[key].value)}</strong>{row.metrics[key].status !== 'ok' && <small className="overview-metric-reason" title={row.metrics[key].message}>{row.metrics[key].status === 'incomplete' ? `${row.metrics[key].coveredDays}/${row.metrics[key].expectedDays} ngày` : row.metrics[key].status === 'stale' ? 'Dữ liệu cũ · ' + row.metrics[key].message : row.metrics[key].message || INSIGHT_MESSAGES[row.metrics[key].status]}</small>}</td>)}<td><span className={'overview-state ' + row.status}>{row.status === 'ready' ? 'Đủ dữ liệu' : row.status === 'attention' ? 'Cần xem lại' : 'Chưa đồng bộ'}</span><small>{when(row.checkedAt)}{row.stale ? ' · cần cập nhật' : ''}</small></td></tr>)}</tbody></table>{payload && !payload.rows.length && <p className="overview-empty-chart">Không có Page khớp bộ lọc.</p>}</div>
      <div className="overview-pager"><Button disabled={!payload || payload.pagination.page <= 1} onClick={() => setScope(current => ({ ...current, page: payload.pagination.page - 1 }))}>Trang trước</Button><span>Trang {payload?.pagination.page || 1}/{payload?.pagination.pages || 1}</span><Button disabled={!payload || payload.pagination.page >= payload.pagination.pages} onClick={() => setScope(current => ({ ...current, page: payload.pagination.page + 1 }))}>Trang sau</Button></div></section>
    </>}
    <p className="overview-footnote">{payload?.reportingNote}{updateAge.length ? ` Lần kiểm tra gần nhất trong trang: ${when(Math.max(...updateAge))}.` : ''}</p>
  </div>;
}
