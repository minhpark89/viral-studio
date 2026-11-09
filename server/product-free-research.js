import { createHash } from "node:crypto";
import { z } from "zod";
import { StudioError } from "./store.js";
import { researchProductVideos } from "./product-sources.js";
import { productLlm } from "./product-model.js";

export const freeResearchSchema = z.object({
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
  keywords: z.string().trim().min(2).max(150),
  limit: z.number().int().min(1).max(20).default(10),
  minViews: z.number().int().min(0).max(1e9).default(10000),
  recentDays: z.number().int().min(7).max(365).default(90),
  useAi: z.boolean().default(true),
  autoShortlist: z.boolean().default(true),
});
const groupingSchema = z.object({
  ideas: z
    .array(
      z.object({
        name: z.string().min(1).max(180),
        category: z.string().max(120),
        opportunity: z.string().max(900),
        videoIndexes: z.array(z.number().int()).min(1).max(8),
      }),
    )
    .max(20),
});
export function scoreFreeIdea(
  videos,
  { minViews = 10000, recentDays = 90, now = Date.now() } = {},
) {
  const observed = videos.filter(
      (v) => Number.isFinite(v.views) && v.views >= 0,
    ),
    recent = observed.filter((v) => {
      const t = Date.parse(v.publishedAt);
      return t <= now && t >= now - recentDays * 86400000;
    }),
    strong = recent.filter((v) => v.views >= minViews),
    creators = new Set(strong.map((v) => v.channel?.trim()).filter(Boolean)),
    eligible = strong.length >= 2 && creators.size >= 2;
  const reasons = [
    `${observed.length}/${videos.length} video có số lượt xem đọc được.`,
    `${strong.length} video đăng trong ${recentDays} ngày có ít nhất ${minViews.toLocaleString("en-US")} lượt xem.`,
    `${creators.size} kênh độc lập trong nhóm video đạt ngưỡng.`,
    "Đây là tín hiệu nội dung để làm thử; chưa xác nhận doanh thu hoặc cơ cấu khán giả US.",
  ];
  return {
    eligible,
    label: eligible ? "Ngon húp luôn" : "Tham khảo thêm",
    score: Math.min(
      100,
      Math.round(
        Math.min(
          40,
          Math.log10(1 + observed.reduce((n, v) => n + v.views, 0)) * 6,
        ) +
          Math.min(30, strong.length * 10) +
          Math.min(30, creators.size * 10),
      ),
    ),
    totalViews: observed.reduce((n, v) => n + v.views, 0),
    recentCount: recent.length,
    creatorCount: creators.size,
    reasons,
    measurement: "public_video_signals",
  };
}
export function freeVideoHistory(scans, videoId) {
  const points = [];
  for (const scan of scans) {
    const v = scan.videos?.find((v) => v.id === videoId);
    if (Number.isFinite(v?.views) && v.views >= 0)
      points.push({ at: scan.finishedAt || scan.createdAt, views: v.views });
  }
  return points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export function observedViewGrowth(points) {
  if (points.length < 2) return null;
  const first = points[0],
    last = points.at(-1),
    days = (Date.parse(last.at) - Date.parse(first.at)) / 86400000;
  if (days < 1 || last.views < first.views) return null;
  return {
    from: first.at,
    to: last.at,
    delta: last.views - first.views,
    perDay: (last.views - first.views) / days,
    days,
  };
}

export class ProductFreeResearch {
  constructor(
    store,
    {
      research = researchProductVideos,
      model = productLlm,
      now = Date.now,
    } = {},
  ) {
    this.store = store;
    this.research = research;
    this.model = model;
    this.now = now;
    this.running = new Map();
    this.controller = new AbortController();
    for (const s of store.state.productFreeScans)
      if (s.status === "running")
        store.patch("productFreeScans", s.id, {
          status: "interrupted",
          error:
            "Quét bị gián đoạn khi đóng app. Bấm quét lại để đọc nguồn mới.",
        });
  }
  start(input) {
    const request = freeResearchSchema.parse(input);
    this.store.require("projects", request.projectId);
    const old = this.store.state.productFreeScans.find(
      (s) => s.request.requestId === request.requestId,
    );
    if (old) {
      if (JSON.stringify(old.request) !== JSON.stringify(request))
        throw new StudioError(
          "Mã quét đã được dùng với bộ lọc khác.",
          "REQUEST_CONFLICT",
          409,
        );
      return old;
    }
    if (this.running.size)
      throw new StudioError(
        "Đang quét nguồn miễn phí. Chờ lần hiện tại hoàn tất.",
        "FREE_RESEARCH_BUSY",
        409,
      );
    const scan = this.store.add("productFreeScans", {
      projectId: request.projectId,
      request,
      status: "running",
      stage: "Tìm video và ý tưởng sản phẩm",
      videos: [],
      ideas: [],
      warnings: [],
      targetMarket: "US",
      verifiedAudience: false,
      measurement: "public_video_signals",
    });
    const promise = this.scan(scan).finally(() => this.running.delete(scan.id));
    this.running.set(scan.id, promise);
    return scan;
  }
  async scan(scan) {
    const signal = this.controller.signal,
      r = scan.request;
    try {
      const found = await this.research(r.keywords, {
        signal,
        limit: r.limit,
        stage: (stage) =>
          this.store.patch("productFreeScans", scan.id, { stage }),
        searchQueries: [
          `${r.keywords} USA product review shorts`,
          `${r.keywords} US tiktok made me buy it`,
          `${r.keywords} Amazon.com product demonstration`,
        ],
      });
      const videos = found.videos.map(
        ({ storyboardSpec, transcript, ...v }) => ({
          ...v,
          captionAvailable: !!transcript?.length,
        }),
      );
      const warnings = [...found.warnings];
      if (!videos.length)
        throw new StudioError(
          "Chưa đọc được video từ nguồn công khai. Thử lại hoặc nhập từ khóa cụ thể hơn; không cần FastMoss key.",
          "FREE_SOURCE_EMPTY",
        );
      let groups = videos.map((v, i) => ({
          name: v.title,
          category: r.keywords,
          opportunity:
            "Ý tưởng lấy từ tiêu đề video. Cần đối chiếu sản phẩm thực tế trước khi làm.",
          videoIndexes: [i],
        })),
        model = null;
      if (r.useAi && this.store.state.settings.llm?.enabled) {
        try {
          this.store.patch("productFreeScans", scan.id, {
            stage: "AI đang nhóm sản phẩm từ nguồn đã đọc",
          });
          const selected = await this.model(this.store, {}, { signal });
          model = selected.model;
          const response = groupingSchema.parse(
            await selected.llm(
              "Group these observed public videos into actionable consumer PRODUCT IDEAS for a US-targeted store. Return {ideas:[{name,category,opportunity,videoIndexes:[]}]}. Use only exact numeric indexes supplied. Group similar products to compare examples; avoid merging unrelated categories. Product identity is inferred from source text, not a verified SKU. Explain evidence-based creative opportunities in Vietnamese. Do not invent product pages, sales, US audience composition, testimonials or factual product capabilities. Views alone do not prove sales. Exclude unrelated science experiments or manufacturing videos.",
              {
                keywords: r.keywords,
                videos: videos.map((v, index) => ({
                  index,
                  title: v.title,
                  channel: v.channel,
                  views: v.views,
                  publishedAt: v.publishedAt,
                  description: v.description?.slice(0, 1000),
                })),
              },
              { signal, maxTokens: 2400, timeoutSeconds: 180, language: "vi" },
            ),
          );
          if (response.ideas.length) groups = response.ideas;
        } catch (e) {
          signal.throwIfAborted();
          warnings.push(
            `AI chưa nhóm được ý tưởng: ${e.message}. Vẫn hiển thị video nguồn để bạn chọn.`,
          );
        }
      } else if (r.useAi)
        warnings.push(
          "Chưa bật LLM: đang hiển thị ý tưởng theo từng video, vẫn quét nguồn miễn phí được.",
        );
      const ideas = groups.flatMap((g) => {
        const indexes = [...new Set(g.videoIndexes)].filter(
          (i) => i >= 0 && i < videos.length,
        );
        if (!indexes.length) return [];
        const references = indexes.map((i) => videos[i]),
          recommendation = scoreFreeIdea(references, { ...r, now: this.now() });
        return [
          {
            id: createHash("sha256")
              .update(
                g.name.toLowerCase() +
                  "|" +
                  indexes
                    .map((i) => videos[i].id)
                    .sort()
                    .join(","),
              )
              .digest("hex")
              .slice(0, 24),
            name: g.name,
            category: g.category,
            opportunity: g.opportunity,
            videoIds: references.map((v) => v.id),
            recommendation,
            management:
              r.autoShortlist && recommendation.eligible
                ? "shortlisted"
                : "new",
            identity: "inferred_from_video_sources",
          },
        ];
      });
      if (!ideas.length)
        throw new StudioError(
          "Các lựa chọn AI không khớp nguồn. Thử lại với tùy chọn AI tắt.",
          "FREE_IDEAS_INVALID",
        );
      this.store.patch("productFreeScans", scan.id, {
        status: "completed",
        stage: `Đã tìm ${ideas.length} ý tưởng từ ${videos.length} video`,
        videos,
        ideas,
        warnings,
        model,
        searches: found.searches,
        finishedAt: new Date(this.now()).toISOString(),
        error: null,
      });
    } catch (e) {
      this.store.patch("productFreeScans", scan.id, {
        status: signal.aborted ? "interrupted" : "failed",
        stage: "Quét chưa hoàn tất",
        error: e.message,
        finishedAt: new Date(this.now()).toISOString(),
      });
    }
  }
  manage(id, ideaId, status) {
    const scan = this.store.require("productFreeScans", id);
    if (!["new", "shortlisted", "producing", "dismissed"].includes(status))
      throw new StudioError("Trạng thái không hợp lệ.");
    if (!scan.ideas.some((p) => p.id === ideaId))
      throw new StudioError("Không tìm thấy ý tưởng.");
    return this.store.patch("productFreeScans", id, {
      ideas: scan.ideas.map((p) =>
        p.id === ideaId ? { ...p, management: status } : p,
      ),
    });
  }
  prepare(id, ideaId) {
    const scan = this.store.require("productFreeScans", id),
      idea = scan.ideas.find((p) => p.id === ideaId);
    if (!idea) throw new StudioError("Không tìm thấy ý tưởng.");
    this.manage(id, ideaId, "shortlisted");
    return {
      name: idea.name,
      notes: `Product idea to verify: ${idea.name}. ${idea.opportunity} Do not infer sales or product claims from video popularity.`,
      inspirationUrls: scan.videos
        .filter((v) => idea.videoIds.includes(v.id))
        .slice(0, 3)
        .map((v) => v.url),
      researchSource: { type: "free", scanId: id, ideaId },
      productUrl: "",
      imageMediaId: null,
    };
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled(this.running.values());
  }
}
export function mountProductFreeResearch(app, store, options) {
  const service = new ProductFreeResearch(store, options);
  app.post("/api/product-free-research/scans", (req, res) =>
    res.status(202).json(service.start(req.body)),
  );
  app.patch("/api/product-free-research/scans/:id/ideas/:ideaId", (req, res) =>
    res.json(service.manage(req.params.id, req.params.ideaId, req.body.status)),
  );
  app.post(
    "/api/product-free-research/scans/:id/ideas/:ideaId/prepare",
    (req, res) => res.json(service.prepare(req.params.id, req.params.ideaId)),
  );
  return service;
}
