import { createHash } from "node:crypto";
import { StudioError } from "../store.js";
import {
  fetchProductResource,
  researchProductVideos,
} from "../product-sources.js";
import { evidence, isoDate, safeUrl, textValue } from "./evidence.js";
import { aiVideoPlan, aiSearchQuery } from './ai-video.js';
import { prioritizeProducts } from "./opportunities.js";

export const SOURCES = [
  {
    id: "shopping",
    name: "Google Shopping · sản phẩm & shop",
    provider: "serpapi",
    detail:
      "Listing tại US: sản phẩm, giá, shop, đánh giá và link. Không phải bảng doanh số.",
  },
  {
    id: "trending",
    name: "Google Trending · US",
    free: true,
    detail:
      "RSS xu hướng nổi hôm nay, lọc theo từ khóa. Ngách nhỏ có thể không xuất hiện.",
  },
  {
    id: "youtube",
    name: "YouTube · video công khai",
    free: true,
    detail: "Tìm video và đọc lượt xem công khai; chưa xác minh khán giả US.",
  },
  {
    id: "interest",
    name: "Google Trends · biểu đồ ngách",
    provider: "serpapi",
    detail: "Mức quan tâm tìm kiếm 0–100 ở US trong 3 tháng; cần SerpApi.",
  },
  {
    id: "ads",
    name: "Meta Ads · Facebook / Instagram",
    provider: "serpapi",
    detail:
      "Quảng cáo video đang chạy tại US, qua SerpApi. Không cung cấp doanh thu đối thủ.",
  },
  {
    id: "social",
    name: "TikTok / Instagram / Facebook · video ngắn",
    provider: "serpapi",
    detail:
      "Google Short Videos: mẫu video ngắn, ảnh, kênh và thời lượng nếu nguồn có. Chưa xác nhận viral; cần SerpApi.",
  },
];

