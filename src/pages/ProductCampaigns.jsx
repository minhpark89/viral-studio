import { useState } from "react";
import { Play, Pause, Settings2, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { Button, Field, Notice } from "../components.jsx";
import { productStyles } from "../../shared/product-contracts.js";
import {
  ProductOutputPicker,
  ProductOutputLocation,
} from "./ProductOutput.jsx";

const labels = {
  completed: "Hoàn tất",
  ready: "Chờ duyệt",
  failed: "Có lỗi",
  cancelled: "Đã dừng",
  interrupted: "Gián đoạn",
  researching: "Nghiên cứu",
  "queued-research": "Chờ nghiên cứu",
  queued: "Chờ render",
  rendering: "Đang render",
};
function CampaignEditor({ campaign, data, onSaved, notify }) {
  const [outputDirectory, setOutputDirectory] = useState(
    campaign.request.outputDirectory || "",
  );
  const [quantity, setQuantity] = useState(campaign.quantity),
    [schedule, setSchedule] = useState({ ...campaign.schedule }),
    [style, setStyle] = useState(campaign.request.style || "auto"),
    [styleNotes, setNotes] = useState(campaign.request.styleNotes || ""),
    [sample, setSample] = useState(campaign.request.sampleVideoMediaId || ""),
    [busy, setBusy] = useState(false),
    [autoRender, setAutoRender] = useState(campaign.request.autoRender);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        `/product-campaigns/${campaign.id}`,
        {
          quantity,
          schedule,
          request: {
            style,
            styleNotes,
            sampleVideoMediaId: sample || null,
            autoRender,
            outputDirectory,
          },
        },
        "PATCH",
      );
      notify("Đã lưu cấu hình cho những đợt tiếp theo.");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="campaign-editor product-form" onSubmit={save}>
      <div className="form-grid">
        <Field label="Số video / đợt tiếp theo">
          <input
            type="number"
            min={1}
            max={100}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </Field>
        <Field label="Phong cách đợt tiếp theo">
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {productStyles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Điều chỉnh cách dựng">
        <textarea
          value={styleNotes}
          maxLength={1500}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </Field>
      <Field label="Video mẫu cho đợt tiếp theo">
        <select value={sample} onChange={(e) => setSample(e.target.value)}>
          <option value="">Không dùng video tải lên</option>
          {(data.media || [])
            .filter(
              (m) =>
                m.projectId === campaign.projectId &&
                m.kind === "video" &&
                m.mediaType === "product-reference-video",
            )
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <label className="toggle-field">
        <input
          type="checkbox"
          checked={autoRender}
          onChange={(e) => setAutoRender(e.target.checked)}
        />
        Tự render sau khi nghiên cứu
      </label>
      <label className="toggle-field">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) =>
            setSchedule({ ...schedule, enabled: e.target.checked })
          }
        />
        Chạy hằng ngày
      </label>
      <div className="form-grid">
        <Field label="Giờ chạy tiếp theo">
          <input
            type="time"
            required
            value={schedule.time}
            onChange={(e) => setSchedule({ ...schedule, time: e.target.value })}
          />
        </Field>
        <Field label="Múi giờ lịch">
          <select
            value={schedule.timezone}
            onChange={(e) =>
              setSchedule({ ...schedule, timezone: e.target.value })
            }
          >
            {[
              ...new Set([
                schedule.timezone,
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
      <p className="small muted">
        Áp dụng từ đợt mới; video đang chạy giữ cấu hình lúc tạo. Máy và ứng
        dụng cần mở để chạy lịch.
      </p>
      <ProductOutputPicker
        value={outputDirectory}
        onChange={setOutputDirectory}
        notify={notify}
        label="Nơi lưu đợt tiếp theo"
      />
      <Button type="submit" variant="primary" busy={busy}>
        Lưu đợt tiếp theo
      </Button>
    </form>
  );
}
function CampaignCard({ campaign, data, notify, onSelect, onReuse }) {
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [runKey, setRunKey] = useState(() => crypto.randomUUID());
  const runs = (data.productRuns || []).filter(
      (r) => r.campaignId === campaign.id,
    ),
    batches = (data.productBatches || [])
      .filter((b) => b.campaignId === campaign.id)
      .slice()
      .reverse(),
    latest = batches[0],
    latestRuns = runs.filter((r) => r.productBatchId === latest?.id),
    outstanding = batches.some(
      (b) =>
        !b.cancelled &&
        (runs.filter((r) => r.productBatchId === b.id).length < b.quantity ||
          runs.some(
            (r) =>
              r.productBatchId === b.id &&
              !["completed", "failed", "cancelled"].includes(r.status),
          )),
    );
  const act = async (url, body = {}, method = "POST") => {
    setBusy(true);
    try {
      const result = await api(url, body, method);
      notify("Đã cập nhật Product.");
      return result;
    } catch (e) {
      notify(e.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    const b = await act(`/product-campaigns/${campaign.id}/run`, {
      requestId: runKey,
    });
    if (b) {
      setRunKey(crypto.randomUUID());
      if (b.runIds[0]) onSelect(b.runIds[0]);
    }
  };
  return (
    <article className="product-card campaign-card">
      <div className="product-card-heading">
        <div>
          <h3>
            {runs.find((r) => r.study)?.study.product.name ||
              campaign.request.productUrl ||
              "Sản phẩm từ ảnh"}
          </h3>
          <p className="small">
            {campaign.quantity} video / đợt · {campaign.request.duration}s /
            video ·{" "}
            {productStyles.find((s) => s.id === campaign.request.style)
              ?.label || "Luân phiên phong cách"}
          </p>
        </div>
        <span className="product-market-chip">
          {campaign.schedule.enabled
            ? `${campaign.schedule.time} hằng ngày`
            : "Lịch đang tắt"}
        </span>
      </div>
      <p className="small muted">
        {campaign.schedule.timezone} · {campaign.stage}
        {campaign.lastScheduledDate
          ? ` · Đã nhận lịch ngày ${campaign.lastScheduledDate}`
          : ""}
      </p>
      {campaign.error && <Notice>{campaign.error}</Notice>}
      <div className="product-actions">
        <Button
          variant="primary"
          busy={busy}
          disabled={outstanding}
          onClick={runNow}
        >
          <Play size={14} />
          Tạo thêm {campaign.quantity} video
        </Button>
        <Button
          busy={busy}
          onClick={() =>
            act(
              `/product-campaigns/${campaign.id}`,
              { schedule: { enabled: !campaign.schedule.enabled } },
              "PATCH",
            )
          }
        >
          <Pause size={14} />
          {campaign.schedule.enabled
            ? "Tắt lịch hằng ngày"
            : "Bật lịch hằng ngày"}
        </Button>
        <Button onClick={() => setEditing(!editing)}>
          <Settings2 size={14} />
          Đổi số lượng / phong cách
        </Button>
        <Button onClick={() => onReuse(campaign.request)}>
          Nạp vào biểu mẫu
        </Button>
      </div>
      {outstanding && (
        <p className="small muted">
          Đợt trước đang xử lý hoặc chờ duyệt / lượt Product. Lịch tự chờ, không
          tạo chồng thêm.
        </p>
      )}
      {editing && (
        <CampaignEditor
          key={campaign.updatedAt}
          campaign={campaign}
          data={data}
          notify={notify}
          onSaved={() => setEditing(false)}
        />
      )}
      {latest && (
        <div className="campaign-delivery">
          <ProductOutputLocation
            directory={latest.outputDirectory || latestRuns[0]?.outputDirectory}
            notify={notify}
          />
          <h4>
            Đợt gần nhất · {new Date(latest.createdAt).toLocaleString("vi-VN")}
          </h4>
          <p className="small">
            {latestRuns.filter((r) => r.status === "completed").length}/
            {latest.quantity} video hoàn tất
            {latest.cancelled ? " · Đã dừng đợt" : ""}
          </p>
          <div className="product-actions">
            {latestRuns.some((r) => r.status === "ready") && (
              <Button
                busy={busy}
                onClick={() => act(`/product-batches/${latest.id}/render`)}
              >
                Duyệt & render cả đợt
              </Button>
            )}
            {latestRuns.some((r) =>
              ["failed", "interrupted", "cancelled"].includes(r.status),
            ) && (
              <Button
                busy={busy}
                onClick={() => act(`/product-batches/${latest.id}/retry`)}
              >
                <RefreshCw size={14} />
                Thử lại phần lỗi
              </Button>
            )}
            {!latest.cancelled &&
              latestRuns.some(
                (r) => !["completed", "failed", "cancelled"].includes(r.status),
              ) && (
                <Button
                  busy={busy}
                  onClick={() => act(`/product-batches/${latest.id}/cancel`)}
                >
                  Dừng đợt này
                </Button>
              )}
          </div>
        </div>
      )}
      <details open>
        <summary>Video và file xuất ({runs.length})</summary>
        <div className="campaign-output-list">
          {runs
            .slice()
            .reverse()
            .map((r) => {
              const output = data.media.find((m) => m.id === r.mediaId);
              return (
                <div key={r.id}>
                  <button type="button" onClick={() => onSelect(r.id)}>
                    <strong>
                      Video {r.sequence + 1} ·{" "}
                      {r.study?.creativeDirection?.label || "Đang chuẩn bị"}
                    </strong>
                    <span>{labels[r.status] || r.status}</span>
                    <small>{r.stage}</small>
                  </button>
                  {output && (
                    <a href={`${output.url}?download=true`}>
                      Tải MP4 · {output.duration?.toFixed(1)}s
                    </a>
                  )}
                </div>
              );
            })}
        </div>
      </details>
    </article>
  );
}
export function ProductCampaignList(props) {
  const campaigns = (props.data.productCampaigns || [])
    .filter((c) => c.projectId === props.project.id)
    .slice()
    .reverse();
  if (!campaigns.length) return null;
  return (
    <section className="product-campaign-list">
      <h2>Sản phẩm đã lưu & lịch hằng ngày</h2>
      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} {...props} />
      ))}
    </section>
  );
}
