import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioError } from "./store.js";
import { productCampaignSchema } from "../shared/product-contracts.js";
import {checkProductOutput} from './product-output.js';

const terminal = new Set(["completed", "failed", "cancelled"]);
export function campaignLocalClock(now, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
export function campaignRunKey(batchId, index) {
  const bytes = createHash("sha256")
    .update(`${batchId}:${index}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function campaignBatchSummary(store, batch) {
  const runs = store.state.productRuns.filter(
    (r) => r.productBatchId === batch.id,
  );
  const counts = {
    total: batch.quantity,
    completed: 0,
    failed: 0,
    cancelled: 0,
    ready: 0,
    pending: 0,
  };
  for (const run of runs) {
    if (run.status in counts) counts[run.status]++;
    else counts.pending++;
  }
  counts.pending += Math.max(0, batch.quantity - runs.length);
  return counts;
}

export class ProductCampaigns {
  constructor(store, studio, { now = Date.now, intervalMs = 15000 } = {}) {
    this.store = store;
    this.studio = studio;
    this.now = now;
    this.closed = false;
    this.ticking = false;
    this.timer = intervalMs ? setInterval(() => this.tick(), intervalMs) : null;
    this.timer?.unref();
    this.tick();
  }
  create(input) {
    const parsed = productCampaignSchema.parse(input);
    this.studio.validate(parsed.request);
    const prior = this.store.state.productCampaigns.find(
      (c) => c.request.requestId === parsed.request.requestId,
    );
    if (prior) {
      if (JSON.stringify(productCampaignSchema.parse(prior.initial)) !== JSON.stringify(parsed))
        throw new StudioError(
          "Mã yêu cầu đã dùng với cấu hình khác.",
          "REQUEST_CONFLICT",
          409,
        );
      return {
        campaign: prior,
        batch:
          this.store.state.productBatches.find(
            (b) => b.campaignId === prior.id,
          ) || null,
      };
    }
    checkProductOutput(this.store,parsed.request.outputDirectory);
    const local = campaignLocalClock(this.now(), parsed.schedule.timezone);
    const campaign = this.store.add("productCampaigns", {
      projectId: parsed.request.projectId,
      initial: parsed,
      request: parsed.request,
      quantity: parsed.quantity,
      schedule: parsed.schedule,
      sequence: 0,
      lastScheduledDate:
        parsed.startNow && parsed.schedule.enabled ? local.date : null,
      lastBatchId: null,
      stage: "Sẵn sàng",
      error: null,
    });
    const batch = parsed.startNow
      ? this.startBatch(campaign, {
          key: "initial",
          trigger: "manual",
          date: local.date,
        })
      : null;
    return { campaign, batch };
  }
  startBatch(campaign, { key = randomUUID(), trigger = "manual", date } = {}) {
    const prior = this.store.state.productBatches.find(
      (b) => b.campaignId === campaign.id && b.key === key,
    );
    if (prior) {
      this.ensureRuns(prior);
      return prior;
    }
    const active = this.store.state.productBatches.find(
      (b) =>
        b.campaignId === campaign.id &&
        !b.cancelled &&
        this.batchOutstanding(b),
    );
    if (active)
      throw new StudioError(
        "Đợt trước còn video đang nghiên cứu, chờ duyệt hoặc chờ render. Hoàn tất hoặc dừng đợt đó trước.",
        "PRODUCT_BATCH_BUSY",
        409,
      );
    this.studio.validate(campaign.request);
    const outputDirectory=checkProductOutput(this.store,campaign.request.outputDirectory||'');
    const batch = this.store.add("productBatches", {
      projectId: campaign.projectId,
      campaignId: campaign.id,
      key,
      trigger,
      date:
        date || campaignLocalClock(this.now(), campaign.schedule.timezone).date,
      quantity: campaign.quantity,
      request: structuredClone(campaign.request),
      outputDirectory,
      sequenceStart: campaign.sequence,
      runIds: [],
      status: "creating",
      cancelled: false,
    });
    this.store.patch("productCampaigns", campaign.id, {
      sequence: campaign.sequence + batch.quantity,
      lastBatchId: batch.id,
      stage: `Đang tạo ${batch.quantity} video`,
      error: null,
    });
    this.ensureRuns(batch);
    return batch;
  }
  ensureRuns(batch) {
    if (batch.cancelled || batch.status !== "creating") return;
    // Repair the reservation if the app stopped between the two durable writes.
    const campaign = this.store.require("productCampaigns", batch.campaignId);
    if (
      campaign.sequence < batch.sequenceStart + batch.quantity ||
      campaign.lastBatchId !== batch.id
    )
      this.store.patch("productCampaigns", campaign.id, {
        sequence: Math.max(
          campaign.sequence,
          batch.sequenceStart + batch.quantity,
        ),
        lastBatchId: batch.id,
      });
    let first = null;
    const ids = [];
    for (let index = 0; index < batch.quantity; index++) {
      const request = {
        ...batch.request,
        requestId: campaignRunKey(batch.id, index),
      };
      const run = this.studio.create(request, {
        campaignId: batch.campaignId,
        batchId: batch.id,
        sourceRunId: index ? first : null,
        sequence: batch.sequenceStart + index,
        outputDirectory:batch.outputDirectory,
      });
      first ||= run.id;
      ids.push(run.id);
    }
    this.store.patch("productBatches", batch.id, {
      runIds: ids,
      status: "created",
    });
  }
  batchOutstanding(batch) {
    const runs = this.store.state.productRuns.filter(
      (r) => r.productBatchId === batch.id,
    );
    return (
      runs.length < batch.quantity || runs.some((r) => !terminal.has(r.status))
    );
  }
  update(id, input) {
    const campaign = this.store.require("productCampaigns", id);
    const patch = z
      .object({
        quantity: z.number().int().min(1).max(100).optional(),
        schedule: z
          .object({
            enabled: z.boolean().optional(),
            time: z.string().optional(),
            timezone: z.string().optional(),
          })
          .optional(),
        request: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .parse(input);
    const parsed = productCampaignSchema.parse({
      request: {
        ...campaign.request,
        ...patch.request,
        projectId: campaign.projectId,
        requestId: campaign.request.requestId,
      },
      quantity: patch.quantity ?? campaign.quantity,
      schedule: { ...campaign.schedule, ...patch.schedule },
      startNow: false,
    });
    this.studio.validate(parsed.request);
    checkProductOutput(this.store,parsed.request.outputDirectory);
    return this.store.patch("productCampaigns", id, {
      request: parsed.request,
      quantity: parsed.quantity,
      schedule: parsed.schedule,
      error: null,
      stage: parsed.schedule.enabled
        ? "Đã lưu lịch hằng ngày"
        : "Lịch hằng ngày đang tắt",
    });
  }
  run(id, input) {
    const request = z.object({ requestId: z.string().uuid() }).parse(input);
    return this.startBatch(this.store.require("productCampaigns", id), {
      key: request.requestId,
    });
  }
  renderBatch(id) {
    const batch = this.store.require("productBatches", id);
    for (const run of this.store.state.productRuns.filter(
      (r) => r.productBatchId === id && r.status === "ready",
    ))
      this.studio.render(run.id);
    return batch;
  }
  retryBatch(id) {
    const batch = this.store.require("productBatches", id);
    if (batch.cancelled)
      this.store.patch("productBatches", id, { cancelled: false });
    for (const run of this.store.state.productRuns.filter(
      (r) =>
        r.productBatchId === id &&
        ["failed", "interrupted", "cancelled"].includes(r.status),
    ))
      this.studio.retry(run.id);
    return batch;
  }
  cancelBatch(id) {
    const batch = this.store.require("productBatches", id);
    this.store.patch("productBatches", id, {
      cancelled: true,
      status: "cancelled",
    });
    for (const run of this.store.state.productRuns.filter(
      (r) => r.productBatchId === id && !terminal.has(r.status),
    ))
      this.studio.cancel(run.id);
    return batch;
  }
  tick() {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      for (const batch of this.store.state.productBatches.filter(
        (b) => b.status === "creating",
      ))
        try {
          this.ensureRuns(batch);
        } catch (e) {
          this.store.patch("productBatches", batch.id, { error: e.message });
        }
      for (const campaign of this.store.state.productCampaigns) {
        if (!campaign.schedule.enabled) continue;
        const local = campaignLocalClock(
          this.now(),
          campaign.schedule.timezone,
        );
        if (
          local.time < campaign.schedule.time ||
          campaign.lastScheduledDate === local.date
        )
          continue;
        try {
          const prior = this.store.state.productBatches.find(
            (b) =>
              b.campaignId === campaign.id && b.key === `daily:${local.date}`,
          );
          if (prior) {
            this.ensureRuns(prior);
            this.store.patch("productCampaigns", campaign.id, {
              lastScheduledDate: local.date,
              lastBatchId: prior.id,
              sequence: Math.max(
                campaign.sequence,
                prior.sequenceStart + prior.quantity,
              ),
            });
            continue;
          }
          if (
            this.store.state.productBatches.some(
              (b) =>
                b.campaignId === campaign.id &&
                !b.cancelled &&
                this.batchOutstanding(b),
            )
          ) {
            if (campaign.stage !== "Chờ đợt trước hoàn tất")
              this.store.patch("productCampaigns", campaign.id, {
                stage: "Chờ đợt trước hoàn tất",
              });
            continue;
          }
          this.startBatch(campaign, {
            key: `daily:${local.date}`,
            trigger: "daily",
            date: local.date,
          });
          this.store.patch("productCampaigns", campaign.id, {
            lastScheduledDate: local.date,
          });
        } catch (e) {
          if (campaign.error !== e.message)
            this.store.patch("productCampaigns", campaign.id, {
              error: e.message,
              stage: "Lịch cần kiểm tra cấu hình",
            });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}

export function mountProductCampaigns(app, store, studio, options) {
  const service = new ProductCampaigns(store, studio, options);
  app.post("/api/product-campaigns", (req, res) =>
    res.status(202).json(service.create(req.body)),
  );
  app.patch("/api/product-campaigns/:id", (req, res) =>
    res.json(service.update(req.params.id, req.body)),
  );
  app.post("/api/product-campaigns/:id/run", (req, res) =>
    res.status(202).json(service.run(req.params.id, req.body)),
  );
  for (const [action, method] of [
    ["render", "renderBatch"],
    ["retry", "retryBatch"],
    ["cancel", "cancelBatch"],
  ])
    app.post(`/api/product-batches/:id/${action}`, (req, res) =>
      res.json(service[method](req.params.id)),
    );
  return service;
}
