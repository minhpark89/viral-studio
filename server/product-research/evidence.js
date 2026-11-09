import { createHash } from "node:crypto";

export function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export const textValue = (value, length = 1500) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
export function metric(value) {
  if (value === "" || value == null || typeof value === "boolean") return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function isoDate(value) {
  if (value == null || value === "") return null;
  let v = value;
  if (/^\d{10,13}$/.test(String(value)))
    v = Number(value) * (String(value).length <= 10 ? 1000 : 1);
  const date = new Date(v);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function evidence(input, now = Date.now()) {
  const url = safeUrl(input.url);
  if (!url || !input.externalId) return null;
  const record = {
    ...input,
    id: createHash("sha256")
      .update(`${input.provider}:${input.platform}:${input.externalId}`)
      .digest("hex")
      .slice(0, 32),
    externalId: String(input.externalId),
    title: textValue(input.title, 250),
    description: textValue(input.description),
    url,
    sourceUrl: safeUrl(input.sourceUrl) || url,
    thumbnailUrl: safeUrl(input.thumbnailUrl),
    mediaUrl: safeUrl(input.mediaUrl),
    productUrl: safeUrl(input.productUrl),
    creator: textValue(input.creator, 200),
    observedAt: isoDate(input.observedAt) || new Date(now).toISOString(),
    publishedAt: isoDate(input.publishedAt),
    marketEvidence: input.marketEvidence || "unknown",
    measurement: input.measurement || "public_metrics",
    metrics: Object.fromEntries(
      Object.entries(input.metrics || {}).map(([k, v]) => [k, metric(v)]),
    ),
  };
  return record;
}
export function viewGrowth(points, now = Date.now()) {
  const recent = points.filter(
    (p) =>
      metric(p.metrics?.views) !== null &&
      now - Date.parse(p.observedAt) <= 7 * 86400000 &&
      Date.parse(p.observedAt) <= now,
  );
  if (recent.length < 2) return null;
  const last = recent.at(-1);
  const first = [...recent]
    .reverse()
    .find(
      (p) => Date.parse(last.observedAt) - Date.parse(p.observedAt) >= 3600000,
    );
  if (
    !first ||
    last.metrics.views < first.metrics.views ||
    now - Date.parse(last.observedAt) > 72 * 3600000
  )
    return null;
  const hours =
    (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 3600000;
  return {
    from: first.observedAt,
    to: last.observedAt,
    delta: last.metrics.views - first.metrics.views,
    perDay: ((last.metrics.views - first.metrics.views) * 24) / hours,
    hours,
  };
}
export function rankEvidence(
  record,
  { history = [], minViews = 10000, recentDays = 30, now = Date.now() } = {},
) {
  const growth = viewGrowth(history, now);
  const age = record.publishedAt
    ? (now - Date.parse(record.publishedAt)) / 86400000
    : null;
  const fresh = age !== null && age >= 0 && age <= recentDays;
  const views = metric(record.metrics?.views);
  const sourceAge = now - Date.parse(record.observedAt);
  const sourceFresh = sourceAge >= 0 && sourceAge <= 72 * 3600000;
  const contentScore =
    record.kind === "video" && views !== null
      ? Math.min(
          100,
          Math.round(
            Math.min(40, Math.log10(views + 1) * 8) +
              (fresh ? 25 : 0) +
              (growth?.delta > 0 ? 25 : 0) +
              (record.productId ? 10 : 0),
          ),
        )
      : null;
  const salesScore = record.salesAssessment?.score ?? null;
  let label =
    record.kind === "ad"
      ? "Quảng cáo tham khảo"
      : record.kind === "trend"
        ? "Tín hiệu tìm kiếm"
        : "Tham khảo thêm";
  if (record.kind === "video")
    label =
      growth?.delta > 0 && fresh && sourceFresh
        ? "Video đang tăng"
        : fresh && sourceFresh && views !== null && views >= minViews
          ? "Video đáng tham khảo"
          : "Chưa xác nhận tăng";
  if (record.kind === "product")
    label = record.salesAssessment?.eligible
      ? "Bán tốt · tìm mẫu video"
      : record.measurement === "shopping_listing"
        ? "Listing sản phẩm · chưa xác nhận bán chạy"
        : "Theo dõi doanh số";
  return {
    salesScore,
    contentScore,
    label,
    growth,
    fresh,
    sourceFresh,
    reasons:
      record.kind === "trend"
        ? ["Mức quan tâm tìm kiếm, không phải số đơn hoặc doanh thu."]
        : record.kind === "ad"
          ? ["Quảng cáo xuất hiện không chứng minh bán tốt hoặc có lợi nhuận."]
          : record.kind === "product"
            ? record.salesAssessment?.reasons ||
              (record.measurement === "shopping_listing"
                ? [
                    "Listing xuất hiện trên tìm kiếm Google Shopping US; chưa xác minh thị trường khách mua.",
                    "Giá, số đánh giá và điểm sao không phải số đơn hay doanh thu.",
                  ]
                : ["Chưa đủ chuỗi doanh số để đánh giá."])
            : [
                views === null
                  ? "Nguồn chưa có lượt xem."
                  : `${views.toLocaleString("en-US")} lượt xem tại lần đo.`,
                growth
                  ? `Tăng ${growth.delta.toLocaleString("en-US")} lượt xem qua ${growth.hours.toFixed(1)} giờ quan sát.`
                  : "Cần hai lần đo cách nhau ít nhất 1 giờ để xác nhận đà tăng.",
                "Chưa xác nhận doanh thu hoặc cơ cấu khán giả US từ lượt xem.",
              ],
  };
}
export function joinProductSignals(records) {
  return records.map((record) => {
    if (record.kind !== "product") return record;
    const linked = records.filter(
      (v) =>
        v.kind === "video" &&
        v.productId === record.productId &&
        v.provider === record.provider,
    );
    const suitable = linked.filter(
      (v) =>
        v.assessment.fresh &&
        v.assessment.sourceFresh &&
        (v.metrics.views ?? 0) >= 10000,
    );
    return {
      ...record,
      linkedVideoIds: linked.map((v) => v.id),
      assessment: {
        ...record.assessment,
        contentScore: suitable.length
          ? Math.max(...suitable.map((v) => v.assessment.contentScore || 0))
          : null,
        label:
          record.salesAssessment?.eligible && suitable.length
            ? "Bán tốt + có video đáng thử"
            : record.assessment.label,
      },
    };
  });
}
