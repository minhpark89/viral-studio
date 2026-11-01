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
import { Button, Empty, Field, MediaThumb, Uploader } from "../components.jsx";
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
  useEffect(() => setSelected([]), [group, filter, search, project.id, period]);
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
  const deleteSelected = async () => {
    const items = selected
      .map((id) => data.media.find((item) => item.id === id))
      .filter(Boolean);
    if (!items.length || !confirm(`Xóa ${items.length} tệp đã chọn khỏi thư viện?`)) return;
    const results = await Promise.all(
      items.map((item) => run(() => api(`/media/${item.id}`, {}, "DELETE"))),
    );
    const deleted = results.filter(Boolean).length;
    if (deleted) {
      setSelected([]);
      notify(`Đã xóa ${deleted} tệp khỏi thư viện.`);
    }
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
      <div className="segmented library-groups" aria-label="Nhóm kho media">{[['finished','Video hoàn tất'],['assets','Tư liệu'],['mc-image','Ảnh MC'],['presenter','Video MC thô'],['page-avatar','Avatar Page'],['all','Tất cả media']].map(([value,label]) => <button key={value} className={group === value ? 'selected' : ''} aria-pressed={group === value} onClick={() => { setGroup(value); setFilter('all'); }}>{label} <b>{projectMedia.filter(item => value === 'all' || mediaLibraryGroup(item, data) === value).length}</b></button>)}</div>
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
          <Button className="danger-text" onClick={deleteSelected}>
            <Trash2 size={15} />
            Xóa đã chọn
          </Button>
        </div>
      )}
      {media.length ? (
        <div className="media-grid">
          {media.map((item) => (
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
                      onClick={async () => {
                        if (!confirm(`Xóa tệp ${item.name} khỏi thư viện?`))
                          return;
                        const result = await run(
                          () => api(`/media/${item.id}`, {}, "DELETE"),
                          "Đã xóa tệp.",
                        );
                        if (result)
                          setSelected(selected.filter((id) => id !== item.id));
                      }}
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
