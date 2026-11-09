import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { StudioError } from "../store.js";
import { SecretStore } from "../secret-store.js";
import { fetchProductResource, parseProductPage } from "../product-sources.js";
import { ResearchRepository } from "./repository.js";
import { rankEvidence, textValue } from "./evidence.js";
import { ResearchProviders, SOURCES, sourceLinks } from "./providers.js";
import { importGoogleCsv, manualReference } from "./imports.js";
import { aiVideoPlan, aiSearchQuery } from './ai-video.js';
import { researchStorage, clearResearchCache } from './storage.js';
import { ResearchPreview } from "./preview.js";

export const researchScanSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    mode: z.enum(["discover", "product"]).default("discover"),
    videoGoal: z.enum(["standard", "no-filming"]).default("standard"),
    aiVideoKeywords: z.string().trim().max(150).default(''),
    keywords: z.string().trim().max(150).default(""),
    productUrl: z.string().url().or(z.literal("")).default(""),
    sources: z
      .array(z.enum(SOURCES.map((s) => s.id)))
      .min(1)
      .max(SOURCES.length)
      .transform((v) => [...new Set(v)]),
    limit: z.number().int().min(1).max(20).default(10),
    minViews: z.number().int().min(0).max(1e9).default(10000),
    recentDays: z.number().int().min(7).max(365).default(90),
  })
  .refine(
    (v) => v.keywords.length >= 2 || (v.mode === "product" && v.productUrl),
    "Nhập từ khóa tiếng Anh hoặc link sản phẩm.",
  );