export function sourceLinks(query) {
  return {
    trends: `https://trends.google.com/trends/explore?geo=US&hl=en&date=today%203-m&q=${encodeURIComponent(query)}`,
    ads: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=video&search_type=keyword_unordered&q=${encodeURIComponent(query)}`,
    tiktok: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
    instagram: `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com/reel/ ${query}`)}`,
    facebook: `https://www.google.com/search?q=${encodeURIComponent(`site:facebook.com/reel/ ${query}`)}`,
  };
}
function xmlText(value = "") {
  return textValue(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
        const cp =
          n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      })
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
}
export function parseTrending(
  xml,
  query,
  limit = 20,
  observedAt = new Date().toISOString(),
) {
  if (!/<rss[\s>]/i.test(xml))
    throw new StudioError(
      "Google Trending chưa trả về RSS hợp lệ.",
      "RESEARCH_SOURCE_FORMAT",
    );
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((x) => x.length > 2 && !["the", "and", "for", "with"].includes(x));
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const get = (tag) =>
        xmlText(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]);
      const title = get("title");
      return evidence({
        provider: "google_rss",
        platform: "google",
        kind: "trend",
        externalId: `${title}:${get("pubDate")}`,
        title,
        url: sourceLinks(title).trends,
        publishedAt: get("pubDate"),
        observedAt,
        thumbnailUrl: get("ht:picture"),
        description: get("ht:news_item_title"),
        trafficText: get("ht:approx_traffic"),
        measurement: "trending_search_traffic_approx",
        marketEvidence: "query_country_US",
        metrics: {},
      });
    })
    .filter(Boolean);
  return {
    records: items
      .filter((r) => {
        if (!tokens.length) return false;
        const words = new Set(
          `${r.title} ${r.description}`.toLowerCase().split(/[^\p{L}\p{N}]+/u),
        );
        return (
          tokens.filter((t) => words.has(t)).length >=
          Math.min(2, tokens.length)
        );
      })
      .slice(0, limit),
    total: items.length,
  };
}
export function parseInterest(body, query, observedAt) {
  const points = (body.interest_over_time?.timeline_data || [])
    .map((row) => ({
      at: isoDate(row.timestamp),
      label: textValue(row.date, 100),
      value:
        typeof row.values?.[0]?.extracted_value === "number" &&
        row.values[0].extracted_value >= 0 &&
        row.values[0].extracted_value <= 100
          ? row.values[0].extracted_value
          : null,
      partial: row.is_partial === true || row.isPartial === true,
    }))
    .filter((row) => row.at);
  if (!points.some((p) => p.value !== null)) return [];
  return [
    evidence({
      provider: "serpapi",
      platform: "google",
      kind: "trend",
      externalId: `interest:US:3m:${query.toLowerCase()}`,
      title: query,
      url: sourceLinks(query).trends,
      observedAt,
      measurement: "search_interest_index",
      marketEvidence: "query_country_US",
      description:
        "Chỉ số tìm kiếm tương đối 0–100, chuẩn hóa trong khoảng 3 tháng của lần lấy này. Không phải lượng tìm kiếm tuyệt đối hay doanh thu.",
      series: points,
      metrics: {},
      window: "today 3-m",
    }),
  ];
}
export function parseAds(body, observedAt, limit = 20) {
  return (body.ads || [])
    .slice(0, limit)
    .map((ad) => {
      if (!ad.ad_archive_id) return null;
      const card = ad.cards?.[0] || {},
        video = ad.videos?.[0] || card.videos?.[0] || {};
      return evidence({
        provider: "serpapi",
        platform: "meta",
        kind: "ad",
        externalId: String(ad.ad_archive_id),
        url:
          safeUrl(ad.details_link) ||
          `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.ad_archive_id)}`,
        title: ad.title || card.title || ad.page_name || "Meta video ad",
        description: ad.body || card.body,
        creator: ad.page_name,
        creatorId: String(ad.page_id || ""),
        publishedAt: ad.start_date,
        observedAt,
        thumbnailUrl:
          video.video_preview_image ||
          card.resized_image ||
          ad.page_profile_picture,
        mediaUrl: video.video_hd || video.video_sd,
        productUrl: ad.link || card.link,
        active: typeof ad.is_active === "boolean" ? ad.is_active : null,
        platforms: (ad.publisher_platforms || [])
          .filter((p) => typeof p === "string")
          .slice(0, 8),
        gated: textValue(ad.gated_type, 80),
        callToAction: textValue(ad.call_to_action || card.call_to_action, 100),
        marketEvidence: "ad_library_country_US",
        measurement: "ad_library_listing",
        metrics: {},
      });
    })
    .filter(Boolean);
}
export function parseShopping(body, observedAt, limit = 20) {
  const items = [
    ...(body.shopping_results || []),
    ...(body.categorized_shopping_results || []).flatMap(
      (g) => g.shopping_results || [],
    ),
  ];
  const records = items
    .map((item) => {
      const url = safeUrl(item.product_link) || safeUrl(item.link);
      if (!url || !item.title) return null;
      return evidence({
        provider: "serpapi",
        platform: "google_shopping",
        kind: "product",
        externalId: `${item.product_id || url}:${item.source || ""}`,
        productId: item.product_id ? String(item.product_id) : null,
        title: item.title,
        url,
        productUrl: safeUrl(item.link),
        creator: item.source,
        thumbnailUrl: item.thumbnail || item.thumbnails?.[0],
        observedAt,
        description:
          item.snippet ||
          (item.extensions || [])
            .filter((v) => typeof v === "string")
            .join(" · "),
        priceText: textValue(item.price, 100),
        delivery: textValue(item.delivery, 180),
        metrics: {
          price: item.extracted_price,
          rating:
            typeof item.rating === "number" && item.rating <= 5
              ? item.rating
              : null,
          reviews: item.reviews,
        },
        measurement: "shopping_listing",
        marketEvidence: "Google_Shopping_search_US",
      });
    })
    .filter(Boolean);
  return [...new Map(records.map((r) => [r.id, r])).values()].slice(0, limit);
}
export function socialPlatform(url) {
  try {
    const u = new URL(url),
      host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "tiktok.com" && /\/@[^/]+\/video\/\d+/.test(u.pathname))
      return "tiktok";
    if (host === "instagram.com" && /^\/(?:reel|p)\/[^/]+/.test(u.pathname))
      return "instagram";
    if (host === "facebook.com" && /\/(?:reel|videos)\//.test(u.pathname))
      return "facebook";
  } catch {}
  return null;
}
export function parseSocial(body, observedAt, limit = 20) {
  const items = [
    ...(body.short_video_results || []),
    ...(body.organic_results || []),
  ];
  return items
    .map((item) => {
      const platform = socialPlatform(item.link);
      if (!platform) return null;
      const url = new URL(item.link);
      url.search = "";
      url.hash = "";
      return evidence({
        provider: "serpapi",
        platform,
        kind: "video",
        externalId: url.href,
        url: url.href,
        title: item.title,
        description: item.snippet,
        thumbnailUrl: item.thumbnail,
        creator: item.channel,
        durationText: textValue(item.duration, 30),
        previewClipUrl: safeUrl(item.clip),
        observedAt,
        measurement: body.short_video_results
          ? "short_video_search_metadata"
          : "search_index_metadata",
        marketEvidence: "search_locale_US_only",
        metrics: {},
      });
    })
    .filter(Boolean)
    .slice(0, limit);
}

