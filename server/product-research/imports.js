import { StudioError } from "../store.js";
import { evidence, textValue, safeUrl } from "./evidence.js";
import { socialPlatform, sourceLinks } from "./providers.js";

// No formulas are executed. Quoted cells/newlines from the Google CSV export are supported.
export function csvRows(text) {
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else value += char;
  }
  if (quoted)
    throw new StudioError(
      "CSV có dấu nháy chưa đóng. Tải lại file từ Google Trends.",
    );
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
export function importGoogleCsv(text, now = Date.now()) {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const index = rows.findIndex(
    (r) =>
      /^(?:Day|Week|Month|Date)$/i.test(r[0]?.trim()) &&
      /\(United States\)/i.test(r[1] || ""),
  );
  if (index < 0)
    throw new StudioError(
      "Chọn United States, ngôn ngữ English trên Google Trends, rồi tải CSV từ ô Interest over time. App cần cột Day / Week / Month và nhãn (United States).",
      "RESEARCH_CSV_REGION",
    );
  const title = textValue(
    rows[index][1].replace(/:\s*\(United States\)/i, ""),
    150,
  );
  const series = rows
    .slice(index + 1)
    .filter((r) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(r[0]))
    .slice(0, 5000)
    .map((r) => {
      const raw = (r[1] || "").trim(),
        n = raw === "" || raw === "<1" ? null : Number(raw);
      const day = r[0].length === 7 ? `${r[0]}-01` : r[0],
        date = new Date(`${day}T00:00:00Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== day
      )
        throw new StudioError(
          "CSV có ngày không hợp lệ. Tải lại file từ Google Trends.",
          "RESEARCH_CSV_DATE",
        );
      return {
        at: date.toISOString(),
        label: r[0],
        value: Number.isFinite(n) && n >= 0 && n <= 100 ? n : null,
        belowOne: raw === "<1",
      };
    });
  series.sort((a, b) => a.at.localeCompare(b.at));
  if (!series.some((r) => r.value !== null))
    throw new StudioError(
      "CSV chưa có điểm số 0–100 đọc được.",
      "RESEARCH_CSV_EMPTY",
    );
  return evidence(
    {
      provider: "google_csv",
      platform: "google",
      kind: "trend",
      externalId: `${title}:${series[0].at}:${series.at(-1).at}`,
      title,
      url: sourceLinks(title).trends,
      observedAt: new Date(now).toISOString(),
      measurement: "user_imported_search_interest_index",
      marketEvidence: "CSV_label_United_States",
      series,
      description:
        "CSV người dùng tải từ Google Trends US. Chỉ số 0–100 theo cửa sổ trong file; app chưa tự xác minh file với Google. Giá trị <1 giữ trống, không làm tròn thành 1 hoặc 0.",
      metrics: {},
    },
    now,
  );
}
export function manualReference(input, now = Date.now()) {
  const url = safeUrl(input.url);
  if (!url) throw new StudioError("Link không hợp lệ.");
  const u = new URL(url),
    host = u.hostname.replace(/^www\./, "");
  const isAd =
    host === "facebook.com" &&
    u.pathname.startsWith("/ads/library") &&
    /^\d+$/.test(u.searchParams.get("id") || "");
  const platform = isAd ? "meta" : socialPlatform(url);
  if (!platform)
    throw new StudioError(
      "Dán link video TikTok / Instagram / Facebook hoặc link Meta Ad Library có ?id=…",
      "RESEARCH_REFERENCE_URL",
    );
  return evidence(
    {
      provider: "manual",
      kind: isAd ? "ad" : "video",
      platform,
      externalId: url,
      url,
      title: input.title || "Mẫu do bạn chọn",
      description: input.description || "",
      observedAt: new Date(now).toISOString(),
      measurement: "user_provided_reference",
      metrics: {},
      marketEvidence: "unverified",
    },
    now,
  );
}
