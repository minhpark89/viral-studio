import { useEffect, useState } from "react";
import {
  Search,
  Film,
  Download,
  Scissors,
  Trash2,
  Play,
  Image,
  Music2,
  Newspaper,
  FolderOpen,
} from "lucide-react";
import { api, bytes, timecode, clipFrom } from "../api.js";
import { Button, Empty, Field, MediaThumb, Uploader, Modal } from "../components.jsx";
import './library.css';
import { mediaOutputType as classifyMediaOutput, mediaLibraryGroup, isPageAvatar, isNewsPresenterMedia } from "../../shared/output-media.js";
import { outputContext, formatDateTime, sourceDateLabel } from "../../shared/source-context.js";
import { MediaPreview } from "../MediaPreview.jsx";

export function LibraryPage({ data, project, run, notify, navigate }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [group, setGroup] = useState('finished');
  const [period, setPeriod] = useState('all');
  const [pageNumber, setPageNumber] = useState(1);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [cleanup, setCleanup] = useState(null);
  const [lastDelete, setLastDelete] = useState(null);
  useEffect(() => { setSelected([]); setPageNumber(1); }, [group, filter, search, project.id, period]);
  useEffect(() => { let live = true; api('/storage/published-media').then(value => { if (live) setCleanup(value); }).catch(() => {}); return () => { live = false; }; }, [data.media.length]);
  useEffect(() => setSelected(current => current.filter(id => data.media.some(item => item.id === id))), [data.media]);
  const projectMedia = data.media.filter(item => item.projectId === project.id || !item.projectId);
  const media = data.media
    .filter(
      (item) =>
        (item.projectId === project.id || !item.projectId) &&
        (group === 'all' || mediaLibraryGroup(item, data) === group) &&
        (period === 'all' || Date.parse(outputContext(item, data).renderedAt) >= (period === 'today' ? new Date().setHours(0, 0, 0, 0) : Date.now() - 7 * 86400000)) &&
        (filter === "all" ||
          (filter === "exports"
            ? item.generated
            : ["news", "product"].includes(filter)
              ? item.kind === "video" && classifyMediaOutput(item, data.jobs) === filter
              : item.kind === filter)) &&
        item.name.toLowerCase().includes(search.toLowerCase()),
    )
    .slice()
    .sort((a, b) => Date.parse(outputContext(b, data).renderedAt || 0) - Date.parse(outputContext(a, data).renderedAt || 0));
  const append = async (items) => {
    const timeline = structuredClone(project.timeline);
    for (const item of items) {
      if (item.kind === "audio") {
        timeline.music = {
          mediaId: item.id,
          volume: 0.35,
          startSec: 0,
          offsetSec: 0,
          speed: 1,
          loop: true,
          fadeIn: 0.5,
          fadeOut: 1,
        };
      } else timeline.clips.push(clipFrom(item));
    }
    if (
      await run(() => api(`/projects/${project.id}`, { timeline }, "PATCH"))
    ) {
      notify(`Đã thêm ${items.length} tệp vào trình dựng.`);
      navigate("editor");
    }
  };
  const handoffToContent = (item) => {
    sessionStorage.setItem(
      "studio-content-media",
      JSON.stringify({ mediaId: item.id, projectId: project.id }),
    );
    navigate("content");
  };
  const pageCount = Math.max(1, Math.ceil(media.length / 48));
  const currentPage = Math.min(pageNumber, pageCount);
  const visibleMedia = media.slice((currentPage - 1) * 48, currentPage * 48);
  const selectedSet = new Set(selected);
  const allSelected = media.length > 0 && media.every(item => selectedSet.has(item.id));
  const reviewDelete = async ids => {
    if (!ids.length || busy) return;
    setBusy(true);
    const result = await run(() => api('/media/delete-bulk', { ids, preview: true }));
    if (result) setReview({ ...result, ids });
    setBusy(false);
  };
  const confirmDelete = async () => {
    if (busy || !review) return;
    setBusy(true);
    const result = await run(() => api('/media/delete-bulk', { ids: review.ids }));
    if (result) { setLastDelete(result); setSelected(current => current.filter(id => !result.removedIds.includes(id))); setReview(null); notify(`Đã xóa ${result.removedCount} tệp · giải phóng ${bytes(result.freedBytes)}${result.blockedCount ? ` · giữ ${result.blockedCount} tệp còn được dùng hoặc chưa xóa được` : ''}.`); }
    setBusy(false);
  };
  const cleanPublished = async () => {
    setBusy(true);
    const result = await run(() => api('/storage/published-media/clean', {}));
    if (result) { notify(`Đã dọn ${result.removedCount} tệp đã đăng · ${bytes(result.freedBytes)}.`); const next = await run(() => api('/storage/published-media')); if (next) setCleanup(next); }
    setBusy(false);
  };
  return (
    <div className="page library-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MEDIA LIBRARY</div>
          <h1>Video và tư liệu theo mục đích.</h1>
          <p>Video hoàn tất ở kho riêng. Ảnh MC, video MC thô và avatar Page có nhóm riêng để dễ quản lý.</p>
        </div>
        <Uploader compact projectId={project.id} notify={notify} />
      </div>
      <div className="library-retention"><div><strong>Tự dọn sau khi đăng thành công</strong><p>Video cuối, MC thô do app tạo và ảnh minh họa News được dọn sau khi video + bình luận đầu tiên thành công. Kiểm tra lại khi mở app và mỗi 5 phút. Tệp còn dùng cho bài khác, ảnh MC và avatar dùng lại được giữ.</p><small>{projectMedia.length} tệp trong dự án · {bytes(projectMedia.reduce((sum, item) => sum + Number(item.bytes || 0), 0))}{cleanup ? ` · ${cleanup.candidates} tệp đã đăng có thể dọn trong toàn bộ workspace` : ''}</small></div><Button busy={busy} disabled={!cleanup?.candidates} onClick={cleanPublished}>Dọn tệp đã đăng{cleanup?.candidates ? ` (${cleanup.candidates})` : ''}</Button></div>
      <div className="segmented library-groups" aria-label="Nhóm kho media">{[['finished','Video hoàn tất'],['assets','Tư liệu'],['mc-image','Ảnh MC'],['presenter','Video MC thô'],['page-avatar','Avatar Page'],['all','Tất cả media']].map(([value,label]) => { const items = projectMedia.filter(item => value === 'all' || mediaLibraryGroup(item, data) === value); return <button key={value} className={group === value ? 'selected' : ''} aria-pressed={group === value} onClick={() => { setGroup(value); setFilter('all'); }}>{label} <b>{items.length}</b><small>{bytes(items.reduce((sum,item) => sum + Number(item.bytes || 0), 0))}</small></button>; })}</div>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "Tất cả"],
            ["video", "Video"],
            ["news", "Output News"],
            ["product", "Output Product"],
            ["image", "Ảnh"],
            ["audio", "Âm thanh"],
            ["exports", "Đã tạo / xuất"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Tìm media"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm trong thư viện…"
          />
        </div>
      </div>
      <div className="output-filters"><Field label="Ngày tạo video / media"><select value={period} onChange={event => setPeriod(event.target.value)}><option value="all">Tất cả · mới nhất trước</option><option value="today">Hôm nay</option><option value="7d">7 ngày qua</option></select></Field><span className="muted small">{media.length} tệp trong nhóm đang chọn</span></div>
      <div className="library-select-all"><label><input type="checkbox" aria-label="Chọn tất cả tệp theo bộ lọc" ref={node => { if (node) node.indeterminate = selected.length > 0 && !allSelected; }} checked={allSelected} disabled={!media.length || busy} onChange={event => setSelected(event.target.checked ? media.map(item => item.id) : [])} /> Chọn tất cả {media.length} tệp theo bộ lọc</label><span>Áp dụng cả các trang sau trong dự án này.</span></div>
      {selected.length > 0 && (
        <div className="selection-toolbar">
          <span>Đã chọn {selected.length} tệp</span>
          <button className="text-button" onClick={() => setSelected([])}>
            Bỏ chọn
          </button>
          <Button
            variant="primary"
            onClick={() =>
              append(
                selected
                  .map((id) => data.media.find((item) => item.id === id))
                  .filter(Boolean),
              )
            }
          >
            <Scissors size={15} />
            Thêm vào timeline
          </Button>
          <Button className="danger-text" busy={busy} onClick={() => reviewDelete(selected)}>
            <Trash2 size={15} />
            Xóa đã chọn
          </Button>
        </div>
      )}
      {media.length ? (
        <div className="media-grid">
          {visibleMedia.map((item) => (
            <article
              key={item.id}
              className={`media-card ${selected.includes(item.id) ? "selected" : ""}`}
              data-media-id={item.id}
            >
              <div className="media-cover">
                <button
                  className="media-preview"
                  onClick={() => setPreview(item)}
                  aria-label={`Xem ${item.name}`}
                >
                  <MediaThumb media={item} />
                  <span className="play-overlay">
                    {item.kind === "image" ? (
                      <Image size={23} />
                    ) : item.kind === "audio" ? (
                      <Music2 size={23} />
                    ) : (
                      <Play size={23} />
                    )}
                  </span>
                </button>
                <input
                  className="media-check"
                  aria-label={`Chọn ${item.name}`}
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
                <span className="media-time">
                  {item.kind === "image"
                    ? `${item.width}×${item.height}`
                    : timecode(item.duration)}
                </span>
                {item.generated && (
                  <span className="generated-tag">
                    {data.jobs.find((job) => job.id === item.jobId)?.type ===
                    "render"
                      ? "BẢN XUẤT"
                      : "AI"}
                  </span>
                )}
                {item.kind === "video" && classifyMediaOutput(item, data.jobs) !== "other" && (
                  <span className={`media-output-tag ${classifyMediaOutput(item, data.jobs)}`}>
                    {classifyMediaOutput(item, data.jobs) === "news" ? "OUTPUT NEWS" : "OUTPUT PRODUCT"}
                  </span>
                )}
              </div>
              <div className="media-info">
                <h3 title={item.name}>{item.name}</h3>
                <div className="output-context"><span>{item.generated ? 'Hoàn tất' : 'Nhập lúc'}: {formatDateTime(outputContext(item, data).renderedAt)} · Mã {item.id.slice(0, 8)}</span>{outputContext(item, data).research && <span>{sourceDateLabel(outputContext(item, data).research)}</span>}{outputContext(item, data).variant && <span>Phiên bản {outputContext(item, data).variant}</span>}</div>
                <p>
                  {item.kind === "audio"
                    ? "AUDIO"
                    : `${item.width}×${item.height}`}
                  <span>·</span>
                  {bytes(item.bytes)}
                </p>
                <div className="spread">
                  <button
                    className="text-button"
                    onClick={() => append([item])}
                  >
                    <Scissors size={14} />
                    Dựng video
                  </button>
                  {item.kind !== "audio" && !isPageAvatar(item, data) && !isNewsPresenterMedia(item, data.jobs) && (
                    <button
                      className="text-button"
                      onClick={() => handoffToContent(item)}
                    >
                      <Newspaper size={14} />
                      Soạn Content
                    </button>
                  )}
                  <div className="inline-actions">
                    {data.capabilities?.desktop && (
                      <button
                        className="icon-button"
                        title="Mở thư mục chứa tệp"
                        aria-label={`Mở thư mục chứa ${item.name}`}
                        onClick={() => run(
                          () => api("/desktop/reveal", { mediaId: item.id }),
                          "Đã mở thư mục chứa tệp.",
                        )}
                      >
                        <FolderOpen size={15} />
                      </button>
                    )}
                    <a
                      className="icon-button"
                      href={`${item.url}?download=1`}
                      title="Tải về"
                    >
                      <Download size={15} />
                    </a>
                    <button
                      className="icon-button danger-text"
                      aria-label={`Xóa tệp ${item.name}`}
                      disabled={busy}
                      onClick={() => reviewDelete([item.id])}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Film}
          title="Thư viện đang chờ nội dung"
          action={
            <Button onClick={() => navigate("create")}>Tạo video AI</Button>
          }
        >
          Nhập video, ảnh và âm thanh từ máy hoặc tạo nội dung mới bằng AI.
        </Empty>
      )}
      {media.length > 0 && <div className="library-pager"><Button disabled={currentPage <= 1} onClick={() => setPageNumber(currentPage - 1)}>Trang trước</Button><span>Trang {currentPage}/{pageCount} · {visibleMedia.length}/{media.length} tệp</span><Button disabled={currentPage >= pageCount} onClick={() => setPageNumber(currentPage + 1)}>Trang sau</Button></div>}
      {lastDelete && <p role="status" className="library-delete-result">Lần xóa gần nhất: {lastDelete.removedCount} tệp · {bytes(lastDelete.freedBytes)}. {lastDelete.blockedCount > 0 && `Giữ lại ${lastDelete.blockedCount} tệp còn được dùng hoặc đường dẫn chưa an toàn.`}</p>}
      {review && <Modal title="Xác nhận xóa tệp đã chọn" onClose={() => { if (!busy) setReview(null); }}><p>Sẽ xóa vĩnh viễn {review.removableCount} / {review.ids.length} tệp đã chọn cùng thumbnail, giải phóng khoảng {bytes(review.results.filter(item => item.removable).reduce((sum,item) => sum + item.bytes, 0))}.</p>{review.blockedCount > 0 && <div className="library-delete-blocked"><strong>Giữ lại {review.blockedCount} tệp đang dùng hoặc chưa xóa được</strong><ul>{review.results.filter(item => !item.removable).slice(0,8).map(item => <li key={item.mediaId}>{item.name || 'Tệp đã thay đổi'} — {item.reason === 'media_still_referenced' ? 'còn được bài đăng, timeline, ảnh đại diện hoặc tác vụ sử dụng' : item.reason === 'media_not_found' ? 'đã được xóa' : 'cần kiểm tra đường dẫn tệp'}</li>)}</ul>{review.blockedCount > 8 && <small>Và {review.blockedCount - 8} tệp khác.</small>}</div>}<p className="muted small">Để chọn toàn bộ thư viện dự án, chọn nhóm “Tất cả media”, bỏ bộ lọc rồi tick “Chọn tất cả”. Tệp sẽ được kiểm tra lại trước khi xóa.</p><div className="modal-actions"><Button disabled={busy} onClick={() => setReview(null)}>Hủy</Button><Button className="danger-text" busy={busy} disabled={!review.removableCount} onClick={confirmDelete}>Xóa {review.removableCount} tệp</Button></div></Modal>}
      <div className="library-drop">
        <Uploader projectId={project.id} notify={notify} />
      </div>
      {preview && (
        <MediaPreview media={preview} data={data} onClose={() => setPreview(null)}>
            <Button variant="primary" onClick={() => append([preview])}>
              <Scissors size={16} />
              Thêm vào trình dựng
            </Button>
        </MediaPreview>
      )}
    </div>
  );
}
