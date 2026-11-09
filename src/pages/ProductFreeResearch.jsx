import { useState } from "react";
import { Search, ArrowRight, ExternalLink, Bookmark } from "lucide-react";
import { api } from "../api.js";
import { Button, Field, Notice } from "../components.jsx";
import { ProductSourceLink } from "./ProductSourceLink.jsx";

const statuses = {
  new: "Mới",
  shortlisted: "Đã nhặt",
  producing: "Đang làm",
  dismissed: "Bỏ qua",
};
const number = (n) =>
  Number.isFinite(n) ? n.toLocaleString("vi-VN") : "Chưa đọc được";
function ViewEvidence({ videos, scans }) {
  const max = Math.max(1, ...videos.map((v) => v.views || 0));
  return (
    <div className="free-evidence">
      <h3>Lượt xem video tham khảo</h3>
      <p className="small muted">
        Số tích lũy khi quét, không phải lượt xem mỗi ngày hoặc doanh thu. Các
        kênh này là nguồn tham khảo, chưa xác minh là shop đối thủ.
      </p>
      <div className="shop-bars">
        {videos.map((v) => (
          <div key={v.id}>
            <div>
              <ProductSourceLink href={v.url}>{v.title}</ProductSourceLink>
              <b>{number(v.views)}</b>
            </div>
            <div className="shop-bar-track">
              <div style={{ width: `${((v.views || 0) / max) * 100}%` }} />
            </div>
            <small>
              {v.channel || "Chưa rõ kênh"} ·{" "}
              {v.publishedAt
                ? new Date(v.publishedAt).toLocaleDateString("vi-VN")
                : "Chưa rõ ngày đăng"}
            </small>
            <p className="small">
              <ProductSourceLink href={v.url}>
                Xem video trên YouTube
              </ProductSourceLink>
            </p>
          </div>
        ))}
      </div>
      <details>
        <summary>Lịch sử lượt xem đã đo</summary>
        <p className="small muted">
          Quét lại vào ngày khác để theo dõi thay đổi. Chỉ lưu điểm đã đọc thực
          tế; không điền thêm các ngày thiếu.
        </p>
        {videos.map((v) => {
          const points = scans
            .filter((s) => s.status === "completed")
            .flatMap((s) => {
              const found = s.videos?.find((x) => x.id === v.id);
              return Number.isFinite(found?.views)
                ? [{ at: s.finishedAt || s.createdAt, views: found.views }]
                : [];
            })
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
          return (
            <div key={v.id} className="market-video">
              <strong>{v.title}</strong>
              {points.length < 2 ? (
                <p className="small">
                  Mới có một lần đo: {number(v.views)} lượt xem.
                </p>
              ) : (
                <>
                  <svg
                    viewBox="0 0 500 120"
                    role="img"
                    aria-label={`Lịch sử lượt xem ${v.title}`}
                    className="free-history-chart"
                  >
                    <polyline
                      fill="none"
                      stroke="#71e5c2"
                      strokeWidth="2"
                      points={points
                        .map(
                          (p, i) =>
                            `${20 + (i / (points.length - 1)) * 460},${100 - (p.views / Math.max(1, ...points.map((x) => x.views))) * 80}`,
                        )
                        .join(" ")}
                    />
                    {points.map((p, i) => (
                      <circle
                        key={i}
                        cx={20 + (i / (points.length - 1)) * 460}
                        cy={
                          100 -
                          (p.views /
                            Math.max(1, ...points.map((x) => x.views))) *
                            80
                        }
                        r="4"
                        fill="#71e5c2"
                      >
                        <title>
                          {new Date(p.at).toLocaleString("vi-VN")}:{" "}
                          {number(p.views)}
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <p className="small">
                    Điểm đo theo thứ tự thời gian, không cách đều theo ngày.
                  </p>
                  <div className="product-table-wrap">
                    <table className="product-data-table">
                      <thead>
                        <tr>
                          <th>Đo lúc</th>
                          <th>Lượt xem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p, i) => (
                          <tr key={i}>
                            <td>{new Date(p.at).toLocaleString("vi-VN")}</td>
                            <td>{number(p.views)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </details>
    </div>
  );
}

export function ProductFreeResearchPage({ data, project, notify, navigate }) {
  const [keywords, setKeywords] = useState(""),
    [limit, setLimit] = useState(10),
    [minViews, setMinViews] = useState(10000),
    [recentDays, setRecentDays] = useState(90),
    [useAi, setUseAi] = useState(false),
    [autoShortlist, setAuto] = useState(true),
    [busy, setBusy] = useState(false),
    [requestId, setRequest] = useState(() => crypto.randomUUID()),
    [focus, setFocus] = useState(""),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all");
  const scans = (data.productFreeScans || [])
      .filter((s) => s.projectId === project.id)
      .slice()
      .reverse(),
    scan = scans.find((s) => s.id === focus) || scans[0],
    running = (data.productFreeScans || []).some((s) => s.status === "running");
  const ideas = (scan?.ideas || []).filter(
      (p) =>
        filter === "all" ||
        (filter === "promising"
          ? p.recommendation.eligible
          : p.management === filter),
    ),
    idea = ideas.find((p) => p.id === selected) || ideas[0],
    videos = (scan?.videos || []).filter((v) => idea?.videoIds.includes(v.id));
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api("/product-free-research/scans", {
        projectId: project.id,
        requestId,
        keywords,
        limit,
        minViews,
        recentDays,
        useAi,
        autoShortlist,
      });
      setFocus(result.id);
      setSelected("");
      setRequest(crypto.randomUUID());
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const manage = async (status) => {
    try {
      await api(
        `/product-free-research/scans/${scan.id}/ideas/${idea.id}`,
        { status },
        "PATCH",
      );
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const prepare = async () => {
    setBusy(true);
    try {
      const draft = await api(
        `/product-free-research/scans/${scan.id}/ideas/${idea.id}/prepare`,
        {},
      );
      localStorage.setItem(
        `product-draft-${project.id}`,
        JSON.stringify(draft),
      );
      navigate("product");
      notify(
        "Đã chuyển video tham khảo. Thêm link hoặc ảnh sản phẩm thật để tạo video.",
      );
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page product-research-page free-research-page">
      <div className="page-heading">
        <div>
          <h1>AI Research · Free</h1>
          <p>Tìm ý tưởng sản phẩm và video để làm thử cho thị trường US.</p>
        </div>
        <span className="product-market-chip">Không cần FastMoss key</span>
      </div>
      <div className="product-card free-source-note">
        <strong>Nguồn miễn phí: video YouTube công khai</strong>
        <p>
          Đọc tiêu đề, kênh, ngày đăng và lượt xem thực tế. Tìm kiếm theo ngữ
          cảnh tiếng Anh / US; chưa xác nhận người xem thuộc US. Chế độ này chưa
          có dữ liệu doanh thu sản phẩm hoặc shop.
        </p>
      </div>
      <div className="product-card product-flow-help">
        <strong>Cách dùng Research Free</strong>
        <ol>
          <li>
            Nhập từ khóa tiếng Anh cho sản phẩm hoặc ngách, rồi bấm{" "}
            <b>Quét miễn phí</b>. App tự tìm nguồn theo từ khóa đó.
          </li>
          <li>
            Chọn ý tưởng trong danh sách bên trái; bấm{" "}
            <b>Xem video trên YouTube</b> bên phải để mở trình duyệt.
          </li>
          <li>
            Bấm <b>Làm video sản phẩm này</b> để chuyển nguồn tham khảo sang
            Product Studio; thêm link / ảnh sản phẩm thật, chọn số lượng rồi
            tạo.
          </li>
        </ol>
        <p className="small muted">
          Chưa tự quét toàn thị trường hoặc tự chạy Research Free theo lịch.
          Trong Product Studio, nghiên cứu sản phẩm sẽ tự chạy trước mỗi đợt
          video.
        </p>
      </div>
      <form className="product-card market-scan-form" onSubmit={start}>
        <Field label="Sản phẩm / ngách cần tìm (tiếng Anh)">
          <input
            required
            minLength={2}
            maxLength={150}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Ví dụ: insulated water bottle"
          />
        </Field>
        <Field label="Số video nguồn">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[5, 10, 15, 20].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Lượt xem tối thiểu">
          <input
            type="number"
            min={0}
            max={1e9}
            value={minViews}
            onChange={(e) => setMinViews(Number(e.target.value))}
          />
        </Field>
        <Field label="Độ mới để đánh giá">
          <select
            value={recentDays}
            onChange={(e) => setRecentDays(Number(e.target.value))}
          >
            {[30, 90, 180, 365].map((n) => (
              <option key={n} value={n}>
                {n} ngày
              </option>
            ))}
          </select>
        </Field>
        <Button
          type="submit"
          variant="primary"
          busy={busy || running}
          disabled={keywords.trim().length < 2}
        >
          <Search size={16} />
          Quét miễn phí
        </Button>
        <div className="market-scan-note free-options">
          <label>
            <input
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
            />{" "}
            AI nhóm sản phẩm và gợi ý cách làm (dùng LLM đã cấu hình, có thể
            tính phí token)
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoShortlist}
              onChange={(e) => setAuto(e.target.checked)}
            />{" "}
            Tự nhặt ý tưởng đạt tiêu chí
          </label>
          <small>
            “Ngon húp luôn” ở đây = đáng thử nội dung: ít nhất 2 video gần đây
            từ 2 kênh đạt ngưỡng. Không phải cam kết bán chạy. Tắt AI vẫn quét
            và chọn từng video được.
          </small>
        </div>
      </form>
      {scans.length > 0 && (
        <div className="product-scan-heading">
          <Field label="Lần quét Free">
            <select
              value={scan.id}
              onChange={(e) => {
                setFocus(e.target.value);
                setSelected("");
              }}
            >
              {scans.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.request.keywords} ·{" "}
                  {new Date(s.createdAt).toLocaleString("vi-VN")}
                </option>
              ))}
            </select>
          </Field>
          <div className="market-filter">
            {[
              ["all", "Tất cả"],
              ["promising", "Đáng thử"],
              ["shortlisted", "Đã nhặt"],
            ].map(([v, t]) => (
              <button
                key={v}
                className={filter === v ? "active" : ""}
                onClick={() => {
                  setFilter(v);
                  setSelected("");
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      {scan?.status === "running" && (
        <div role="status" className="product-status">
          <strong>Đang quét nguồn miễn phí</strong>
          <span>{scan.stage}</span>
        </div>
      )}
      {scan?.error && <Notice>{scan.error}</Notice>}
      {scan?.warnings?.map((w, i) => (
        <Notice key={i}>{w}</Notice>
      ))}
      {idea ? (
        <div className="market-results-grid">
          <section className="product-card market-products">
            {ideas.map((p) => (
              <article
                key={p.id}
                className={`market-product ${idea.id === p.id ? "selected" : ""}`}
              >
                <button
                  className="market-product-select"
                  onClick={() => setSelected(p.id)}
                >
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.category} · {p.videoIds.length} video tham khảo
                    </small>
                  </span>
                </button>
                <div className="market-product-bottom">
                  <span
                    className={`market-verdict ${p.recommendation.eligible ? "good" : ""}`}
                  >
                    {p.recommendation.label}
                  </span>
                  <small>{statuses[p.management]}</small>
                </div>
              </article>
            ))}
          </section>
          <section className="product-card market-analysis">
            <div>
              <h2>{idea.name}</h2>
              <p>{idea.opportunity}</p>
              <p className="small muted">
                Tên sản phẩm suy luận từ video, chưa đối chiếu SKU. Kiểm tra sản
                phẩm thật trước khi tạo.
              </p>
            </div>
            <div className="product-reasons">
              <strong>{idea.recommendation.label} · tín hiệu nội dung</strong>
              <ul>
                {idea.recommendation.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <ViewEvidence videos={videos} scans={scans} />
            <div className="product-actions">
              <Button onClick={() => manage("shortlisted")}>
                <Bookmark size={14} />
                Nhặt ý tưởng
              </Button>
              <Button variant="primary" busy={busy} onClick={prepare}>
                Làm video sản phẩm này <ArrowRight size={14} />
              </Button>
              <select
                aria-label="Quản lý ý tưởng"
                value={idea.management}
                onChange={(e) => manage(e.target.value)}
              >
                {Object.entries(statuses).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      ) : (
        scan?.status !== "running" && (
          <div className="product-card product-empty">
            <Search size={30} />
            <h3>
              {scan ? "Chưa có ý tưởng trong bộ lọc" : "Bắt đầu Research Free"}
            </h3>
            <p>
              Nhập ngách sản phẩm bằng tiếng Anh rồi bấm Quét miễn phí. Nguồn và
              các lần đo được lưu trên máy này.
            </p>
          </div>
        )
      )}
    </div>
  );
}