export class ResearchProviders {
  constructor(
    repository,
    settings,
    {
      fetchResource = fetchProductResource,
      youtube = researchProductVideos,
    } = {},
  ) {
    this.repo = repository;
    this.settings = settings;
    this.fetchResource = fetchResource;
    this.youtube = youtube;
  }
  async serp(params, signal) {
    const config = this.settings(),
      key = config.key;
    if (!key)
      throw new StudioError(
        "Chưa có SerpApi key. Có thể mở nguồn miễn phí bằng link bên dưới.",
        "RESEARCH_KEY_REQUIRED",
        409,
      );
    const cacheId = createHash("sha256")
      .update(JSON.stringify(params))
      .digest("hex");
    const cached = this.repo.cached(cacheId);
    if (cached) return { ...cached, cached: true };
    const ticket = this.repo.reserve("serpapi", config);
    try {
      const url = new URL("https://serpapi.com/search.json");
      for (const [k, v] of Object.entries({ ...params, api_key: key }))
        url.searchParams.set(k, String(v));
      const r = await this.fetchResource(url.href, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        maxBytes: 5 * 1024 * 1024,
        accept: "application/json",
      });
      // Keep long platform IDs as strings, even when a provider emits a JSON number.
      const raw = JSON.parse(
        r.bytes
          .toString()
          .replace(
            /("(?:ad_archive_id|page_id|collation_id|product_id)"\s*:\s*)(\d{15,})/g,
            '$1"$2"',
          ),
      );
      const emptySearch = params.engine === 'google_short_videos' &&
        /^(?:Google hasn't returned any results for this query\.?|No results found\.?|No matching results found\.?)$/i.test(String(raw.error || '').trim());
      if ((raw.error || raw.search_metadata?.status === "Error") && !emptySearch)
        throw new StudioError(
          "SerpApi không trả được kết quả. Kiểm tra key, quota và engine trong tài khoản SerpApi.",
          "RESEARCH_PROVIDER_ERROR",
          502,
        );
      // Drop response request metadata/pagination URLs: providers can echo the key.
      const redact = (value) =>
        typeof value === "string"
          ? value
              .split(key)
              .join("[redacted]")
              .split(encodeURIComponent(key))
              .join("[redacted]")
          : Array.isArray(value)
            ? value.map(redact)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value)
                    .filter(
                      ([k]) =>
                        !/^(?:api_key|access_token|authorization)$/i.test(k),
                    )
                    .map(([k, v]) => [k, redact(v)]),
                )
              : value;
      const body = redact({
        ads: raw.ads,
        organic_results: raw.organic_results,
        short_video_results: raw.short_video_results,
        shopping_results: raw.shopping_results,
        categorized_shopping_results: raw.categorized_shopping_results,
        interest_over_time: raw.interest_over_time,
      });
      const result = {
        body,
        observedAt: new Date(this.repo.now()).toISOString(),
        cached: false,
      };
      this.repo.finishRequest(
        ticket,
        "completed",
        (
          body.ads ||
          body.organic_results ||
          body.short_video_results ||
          body.shopping_results ||
          body.interest_over_time?.timeline_data ||
          []
        ).length,
      );
      this.repo.cache(cacheId, result, 3600000);
      return result;
    } catch (error) {
      this.repo.finishRequest(ticket, signal.aborted ? "cancelled" : "failed");
      // Transport errors may include the URL/key. Never persist or return them.
      if (
        error instanceof StudioError &&
        error.code === "RESEARCH_PROVIDER_ERROR"
      )
        throw error;
      throw new StudioError(
        signal.aborted
          ? "Đã dừng quét nguồn."
          : "Không kết nối được SerpApi. Kiểm tra mạng, key và quota; không tự gọi lại để tránh tốn lượt.",
        "RESEARCH_PROVIDER_ERROR",
        502,
      );
    }
  }
  async scan(source, request, signal) {
    const query = request.keywords,
      observedAt = new Date(this.repo.now()).toISOString();
    if (source === "trending") {
      let result = this.repo.cached("google-rss-US"),
        cached = !!result;
      if (!result) {
        const r = await this.fetchResource(
          "https://trends.google.com/trending/rss?geo=US",
          {
            signal,
            accept: "application/rss+xml,application/xml",
            maxBytes: 1024 * 1024,
          },
        );
        result = { xml: r.bytes.toString(), observedAt };
        this.repo.cache("google-rss-US", result, 900000);
      }
      const parsed = parseTrending(
        result.xml,
        query,
        request.limit,
        result.observedAt,
      );
      return {
        records: parsed.records,
        cached,
        note: `Đọc ${parsed.total} xu hướng US, ${parsed.records.length} khớp từ khóa. RSS không bao phủ mọi ngách sản phẩm.`,
      };
    }
    if (source === "youtube") {
      const cacheId = `youtube:${query}:${request.limit}`,
        cached = this.repo.cached(cacheId);
      if (cached) return { ...cached, cached: true };
      const found = await this.youtube(query, {
        signal,
        limit: request.limit,
        stage: () => {},
      });
      const result = {
        records: found.videos
          .map((v) =>
            evidence({
              provider: "youtube_public",
              platform: "youtube",
              kind: "video",
              externalId: v.id,
              url: v.url,
              title: v.title,
              description: v.transcript
                ?.slice(0, 6)
                .map((t) => t.text)
                .join(" "),
              thumbnailUrl: v.thumbnailUrl,
              creator: v.channel,
              publishedAt: v.publishedAt,
              observedAt: v.observedAt || found.checkedAt || observedAt,
              metrics: { views: v.views },
              measurement: "public_video_metadata",
            }),
          )
          .filter(Boolean),
        note: (found.warnings || []).join(" ").slice(0, 700),
        cached: false,
      };
      this.repo.cache(cacheId, result, 3600000);
      return result;
    }
    if (source === "interest") {
      const r = await this.serp(
        {
          engine: "google_trends",
          q: query,
          geo: "US",
          date: "today 3-m",
          data_type: "TIMESERIES",
        },
        signal,
      );
      return {
        records: parseInterest(r.body, query, r.observedAt),
        cached: r.cached,
        note: "Chỉ số tương đối trong một cửa sổ 3 tháng; ngày thiếu giữ trống.",
      };
    }
    if (source === "shopping") {
      const r = await this.serp(
        { engine: "google_shopping", q: query, gl: "us", hl: "en" },
        signal,
      );
      return {
        records: prioritizeProducts(
          parseShopping(r.body, r.observedAt, request.limit),
          query,
        ),
        cached: r.cached,
        note: "Listing theo tìm kiếm US: giá/đánh giá giúp so sánh, không chứng minh sản phẩm bán chạy hoặc doanh thu shop.",
      };
    }
    if (source === "ads") {
      const r = await this.serp(
        {
          engine: "meta_ad_library",
          q: query,
          country: "US",
          active_status: "active",
          ad_type: "all",
          media_type: "video",
          publisher_platforms: "facebook,instagram",
          sort_by: "most_recent",
        },
        signal,
      );
      return {
        records: prioritizeProducts(
          parseAds(r.body, r.observedAt, 30),
          query,
        ).slice(0, request.limit),
        cached: r.cached,
        note: "Một trang kết quả, ưu tiên CTA mua hàng, trang sản phẩm và nội dung nhắc vật phẩm. Đây là lọc tham khảo, chưa xác nhận đúng SKU, doanh thu hoặc ROAS.",
      };
    }
    if (source === "social") {
      const searchQuery = request.videoGoal === "no-filming" ? request.aiVideoKeywords || aiSearchQuery(query) : query;
      const r = await this.serp(
        { engine: "google_short_videos", q: searchQuery, gl: "us", hl: "en" },
        signal,
      );
      const candidates = parseSocial(r.body, r.observedAt, 40);
      if (request.videoGoal === "no-filming") candidates.sort((a,b)=>Number(!!aiVideoPlan(b)?.suitable)-Number(!!aiVideoPlan(a)?.suitable));
      const records = prioritizeProducts(
        [...new Map(candidates.map((v) => [v.id, v])).values()],
        query,
      ).sort((a,b)=>request.videoGoal === "no-filming" ? Number(!!aiVideoPlan(b)?.suitable)-Number(!!aiVideoPlan(a)?.suitable) : 0).slice(0, request.limit);
      const platforms = Object.fromEntries(
        ["tiktok", "instagram", "facebook"].map((p) => [
          p,
          records.filter((v) => v.platform === p).length,
        ]),
      );
      return {
        records,
        cached: r.cached,
        platforms,
        note: `${request.videoGoal === "no-filming" ? `Từ khóa mẫu dựng: ${searchQuery}. Mẫu kỹ thuật có thể khác ngách sản phẩm. Không có kết quả thì đổi từ khóa hoặc thêm link mẫu; không tự gọi thêm API. ` : ""}Google Short Videos: ${platforms.tiktok} TikTok · ${platforms.instagram} Instagram · ${platforms.facebook} Facebook. Chỉ nhận link video đúng nền tảng; chưa xác minh viral, lượt xem hoặc khán giả US.`,
      };
    }
    throw new StudioError(
      "Nguồn không được hỗ trợ.",
      "RESEARCH_SOURCE_UNKNOWN",
    );
  }
}