export class ProductResearch {
  constructor(
    store,
    {
      repository,
      providers,
      fetchResource = fetchProductResource,
      now = Date.now,
      schedule = true,
    } = {},
  ) {
    this.store = store;
    this.now = now;
    this.fetchResource = fetchResource;
    this.previews = new ResearchPreview(store.root, { fetchResource });
    this.repo = repository || new ResearchRepository(store.root, { now });
    this.repo.prune();
    this.secrets = new SecretStore(store.root);
    this.running = new Map();
    this.controllers = new Map();
    this.closed = false;
    this.providers =
      providers ||
      new ResearchProviders(this.repo, () => this.privateSettings(), {
        fetchResource,
      });
    for (const scan of this.repo.list("scan", null, 1000))
      if (scan.status === "running")
        this.repo.patch("scan", scan.id, {
          status: "interrupted",
          finishedAt: this.repo.timestamp(),
          message:
            "App đã đóng khi quét. Có thể tạo lần quét mới; không tự gọi lại API.",
        });
    if (schedule) {
      this.timer = setInterval(() => this.tick(), 60000);
      this.timer.unref?.();
    }
  }
  privateSettings() {
    return {
      dailyLimit: 20,
      monthlyLimit: 300,
      ...this.repo.get("settings", "sources"),
      key: this.secrets.get("product-research-serpapi")?.key || "",
    };
  }
  connection() {
    const { key, ...settings } = this.privateSettings();
    return {
      configured: !!key,
      dailyLimit: settings.dailyLimit,
      monthlyLimit: settings.monthlyLimit,
      usage: this.repo.usage("serpapi"),
      sources: SOURCES.map((s) => ({ ...s, ready: s.free || !!key })),
    };
  }
  configure(input) {
    const v = z
      .object({
        key: z.string().trim().max(512).optional(),
        removeKey: z.boolean().default(false),
        dailyLimit: z.number().int().min(0).max(1000),
        monthlyLimit: z.number().int().min(0).max(20000),
      })
      .parse(input);
    if (v.key) this.secrets.set("product-research-serpapi", { key: v.key });
    if (v.removeKey) this.secrets.delete("product-research-serpapi");
    this.repo.put("settings", {
      id: "sources",
      dailyLimit: v.dailyLimit,
      monthlyLimit: v.monthlyLimit,
    });
    return this.connection();
  }
  state(projectId) {
    this.store.require("projects", projectId);
    return {
      connection: this.connection(),
      scans: this.repo
        .list("scan", projectId, 40)
        .map(({ records, ...s }) => ({ ...s, count: records?.length || 0 })),
      watches: this.repo.list("watch", projectId),
    };
  }
  scan(id, projectId) {
    this.store.require("projects", projectId);
    const scan = this.repo.require("scan", id, projectId);
    return {...scan, records: scan.records.map(r => ({...r, aiVideo: aiVideoPlan(r)}))};
  }
  start(input) {
    const request = researchScanSchema.parse(input);
    this.store.require("projects", request.projectId);
    if (this.closed)
      throw new StudioError("Research đang đóng.", "RESEARCH_CLOSED", 409);
    const existing = this.repo.get("scan", request.requestId);
    if (existing) {
      if (JSON.stringify(researchScanSchema.parse(existing.request)) !== JSON.stringify(request))
        throw new StudioError(
          "Mã lần quét đã được dùng với cấu hình khác.",
          "RESEARCH_REQUEST_CONFLICT",
          409,
        );
      return existing;
    }
    if (this.running.size)
      throw new StudioError(
        "Đang có một lần quét Product. Chờ hoàn tất hoặc dừng trước khi quét tiếp.",
        "RESEARCH_BUSY",
        409,
      );
    this.repo.prune();
    const scan = this.repo.put("scan", {
      id: request.requestId,
      projectId: request.projectId,
      request,
      createdAt: this.repo.timestamp(),
      status: "running",
      records: [],
      sources: [],
      shortlist: [],
    });
    const controller = new AbortController();
    this.controllers.set(scan.id, controller);
    const task = Promise.resolve()
      .then(() => this.run(scan, controller.signal))
      .finally(() => {
        this.running.delete(scan.id);
        this.controllers.delete(scan.id);
      });
    this.running.set(scan.id, task);
    return scan;
  }
  async run(scan, signal) {
    const request = { ...scan.request },
      records = new Map(),
      sources = [];
    try {
      if (!request.keywords) {
        const page = await this.fetchResource(request.productUrl, {
          signal,
          maxBytes: 3 * 1024 * 1024,
        });
        const product = parseProductPage(page.bytes.toString(), page.url);
        request.keywords = textValue(product.name, 150);
        if (request.keywords.length < 2)
          throw new StudioError(
            "Không đọc được tên từ link. Nhập tên hoặc ngách tiếng Anh rồi quét lại.",
            "RESEARCH_PRODUCT_NAME",
          );
      }
      this.repo.patch("scan", scan.id, {
        query: request.keywords,
        links: sourceLinks(request.videoGoal === "no-filming" ? request.aiVideoKeywords || aiSearchQuery(request.keywords) : request.keywords),
      });
      for (const source of request.sources) {
        signal.throwIfAborted();
        this.repo.patch("scan", scan.id, {
          stage: SOURCES.find((s) => s.id === source).name,
        });
        try {
          const result = await this.providers.scan(source, request, signal);
          for (const record of result.records) {
            const history = this.repo.observe(record);
            records.set(record.id, {
              ...record,
              history,
              aiVideo: aiVideoPlan(record),
              assessment: rankEvidence(record, {
                history,
                ...request,
                now: this.now(),
              }),
            });
          }
          sources.push({
            id: source,
            status: result.partial
              ? "partial"
              : result.records.length
                ? "completed"
                : "empty",
            count: result.records.length,
            cached: !!result.cached,
            note: result.note || "",
            checkedAt: this.repo.timestamp(),
          });
        } catch (error) {
          if (signal.aborted) throw error;
          sources.push({
            id: source,
            status:
              error.code === "RESEARCH_KEY_REQUIRED" ? "needs_key" : "failed",
            count: 0,
            code: error.code || "SOURCE_ERROR",
            note:
              error instanceof StudioError
                ? error.message
                : "Nguồn chưa đọc được; thử mở link nguồn để đối chiếu.",
            checkedAt: this.repo.timestamp(),
          });
        }
        this.repo.patch("scan", scan.id, {
          records: [...records.values()],
          sources,
        });
      }
      const success = sources.some((s) =>
        ["completed", "empty", "partial"].includes(s.status),
      );
      this.repo.patch("scan", scan.id, {
        status: success
          ? sources.some((s) =>
              ["failed", "needs_key", "partial"].includes(s.status),
            )
            ? "partial"
            : "completed"
          : "failed",
        stage: "",
        finishedAt: this.repo.timestamp(),
        message: success
          ? null
          : "Chưa nguồn nào trả kết quả thành công. Kiểm tra kết nối nguồn.",
      });
    } catch (error) {
      this.repo.patch("scan", scan.id, {
        status: signal.aborted ? "cancelled" : "failed",
        records: [...records.values()],
        sources,
        stage: "",
        finishedAt: this.repo.timestamp(),
        message: signal.aborted
          ? "Đã dừng. Kết quả đọc được trước đó vẫn được lưu."
          : error instanceof StudioError
            ? error.message
            : "Không đọc được sản phẩm. Nhập từ khóa để tìm trực tiếp.",
      });
    }
  }
  cancel(id, projectId) {
    const scan = this.scan(id, projectId);
    this.controllers.get(id)?.abort();
    return scan;
  }
  shortlist(id, projectId, ids) {
    const scan = this.scan(id, projectId),
      selected = z.array(z.string()).max(20).parse(ids);
    if (selected.some((key) => !scan.records.some((r) => r.id === key)))
      throw new StudioError("Nguồn đã chọn không thuộc lần quét.");
    return this.repo.patch("scan", id, { shortlist: [...new Set(selected)] });
  }
  prepare(id, projectId, ids) {
    const scan = this.shortlist(id, projectId, ids),
      selected = scan.records.filter((r) => scan.shortlist.includes(r.id));
    if (!selected.length)
      throw new StudioError("Chọn ít nhất một nguồn tham khảo.");
    return {
      name: scan.query,
      productUrl:
        scan.request.mode === "product" ? scan.request.productUrl : "",
      imageMediaId: null,
      noFilming: scan.request.videoGoal === "no-filming",
      ...(scan.request.videoGoal === "no-filming" ? { style: aiVideoPlan(selected[0])?.style || "ai-showcase", styleNotes: selected.map(r=>aiVideoPlan(r)?.recipe).filter(Boolean).slice(0,3).join(" ").slice(0,1500) } : {}),
      notes: `Research for ${scan.query}. Use the selected source evidence as inspiration for original scenes. Search interest and running ads are NOT proof of sales. Verify the actual product from its supplied image/listing.`,
      inspirationUrls: selected
        .filter((r) => r.platform === "youtube")
        .slice(0, 3)
        .map((r) => r.url),
      researchEvidence: selected.slice(0, 12).map((r) => ({
        title: r.title,
        url: r.url,
        platform: r.platform,
        kind: r.kind,
        description: r.description.slice(0, 700),
        observedAt: r.observedAt,
        measurement: r.measurement,
        summary: [...(r.assessment?.reasons || []), ...((aiVideoPlan(r) && scan.request.videoGoal === "no-filming") ? [aiVideoPlan(r).label, aiVideoPlan(r).basis, aiVideoPlan(r).recipe, aiVideoPlan(r).limitation] : [])].join(" ").slice(0, 900),
      })),
      researchSource: { type: "multi-source", scanId: id },
    };
  }
  addReference(id, projectId, input) {
    const scan = this.scan(id, projectId);
    if (scan.status === "running")
      throw new StudioError(
        "Chờ quét xong trước khi thêm nguồn thủ công.",
        "RESEARCH_BUSY",
        409,
      );
    const value = z
      .union([
        z.object({
          type: z.literal("google_csv"),
          text: z.string().max(524288),
        }),
        z.object({
          type: z.literal("link"),
          url: z.string().url().max(2048),
          title: z.string().trim().min(1).max(250),
          description: z.string().max(700).default(""),
        }),
      ])
      .parse(input);
    const record =
      value.type === "google_csv"
        ? importGoogleCsv(value.text, this.now())
        : manualReference(value, this.now());
    const history = this.repo.observe(record),
      enriched = {
        ...record,
        history,
        assessment: rankEvidence(record, {
          history,
          ...scan.request,
          now: this.now(),
        }),
      };
    if (
      scan.records.length >= 150 &&
      !scan.records.some((r) => r.id === record.id)
    )
      throw new StudioError(
        "Mỗi lần quét lưu tối đa 150 nguồn. Tạo lần quét mới để thêm.",
      );
    return this.repo.patch("scan", id, {
      records: [...scan.records.filter((r) => r.id !== record.id), enriched],
    });
  }
  watch(input) {
    const { request, everyHours = 24 } = z
      .object({
        request: researchScanSchema,
        everyHours: z.number().int().min(6).max(168).default(24),
      })
      .parse(input);
    this.store.require("projects", request.projectId);
    return this.repo.put("watch", {
      projectId: request.projectId,
      request,
      everyHours,
      enabled: true,
      nextAt: new Date(this.now() + everyHours * 3600000).toISOString(),
      createdAt: this.repo.timestamp(),
    });
  }
  manageWatch(id, projectId, input) {
    const watch = this.repo.require("watch", id, projectId);
    this.store.require("projects", projectId);
    const value = z.object({ enabled: z.boolean() }).parse(input);
    return this.repo.patch("watch", id, {
      ...value,
      nextAt: value.enabled
        ? new Date(this.now() + watch.everyHours * 3600000).toISOString()
        : watch.nextAt,
    });
  }
  tick() {
    if (this.closed || this.running.size) return;
    const watch = this.repo
      .list("watch", null, 1000)
      .filter((w) => w.enabled && Date.parse(w.nextAt) <= this.now())
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt))[0];
    if (!watch) return;
    // Persist the next deadline before work. A restart never catches up every missed interval.
    this.repo.patch("watch", watch.id, {
      nextAt: new Date(this.now() + watch.everyHours * 3600000).toISOString(),
    });
    try {
      const scan = this.start({ ...watch.request, requestId: randomUUID() });
      this.repo.patch("watch", watch.id, {
        lastScanId: scan.id,
        lastAt: this.repo.timestamp(),
        error: null,
      });
    } catch (error) {
      this.repo.patch("watch", watch.id, {
        error: "Chưa bắt đầu được lịch. Kiểm tra dự án và cấu hình nguồn.",
      });
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.running.values());
    await this.previews.close();
    this.repo.close();
  }
}

