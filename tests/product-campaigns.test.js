import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { ProductStudio } from "../server/product-studio.js";
import { JobQueue } from "../server/queue.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  ProductCampaigns,
  campaignLocalClock,
} from "../server/product-campaigns.js";
import {
  productCampaignSchema,
  productCreativeDirection,
} from "../shared/product-contracts.js";
import {
  sampleTimes,
  analyzeProductReference,
  referenceObservation,
} from "../server/product-reference.js";
import { binary, runProcess, importMedia } from "../server/media.js";
import {
  ProductFreeResearch,
  scoreFreeIdea,
  observedViewGrowth,
  freeVideoHistory,
} from "../server/product-free-research.js";

function context() {
  const store = new Store(
      path.resolve(".verification", `product-batches-${randomUUID()}`),
    ),
    project = store.createProject("Batch QA");
  return {
    store,
    project,
    request: {
      projectId: project.id,
      requestId: randomUUID(),
      productUrl: "https://example.com/verified-product",
      duration: 15,
      billingMode: "free",
      autoRender: false,
    },
  };
}
const emptyQueue = {};
function studyFixture(sequence) {
  return {
    product: { name: "Fixture product", visibleFeatures: ["Fixture"] },
    imageMediaId: randomUUID(),
    analysis: {
      concept: `Distinct concept ${sequence}`,
      scenes: [{ prompt: `Motion ${sequence}` }],
      references: [],
    },
    creativeDirection: productCreativeDirection("auto", sequence),
  };
}

test("scheduled initial delivery survives reservation failure and does not run twice today", async () => {
  const { store, request } = context(),
    studio = new ProductStudio(store, emptyQueue, {
      study: async () => studyFixture(0),
    }),
    now = () => Date.parse("2026-11-08T03:00:00Z");
  let campaigns = new ProductCampaigns(store, studio, { intervalMs: 0, now });
  try {
    const original = studio.create.bind(studio);
    let calls = 0;
    studio.create = (...args) => {
      if (++calls === 2) throw new Error("Crash");
      return original(...args);
    };
    assert.throws(
      () =>
        campaigns.create({
          request,
          quantity: 2,
          schedule: { enabled: true, time: "08:00", timezone: "Asia/Bangkok" },
        }),
      /Crash/,
    );
    await studio.worker;
    campaigns.close();
    store.state.productCampaigns[0].sequence = 0;
    studio.create = original;
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0, now });
    await studio.worker;
    assert.equal(store.state.productCampaigns[0].sequence, 2);
    for (const r of store.state.productRuns)
      store.patch("productRuns", r.id, { status: "completed" });
    campaigns.tick();
    assert.equal(store.state.productBatches.length, 1);
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("opening app resumes campaign research without recreating or submitting DreamFace jobs", async () => {
  const { store, request } = context();
  let studio = new ProductStudio(store, emptyQueue, {
    study: async (s, r, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Closing")), {
          once: true,
        }),
      ),
  });
  const campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  campaigns.create({ request, quantity: 2 });
  campaigns.close();
  await studio.close();
  const ids = store.state.productRuns.map((r) => r.id);
  studio = new ProductStudio(store, emptyQueue, {
    study: async (s, r, { creativeContext }) =>
      studyFixture(creativeContext.sequence),
  });
  try {
    await studio.worker;
    assert.deepEqual(
      store.state.productRuns.map((r) => r.id),
      ids,
    );
    assert.deepEqual(
      store.state.productRuns.map((r) => r.status),
      ["ready", "ready"],
    );
    assert.equal(store.state.jobs.length, 0);
  } finally {
    await studio.close();
  }
});
test("reference normalization preserves structured visual observations", () => {
  assert.equal(
    referenceObservation({ at: "0:01", description: "Close-up cap" }),
    "at: 0:01; description: Close-up cap",
  );
  assert.equal(
    referenceObservation(["Slow shot", "Clean lighting"]),
    "Slow shot; Clean lighting",
  );
});

