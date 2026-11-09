import { useState } from "react";
import {
  Search,
  UploadCloud,
  Play,
  ExternalLink,
  RefreshCw,
  Video,
} from "lucide-react";
import { api, uploadFiles } from "../api.js";
import { Button, Field, Notice } from "../components.jsx";
import "./product.css";
import { productStyles } from "../../shared/product-contracts.js";
import { ProductCampaignList } from "./ProductCampaigns.jsx";
import {
  ProductOutputPicker,
  ProductOutputLocation,
} from "./ProductOutput.jsx";
import { ProductSourceLink } from "./ProductSourceLink.jsx";

const stateLabel = {
  ready: "Kịch bản sẵn sàng",
  researching: "Đang nghiên cứu",
  "queued-research": "Chờ nghiên cứu",
  queued: "Chờ profile Product",
  rendering: "Đang tạo video",
  preparing: "Đang chuẩn bị",
  completed: "Hoàn tất",
  failed: "Có lỗi",
  interrupted: "Bị gián đoạn",
  cancelled: "Đã dừng",
};
function readDraft(projectId) {
  try {
    return JSON.parse(
      localStorage.getItem(`product-draft-${projectId}`) || "{}",
    );
  } catch {
    return {};
  }
}

export function ProductStudy({ study }) {
  if (!study) return null;
  return (
    <div className="product-study">
      <h3>{study.product.name}</h3>
      {study.model && (
        <p className="small muted">
          Model Product: {study.model.id}
          {study.model.visionVerified ? " · hỗ trợ đọc ảnh" : ""}
        </p>
      )}
      <p>{study.analysis.summary}</p>
      {study.creativeDirection && (
        <p className="small">
          Phong cách: {study.creativeDirection.label} · Biến thể{" "}
          {study.creativeDirection.variation}
        </p>
      )}
      {study.sampleVideo && (
        <details>
          <summary>Phân tích video mẫu: {study.sampleVideo.name}</summary>
          <p>{study.sampleVideo.analysis.summary}</p>
          <p>
            <strong>Mở đầu:</strong> {study.sampleVideo.analysis.hook}
          </p>
          <p>
            <strong>Nhịp dựng:</strong> {study.sampleVideo.analysis.pacing}
          </p>
          <p>
            <strong>Áp dụng:</strong> {study.sampleVideo.analysis.adaptation}
          </p>
          <ul>
            {study.sampleVideo.analysis.shots.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <p className="small muted">
            Đã đọc {study.sampleVideo.sampleTimes.length} khung mẫu ·{" "}
            {study.sampleVideo.transcriptWarning}
          </p>
          {study.sampleVideo.analysis.limitations.map((s, i) => (
            <p key={i} className="small muted">
              {s}
            </p>
          ))}
        </details>
      )}
      <div className="product-facts">
        {study.product.visibleFeatures.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      {!!study.product.uncertainties.length && (
        <p className="small muted">
          Chưa xác nhận: {study.product.uncertainties.join(" · ")}
        </p>
      )}
      {study.warnings.map((w, i) => (
        <Notice key={i}>{w}</Notice>
      ))}
      <details>
        <summary>
          Video tham khảo &amp; phân tích cách làm (
          {study.videoResearch.videos.length})
        </summary>
        {study.videoResearch.videos.map((v) => {
          const a = study.analysis.references.find((x) => x.videoId === v.id);
          return (
            <article className="product-reference" key={v.id}>
              <ProductSourceLink href={v.url}>{v.title}</ProductSourceLink>
              <p className="small">
                <ProductSourceLink href={v.url}>
                  Xem video tham khảo trên YouTube
                </ProductSourceLink>
              </p>
              <small>
                {v.views != null
                  ? `${v.views.toLocaleString()} lượt xem`
                  : v.viewsText || "Chưa có lượt xem"}{" "}
                · {v.durationSeconds ? `${v.durationSeconds}s` : v.durationText}{" "}
                · {v.channel || "YouTube"} · kiểm tra{" "}
                {new Date(
                  v.observedAt || study.videoResearch.checkedAt,
                ).toLocaleString()}
              </small>
              <small>
                Bằng chứng:{" "}
                {v.visualEvidence?.sampleTimes?.length
                  ? `${v.visualEvidence.sampleTimes.length} khung mẫu theo thời gian`
                  : v.visualEvidence
                    ? "Ảnh thumbnail"
                    : "Metadata"}
                {v.transcript?.length ? " + phụ đề có thời điểm" : ""}. Chưa xác
                nhận cơ cấu người xem US.
              </small>
              {a && (
                <dl>
                  <dt>Mở đầu</dt>
                  <dd>{a.hook}</dd>
                  <dt>Nhịp cảnh</dt>
                  <dd>{a.pacing}</dd>
                  <dt>Giới thiệu sản phẩm</dt>
                  <dd>{a.productPresentation}</dd>
                  <dt>CTA</dt>
                  <dd>{a.cta}</dd>
                  <dt>Áp dụng</dt>
                  <dd>{a.lesson}</dd>
                  <dt>Giới hạn</dt>
                  <dd>{a.limitations}</dd>
                </dl>
              )}
              {v.limitations.map((x, i) => (
                <small key={i}>{x}</small>
              ))}
            </article>
          );
        })}
        {!study.videoResearch.videos.length && (
          <p>
            Chưa lấy được nguồn video. Kịch bản hiện là gợi ý sáng tạo, không
            phải kết luận học từ video viral.
          </p>
        )}
      </details>
      <details open>
        <summary>Kịch bản mới · {study.analysis.scenes.length} cảnh</summary>
        <p>{study.analysis.concept}</p>
        <ol className="product-scenes">
          {study.analysis.scenes.map((s, i) => (
            <li key={i}>
              <strong>{s.purpose}</strong>
              <p>{s.prompt}</p>
              <small>Chữ trên video: {s.caption}</small>
            </li>
          ))}
        </ol>
        <p>CTA: {study.analysis.cta}</p>
      </details>
    </div>
  );
}

export function ProductPage({ data, project, notify, navigate }) {
  const [draft] = useState(() => readDraft(project.id));
  const [noFilming, setNoFilming] = useState(draft.noFilming === true);
  const [researchEvidence, setResearchEvidence] = useState(draft.researchEvidence || []);
  const [productUrl, setUrl] = useState(draft.productUrl || ""),
    [imageMediaId, setImage] = useState(draft.imageMediaId || ""),
    [notes, setNotes] = useState(draft.notes || "");
  const [duration, setDuration] = useState(15),
    [billingMode, setBilling] = useState("free"),
    [resolution, setResolution] = useState("720p"),
    [ratio, setRatio] = useState("9:16"),
    [maxCredits, setMaxCredits] = useState(6),
    [accountId, setAccount] = useState("auto");
  const [inspiration, setInspiration] = useState(
      (draft.inspirationUrls || []).join("\n"),
    ),
    [autoRender, setAutoRender] = useState(true),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [focus, setFocus] = useState("");
  const [researchModel, setResearchModel] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [quantity, setQuantity] = useState(1),
    [style, setStyle] = useState(draft.style || "auto"),
    [styleNotes, setStyleNotes] = useState(draft.styleNotes || ""),
    [sampleVideoMediaId, setSample] = useState(""),
    [daily, setDaily] = useState(false),
    [time, setTime] = useState("08:00"),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Bangkok",
    ),
    [startNow, setStartNow] = useState(true);
  const samples = (data.media || []).filter(
    (m) =>
      m.projectId === project.id &&
      m.kind === "video" &&
      m.mediaType === "product-reference-video",
  );
  const uploadSample = async (files) => {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const r = await uploadFiles(
        [files[0]],
        project.id,
        "product-reference-video",
      );
      setSample(r[0].id);
      setStyle("reference");
      notify("Đã tải video mẫu. Phân tích sẽ chạy cùng đợt nghiên cứu.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setUploading(false);
    }
  };
  const reuse = (request) => {
    setUrl(request.productUrl || "");
    setImage(request.imageMediaId || "");
    setNotes(request.notes || "");
    setDuration(request.duration);
    setBilling(request.billingMode);
    setResolution(request.resolution);
    setRatio(request.ratio);
    setMaxCredits(request.maxCredits || 6);
    setAccount(request.accountId);
    setResearchModel(request.researchModel || "");
    setInspiration((request.inspirationUrls || []).join("\n"));
    setResearchEvidence(request.researchEvidence || []);
    setNoFilming(request.noFilming === true);
    setStyle(request.style || "auto");
    setStyleNotes(request.styleNotes || "");
    setSample(request.sampleVideoMediaId || "");
    setAutoRender(request.autoRender);
    setOutputDirectory(request.outputDirectory || "");
    setRequestId(crypto.randomUUID());
    setDaily(false);
    document
      .querySelector(".product-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    notify("Đã nạp sản phẩm. Có thể tải video mẫu mới và tạo đợt riêng.");
  };
  const accounts = (data.accounts || []).filter(
    (a) => a.provider === "dreamface",
  );
  const assets = (data.media || []).filter(
    (m) =>
      m.kind === "image" &&
      m.projectId === project.id &&
      m.mediaType === "product",
  );
  const image = data.media.find((m) => m.id === imageMediaId);
  const runs = (data.productRuns || [])
    .filter((r) => r.projectId === project.id)
    .slice()
    .reverse();
  const current = runs.find((r) => r.id === focus) || runs[0];
  const output = current?.mediaId
    ? data.media.find((m) => m.id === current.mediaId)
    : null;
  const upload = async (files) => {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const result = await uploadFiles([files[0]], project.id, "product");
      setImage(result[0].id);
      notify("Đã tải ảnh sản phẩm.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setUploading(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (busy || uploading) return;
    setBusy(true);
    try {
      const result = await api("/product-campaigns", {
        quantity,
        schedule: { enabled: daily, time, timezone },
        startNow: !daily || startNow,
        request: {
          requestId,
          projectId: project.id,
          productUrl: productUrl.trim(),
          imageMediaId: imageMediaId || null,
          notes,
          researchEvidence,
          noFilming,
          duration,
          billingMode,
          resolution,
          ratio,
          maxCredits: billingMode === "credits" ? Number(maxCredits) : 0,
          accountId,
          researchModel,
          style,
          styleNotes,
          sampleVideoMediaId: sampleVideoMediaId || null,
          inspirationUrls: inspiration
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean),
          autoRender,
          outputDirectory,
        },
      });
      if (result.batch?.runIds[0]) setFocus(result.batch.runIds[0]);
      setRequestId(crypto.randomUUID());
      localStorage.removeItem(`product-draft-${project.id}`);
      notify(
        result.batch
          ? `Đã tạo đợt ${quantity} video. Mỗi video có kịch bản riêng.`
          : "Đã lưu sản phẩm và lịch hằng ngày.",
      );
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const action = async (name) => {
    try {
      await api(`/product-studio/${current.id}/${name}`, {});
      notify(
        name === "render"
          ? "Đã xếp lịch render Product."
          : "Đang thử lại Product.",
      );
    } catch (e) {
      notify(e.message, "error");
    }
  };
  return (
    <div className="page product-hub product-studio-v2">
      <div className="page-heading">
        <div>
          <h1>Product Studio</h1>
          <p>
            Dán link hoặc chọn ảnh → nghiên cứu video → kịch bản → DreamFace →
            Output Product.
          </p>
        </div>
        <Button onClick={() => navigate?.("product-research")}>
          <Search size={16} /> AI Research · US
        </Button>
      </div>
      <div className="product-card product-output-prominent">
        <h2>Output Product · Chọn nơi lưu video</h2>
        <ProductOutputPicker key={requestId} value={outputDirectory} onChange={setOutputDirectory} notify={notify} formId="product-create-form" />
      </div>
      <div className="product-card product-flow-help">
        <strong>Cách tạo video hàng loạt</strong>
        <ol>
          <li>Chọn sản phẩm: dán link / ảnh, hoặc nhận ý tưởng từ Research.</li>
          <li>
            App tự nhận diện và nghiên cứu video tham khảo; bạn có thể thêm
            video mẫu.
          </li>
          <li>
            Chọn N video, phong cách và nơi lưu. App viết N kịch bản riêng rồi
            xếp hàng render.
          </li>
          <li>
            Mỗi video xuất một MP4. Lịch hằng ngày tạo đợt mới khi đến giờ và
            đợt trước đã xử lý xong.
          </li>
        </ol>
        <p className="small muted">
          “Nhặt ý tưởng” chỉ lưu lựa chọn, chưa bắt đầu render. Muốn xem kịch
          bản trước, tắt “Tự render sau khi nghiên cứu xong”.
        </p>
      </div>
      <div className="product-studio-grid">
        <form id="product-create-form" className="product-form product-card" onSubmit={submit}>
          <h2>Sản phẩm của bạn</h2>
          <label className="product-check"><input type="checkbox" checked={noFilming} onChange={e=>{setNoFilming(e.target.checked);if(e.target.checked)setStyle("ai-showcase");}} /> Không có hàng để quay · dựng AI từ ảnh sản phẩm</label>
          {noFilming && <Notice>Thêm ảnh rõ nét của đúng sản phẩm hoặc link có ảnh. App tạo cảnh từ ảnh bằng DreamFace; không cần quay hàng thật. Với tranh / quà tặng có chữ, cần kiểm tra hình và chữ trong video trước khi đăng. Chọn số lượng và lịch hàng ngày bên dưới.</Notice>}
          {!!researchEvidence.length && <details className="product-reference" open>
            <summary>{researchEvidence.length} nguồn từ Research đa nguồn</summary>
            <p className="small muted">Dùng nội dung nguồn để gợi ý kịch bản. Link quảng cáo / video social mới có metadata; tải video mẫu nếu muốn phân tích khung hình và nhịp dựng.</p>
            {researchEvidence.map((r,i) => <p className="small" key={i}><ProductSourceLink href={r.url}>{r.title}</ProductSourceLink> · {r.platform}</p>)}
            <Button type="button" onClick={() => setResearchEvidence([])}>Bỏ các nguồn này</Button>
          </details>}
          {draft.researchSource?.type === "free" &&
            !productUrl &&
            !imageMediaId && (
              <Notice>
                Đã nhận ý tưởng và video tham khảo từ Research Free. Thêm link
                hoặc ảnh đúng sản phẩm bạn muốn bán.
              </Notice>
            )}
          <Field label="Link sản phẩm">
            <input
              type="url"
              value={productUrl}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-store.com/products/..."
            />
          </Field>
          <label className="product-upload">
            <UploadCloud size={22} />
            <span>{uploading ? "Đang tải ảnh…" : "Tải một ảnh sản phẩm"}</span>
            <input
              aria-label="Tải ảnh sản phẩm"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(e) => upload(e.target.files)}
            />
          </label>
          {!!assets.length && (
            <Field label="Hoặc dùng ảnh đã có">
              <select
                value={imageMediaId}
                onChange={(e) => setImage(e.target.value)}
              >
                <option value="">Tự lấy ảnh từ link</option>
                {assets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {image && (
            <img
              className="product-input-preview"
              src={image.thumbnailUrl || image.url}
              alt={image.name}
            />
          )}
          <Field label="Thông tin bổ sung (không bắt buộc)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={3000}
              placeholder="Tính năng đã xác nhận, khách hàng mục tiêu, điều cần nhấn mạnh…"
            />
          </Field>
          <div className="form-grid">
            <Field label="Số lượng video / đợt">
              <input
                type="number"
                min={1}
                max={100}
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </Field>
            <Field label="Phong cách video">
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {productStyles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Yêu cầu phong cách (không bắt buộc)">
            <textarea
              rows={2}
              maxLength={1500}
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="Ví dụ: mở đầu cận cảnh, nhịp nhanh, ánh sáng tự nhiên…"
            />
          </Field>
          <label className="product-upload">
            <UploadCloud size={20} />
            <span>Tải video mẫu để phân tích và làm phiên bản mới</span>
            <input
              aria-label="Tải video mẫu"
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              disabled={uploading}
              onChange={(e) => uploadSample(e.target.files)}
            />
          </label>
          {!!samples.length && (
            <Field label="Video mẫu đã tải">
              <select
                value={sampleVideoMediaId}
                onChange={(e) => setSample(e.target.value)}
              >
                <option value="">Không dùng video mẫu</option>
                {samples.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {Math.round(m.duration || 0)}s
                  </option>
                ))}
              </select>
            </Field>
          )}
          {sampleVideoMediaId && (
            <video
              className="product-sample-preview"
              controls
              preload="metadata"
              src={samples.find((m) => m.id === sampleVideoMediaId)?.url}
            />
          )}
          <p className="small muted">
            Video mẫu tối đa 10 phút. Học cách mở đầu, nhịp cảnh và bố cục từ
            khung hình mẫu; nhận dạng lời tiếng Anh tối đa 2 phút. Các video đầu
            ra có kịch bản riêng cho sản phẩm của bạn.
          </p>
          <div className="form-grid">
            <Field label="Độ dài thành phẩm">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {[5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n} giây
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nguồn lượt tạo">
              <select
                value={billingMode}
                onChange={(e) => setBilling(e.target.value)}
              >
                <option value="free">Chỉ dùng lượt miễn phí</option>
                <option value="credits">Cho phép dùng credits</option>
              </select>
            </Field>
          </div>
          <p className="product-budget">
            {billingMode === "free"
              ? `${quantity} video × ${duration / 5} cảnh × 5 giây = ${(quantity * duration) / 5} lượt Product / đợt. Tự chọn profile còn lượt trên máy này; hết lượt sẽ chờ.`
              : `${quantity} video × ${duration} giây · tối đa ${quantity * maxCredits} credits / đợt; kiểm tra giá DreamFace trước từng clip.`}{" "}
            Bản miễn phí có thể có watermark.
          </p>
          {billingMode === "credits" && (
            <Field label="Giới hạn credits / clip">
              <input
                type="number"
                min={1}
                max={100}
                required
                value={maxCredits}
                onChange={(e) => setMaxCredits(Number(e.target.value))}
              />
            </Field>
          )}
          <details>
            <summary>Tùy chọn render và nguồn học hỏi</summary>
            <div className="form-grid">
              <Field label="Chất lượng">
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                >
                  <option>720p</option>
                  <option>480p</option>
                </select>
              </Field>
              <Field label="Khung hình">
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  <option>9:16</option>
                  <option>16:9</option>
                </select>
              </Field>
            </div>
            <Field label="Profile DreamFace">
              <select
                value={accountId}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="auto">Auto · profile Product còn lượt</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{" "}
                    {a.productQuota?.state || "chưa kiểm tra Product"}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Model nghiên cứu Product"
              hint="Để trống: tự chọn model đọc ảnh từ endpoint đã lưu. Chỉ áp dụng cho Product."
            >
              <input
                value={researchModel}
                onChange={(e) => setResearchModel(e.target.value)}
                maxLength={150}
                placeholder="Auto · model hỗ trợ ảnh"
              />
            </Field>
            <Field label="Link YouTube tham khảo thêm (tối đa 3)">
              <textarea
                value={inspiration}
                onChange={(e) => setInspiration(e.target.value)}
                rows={3}
                placeholder="Mỗi dòng một link. Để trống để tự nghiên cứu."
              />
            </Field>
          </details>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={daily}
              onChange={(e) => setDaily(e.target.checked)}
            />
            Tự tạo video hằng ngày
          </label>
          {daily && (
            <div className="product-daily-settings">
              <div className="form-grid">
                <Field label="Giờ tạo hằng ngày">
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
                <Field label="Múi giờ">
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {[
                      ...new Set([
                        timezone,
                        "Asia/Bangkok",
                        "America/New_York",
                        "America/Los_Angeles",
                        "UTC",
                      ]),
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={startNow}
                  onChange={(e) => setStartNow(e.target.checked)}
                />
                Tạo đợt đầu ngay hôm nay
              </label>
              <p className="small muted">
                Cần bật máy và mở ứng dụng. Mỗi ngày tối đa một đợt theo lịch;
                khi mở lại chỉ chạy lịch hôm nay, không dồn các ngày đã nghỉ.
                Chờ đợt trước hoàn tất nếu thiếu lượt hoặc chưa duyệt.
              </p>
            </div>
          )}
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={autoRender}
              onChange={(e) => setAutoRender(e.target.checked)}
            />{" "}
            Tự render sau khi nghiên cứu xong
          </label>
          {!data.settings?.llm?.enabled && (
            <Notice>
              Bật LLM hỗ trợ đọc ảnh trong Cài đặt để tự nhận diện sản phẩm và
              nghiên cứu.
            </Notice>
          )}
          <Button
            type="submit"
            variant="primary"
            busy={busy || uploading}
            disabled={
              (!productUrl.trim() && !imageMediaId) ||
              !data.settings?.llm?.enabled
            }
          >
            <Play size={16} />
            {daily && !startNow
              ? "Lưu sản phẩm & lịch hằng ngày"
              : autoRender
                ? `Nghiên cứu & tạo ${quantity} video`
                : `Nghiên cứu ${quantity} kịch bản`}
          </Button>
        </form>
        <section className="product-card product-run-detail">
          <div className="product-card-heading">
            <h2>Nghiên cứu &amp; kết quả</h2>
            <Button onClick={() => navigate?.("queue")}>Hàng đợi</Button>
          </div>
          {!current ? (
            <div className="product-empty">
              <Video size={32} />
              <p>
                Thêm link hoặc ảnh để bắt đầu. Phân tích, nguồn và video sẽ lưu
                theo từng lần tạo.
              </p>
            </div>
          ) : (
            <>
              <div className={`product-status status-${current.status}`}>
                <strong>{stateLabel[current.status] || current.status}</strong>
                <span>{current.stage}</span>
                {current.progress > 0 && (
                  <progress max={100} value={current.progress} />
                )}
              </div>
              {current.error && <Notice>{current.error}</Notice>}
              <ProductOutputLocation
                directory={current.outputDirectory}
                notify={notify}
              />
              {current.status === "ready" && (
                <Button variant="primary" onClick={() => action("render")}>
                  <Play size={14} /> Render kịch bản này
                </Button>
              )}
              {["failed", "interrupted", "cancelled"].includes(
                current.status,
              ) && (
                <Button onClick={() => action("retry")}>
                  <RefreshCw size={14} /> Thử lại / khôi phục
                </Button>
              )}
              {output && (
                <div className="product-result">
                  <video controls src={output.url} preload="metadata" />
                  <a href={`${output.url}?download=true`}>
                    Tải Output Product · {output.duration?.toFixed(1)} giây
                  </a>
                </div>
              )}
              <ProductStudy study={current.study} />
            </>
          )}
        </section>
      </div>
      <ProductCampaignList
        data={data}
        project={project}
        notify={notify}
        onSelect={(id) => {
          setFocus(id);
          document
            .querySelector(".product-run-detail")
            ?.scrollIntoView({ behavior: "smooth" });
        }}
        onReuse={reuse}
      />
      {!!runs.length && (
        <section className="product-card">
          <h2>Lịch sử Product</h2>
          <div className="product-history">
            {runs.map((r) => (
              <button
                type="button"
                key={r.id}
                className={current?.id === r.id ? "selected" : ""}
                onClick={() => setFocus(r.id)}
              >
                <strong>
                  {r.study?.product.name ||
                    r.request.productUrl ||
                    "Ảnh sản phẩm"}
                </strong>
                <span>
                  {stateLabel[r.status] || r.status} · {r.request.duration}s
                </span>
                <small>{new Date(r.createdAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
