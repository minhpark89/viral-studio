import { useEffect, useRef, useState } from "react";
import {
  Search,
  ArrowRight,
  Bookmark,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { api } from "../api.js";
import { Button, Field, Notice } from "../components.jsx";
import { ProductSourceLink } from "./ProductSourceLink.jsx";
import "./product-research.css";
import { ResearchStorage } from "./ResearchStorage.jsx";

const names = {
  shopping: "Google Shopping",
  trending: "Google Trending",
  youtube: "YouTube",
  interest: "Google Trends",
  ads: "Meta Ads",
  social: "TikTok / Instagram / Facebook",
};
const statusNames = {
  running: "Đang quét",
  completed: "Hoàn tất",
  partial: "Một phần nguồn",
  failed: "Chưa hoàn tất",
  cancelled: "Đã dừng",
  interrupted: "App đã đóng",
  empty: "Chưa có kết quả phù hợp",
  needs_key: "Cần API key",
};
const kinds = {
  all: "Tất cả",
  trend: "Xu hướng",
  ad: "Quảng cáo",
  video: "Video",
  product: "Sản phẩm",
};
const fmt = (n) =>
  Number.isFinite(n) ? n.toLocaleString("vi-VN") : "Chưa có số liệu";
const date = (value) =>
  value ? new Date(value).toLocaleString("vi-VN") : "Chưa rõ";

export function ResearchChart({ points, label, unit, ceiling }) {
  const valid = points.filter(
    (p) => Number.isFinite(p.value) && Number.isFinite(Date.parse(p.at)),
  );
  if (!valid.length)
    return <p className="muted small">Chưa có điểm đo cho biểu đồ này.</p>;
  const minTime = Math.min(...valid.map((p) => Date.parse(p.at))),
    maxTime = Math.max(...valid.map((p) => Date.parse(p.at)));
  const max = ceiling || Math.max(1, ...valid.map((p) => p.value));
  const x = (p) =>
    maxTime === minTime
      ? 250
      : 28 + ((Date.parse(p.at) - minTime) / (maxTime - minTime)) * 444;
  const y = (p) => 136 - (p.value / max) * 110;
  // Missing values split the path. A gap is never interpolated into an observation.
  let drawing = false;
  const path = points
    .map((p) => {
      if (!Number.isFinite(p.value) || !Number.isFinite(Date.parse(p.at))) {
        drawing = false;
        return "";
      }
      const cmd = `${drawing ? "L" : "M"}${x(p)},${y(p)}`;
      drawing = true;
      return cmd;
    })
    .join(" ");
  return (
    <figure className="pr-chart">
      <figcaption>
        {label} · {unit}
      </figcaption>
      <svg viewBox="0 0 500 165" role="img" aria-label={label}>
        <line
          x1="28"
          y1="136"
          x2="472"
          y2="136"
          stroke="currentColor"
          opacity=".25"
        />
        <text x="5" y="22" fill="currentColor" fontSize="12">
          {fmt(max)}
        </text>
        <text x="8" y="137" fill="currentColor" fontSize="12">
          0
        </text>
        <path d={path} fill="none" stroke="#6ee7c5" strokeWidth="2" />
        {valid.map((p, i) => (
          <circle
            key={`${p.at}-${i}`}
            cx={x(p)}
            cy={y(p)}
            r={valid.length > 50 ? 1.8 : 3.5}
            fill={p.partial ? "#f4b97c" : "#6ee7c5"}
          >
            <title>
              {p.label || date(p.at)}: {fmt(p.value)} {unit}
              {p.partial ? " (chưa hết kỳ)" : ""}
            </title>
          </circle>
        ))}
      </svg>
      <div className="pr-chart-dates">
        <small>{date(valid[0].at)}</small>
        <small>{date(valid.at(-1).at)}</small>
      </div>
      <details>
        <summary>Xem {points.length} điểm nguồn</summary>
        <div className="pr-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>{unit}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <td>
                    {p.label || date(p.at)}
                    {p.partial ? " · chưa hết kỳ" : ""}
                  </td>
                  <td>{p.belowOne ? "<1 (không vẽ điểm)" : fmt(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
function SourceConnections({ connection, refresh, notify }) {
  const [key, setKey] = useState(""),
    [daily, setDaily] = useState(connection.dailyLimit),
    [monthly, setMonthly] = useState(connection.monthlyLimit),
    [busy, setBusy] = useState(false);
  const save = async (removeKey) => {
    setBusy(true);
    try {
      await api(
        "/product-research/connection",
        {
          key: key || undefined,
          dailyLimit: Number(daily),
          monthlyLimit: Number(monthly),
          removeKey,
        },
        "PUT",
      );
      setKey("");
      await refresh();
      notify(
        removeKey
          ? "Đã gỡ key của Research Product."
          : "Đã lưu cấu hình Research Product. Quét để kiểm tra nguồn.",
      );
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel pr-connections">
      <summary>
        <Settings2 size={16} /> Kết nối nguồn &amp; giới hạn ·{" "}
        {connection.configured ? "Đã lưu SerpApi key" : "Chế độ miễn phí"}
      </summary>
      <p>
        Google Trending RSS và YouTube chạy không cần key. Một SerpApi key dùng
        cho biểu đồ Google Trends, Meta Ads và tìm link social. Quota / phí do
        gói SerpApi của bạn quyết định; app không tự mua gói.
      </p>
      <div className="pr-fields">
        <Field label="SerpApi key">
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              connection.configured
                ? "Để trống để giữ key đã lưu"
                : "Dán key của bạn"
            }
          />
        </Field>
        <Field label="Tối đa lượt API / ngày">
          <input
            type="number"
            min="0"
            max="1000"
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </Field>
        <Field label="Tối đa lượt API / tháng">
          <input
            type="number"
            min="0"
            max="20000"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </Field>
      </div>
      <p className="small">
        Đã đặt chỗ / gọi: {connection.usage.daily} hôm nay ·{" "}
        {connection.usage.monthly} tháng này · {connection.usage.records} dòng
        kết quả. Reset theo UTC. Request lỗi vẫn tính vào giới hạn để tránh gọi
        dồn; số này không phải hóa đơn.
      </p>
      <div className="pr-actions">
        <Button busy={busy} onClick={() => save(false)}>
          Lưu kết nối
        </Button>
        {connection.configured && (
          <Button busy={busy} onClick={() => save(true)}>
            Gỡ key
          </Button>
        )}
        <ProductSourceLink href="https://serpapi.com/manage-api-key">
          Lấy key / kiểm tra quota
        </ProductSourceLink>
      </div>
    </details>
  );
}
function EvidenceCard({ record: r, selected, select, scanId, projectId }) {
  const [playing, setPlaying] = useState(false),
    [previewError, setPreviewError] = useState("");
  const mediaBase = `/api/product-research/scans/${scanId}/media/${r.id}`;
  const mediaUrl = (kind) =>
    `${mediaBase}/${kind}?projectId=${encodeURIComponent(projectId)}`;
  return (
    <article className={`pr-card ${selected ? "selected" : ""}`}>
      <div className="pr-card-top">
        <span className={`pr-kind ${r.kind}`}>
          {kinds[r.kind]} · {r.platform}
        </span>
        <label className="pr-check">
          <input
            type="checkbox"
            checked={selected}
            onChange={select}
            aria-label={`Chọn ${r.title}`}
          />{" "}
          Lưu mẫu
        </label>
      </div>
      {r.thumbnailUrl && !playing && (
        <img
          className="pr-thumbnail"
          src={mediaUrl("image")}
          loading="lazy"
          alt={`Ảnh nguồn: ${r.title}`}
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
      {(r.mediaUrl || r.previewClipUrl) && (
        <div className="pr-video-preview">
          {playing ? (
            <video
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={mediaUrl("video")}
              onError={() =>
                setPreviewError(
                  "Không tải được video xem trước; link CDN có thể hết hạn. Mở nguồn gốc hoặc quét lại.",
                )
              }
            />
          ) : (
            <Button onClick={() => setPlaying(true)}>
              ▶ {r.mediaUrl ? "Xem video mẫu trong app" : "Xem đoạn preview"}
            </Button>
          )}
          {r.previewClipUrl && !r.mediaUrl && (
            <small>
              Đoạn preview của chỉ mục Google; mở nguồn để xem đầy đủ.
            </small>
          )}
          {previewError && (
            <p className="small" role="alert">
              {previewError}
            </p>
          )}
        </div>
      )}
      <h3>
        <ProductSourceLink href={r.url}>
          {r.title || r.creator || "Mở nguồn"}
        </ProductSourceLink>
      </h3>
      {r.creator && <p className="small">{r.creator}</p>}
      <p className="pr-description">{r.description}</p>
      <div className="pr-metrics">
        {r.kind === "product" && (
          <>
            <span>
              Giá niêm yết <b>{r.priceText || "Chưa có giá"}</b>
            </span>
            <span>
              Đánh giá{" "}
              <b>
                {r.metrics.rating != null ? `${r.metrics.rating}/5` : "Chưa có"}{" "}
                · {fmt(r.metrics.reviews)} lượt
              </b>
            </span>
          </>
        )}
        {r.kind === "video" && (
          <span>
            Lượt xem <b>{fmt(r.metrics.views)}</b>
          </span>
        )}
        {r.kind === "ad" && (
          <>
            <span>
              Trạng thái{" "}
              <b>
                {r.gated
                  ? `Bị giới hạn: ${r.gated}`
                  : r.active === true
                    ? "Đang chạy"
                    : r.active === false
                      ? "Đã dừng"
                      : "Chưa rõ"}
              </b>
            </span>
            <span>
              Nền tảng <b>{r.platforms?.join(", ") || "Meta"}</b>
            </span>
            {r.callToAction && (
              <span>
                CTA <b>{r.callToAction}</b>
              </span>
            )}
          </>
        )}
        {r.trafficText && (
          <span>
            Tìm kiếm tăng <b>{r.trafficText} (ước lượng)</b>
          </span>
        )}
        <span>
          Doanh thu <b>Chưa có dữ liệu</b>
        </span>
      </div>
      <p className="pr-label">{r.assessment.label}</p>
      {r.durationText && (
        <p className="small">Thời lượng nguồn: {r.durationText}</p>
      )}
      {r.kind === "ad" && r.publishedAt && (
        <p className="small">
          Bắt đầu: {date(r.publishedAt)} · kiểm tra {date(r.observedAt)}
        </p>
      )}
      {r.aiVideo && <details className="pr-ai-plan" open={r.aiVideo.suitable}>
        <summary>{r.aiVideo.label}</summary>
        <p className="small muted">{r.aiVideo.basis}</p>
        {!!r.aiVideo.matchedTerms.length && <p className="small">Từ khóa nguồn: {r.aiVideo.matchedTerms.join(", ")}</p>}
        <p className="small"><b>Gợi ý dựng từ ảnh:</b> {r.aiVideo.recipe}</p>
        <p className="small muted">{r.aiVideo.limitation}</p>
      </details>}
      {r.productSignals && (
        <p className="small pr-commerce">
          {r.productSignals.label} · Khớp từ khóa {r.productSignals.relevance}%
        </p>
      )}
      {r.series && (
        <ResearchChart
          points={r.series}
          label={`Mức quan tâm US: ${r.title}`}
          unit="điểm 0–100"
          ceiling={100}
        />
      )}
      {r.kind === "video" &&
        r.history?.some((p) => p.metrics.views != null) && (
          <ResearchChart
            points={r.history.map((p) => ({
              at: p.observedAt,
              value: p.metrics.views,
            }))}
            label="Lượt xem tích lũy đã đo"
            unit="lượt xem"
          />
        )}
      <details>
        <summary>Nguồn &amp; độ tin cậy</summary>
        <p className="small">
          Nguồn: {r.provider} · {r.measurement}
          <br />
          Đo lúc: {date(r.observedAt)}
          <br />
          Ngày đăng / bắt đầu: {date(r.publishedAt)}
        </p>
        {r.assessment.reasons.map((reason, i) => (
          <p className="small muted" key={i}>
            {reason}
          </p>
        ))}
        {r.productSignals?.reasons.map((reason, i) => (
          <p className="small muted" key={`c${i}`}>
            {reason}
          </p>
        ))}
        {r.kind === "video" && (
          <p className="small">
            Điểm nội dung: {r.assessment.contentScore ?? "Chưa đủ dữ liệu"}.
            Điểm phản ánh tín hiệu công khai, chưa xác nhận đúng sản phẩm.
          </p>
        )}
      </details>
      <div className="pr-actions">
        <ProductSourceLink href={r.url}>
          {r.kind === "ad"
            ? "Xem quảng cáo / video gốc"
            : r.kind === "video"
              ? "Xem video gốc"
              : r.kind === "product"
                ? "Xem listing / cửa hàng"
                : "Mở Google Trends"}
        </ProductSourceLink>
        {r.productUrl && (
          <ProductSourceLink href={r.productUrl}>
            {r.kind === "product"
              ? "Mở trang sản phẩm"
              : "Trang đích quảng cáo"}
          </ProductSourceLink>
        )}
      </div>
    </article>
  );
}

function ManualSources({ scan, projectId, onChange, notify }) {
  const [url, setUrl] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false);
  const save = async (body) => {
    setBusy(true);
    try {
      const result = await api(
        `/product-research/scans/${scan.id}/references`,
        { projectId, ...body },
      );
      onChange(result);
      notify("Đã lưu nguồn vào lần nghiên cứu.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const uploadCsv = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 524288) return notify("CSV tối đa 512 KB.", "error");
    await save({ type: "google_csv", text: await file.text() });
  };
  return (
    <details className="pr-manual">
      <summary>
        Thêm dữ liệu miễn phí: CSV Google Trends / link mẫu social
      </summary>
      <p className="small">
        Google Trends: chọn United States, ngôn ngữ English, tải CSV trong ô
        Interest over time. App vẽ dữ liệu trong file và ghi rõ nguồn nhập thủ
        công.
      </p>
      <Field label="Nhập CSV Google Trends US">
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={uploadCsv}
        />
      </Field>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save({ type: "link", url, title, description });
        }}
      >
        <p className="small">
          Đã tìm được mẫu trên TikTok, Instagram, Facebook hoặc Meta Ad Library?
          Lưu link và điều bạn muốn học từ mẫu. App chưa đọc khung hình hoặc xác
          minh số liệu của link này.
        </p>
        <div className="pr-fields">
          <Field label="Tên mẫu tham khảo">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={250}
            />
          </Field>
          <Field label="Link video / quảng cáo mẫu">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Điểm muốn học từ mẫu">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={700}
            rows={2}
          />
        </Field>
        <Button type="submit" busy={busy}>
          Lưu link mẫu
        </Button>
      </form>
    </details>
  );
}

export function ProductResearchHub({ project, notify, navigate }) {
  const [state, setState] = useState(null),
    [scan, setScan] = useState(null),
    [activeId, setActiveId] = useState(""),
    [error, setError] = useState("");
  const [videoGoal, setVideoGoal] = useState("standard"), [onlyAi, setOnlyAi] = useState(false);
  const [aiVideoKeywords, setAiVideoKeywords] = useState('product animation CGI');
  const [mode, setMode] = useState("discover"),
    [keywords, setKeywords] = useState(""),
    [productUrl, setProductUrl] = useState("");
  const [sources, setSources] = useState(["trending", "youtube"]),
    [limit, setLimit] = useState(10),
    [minViews, setMinViews] = useState(10000),
    [recentDays, setRecentDays] = useState(90);
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState([]),
    [filter, setFilter] = useState("all"),
    [everyHours, setEveryHours] = useState(24);
  const [onlyProducts, setOnlyProducts] = useState(false),
    [sort, setSort] = useState("product");
  const mounted = useRef(true),
    requestRef = useRef(null),
    latestId = useRef("");
  latestId.current = activeId;
  const refresh = async () => {
    const result = await api(`/product-research?projectId=${project.id}`);
    if (mounted.current) {
      setState(result);
      setError("");
    }
    return result;
  };
  useEffect(() => {
    mounted.current = true;
    let waiting = false;
    const poll = async () => {
      if (waiting) return;
      waiting = true;
      try {
        const result = await refresh(),
          id = latestId.current || result.scans[0]?.id;
        if (id) {
          const current = await api(
            `/product-research/scans/${id}?projectId=${project.id}`,
          );
          if (
            mounted.current &&
            (!latestId.current || latestId.current === id)
          ) {
            setScan(current);
            if (!latestId.current) {
              setActiveId(id);
              setSelected(current.shortlist || []);
            }
          }
        }
      } catch (e) {
        if (mounted.current) setError(e.message);
      } finally {
        waiting = false;
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [project.id]);
  const chooseScan = async (id) => {
    setActiveId(id);
    latestId.current = id;
    setSelected([]);
    setScan(null);
    try {
      const current = await api(
        `/product-research/scans/${id}?projectId=${project.id}`,
      );
      if (latestId.current === id) {
        setScan(current);
        setSelected(current.shortlist || []);
      }
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const request = () => ({
    projectId: project.id,
    mode,
    videoGoal,
    aiVideoKeywords: videoGoal === 'no-filming' ? aiVideoKeywords.trim() : '',
    keywords: keywords.trim(),
    productUrl: mode === "product" ? productUrl.trim() : "",
    sources,
    limit: Number(limit),
    minViews: Number(minViews),
    recentDays: Number(recentDays),
  });
  const start = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const value = request(),
        signature = JSON.stringify(value);
      if (requestRef.current?.signature !== signature)
        requestRef.current = { signature, id: crypto.randomUUID() };
      const result = await api("/product-research/scans", {
        ...value,
        requestId: requestRef.current.id,
      });
      latestId.current = result.id;
      setActiveId(result.id);
      setScan(result);
      setSelected([]);
      requestRef.current = null;
      await refresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const saveSelection = () =>
    act(async () => {
      const current = await api(
        `/product-research/scans/${scan.id}/shortlist`,
        { projectId: project.id, ids: selected },
        "PUT",
      );
      setScan(current);
      notify("Đã lưu các mẫu đã chọn trong lần quét.");
    });
  const prepare = () =>
    act(async () => {
      const draft = await api(`/product-research/scans/${scan.id}/prepare`, {
        projectId: project.id,
        ids: selected,
      });
      localStorage.setItem(
        `product-draft-${project.id}`,
        JSON.stringify(draft),
      );
      notify(
        "Đã chuyển nguồn sang Product Studio. Kiểm tra link / ảnh sản phẩm rồi chọn số lượng và lịch render.",
      );
      navigate("product");
    });
  const watch = () =>
    act(async () => {
      await api("/product-research/watches", {
        request: { ...request(), requestId: crypto.randomUUID() },
        everyHours: Number(everyHours),
      });
      notify("Đã bật theo dõi. Lịch chạy khi app và máy đang mở.");
    });
  const paidCalls =
    (sources.includes("shopping") ? 1 : 0) +
    (sources.includes("interest") ? 1 : 0) +
    (sources.includes("ads") ? 1 : 0) +
    (sources.includes("social") ? 1 : 0);
  const running = state?.scans.some((s) => s.status === "running");
  const records = (scan?.records || [])
    .filter(
      (r) =>
        (filter === "all" || r.kind === filter) && (!onlyAi || r.aiVideo?.suitable) &&
        (!onlyProducts ||
          r.kind === "trend" ||
          r.kind === "product" ||
          r.productSignals?.likelyProduct),
    )
    .slice()
    .sort((a, b) =>
      sort === "views"
        ? (b.metrics.views ?? -1) - (a.metrics.views ?? -1)
        : sort === "recent"
          ? (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
          : Number(!!b.productSignals?.likelyProduct) -
              Number(!!a.productSignals?.likelyProduct) ||
            (b.productSignals?.relevance || 0) -
              (a.productSignals?.relevance || 0),
    );
  const links = scan?.links;
  return (
    <div className="page product-hub pr-hub">
      <div className="page-heading">
        <div>
          <h1>Research Product · US</h1>
          <p>
            Tìm ngách → đối chiếu xu hướng và mẫu video → chọn nguồn → tạo video
            cho sản phẩm.
          </p>
        </div>
        <span className="tag">Dữ liệu Product riêng</span>
      </div>
      {error && <Notice>{error}</Notice>}
      {state && (
        <SourceConnections
          connection={state.connection}
          refresh={refresh}
          notify={notify}
        />
      )}
      <ResearchStorage projectId={project.id} notify={notify} />
      <form className="panel pr-form" onSubmit={start}>
        <div
          className="pr-purpose-presets"
          role="group"
          aria-label="Chọn bộ nguồn nhanh"
        >
          <Button
            type="button"
            onClick={() => {
              setSources(["shopping", "ads", "social"]);
              setOnlyProducts(false);
            }}
          >
            Tìm sản phẩm &amp; mẫu quảng cáo · tối đa 3 lượt
          </Button>
          <Button type="button" onClick={() => setSources(["ads", "social"])}>
            Chỉ tìm video / quảng cáo · tối đa 2 lượt
          </Button>
          <Button type="button" onClick={() => setSources(["interest"])}>
            Chỉ xem nhu cầu tìm kiếm · 1 lượt
          </Button>
          <Button
            type="button"
            onClick={() => setSources(["trending", "youtube"])}
          >
            Nguồn miễn phí
          </Button>
        </div>
        <p className="small muted">
          Có key: chọn bộ nguồn sản phẩm / quảng cáo để lấy listing, shop và
          video. Biểu đồ Trends chỉ đo nhu cầu tìm kiếm. Các nút này chỉ chọn
          nguồn; bấm Quét mới gọi API.
        </p>
        <Field label="Mục tiêu video tham khảo">
          <select value={videoGoal} onChange={e=>setVideoGoal(e.target.value)}>
            <option value="standard">Tìm sản phẩm / video nói chung</option>
            <option value="no-filming">Không có hàng để quay · tìm mẫu dựng bằng AI từ ảnh</option>
          </select>
        </Field>
        <Button type="button" onClick={()=>{setVideoGoal("no-filming");setSources(["ads","social"]);setOnlyAi(false);}}>Tìm mẫu AI từ ảnh · tối đa 2 lượt</Button>
        {videoGoal === "no-filming" && <>
          <Field label="Từ khóa mẫu AI / cách dựng (tiếng Anh)"><input value={aiVideoKeywords} onChange={e=>setAiVideoKeywords(e.target.value)} maxLength={150} placeholder="product animation CGI, wall art mockup…" /></Field>
          <div className="pr-actions">{['product animation CGI','AI product video','wall art mockup'].map(q=><Button type="button" key={q} onClick={()=>setAiVideoKeywords(q)}>{q}</Button>)}</div>
          <Notice>Tên sản phẩm dùng tìm quảng cáo Meta cùng ngách. Từ khóa mẫu dựng dùng tìm video TikTok / Instagram / Facebook để học cách làm bằng AI, có thể khác sản phẩm. Chỉ đánh giá từ thông tin nguồn; cần xem mẫu để đối chiếu. Chọn mẫu → Product Studio → thêm ảnh đúng sản phẩm → chọn số lượng / lịch render.</Notice>
        </>}
        <div className="pr-actions" role="group" aria-label="Cách nghiên cứu">
          <Button
            type="button"
            variant={mode === "discover" ? "primary" : "ghost"}
            onClick={() => setMode("discover")}
          >
            Tìm ngách / ý tưởng
          </Button>
          <Button
            type="button"
            variant={mode === "product" ? "primary" : "ghost"}
            onClick={() => setMode("product")}
          >
            Đã có sản phẩm
          </Button>
        </div>
        <p className="small muted">
          Bạn chọn ngách hoặc tên sản phẩm; app tự quét các nguồn đã tích. Lịch
          bên dưới giúp quét lại tự động. Với sản phẩm bằng ảnh, nhận diện và
          render trong Product Studio; ở đây nhập tên / ngách để tìm mẫu.
        </p>
        <div className="pr-fields">
          <Field label="Từ khóa / tên sản phẩm (tiếng Anh)">
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Jesus wall art, Christian gifts…"
              maxLength={150}
              required={mode !== "product" || !productUrl}
            />
          </Field>
          {mode === "product" && (
            <Field label="Link sản phẩm của bạn">
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://store…/products/…"
              />
            </Field>
          )}
        </div>
        <div className="pr-presets">
          <small>Gợi ý ngách:</small>
          {["Jesus wall art", "Christian gifts", "Bible verse gifts"].map(
            (q) => (
              <button key={q} type="button" onClick={() => setKeywords(q)}>
                {q}
              </button>
            ),
          )}
        </div>
        <div className="pr-sources">
          {state?.connection.sources.map((s) => (
            <label
              key={s.id}
              className={sources.includes(s.id) ? "selected" : ""}
            >
              <input
                type="checkbox"
                checked={sources.includes(s.id)}
                onChange={() =>
                  setSources(
                    sources.includes(s.id)
                      ? sources.filter((id) => id !== s.id)
                      : [...sources, s.id],
                  )
                }
              />
              <span>
                <b>{s.name}</b>
                <small>
                  {s.free
                    ? "Miễn phí"
                    : s.ready
                      ? "Đã lưu key · dùng quota API"
                      : "Cần SerpApi key"}{" "}
                  · {s.detail}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="pr-fields pr-limits">
          {sources.every((s) =>
            ["interest", "trending", "youtube"].includes(s),
          ) && (
            <p className="small pr-source-hint">
              Hiện chưa chọn Meta Ads hoặc Google Shopping. Lần quét này chưa
              tìm listing sản phẩm và quảng cáo bán hàng.
            </p>
          )}
          <Field label="Kết quả tối đa / nguồn">
            <select value={limit} onChange={(e) => setLimit(e.target.value)}>
              {[5, 10, 20].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Lượt xem tham khảo tối thiểu">
            <input
              type="number"
              min="0"
              max="1000000000"
              value={minViews}
              onChange={(e) => setMinViews(e.target.value)}
            />
          </Field>
          <Field label="Video trong bao nhiêu ngày">
            <select
              value={recentDays}
              onChange={(e) => setRecentDays(e.target.value)}
            >
              {[7, 30, 90, 180, 365].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="pr-actions">
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={running || !sources.length}
          >
            <Search size={16} /> Quét nguồn đã chọn
          </Button>
          <span className="small muted">
            Tối đa {paidCalls} lượt SerpApi / lần, ít hơn khi có cache. Không tự
            gọi AI hoặc render.
          </span>
        </div>
        <details>
          <summary>
            <RefreshCw size={14} /> Theo dõi ngách này tự động
          </summary>
          <p className="small">
            Chạy khi app mở, giữ lịch qua lần khởi động sau. Máy tắt sẽ bỏ qua
            các lượt đã lỡ, không chạy dồn. Lượt API theo giới hạn đã đặt; không
            tự bật render.
          </p>
          <div className="pr-actions">
            <Field label="Quét lại sau (giờ)">
              <select
                value={everyHours}
                onChange={(e) => setEveryHours(e.target.value)}
              >
                {[6, 12, 24, 48, 168].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Button type="button" busy={busy} onClick={watch}>
              Bật theo dõi cấu hình này
            </Button>
          </div>
        </details>
      </form>
      {!!state?.watches.length && (
        <section className="panel">
          <h2>Ngách đang theo dõi</h2>
          {state.watches.map((w) => (
            <div className="pr-watch" key={w.id}>
              <div>
                <b>{w.request.keywords || w.request.productUrl}</b>
                <p className="small">
                  Mỗi {w.everyHours} giờ ·{" "}
                  {w.enabled ? `Lần tới: ${date(w.nextAt)}` : "Đang tắt"}
                  {w.error ? ` · ${w.error}` : ""}
                </p>
              </div>
              <Button
                busy={busy}
                onClick={() =>
                  act(() =>
                    api(
                      `/product-research/watches/${w.id}`,
                      { projectId: project.id, enabled: !w.enabled },
                      "PATCH",
                    ),
                  )
                }
              >
                {w.enabled ? "Tắt theo dõi" : "Bật lại"}
              </Button>
            </div>
          ))}
        </section>
      )}
      <section className="panel pr-results">
        <div className="pr-results-head">
          <h2>Kết quả &amp; mẫu đã chọn</h2>
          {!!state?.scans.length && (
            <Field label="Lịch sử nghiên cứu">
              <select
                value={activeId}
                onChange={(e) => chooseScan(e.target.value)}
              >
                {state.scans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.query || s.request.keywords || "Sản phẩm"} ·{" "}
                    {date(s.createdAt)} · {statusNames[s.status]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {!scan ? (
          <p className="muted">
            Nhập ngách tiếng Anh và bấm Quét. Mỗi nguồn sẽ báo kết quả hoặc lý
            do chưa đọc được. Dữ liệu chỉ xuất hiện sau khi nguồn trả về.
          </p>
        ) : (
          <>
            <div className="pr-actions">
              <b>
                {statusNames[scan.status]}
                {scan.stage ? ` · ${scan.stage}` : ""}
              </b>
              <span className="small">
                {scan.records.length} mẫu / tín hiệu
              </span>
              {scan.status === "running" && (
                <Button
                  onClick={() =>
                    act(() =>
                      api(`/product-research/scans/${scan.id}/cancel`, {
                        projectId: project.id,
                      }),
                    )
                  }
                >
                  Dừng quét
                </Button>
              )}
            </div>
            {scan.message && <Notice>{scan.message}</Notice>}
            <div className="pr-source-results">
              {scan.sources.map((s) => (
                <div key={s.id}>
                  <b>
                    {names[s.id]} · {statusNames[s.status]}{" "}
                    {s.count ? `(${s.count})` : ""}
                    {s.cached ? " · cache" : ""}
                  </b>
                  <p className="small">{s.note}</p>
                </div>
              ))}
            </div>
            {links && (
              <div className="pr-manual">
                <b>Đối chiếu nguồn miễn phí trong trình duyệt</b>
                <p className="small">
                  Các trang có thể yêu cầu đăng nhập. Mở link không đưa số liệu
                  vào app; API key cần cho thu thập tự động.
                </p>
                <div className="pr-actions">
                  <ProductSourceLink href={links.trends}>
                    Google Trends US
                  </ProductSourceLink>
                  <ProductSourceLink href={links.ads}>
                    Meta Ads US
                  </ProductSourceLink>
                  <ProductSourceLink href={links.tiktok}>
                    TikTok
                  </ProductSourceLink>
                  <ProductSourceLink href={links.instagram}>
                    Instagram
                  </ProductSourceLink>
                  <ProductSourceLink href={links.facebook}>
                    Facebook
                  </ProductSourceLink>
                </div>
              </div>
            )}
            {scan.status !== "running" && (
              <ManualSources
                key={scan.id}
                scan={scan}
                projectId={project.id}
                onChange={setScan}
                notify={notify}
              />
            )}
            <p className="small muted">
              Xu hướng tìm kiếm, lượt xem và quảng cáo là tín hiệu để lựa chọn
              mẫu. Dùng tab Doanh thu · FastMoss để đối chiếu GMV khi có nguồn
              doanh số. Chưa tự gắn “bán chạy” từ những tín hiệu này.
            </p>
            <div className="pr-actions pr-selection">
              <div className="market-filter">
                {Object.entries(kinds).map(([id, name]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {name} (
                    {
                      scan.records.filter((r) => id === "all" || r.kind === id)
                        .length
                    }
                    )
                  </button>
                ))}
              </div>
              <span>{selected.length} đã chọn</span>
              <Button
                disabled={!selected.length}
                busy={busy}
                onClick={saveSelection}
              >
                <Bookmark size={15} /> Lưu mẫu
              </Button>
              <Button
                variant="primary"
                disabled={!selected.length}
                busy={busy}
                onClick={prepare}
              >
                Sang Product Studio <ArrowRight size={15} />
              </Button>
            </div>
            <div className="pr-grid">
              <div className="pr-result-tools">
                <label className="pr-check"><input type="checkbox" checked={onlyAi} onChange={e=>setOnlyAi(e.target.checked)} />Chỉ mẫu có dấu hiệu dựng từ ảnh / AI ({scan.records.filter(r=>r.aiVideo?.suitable).length})</label>
                <label className="pr-check">
                  <input
                    type="checkbox"
                    checked={onlyProducts}
                    onChange={(e) => setOnlyProducts(e.target.checked)}
                  />
                  Chỉ mẫu có dấu hiệu sản phẩm (lọc gợi ý)
                </label>
                <Field label="Sắp xếp mẫu">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="product">Ưu tiên liên quan sản phẩm</option>
                    <option value="views">Lượt xem đã đo</option>
                    <option value="recent">Ngày đăng / bắt đầu mới nhất</option>
                  </select>
                </Field>
                <small>
                  {records.length}/{scan.records.length} mẫu đang hiển thị
                </small>
              </div>
              {records.map((r) => (
                <EvidenceCard
                  key={r.id}
                  scanId={scan.id}
                  projectId={project.id}
                  record={r}
                  selected={selected.includes(r.id)}
                  select={() =>
                    setSelected(
                      selected.includes(r.id)
                        ? selected.filter((id) => id !== r.id)
                        : [...selected, r.id].slice(0, 12),
                    )
                  }
                />
              ))}
            </div>
            {!records.length && scan.status !== "running" && (
              <p>
                Chưa có mẫu trong nhóm này. Thử từ khóa rộng hơn hoặc mở link
                nguồn để đối chiếu.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