test("three requested 15-second videos assemble as three distinct local MP4 files", async (t) => {
  const { store, request, project } = context();
  store.state.settings.queuePaused = true;
  store.state.settings.renderAcceleration = "cpu";
  const image = store.add("media", {
      projectId: project.id,
      kind: "image",
      file: "fixture-image.jpg",
    }),
    queue = new JobQueue(store, null, { intervalMs: 0 }),
    studio = new ProductStudio(store, queue, {
      study: async (s, r, { creativeContext }) => ({
        ...studyFixture(creativeContext.sequence),
        imageMediaId: image.id,
        analysis: {
          concept: `Concept ${creativeContext.sequence}`,
          scenes: Array.from({ length: 3 }, (_, i) => ({
            prompt: `Variant ${creativeContext.sequence} scene ${i}`,
            caption: `Video ${creativeContext.sequence + 1} Scene ${i + 1}`,
          })),
          cta: `Discover ${creativeContext.sequence + 1}`,
        },
      }),
    }),
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  t.after(async () => {
    campaigns.close();
    await studio.close();
    await queue.close();
  });
  campaigns.create({
    request: {
      ...request,
      imageMediaId: image.id,
      productUrl: "",
      autoRender: true,
      outputDirectory:path.join(store.root,'batch-custom-output'),
    },
    quantity: 3,
  });
  await studio.worker;
  assert.equal(store.state.jobs.length, 9);
  assert.equal(new Set(store.state.jobs.map((j) => j.batchId)).size, 3);
  store.state.settings.productOutputDirectory=path.join(store.root,'changed-default');
  const file = path.join(store.root, "temp", "batch-fixture.mp4");
  await runProcess(binary("ffmpeg", store.state.settings), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=180x320:rate=24",
    "-t",
    "5.1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    file,
  ]);
  const clip = await importMedia(store, file, {
    projectId: project.id,
    mediaType: "product-clip",
  });
  for (const j of store.state.jobs)
    store.patch("jobs", j.id, {
      status: "completed",
      mediaId: clip.id,
      progress: 100,
    });
  const renders = store.state.productRuns.map((r) =>
    queue.assemble(store.require("jobs", r.sceneJobIds[0])),
  );
  store.state.settings.queuePaused = false;
  queue.tick();
  const deadline = Date.now() + 90000;
  while (
    renders.some((j) => !["completed", "failed"].includes(j.status)) &&
    Date.now() < deadline
  ) {
    await delay(100);
    queue.tick();
  }
  assert.deepEqual(
    renders.map((j) => j.status),
    ["completed", "completed", "completed"],
    renders.map((j) => j.error).join(";"),
  );
  const outputs = renders.map((j) => store.require("media", j.mediaId));
  assert.equal(new Set(outputs.map((m) => m.file)).size, 3);
  assert.ok(outputs.every((m) => Math.abs(m.duration - 15) < 0.2));
  assert.ok(outputs.every(m=>path.dirname(m.file)===path.join(store.root,'batch-custom-output')));
  assert.deepEqual(
    store.state.productRuns.map((r) => r.status),
    ["completed", "completed", "completed"],
  );
  assert.equal(store.state.socialPosts.length, 0);
});

