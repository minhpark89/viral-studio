import { z } from "zod";
import { SecretStore } from "./secret-store.js";
import { StudioError } from "./store.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fetchProductResource } from "./product-sources.js";
import { importMedia } from "./media.js";

const API = "https://openapi.fastmoss.com";
const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
const safeLink = (value) => {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
};
export const marketScanSchema = z.object({
  autoShortlist: z.boolean().default(true),
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
  keywords: z.string().trim().max(150).default(""),
  limit: z.number().int().min(1).max(20).default(5),
  minWeeklyGmv: z.number().min(0).max(10000000).default(1000),
  minGrowth: z.number().min(0).max(10000).default(50),
});

export class FastMossClient {
  constructor(apiKey, { fetchImpl = globalThis.fetch } = {}) {
    this.key = apiKey;
    this.fetch = fetchImpl;
    this.calls = 0;
  }
  async request(endpoint, body, { signal } = {}) {
    if (!this.key)
      throw new StudioError(
        "Kết nối API FastMoss để đọc doanh thu đối thủ US. Không có dữ liệu doanh thu giả thay thế.",
        "MARKET_SOURCE_REQUIRED",
        409,
      );
    if (
      ![
        "/product/v1/search",
        "/product/v1/salesTrend",
        "/product/v1/videoList",
        "/shop/v1/search",
      ].includes(endpoint)
    )
      throw new StudioError(
        "API dữ liệu không được hỗ trợ.",
        "MARKET_ENDPOINT_INVALID",
      );
    this.calls++;
    const timeout = AbortSignal.timeout(25000);
    const r = await this.fetch(API + endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!r.ok)
      throw new StudioError(
        `FastMoss trả HTTP ${r.status}${r.status === 401 || r.status === 403 ? " — kiểm tra quyền API và key." : r.status === 429 ? " — đã chạm giới hạn yêu cầu." : "."}`,
        "MARKET_SOURCE_FAILED",
        502,
      );
    const raw = await r.text();
    if (raw.length > 5 * 1024 * 1024)
      throw new StudioError("Phản hồi nguồn quá lớn.", "MARKET_SOURCE_FAILED");
    // Provider IDs can be 19-digit integers; never round them through Number.
    const b = JSON.parse(
      raw.replace(
        /("(?:product_id|seller_id|video_id|uid)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
        '$1"$2"',
      ),
    );
    if (b.code !== 0 || !b.data)
      throw new StudioError(
        `FastMoss không cấp dữ liệu cho yêu cầu này (mã ${String(b.code).slice(0, 40)}). Kiểm tra gói API/quota.`,
        "MARKET_SOURCE_FAILED",
        502,
      );
    return b.data;
  }
}

export function normalizeSalesTrend(
  data,
  { region = "US", now = Date.now() } = {},
) {
  const overview = data?.overview || {};
  if (overview.region !== region || overview.currency !== "USD")
    throw new StudioError(
      "Nguồn doanh thu không xác nhận US/USD; không trộn vào biểu đồ US.",
      "MARKET_REGION_MISMATCH",
    );
  const seen = new Set();
  const series = [];
  for (const row of data.list || []) {
    const date = String(row.dt || "").slice(0, 10);
    const revenue = number(row.gmv),
      units = number(row.units_sold);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      seen.has(date) ||
      revenue === null ||
      revenue < 0 ||
      units === null ||
      units < 0
    )
      throw new StudioError(
        "Chuỗi doanh thu có ngày trùng hoặc giá trị không hợp lệ.",
        "MARKET_DATA_INVALID",
      );
    seen.add(date);
    series.push({ date, revenue, units });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Exclude the current US calendar date from growth scoring. It may be an
  // incomplete day. Keep it in the chart, explicitly labelled provisional.
  for (const row of series) row.provisional = row.date >= today;
  return {
    series,
    region: "US",
    currency: "USD",
    overview: {
      units: number(overview.units_sold),
      revenue: number(overview.gmv),
      creators: number(overview.creator_count),
      videos: number(overview.aweme_count),
    },
    source: "FastMoss",
    measurement: "estimated_gmv",
    checkedAt: new Date(now).toISOString(),
    timezone:
      "America/New_York (scoring cutoff); source calendar dates preserved",
  };
}

export function scoreProductTrend(
  trend,
  { minWeeklyGmv = 1000, minGrowth = 50, now = Date.now() } = {},
) {
  const rows = trend.series.filter((r) => !r.provisional).slice(-14),
    reasons = [];
  const complete =
    rows.length === 14 &&
    rows.every(
      (r, i) =>
        !i || Date.parse(r.date) - Date.parse(rows[i - 1].date) === 86400000,
    );
  const age = rows.length
    ? (now - Date.parse(rows.at(-1).date)) / 86400000
    : Infinity;
  if (!complete || age > 3)
    return {
      label: "Chưa đủ dữ liệu",
      eligible: false,
      score: null,
      growth: null,
      reasons: [
        !complete
          ? "Cần 14 ngày liên tiếp có dữ liệu; không thay ngày thiếu bằng 0."
          : "Dữ liệu cuối quá 3 ngày.",
      ],
      current7: null,
      previous7: null,
    };
  const previous7 = rows.slice(0, 7).reduce((s, r) => s + r.revenue, 0),
    current7 = rows.slice(7).reduce((s, r) => s + r.revenue, 0),
    units7 = rows.slice(7).reduce((s, r) => s + r.units, 0);
  const growth =
    previous7 > 0 ? ((current7 - previous7) / previous7) * 100 : null;
  const last3 = rows.slice(-3).reduce((s, r) => s + r.revenue, 0) / 3,
    prior4 = rows.slice(-7, -3).reduce((s, r) => s + r.revenue, 0) / 4;
  const activeDays = rows.slice(-7).filter((r) => r.units > 0).length;
  const risingDays = rows.slice(-3).filter((r) => r.revenue > prior4).length;
  if (current7 >= minWeeklyGmv)
    reasons.push(
      `GMV 7 ngày ${current7.toFixed(2)} USD đạt ngưỡng ${minWeeklyGmv} USD.`,
    );
  else reasons.push(`GMV 7 ngày chưa đạt ngưỡng ${minWeeklyGmv} USD.`);
  reasons.push(
    growth === null
      ? "Tuần trước bằng 0; không tính tăng trưởng vô hạn."
      : `Tăng ${growth.toFixed(1)}% so với 7 ngày trước.`,
  );
  reasons.push(
    last3 > prior4
      ? "Trung bình 3 ngày cuối cao hơn 4 ngày trước."
      : "Đà tăng 3 ngày cuối chưa rõ.",
  );
  reasons.push(
    `${risingDays}/3 ngày cuối cao hơn trung bình 4 ngày trước; cần ít nhất 2 ngày để tránh một đỉnh đơn lẻ.`,
  );
  reasons.push(
    `${activeDays}/7 ngày có đơn; GMV là ước tính nguồn, chưa phải lợi nhuận.`,
  );
  const eligible =
    current7 >= minWeeklyGmv &&
    growth !== null &&
    growth >= minGrowth &&
    last3 > prior4 &&
    risingDays >= 2 &&
    activeDays >= 5;
  const score = Math.round(
    Math.min(40, (current7 / Math.max(1, minWeeklyGmv)) * 20) +
      Math.min(35, (Math.max(0, growth || 0) / Math.max(1, minGrowth)) * 20) +
      (last3 > prior4 ? 15 : 0) +
      (activeDays / 7) * 10,
  );
  return {
    label: eligible ? "Ngon húp luôn" : "Theo dõi thêm",
    eligible,
    score: Math.min(100, score),
    growth,
    current7,
    previous7,
    units7,
    activeDays,
    reasons,
    thresholds: { minWeeklyGmv, minGrowth },
  };
}

export class ProductMarket {
  constructor(
    store,
    { clientFactory = (key) => new FastMossClient(key), now = Date.now } = {},
  ) {
    this.store = store;
    this.clientFactory = clientFactory;
    this.now = now;
    this.secrets = new SecretStore(store.root);
    this.running = new Map();
    this.controller = new AbortController();
    for (const scan of store.state.productScans)
      if (scan.status === "running")
        store.patch("productScans", scan.id, {
          status: "interrupted",
          error: "Quét bị gián đoạn khi đóng app.",
        });
  }
  connection() {
    return {
      provider: "FastMoss",
      configured: !!this.secrets.get("product-fastmoss")?.key,
      market: "TikTok Shop US",
      measurement: "estimated_gmv",
      docs: "https://developer.fastmoss.com/api/docs/guide/quickStart",
    };
  }
  configure(key) {
    this.secrets.set("product-fastmoss", {
      key: z.string().trim().min(10).max(2000).parse(key),
    });
    return this.connection();
  }
  start(input) {
    const request = marketScanSchema.parse(input);
    this.store.require("projects", request.projectId);
    const existing = this.store.state.productScans.find(
      (s) => s.request.requestId === request.requestId,
    );
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request))
        throw new StudioError(
          "Mã quét đã dùng với bộ lọc khác.",
          "REQUEST_CONFLICT",
          409,
        );
      return existing;
    }
    if (!this.connection().configured)
      throw new StudioError(
        "Chưa kết nối nguồn doanh thu. Nhập client_secret FastMoss tại AI Research để quét dữ liệu US.",
        "MARKET_SOURCE_REQUIRED",
        409,
      );
    if (this.running.size)
      throw new StudioError(
        "Đang có lần quét chạy. Chờ hoàn tất để tránh gọi API trùng.",
        "MARKET_SCAN_BUSY",
        409,
      );
    const scan = this.store.add("productScans", {
      projectId: request.projectId,
      request,
      status: "running",
      stage: "Tìm sản phẩm US",
      products: [],
      errors: [],
      source: "FastMoss",
      measurement: "estimated_gmv",
      market: "US",
      currency: "USD",
      apiCalls: 0,
    });
    const promise = this.scan(scan).finally(() => this.running.delete(scan.id));
    this.running.set(scan.id, promise);
    return scan;
  }
  async scan(scan) {
    const client = this.clientFactory(this.secrets.get("product-fastmoss").key),
      signal = this.controller.signal,
      request = scan.request;
    try {
      const result = await client.request(
        "/product/v1/search",
        {
          keywords: request.keywords,
          filter: { region: "US", off_shelves: 0 },
          orderby: [{ field: "day7_gmv", order: "desc" }],
          page: 1,
          pagesize: request.limit,
        },
        { signal },
      );
      const shops = new Map();
      for (const row of (result.list || []).slice(0, request.limit)) {
        signal.throwIfAborted();
        if (row.region !== "US") {
          scan.errors.push("Đã bỏ một kết quả không xác nhận thị trường US.");
          continue;
        }
        const id = String(row.product_id || "");
        if (!/^\d{5,30}$/.test(id)) {
          scan.errors.push("Bỏ kết quả có product ID không hợp lệ.");
          continue;
        }
        this.store.patch("productScans", scan.id, {
          stage: `Đọc doanh thu: ${String(row.title || id).slice(0, 80)}`,
          apiCalls: client.calls,
        });
        try {
          const trend = normalizeSalesTrend(
            await client.request(
              "/product/v1/salesTrend",
              { filter: { product_id: id, days: 28 } },
              { signal },
            ),
            { now: this.now() },
          );
          const product = {
            id,
            name: String(row.title || id).slice(0, 500),
            imageUrl: safeLink(row.cover),
            url: safeLink(row.tiktok_url),
            sourceUrl:
              safeLink(row.fastmoss_url) ||
              `https://www.fastmoss.com/e-commerce/detail/${id}`,
            price: number(row.floor_price),
            priceText: String(row.price || ""),
            sellerId: String(row.shop?.seller_id || ""),
            sellerName: String(row.shop?.name || "Chưa rõ shop"),
            trend,
            recommendation: scoreProductTrend(trend, {
              ...request,
              now: this.now(),
            }),
            videos: [],
            shopRevenue7: null,
            management: "new",
          };
          if (request.autoShortlist && product.recommendation.eligible)
            product.management = "shortlisted";
          if (product.sellerId && !shops.has(product.sellerId))
            try {
              const detail = await client.request(
                "/shop/v1/search",
                {
                  filter: { region: "US", seller_id: product.sellerId },
                  page: 1,
                  pagesize: 10,
                },
                { signal },
              );
              const shop = detail.list?.find(
                (s) =>
                  String(s.seller_id) === product.sellerId && s.region === "US",
              );
              shops.set(
                product.sellerId,
                shop
                  ? {
                      revenue: number(shop.day7_total_gmv),
                      units: number(shop.day7_units_sold),
                      checkedAt: new Date(this.now()).toISOString(),
                    }
                  : null,
              );
            } catch (e) {
              scan.errors.push(
                `Không đọc được toàn shop ${product.sellerName}: ${e.message}`,
              );
              shops.set(product.sellerId, null);
            }
          product.shopRevenue7 = shops.get(product.sellerId) || null;
          try {
            const videos = await client.request(
              "/product/v1/videoList",
              {
                filter: { product_id: id, days: 28 },
                orderby: { field: "gmv", order: "desc" },
                page: 1,
                pagesize: 3,
              },
              { signal },
            );
            product.videos = (videos.list || [])
              .filter((v) => v.region === "US")
              .slice(0, 3)
              .map((v) => ({
                id: String(v.video_id),
                url: safeLink(v.video?.tiktok_url),
                sourceUrl: safeLink(v.video?.fastmoss_url),
                title: String(v.video?.video_desc || "").slice(0, 500),
                views: number(v.play_count),
                units: number(v.units_sold),
                gmv: number(v.gmv),
                duration: number(v.video?.duration),
                measurement: "estimated_gmv",
              }));
          } catch (e) {
            scan.errors.push(`Không đọc được video liên quan: ${e.message}`);
          }
          this.store.patch("productScans", scan.id, {
            products: [...scan.products, product],
            errors: [...scan.errors],
            apiCalls: client.calls,
          });
        } catch (e) {
          if (signal.aborted) throw e;
          this.store.patch("productScans", scan.id, {
            errors: [...scan.errors, `${id}: ${e.message}`],
            apiCalls: client.calls,
          });
        }
      }
      this.store.patch("productScans", scan.id, {
        status: scan.products.length ? "completed" : "failed",
        stage: scan.products.length
          ? "Quét hoàn tất"
          : "Không có chuỗi doanh thu hợp lệ",
        finishedAt: new Date(this.now()).toISOString(),
        apiCalls: client.calls,
        error: scan.products.length
          ? null
          : "Không lấy được dữ liệu US/USD đủ để hiển thị. Xem lỗi nguồn.",
      });
    } catch (e) {
      this.store.patch("productScans", scan.id, {
        status: signal.aborted ? "interrupted" : "failed",
        stage: "Quét chưa hoàn tất",
        error: e.message,
        apiCalls: client.calls,
      });
    }
  }
  manage(scanId, productId, status) {
    const scan = this.store.require("productScans", scanId);
    if (!["new", "shortlisted", "producing", "dismissed"].includes(status))
      throw new StudioError("Trạng thái không hợp lệ.");
    if (!scan.products.some((p) => p.id === productId))
      throw new StudioError("Không tìm thấy sản phẩm.");
    return this.store.patch("productScans", scanId, {
      products: scan.products.map((p) =>
        p.id === productId ? { ...p, management: status } : p,
      ),
    });
  }
  async prepare(scanId, productId) {
    const scan = this.store.require("productScans", scanId),
      product = scan.products.find((p) => p.id === productId);
    if (!product) throw new StudioError("Không tìm thấy sản phẩm.");
    let media = this.store.state.media.find(
      (m) => m.projectId === scan.projectId && m.marketProductId === productId,
    );
    if (!media) {
      if (!product.imageUrl)
        throw new StudioError(
          "Nguồn không có ảnh sản phẩm; tải ảnh trong Product Studio.",
          "PRODUCT_IMAGE_REQUIRED",
        );
      const r = await fetchProductResource(product.imageUrl, {
        signal: this.controller.signal,
        accept: "image/*",
        maxBytes: 12 * 1024 * 1024,
      });
      const ext = /png/i.test(r.type)
        ? ".png"
        : /webp/i.test(r.type)
          ? ".webp"
          : ".jpg";
      if (!/^image\/(?:jpeg|png|webp)/i.test(r.type))
        throw new StudioError("Nguồn ảnh không hợp lệ.");
      const file = path.join(this.store.root, "temp", `${randomUUID()}${ext}`);
      try {
        await fs.writeFile(file, r.bytes);
        media = await importMedia(this.store, file, {
          projectId: scan.projectId,
          name: `${product.name.slice(0, 120)}${ext}`,
          move: true,
          mediaType: "product",
        });
        this.store.patch("media", media.id, {
          marketProductId: productId,
          sourceUrl: product.imageUrl,
        });
      } finally {
        await fs.rm(file, { force: true }).catch(() => {});
      }
    }
    this.manage(scanId, productId, "shortlisted");
    return {
      imageMediaId: media.id,
      productUrl: product.url || "",
      notes: `Product listing: ${product.name}. Source: ${product.sourceUrl}. Do not infer product performance or claims from sales figures.`,
      name: product.name,
    };
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled(this.running.values());
  }
}

export function mountProductMarket(app, store, options) {
  const service = new ProductMarket(store, options);
  app.get("/api/product-market/connection", (_req, res) =>
    res.json(service.connection()),
  );
  app.post("/api/product-market/connection", (req, res) =>
    res.json(service.configure(req.body.key)),
  );
  app.post("/api/product-market/scans", (req, res) =>
    res.status(202).json(service.start(req.body)),
  );
  app.patch("/api/product-market/scans/:id/products/:productId", (req, res) =>
    res.json(
      service.manage(req.params.id, req.params.productId, req.body.status),
    ),
  );
  app.post(
    "/api/product-market/scans/:id/products/:productId/prepare",
    async (req, res) =>
      res.json(await service.prepare(req.params.id, req.params.productId)),
  );
  return service;
}