export function mountProductResearch(app, store, options) {
  // News-only workspaces do not open a Product database or start its scheduler.
  // Existing Product workspaces resume their watches at startup.
  let instance;
  const get = () => (instance ||= new ProductResearch(store, options));
  if (
    fs.existsSync(path.join(store.root, "product-research", "research.sqlite"))
  )
    get();
  const service = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "close")
          return async () => {
            if (instance) await instance.close();
          };
        const value = get()[key];
        return typeof value === "function" ? value.bind(instance) : value;
      },
      set(_target, key, value) {
        get()[key] = value;
        return true;
      },
    },
  );
  const project = (req) =>
    z
      .string()
      .uuid()
      .parse(req.query.projectId || req.body?.projectId);
  app.get("/api/product-research", (req, res) =>
    res.json(service.state(project(req))),
  );
  app.get("/api/product-research/storage", (req,res)=>res.json(researchStorage(service,project(req))));
  app.post("/api/product-research/cache/clear", (req,res)=>res.json(clearResearchCache(service,project(req))));
  app.put("/api/product-research/connection", (req, res) =>
    res.json(service.configure(req.body)),
  );
  app.post("/api/product-research/scans", (req, res) =>
    res.status(202).json(service.start(req.body)),
  );
  app.get("/api/product-research/scans/:id", (req, res) =>
    res.json(service.scan(req.params.id, project(req))),
  );
  app.get(
    "/api/product-research/scans/:id/media/:recordId/:kind",
    async (req, res) => {
      const scan = service.scan(req.params.id, project(req)),
        record = scan.records.find((r) => r.id === req.params.recordId);
      if (!record)
        throw new StudioError(
          "Nguồn không thuộc dự án / lần quét này.",
          "PRODUCT_RESEARCH_NOT_FOUND",
          404,
        );
      const result = await service.previews.load(record, req.params.kind);
      res.setHeader("Content-Type", result.type);
      res.setHeader("Cache-Control", "private, max-age=1800");
      res.sendFile(result.file, { dotfiles: 'allow' });
    },
  );
  app.post("/api/product-research/scans/:id/cancel", (req, res) =>
    res.json(service.cancel(req.params.id, project(req))),
  );
  app.put("/api/product-research/scans/:id/shortlist", (req, res) =>
    res.json(service.shortlist(req.params.id, project(req), req.body.ids)),
  );
  app.post("/api/product-research/scans/:id/prepare", (req, res) =>
    res.json(service.prepare(req.params.id, project(req), req.body.ids)),
  );
  app.post("/api/product-research/scans/:id/references", (req, res) =>
    res.json(service.addReference(req.params.id, project(req), req.body)),
  );
  app.post("/api/product-research/watches", (req, res) =>
    res.status(201).json(service.watch(req.body)),
  );
  app.patch("/api/product-research/watches/:id", (req, res) =>
    res.json(service.manageWatch(req.params.id, project(req), req.body)),
  );
  return service;
}
