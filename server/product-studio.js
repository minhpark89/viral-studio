import { productStudioRequest } from "../shared/product-contracts.js";
import { validateProductReference } from "./product-reference.js";
import { StudioError } from "./store.js";
import { buildProductStudy } from "./product-intelligence.js";
import {checkProductOutput,resolveProductOutput} from './product-output.js';

export { productStudioRequest } from "../shared/product-contracts.js";

export class ProductStudio {
  constructor(store, queue, { study = buildProductStudy } = {}) {
    this.store = store;
    this.queue = queue;
    this.study = study;
    this.pending = [];
    this.worker = null;
    this.controller = new AbortController();
    this.syncing = false;
    this.closed = false;
    this.researchControllers = new Map();
    for (const run of store.state.productRuns) {
      if (["queued-research", "researching"].includes(run.status)) {
        if (
          run.campaignId &&
          !store.state.jobs.some((j) => j.production?.productRunId === run.id)
        ) {
          store.patch("productRuns", run.id, {
            status: "queued-research",
            stage: "Tiếp tục nghiên cứu sau khi mở lại app",
            error: null,
          });
          this.pending.push(run.id);
          continue;
        }
        store.patch("productRuns", run.id, {
          status: "interrupted",
          stage: "Nghiên cứu bị gián đoạn; thử lại để tiếp tục.",
          error: "App đã đóng khi nghiên cứu.",
        });
      }
    }
    this.listener = () => {
      if (!this.syncing && !this.closed) this.sync();
    };
    store.on("change", this.listener);
    this.sync();
    if (this.pending.length) this.drain();
  }
  validate(input) {
    const request = productStudioRequest.parse(input);
    this.store.require("projects", request.projectId);
    if (request.imageMediaId) {
      const m = this.store.require("media", request.imageMediaId);
      if (m.kind !== "image" || m.projectId !== request.projectId)
        throw new StudioError(
          "Ảnh sản phẩm không thuộc dự án.",
          "INVALID_REFERENCE",
        );
    }
    if (
      request.accountId !== "auto" &&
      this.store.require("accounts", request.accountId).provider !== "dreamface"
    )
      throw new StudioError("Chọn profile DreamFace.", "INVALID_ACCOUNT");
    validateProductReference(
      this.store,
      request.sampleVideoMediaId,
      request.projectId,
    );
    resolveProductOutput(this.store,request.outputDirectory);
    return request;
  }
  create(input, context = {}) {
    const request = this.validate(input);
    const prior = this.store.state.productRuns.find(
      (r) => r.request.requestId === request.requestId,
    );
    if (prior) {
      if (JSON.stringify(productStudioRequest.parse(prior.request)) !== JSON.stringify(request))
        throw new StudioError(
          "Yêu cầu đã được dùng với tùy chọn khác.",
          "REQUEST_CONFLICT",
          409,
        );
      return prior;
    }
    const run = this.store.add("productRuns", {
      projectId: request.projectId,
      request,
      campaignId: context.campaignId || null,
      productBatchId: context.batchId || null,
      sourceRunId: context.sourceRunId || null,
      sequence: context.sequence || 0,
      outputDirectory:checkProductOutput(this.store,context.outputDirectory||request.outputDirectory),
      status: "queued-research",
      stage: "Chờ nghiên cứu sản phẩm",
      study: null,
      sceneJobIds: [],
      renderJobId: null,
      mediaId: null,
      error: null,
    });
    this.pending.push(run.id);
    this.drain();
    return run;
  }
  drain() {
    if (this.worker || this.closed) return;
    this.worker = (async () => {
      while (this.pending.length && !this.closed) {
        const id = this.pending.shift(),
          run = this.store.require("productRuns", id);
        if (run.status !== "queued-research") continue;
        const controller = new AbortController();
        this.researchControllers.set(id, controller);
        try {
          this.store.patch("productRuns", id, {
            status: "researching",
            error: null,
          });
          const source = run.sourceRunId
            ? this.store.require("productRuns", run.sourceRunId)
            : null;
          if (source && !source.study)
            throw new StudioError(
              "Nghiên cứu gốc chưa hoàn tất. Thử lại đợt sau khi xử lý video đầu tiên.",
              "PRODUCT_BASE_STUDY_FAILED",
            );
          const previous = this.store.state.productRuns
            .filter(
              (r) =>
                r.id !== id &&
                r.campaignId === run.campaignId &&
                r.study &&
                run.campaignId,
            )
            .slice(-30);
          const study = await this.study(this.store, run.request, {
            signal: AbortSignal.any([
              this.controller.signal,
              controller.signal,
            ]),
            baselineStudy: source?.study,
            creativeContext: {
              sequence: run.sequence,
              variationKey: run.id,
              previousConcepts: previous.map((r) => r.study.analysis.concept),
              previousScripts: previous.map((r) =>
                r.study.analysis.scenes
                  .map((s) =>
                    s.prompt.replace(/\s+/g, " ").trim().toLowerCase(),
                  )
                  .join("|"),
              ),
            },
            stage: (stage) => {
              if (!this.closed) this.store.patch("productRuns", id, { stage });
            },
          });
          if (this.closed) break;
          controller.signal.throwIfAborted();
          this.store.patch("productRuns", id, {
            study,
            status: "ready",
            stage: "Nghiên cứu và kịch bản đã sẵn sàng",
          });
          if (run.request.autoRender) this.render(id);
        } catch (e) {
          if (!this.closed)
            this.store.patch("productRuns", id, {
              status: controller.signal.aborted ? "cancelled" : "failed",
              stage: controller.signal.aborted
                ? "Đã dừng nghiên cứu"
                : "Không hoàn tất nghiên cứu",
              error: e.message,
              errorCode: e.code || "PRODUCT_RESEARCH_FAILED",
            });
        } finally {
          this.researchControllers.delete(id);
        }
      }
    })().finally(() => {
      this.worker = null;
      if (this.pending.length && !this.closed) this.drain();
    });
  }
  render(id) {
    const run = this.store.require("productRuns", id);
    if (!run.study)
      throw new StudioError(
        "Chờ nghiên cứu hoàn tất.",
        "PRODUCT_STUDY_REQUIRED",
      );
    const existing = this.store.state.jobs.filter(
      (j) => j.production?.productRunId === id,
    );
    if (existing.length) {
      this.sync();
      return run;
    }
    const req = run.request,
      study = run.study;
    const jobs = this.queue.enqueueGeneration(
      {
        projectId: run.projectId,
        provider: "dreamface",
        accountId: req.accountId,
        workflow: "product-video",
        productOptions: {
          billingMode: req.billingMode,
          resolution: req.resolution,
          maxCredits: req.maxCredits,
        },
        kind: "video",
        mode: "reference",
        model: "DreamFace video",
        duration: req.billingMode === "free" ? 5 : req.duration,
        ratio: req.ratio,
        prompts: study.analysis.scenes.map((s) => s.prompt),
        references: [study.imageMediaId],
        autoAssemble: true,
      },
      {
        production: {
          contentType: "product",
          productRunId: id,
          productCampaignId: run.campaignId,
          productBatchId: run.productBatchId,
          productOutputDirectory: run.outputDirectory || checkProductOutput(this.store,run.request.outputDirectory||''),
          title: `${study.product.name}${run.campaignId ? ` · Video ${run.sequence + 1}` : ""}`,
          productBrief: study.product.visibleFeatures.join(". "),
          productUrl: req.productUrl,
          autoCreateContent: false,
          productCaptions: study.analysis.scenes.map((s) => s.caption),
          cta: study.analysis.cta,
        },
      },
    );
    this.store.patch("productRuns", id, {
      sceneJobIds: jobs.map((j) => j.id),
      status: "queued",
      stage: `Đã xếp ${jobs.length} cảnh Product`,
      error: null,
    });
    this.queue.tick();
    return run;
  }
  retry(id) {
    const run = this.store.require("productRuns", id);
    if (run.sceneJobIds.length) {
      for (const job of this.queue.batchEntries(
        this.store.require("jobs", run.sceneJobIds[0]).batchId,
      )) {
        if (["failed", "interrupted", "cancelled"].includes(job.status)) {
          if (job.payload.productRequest?.id)
            this.queue.recoverSubmitted(job.id);
          else if (!job.submittedAt) this.queue.retry(job.id, false);
          else
            throw new StudioError(
              "Có cảnh đã gửi nhưng chưa rõ mã tác vụ. Kiểm tra Creations trong Queue.",
              "PRODUCT_SUBMISSION_UNCONFIRMED",
              409,
            );
        }
      }
      const render = this.store.state.jobs.findLast(
        (j) => j.production?.productRunId === id && j.type === "render",
      );
      if (
        render &&
        ["failed", "interrupted", "cancelled"].includes(render.status)
      )
        this.queue.retry(render.id, false);
      this.sync();
      this.queue.tick();
      return run;
    }
    if (!["failed", "interrupted", "ready", "cancelled"].includes(run.status))
      throw new StudioError(
        "Nghiên cứu đang chạy.",
        "PRODUCT_RESEARCH_BUSY",
        409,
      );
    this.store.patch("productRuns", id, {
      status: "queued-research",
      stage: "Chờ thử lại",
      error: null,
    });
    this.pending.push(id);
    this.drain();
    return run;
  }
  sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      for (const run of this.store.state.productRuns) {
        const jobs = this.store.state.jobs.filter(
          (j) => j.production?.productRunId === run.id,
        );
        if (!jobs.length) continue;
        const render = jobs.findLast((j) => j.type === "render");
        const first = jobs.find((j) => j.type === "generate");
        const scenes = first ? this.queue.batchEntries(first.batchId) : [];
        const failed = scenes.find((j) =>
          ["failed", "interrupted", "cancelled"].includes(j.status),
        );
        let patch;
        if (render) {
          patch = {
            status: render.status,
            stage: render.stage || "Chờ ghép video Product",
            renderJobId: render.id,
            mediaId: render.mediaId,
            error: render.error,
            progress: render.progress,
          };
        } else if (failed)
          patch = {
            status: failed.status === "cancelled" ? "cancelled" : "failed",
            stage: "Có cảnh Product chưa hoàn tất",
            error: failed.error,
            progress: 0,
          };
        else {
          const active = scenes.find(
            (j) => !["queued", "completed"].includes(j.status),
          );
          patch = {
            status: active ? "rendering" : "queued",
            stage:
              active?.stage ||
              scenes.find((j) => j.stage)?.stage ||
              "Chờ profile còn lượt Product",
            progress: Math.round(
              scenes.reduce((sum, j) => sum + (j.progress || 0), 0) /
                Math.max(1, scenes.length),
            ),
            error: null,
          };
        }
        patch.sceneJobIds = scenes.map((j) => j.id);
        if (
          Object.entries(patch).some(
            ([k, v]) => JSON.stringify(run[k]) !== JSON.stringify(v),
          )
        )
          this.store.patch("productRuns", run.id, patch);
      }
    } finally {
      this.syncing = false;
    }
  }
  cancel(id) {
    const run = this.store.require("productRuns", id);
    this.pending = this.pending.filter((value) => value !== id);
    this.researchControllers.get(id)?.abort();
    for (const job of this.store.state.jobs.filter(
      (j) =>
        j.production?.productRunId === id &&
        [
          "queued",
          "scheduled",
          "preparing",
          "submitting",
          "rendering",
          "downloading",
        ].includes(j.status),
    ))
      this.queue.cancel(job.id);
    if (!run.sceneJobIds.length)
      this.store.patch("productRuns", id, {
        status: "cancelled",
        stage: "Đã dừng Product",
        error: null,
      });
    return run;
  }
  async close() {
    this.closed = true;
    this.pending = [];
    this.controller.abort();
    this.store.off("change", this.listener);
    await this.worker;
  }
}

export function mountProductStudio(app, store, queue, options) {
  const service = new ProductStudio(store, queue, options);
  app.post("/api/product-studio", (req, res) =>
    res.status(202).json(service.create(req.body)),
  );
  app.post("/api/product-studio/:id/render", (req, res) =>
    res.status(202).json(service.render(req.params.id)),
  );
  app.post("/api/product-studio/:id/retry", (req, res) =>
    res.status(202).json(service.retry(req.params.id)),
  );
  app.post("/api/product-studio/:id/cancel", (req, res) =>
    res.json(service.cancel(req.params.id)),
  );
  return service;
}