test("a batch creates distinct runs, reuses first evidence, rotates styles, and remains idempotent", async () => {
  const { store, request } = context(),
    calls = [];
  const studio = new ProductStudio(store, emptyQueue, {
      study: async (s, r, options) => {
        calls.push(options);
        return studyFixture(options.creativeContext.sequence);
      },
    }),
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  try {
    const input = { request, quantity: 3 },
      result = campaigns.create(input);
    await studio.worker;
    assert.equal(store.state.productRuns.length, 3);
    assert.equal(calls[0].baselineStudy, undefined);
    assert.equal(calls[1].baselineStudy.analysis.concept, "Distinct concept 0");
    assert.deepEqual(calls[2].creativeContext.previousConcepts, [
      "Distinct concept 0",
      "Distinct concept 1",
    ]);
    assert.equal(
      new Set(store.state.productRuns.map((r) => r.request.requestId)).size,
      3,
    );
    assert.deepEqual(
      store.state.productRuns.map((r) => r.study.creativeDirection.id),
      ["demo", "ugc", "cinematic"],
    );
    assert.equal(campaigns.create(input).batch.id, result.batch.id);
    assert.throws(
      () => campaigns.run(result.campaign.id, { requestId: randomUUID() }),
      /Đợt trước/,
    );
    for (const r of store.state.productRuns)
      store.patch("productRuns", r.id, { status: "completed" });
    campaigns.update(result.campaign.id, {
      quantity: 2,
      request: { style: "minimal" },
    });
    const next = campaigns.run(result.campaign.id, { requestId: randomUUID() });
    await studio.worker;
    assert.equal(next.quantity, 2);
    assert.equal(result.batch.quantity, 3);
    assert.equal(result.batch.request.style, "auto");
    assert.equal(next.request.style, "minimal");
    assert.equal(next.sequenceStart, 3);
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("daily schedule respects local date, pause, backlog, restart, and only catches up today", async () => {
  const { store, request } = context();
  let now = Date.parse("2026-11-08T00:59:00Z");
  const studio = new ProductStudio(store, emptyQueue, {
    study: async () => studyFixture(0),
  });
  let campaigns = new ProductCampaigns(store, studio, {
    intervalMs: 0,
    now: () => now,
  });
  try {
    const { campaign } = campaigns.create({
      request,
      quantity: 2,
      startNow: false,
      schedule: { enabled: true, time: "08:00", timezone: "Asia/Bangkok" },
    });
    campaigns.tick();
    assert.equal(store.state.productRuns.length, 0);
    now += 60000;
    campaigns.tick();
    await studio.worker;
    assert.equal(store.state.productBatches.length, 1);
    campaigns.tick();
    assert.equal(store.state.productRuns.length, 2);
    now += 86400000;
    campaigns.tick();
    assert.equal(store.state.productBatches.length, 1);
    assert.match(campaign.stage, /Chờ đợt/);
    campaigns.update(campaign.id, { schedule: { enabled: false } });
    for (const r of store.state.productRuns)
      store.patch("productRuns", r.id, { status: "completed" });
    campaigns.tick();
    assert.equal(store.state.productBatches.length, 1);
    now = Date.parse("2026-11-15T01:00:00Z");
    campaigns.update(campaign.id, { schedule: { enabled: true } });
    campaigns.tick();
    await studio.worker;
    assert.equal(store.state.productBatches.length, 2);
    assert.equal(store.state.productBatches[1].date, "2026-11-15");
    campaigns.close();
    campaigns = new ProductCampaigns(store, studio, {
      intervalMs: 0,
      now: () => now,
    });
    assert.equal(store.state.productBatches.length, 2);
    assert.deepEqual(
      campaignLocalClock(
        Date.parse("2026-11-08T02:00:00Z"),
        "America/New_York",
      ),
      { date: "2026-11-07", time: "21:00" },
    );
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("reserved batch repairs a crash without duplicating an existing first run", async () => {
  const { store, request } = context(),
    studio = new ProductStudio(store, emptyQueue, {
      study: async () => studyFixture(0),
    });
  let campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  try {
    const original = studio.create.bind(studio);
    let count = 0;
    studio.create = (...args) => {
      if (++count === 2) throw new Error("Simulated interruption");
      return original(...args);
    };
    assert.throws(
      () => campaigns.create({ request, quantity: 3 }),
      /Simulated/,
    );
    await studio.worker;
    assert.equal(store.state.productRuns.length, 1);
    campaigns.close();
    studio.create = original;
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
    await studio.worker;
    assert.equal(store.state.productRuns.length, 3);
    assert.equal(store.state.productBatches[0].status, "created");
    assert.equal(
      new Set(store.state.productRuns.map((r) => r.request.requestId)).size,
      3,
    );
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("cancel stops a research batch even if a provider resolves after abort", async () => {
  const { store, request } = context();
  let resolve;
  const studio = new ProductStudio(store, emptyQueue, {
      study: () => new Promise((r) => (resolve = r)),
    }),
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  try {
    const { batch } = campaigns.create({ request, quantity: 3 });
    campaigns.cancelBatch(batch.id);
    resolve(studyFixture(0));
    await studio.worker;
    assert.deepEqual(
      store.state.productRuns.map((r) => r.status),
      ["cancelled", "cancelled", "cancelled"],
    );
    assert.equal(studio.pending.length, 0);
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("campaign validation rejects missing reference, unsafe counts, and invalid schedule", () => {
  const { request } = context();
  assert.equal(
    productCampaignSchema.safeParse({ request, quantity: 101 }).success,
    false,
  );
  assert.equal(
    productCampaignSchema.safeParse({
      request: { ...request, style: "reference" },
    }).success,
    false,
  );
  assert.equal(
    productCampaignSchema.safeParse({ request, schedule: { time: "25:00" } })
      .success,
    false,
  );
  assert.equal(
    productCampaignSchema.safeParse({
      request,
      schedule: { timezone: "Made/Up" },
    }).success,
    false,
  );
  assert.equal(
    productCampaignSchema.safeParse({
      request: { ...request, billingMode: "credits", maxCredits: 0 },
    }).success,
    false,
  );
});
test("sample video analysis reads actual ordered frames and scene candidates with honest audio coverage", async () => {
  const { store, project } = context(),
    file = path.join(store.root, "temp", "sample.mp4");
  await runProcess(binary("ffmpeg", store.state.settings), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=12",
    "-t",
    "4",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  const media = await importMedia(store, file, {
    projectId: project.id,
    mediaType: "product-reference-video",
  });
  let seen;
  const result = await analyzeProductReference(
    store,
    { projectId: project.id, sampleVideoMediaId: media.id },
    {
      llm: async (s, input, options) => {
        seen = input;
        assert.match(options.images[0], /^data:image\/jpeg;base64,/);
        return {
          summary: "Observed sampled frames",
          hook: "Test scene",
          pacing: "Sampled only",
          shots: [{at:'0:01',description:'A test pattern'}],
          lighting: "Unknown",
          textAndCta: "None observed",
          adaptation: {technique:'Original technique'},
          limitations: "No complete viewing",
        };
      },
    },
  );
  assert.deepEqual(
    seen.sampleTimes,
    [...seen.sampleTimes].sort((a, b) => a - b),
  );
  assert.ok(seen.sampleTimes.length >= 7);
  assert.deepEqual(result.transcript, []);
  assert.match(result.transcriptWarning, /Không có lời nói/);
  assert.equal(result.mediaId, media.id);
  assert.equal(
    (await fs.readdir(path.join(store.root, "temp"))).filter((n) =>
      /^sample-(contact|voice|asr|[0-9a-f]{8}-)/.test(n),
    ).length,
    0,
  );
  assert.deepEqual(sampleTimes(0.05), [0]);
});
test("free research works without API keys or LLM and keeps measured sources and transfer references", async () => {
  const { store, project } = context();
  store.state.settings.llm.enabled = false;
  let modelCalls = 0;
  const service = new ProductFreeResearch(store, {
    model: async () => {
      modelCalls++;
      throw new Error("must not call");
    },
    research: async () => ({
      videos: [
        {
          id: "real-01",
          url: "https://www.youtube.com/watch?v=real-01",
          title: "Product demo",
          channel: "Creator",
          views: 12432,
          publishedAt: "2026-11-01",
          transcript: [],
          storyboardSpec: "private large data",
        },
      ],
      searches: ["query"],
      warnings: [],
    }),
  });
  try {
    const request = {
      projectId: project.id,
      requestId: randomUUID(),
      keywords: "water bottle",
      useAi: false,
    };
    const scan = service.start(request);
    await service.running.get(scan.id);
    assert.equal(scan.status, "completed");
    assert.equal(modelCalls, 0);
    assert.equal(scan.videos[0].views, 12432);
    assert.equal(scan.videos[0].storyboardSpec, undefined);
    assert.equal(scan.verifiedAudience, false);
    assert.equal(scan.ideas[0].recommendation.eligible, false);
    assert.equal(scan.ideas[0].gmv, undefined);
    assert.equal(service.start(request).id, scan.id);
    const draft = service.prepare(scan.id, scan.ideas[0].id);
    assert.equal(draft.productUrl, "");
    assert.deepEqual(draft.inspirationUrls, [scan.videos[0].url]);
    assert.equal(draft.imageMediaId, null);
  } finally {
    await service.close();
  }
});
test("free recommendations require recent independent signals and never invent daily growth", () => {
  const now = Date.parse("2026-11-08"),
    videos = [
      { id: "a", channel: "One", views: 20000, publishedAt: "2026-11-01" },
      { id: "b", channel: "Two", views: 30000, publishedAt: "2026-11-02" },
    ];
  assert.equal(scoreFreeIdea(videos, { now }).eligible, true);
  assert.equal(
    scoreFreeIdea(
      videos.map((v) => ({ ...v, channel: "Same" })),
      { now },
    ).eligible,
    false,
  );
  assert.equal(
    scoreFreeIdea(
      videos.map((v) => ({ ...v, publishedAt: "2020-01-01" })),
      { now },
    ).eligible,
    false,
  );
  assert.equal(
    scoreFreeIdea(
      videos.map((v) => ({ ...v, views: null })),
      { now },
    ).eligible,
    false,
  );
  const points = freeVideoHistory(
    [
      { finishedAt: "2026-11-01", videos: [videos[0]] },
      { finishedAt: "2026-11-04", videos: [{ ...videos[0], views: 26000 }] },
    ],
    "a",
  );
  assert.equal(points.length, 2);
  assert.equal(observedViewGrowth(points).perDay, 2000);
  assert.equal(observedViewGrowth([points[0]]), null);
  assert.equal(
    observedViewGrowth([
      { at: "2026-11-01", views: 20 },
      { at: "2026-11-01T01:00:00Z", views: 50 },
    ]),
    null,
  );
});
test("unavailable free sources fail explicitly; optional AI failure retains measured videos", async () => {
  const { store, project } = context();
  store.state.settings.llm.enabled = true;
  const failed = new ProductFreeResearch(store, {
    research: async () => {
      throw new Error("Source unavailable");
    },
  });
  let scan = failed.start({
    projectId: project.id,
    requestId: randomUUID(),
    keywords: "bottle",
  });
  await failed.running.get(scan.id);
  assert.equal(scan.status, "failed");
  assert.deepEqual(scan.ideas, []);
  await failed.close();
  const fallback = new ProductFreeResearch(store, {
    research: async () => ({
      videos: [{ id: "a", title: "Source", views: 42 }],
      warnings: [],
    }),
    model: async () => {
      throw new Error("LLM unavailable");
    },
  });
  scan = fallback.start({
    projectId: project.id,
    requestId: randomUUID(),
    keywords: "bottle",
  });
  await fallback.running.get(scan.id);
  assert.equal(scan.status, "completed");
  assert.equal(scan.videos[0].views, 42);
  assert.ok(scan.warnings.some((w) => w.includes("LLM unavailable")));
  await fallback.close();
});
