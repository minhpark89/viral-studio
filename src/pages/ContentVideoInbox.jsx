import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Video } from 'lucide-react';
import { Button } from '../components.jsx';
import { mediaContentType } from '../../shared/content-inventory.js';
import { createContentBatch } from '../content-creation.js';

const PAGE_SIZE = 20;

export function ContentVideoInbox({ videos, busy, autoPublishNews, create, onCreated, onStart, onFinish, notify }) {
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(0);
  const [concurrency, setConcurrency] = useState(2);
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stop = useRef(false);
  const active = useRef(false);
  const mounted = useRef(true);
  const selectAllRef = useRef(null);
  const selectedVideos = videos.filter(video => selected.includes(video.id));
  const allSelected = videos.length > 0 && selectedVideos.length === videos.length;
  const lastPage = Math.max(0, Math.ceil(videos.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = videos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const disabled = Boolean(busy) || running;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current = true; };
  }, []);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVideos.length > 0 && !allSelected;
  }, [selectedVideos.length, allSelected]);

  const run = async targets => {
    if (active.current || busy || !targets.length) return;
    active.current = true; stop.current = false;
    setRunning(true); setStopping(false); onStart();
    try {
      const result = await createContentBatch({
        videos: targets, concurrency, create,
        onCreated: (post, video) => {
          if (!mounted.current) return;
          onCreated(post);
          setSelected(ids => ids.filter(id => id !== video.id));
        },
        onProgress: value => { if (mounted.current) setProgress(value); },
        shouldStop: () => stop.current,
      });
      if (mounted.current) notify(`Đã tạo ${result.created}/${result.total} Content${result.failures.length ? ` · ${result.failures.length} lỗi tạo Content` : ''}${result.websiteErrors.length ? ` · ${result.websiteErrors.length} bài cần đăng lại website` : ''}${result.stopped ? ` · ${result.total - result.completed} video chưa chạy` : ''}.`, result.failures.length || result.websiteErrors.length ? 'error' : undefined);
    } finally {
      active.current = false;
      if (mounted.current) { setRunning(false); setStopping(false); }
      onFinish();
    }
  };
  const toggle = id => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);

  if (!videos.length && !progress) return null;
  return <section className="content-video-inbox" aria-label="Video chưa có Content">
    <div className="hub-panel-heading"><div><span className="hub-kicker">VIDEO ĐÃ RENDER</span><h2>{videos.length} video chưa có Content</h2><p>Mỗi video có một Content riêng, kể cả các bản render cùng tin. {autoPublishNews ? 'News sẽ tự đăng website theo cài đặt và gắn URL vào first comment.' : 'News được lưu thành bản nháp; tự đăng website đang tắt.'}</p></div></div>
    {videos.length > 0 && <div className="content-inbox-controls">
      <label className="content-select-toggle"><input ref={selectAllRef} type="checkbox" checked={allSelected} disabled={disabled} onChange={() => setSelected(allSelected ? [] : videos.map(video => video.id))} /><span>Chọn tất cả {videos.length} video</span></label>
      <span className="content-bulk-hint">Đã chọn {selectedVideos.length} video · gồm mọi trang</span>
      <label className="content-inbox-concurrency">Số luồng tạo Content<select aria-label="Số luồng tạo Content" value={concurrency} disabled={disabled} onChange={event => setConcurrency(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <Button variant="primary" busy={running} disabled={disabled || !selectedVideos.length} onClick={() => run(selectedVideos)}><Sparkles size={15} />Tạo Content cho {selectedVideos.length} video</Button>
    </div>}
    {progress && <div className="content-inbox-progress" role="status" aria-live="polite">
      <strong>{running ? stopping ? 'Đang dừng sau các video đang xử lý' : 'Đang tạo Content' : progress.stopped ? 'Đã dừng' : 'Đã xử lý'}: {progress.completed}/{progress.total} video</strong>
      <span>{progress.created} Content đã tạo · {progress.active} đang xử lý · {progress.failures.length} lỗi tạo · {progress.websiteErrors.length} lỗi website{progress.stopped ? ` · ${progress.total - progress.completed} chưa chạy` : ''}</span>
      <progress value={progress.completed} max={Math.max(1, progress.total)} aria-label="Tiến độ tạo Content" />
      {running && <p>Giữ mục Content mở đến khi xong. Chuyển mục sẽ dừng gửi các video chưa chạy.</p>}
      {running && <Button disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>Dừng sau video đang xử lý</Button>}
      {!running && !!(progress.failures.length + progress.websiteErrors.length) && <details><summary>Xem các lỗi cần xử lý</summary><ul>{[...progress.failures, ...progress.websiteErrors].map(error => <li key={error.id}>{error.title || error.id}: {error.message}</li>)}</ul><p>Video lỗi tạo Content vẫn được chọn để thử lại. Bài lỗi website đã lưu trong mục Cần đăng web.</p></details>}
    </div>}
    {visible.map(video => <article key={video.id} data-video-id={video.id}>
      <input type="checkbox" aria-label={`Chọn video ${video.production?.title || video.name} · ${video.id.slice(0, 8)}`} checked={selected.includes(video.id)} disabled={disabled} onChange={() => toggle(video.id)} />
      <Video size={22} aria-hidden="true" />
      <div><strong>{video.production?.title || video.name}</strong><p>{mediaContentType(video) === 'news' ? 'News' : 'Product'} · {video.duration ? `${Number(video.duration).toFixed(1)} giây · ` : ''}{video.createdAt ? `${new Date(video.createdAt).toLocaleString('vi-VN')} · ` : ''}Mã {video.id.slice(0, 8)}</p></div>
      <Button disabled={disabled} onClick={() => run([video])}><Sparkles size={15} />Tạo Content</Button>
    </article>)}
    {videos.length > 0 && <div className="content-inbox-pagination"><span>Hiển thị {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, videos.length)}/{videos.length} video</span><Button aria-label="Trang video trước" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></Button><span>Trang {currentPage + 1}/{lastPage + 1}</span><Button aria-label="Trang video sau" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></Button></div>}
  </section>;
}
