import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../server/store.js";
import { JobQueue, productQuotaBlocked } from "../server/queue.js";
import { chooseProductModel, productLlm } from "../server/product-model.js";
import { ProductStudio } from "../server/product-studio.js";
import {
  parseProductPage,
  parseVideoSearch,
  researchProductVideos,
  fetchProductResource,
} from "../server/product-sources.js";
import { classifyProductQuote } from "../server/dreamface-product-ui.js";
import {
  submitProductVideo,
  matchingProductWork,
  productTaskId,
} from "../server/dreamface-product-result.js";
import {
  storyboardFrames,
  buildProductStudy,
} from "../server/product-intelligence.js";
import { isPublishableVideo } from "../shared/output-media.js";
import { binary, runProcess, importMedia, probe } from "../server/media.js";

test("image-only research maps bounded candidate indexes to real sources and queues no invented facts", async () => {
  const store = new Store(
      path.resolve(".verification", `product-study-${randomUUID()}`),
    ),
    project = store.createProject("Image-only QA");
  const file = path.join(store.root, "temp", "product.png");
  await runProcess(binary("ffmpeg", store.state.settings), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=80x100",
    "-frames:v",
    "1",
    file,
  ]);
  const image = await importMedia(store, file, {
    projectId: project.id,
    mediaType: "product",
  });
  let visionCalls = 0;
  const llm = async (system, input, options) => {
    if (options.images?.length) visionCalls++;
    if (system.startsWith("Identify"))
      return {
        name: "Blue object",
        category: "Object",
        visibleFeatures: ["Blue surface"],
        uncertainties: ["Exact product unknown"],
        searchQuery: "blue object",
      };
    if (system.startsWith("Choose")) {
      assert.deepEqual(
        input.candidates.map((c) => c.index),
        [0, 1],
      );
      return { candidateIndexes: [1, 999, 1] };
    }
    if (system.startsWith("Analyze"))
      return {
        videoId: "real-source-2",
        hook: "Observed title only",
        pacing: "Unknown",
        productPresentation: "Unknown",
        cta: "Unknown",
        lesson: "Original demo suggestion",
        limitations: "No frames or captions were retrieved",
      };
    return {
      summary: "Original suggestion from limited evidence",
      concept: "Show the visible surface",
      scenes: Array.from({ length: 3 }, () => ({
        purpose: "Product view",
        prompt: "A slow camera move around this exact blue object.",
        caption: "Look closer",
      })),
      cta: "Explore",
    };
  };
  const study = await buildProductStudy(
    store,
    {
      projectId: project.id,
      imageMediaId: image.id,
      billingMode: "free",
      duration: 15,
      ratio: "9:16",
    },
    {
      llm,
      research: async (query, { selectVideos }) => {
        const ids = await selectVideos([
          { id: "real-source-1", title: "First" },
          { id: "real-source-2", title: "Second" },
        ]);
        assert.deepEqual(ids, ["real-source-2"]);
        return {
          query,
          searches: [],
          warnings: [],
          checkedAt: new Date().toISOString(),
          videos: [
            {
              id: ids[0],
              title: "Second",
              evidence: ["search metadata"],
              limitations: [],
              transcript: [],
            },
          ],
        };
      },
    },
  );
  assert.equal(study.source, null);
  assert.equal(study.product.name, "Object");
  assert.ok(
    study.product.uncertainties.some((x) => x.includes("brand and model")),
  );
  assert.equal(study.analysis.scenes.length, 3);
  assert.equal(study.analysis.references[0].videoId, "real-source-2");
  assert.equal(study.warnings.length, 1);
  assert.equal(visionCalls, 3);
});

test("Product selects a declared vision model while leaving News settings unchanged", async () => {
  const models = [
    { id: "news-model", capabilities: { vision: false } },
    { id: "vision-flash-low", capabilities: { vision: true } },
  ];
  assert.equal(chooseProductModel(models, "news-model").id, "vision-flash-low");
  assert.throws(
    () => chooseProductModel(models, "news-model", "news-model"),
    (e) => e.code === "PRODUCT_MODEL_NO_VISION",
  );
  const store = {
    state: {
      settings: {
        llm: {
          enabled: true,
          endpoint: "https://example.com/v1",
          model: "news-model",
          apiKey: "qa",
        },
      },
    },
  };
  const before = structuredClone(store);
  const resolved = await productLlm(
    store,
    {},
    { fetchImpl: async () => Response.json({ data: models }) },
  );
  assert.equal(resolved.model.visionVerified, true);
  assert.deepEqual(store, before);
});
test("Product quota cache is separate from MC and from a different credit budget", () => {
  const account = {
    quota: { blocked: true },
    productQuota: {
      kind: "daily",
      state: "exhausted",
      nextCheckAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  assert.equal(
    productQuotaBlocked(account, { productOptions: { billingMode: "free" } }),
    true,
  );
  assert.equal(
    productQuotaBlocked(account, {
      productOptions: { billingMode: "credits", maxCredits: 6 },
    }),
    false,
  );
  assert.equal(
    productQuotaBlocked(account, {
      productOptions: { billingMode: "free" },
      productRequest: { id: "already-submitted" },
    }),
    false,
  );
  account.productQuota = {
    ...account.productQuota,
    kind: "credits",
    billingMode: "credits",
    duration: 15,
    resolution: "720p",
    maxCredits: 5,
  };
  assert.equal(
    productQuotaBlocked(account, {
      duration: 15,
      productOptions: {
        billingMode: "credits",
        resolution: "720p",
        maxCredits: 5,
      },
    }),
    true,
  );
  assert.equal(
    productQuotaBlocked(account, {
      duration: 15,
      productOptions: {
        billingMode: "credits",
        resolution: "720p",
        maxCredits: 6,
      },
    }),
    false,
  );
});
test("source parser extracts a structured product and never invents an image URL", () => {
  const r = parseProductPage(
    '<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Bottle &amp; lid","image":"/bottle.jpg"}]}</script>',
    "https://example.com/item",
  );
  assert.equal(r.name, "Bottle & lid");
  assert.equal(r.imageUrl, "https://example.com/bottle.jpg");
  assert.equal(
    parseProductPage("<title>Just title</title>", "https://example.com/item")
      .imageUrl,
    null,
  );
});
test("product fetch refuses private sources and redirects into private networks", async () => {
  await assert.rejects(fetchProductResource("http://127.0.0.1/admin"));
  await assert.rejects(
    fetchProductResource("https://example.com/item", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        }),
    }),
  );
});
test("storyboard samples use correct sheet and tile coordinates", () => {
  const r = storyboardFrames(
    "https://i.ytimg.com/sb/test/$L/$N.jpg|160#90#36#3#2#2000#M$M#sig",
    72,
  );
  assert.equal(r.length, 6);
  assert.equal(r[0].x, 0);
  assert.equal(r[5].x, 320);
  assert.equal(r[5].y, 90);
  assert.equal(r[5].seconds, 70);
  assert.match(r[5].url, /\/0\/M5.jpg\?sigh=sig$/);
});
test("manual reference videos are retained ahead of search counts", async () => {
  const id = "abcdefghijk",
    other = "zyxwvutsrqp";
  const search =
    "var ytInitialData = " +
    JSON.stringify({
      items: [
        {
          videoRenderer: {
            videoId: other,
            title: { simpleText: "bottle" },
            viewCountText: { simpleText: "9M views" },
          },
        },
      ],
    }) +
    ";";
  const result = await researchProductVideos("bottle", {
    sourceUrls: [`https://youtu.be/${id}`],
    fetchResource: async (url) => ({
      bytes: Buffer.from(
        url.includes("results?") ? search : "var ytInitialPlayerResponse = {};",
      ),
    }),
  });
  assert.equal(result.videos[0].id, id);
  assert.equal(result.videos[0].transcript.length, 0);
  assert.ok(result.videos[0].limitations.length);
  assert.equal(parseVideoSearch(search)[0].id, other);
});
test("free workflow never authorizes a paid click; credit mode respects balance and cap", () => {
  assert.equal(classifyProductQuote("1 Free Daily", null).cost, 0);
  assert.equal(
    classifyProductQuote("6 Create", { paid_count: 100, free_count: 0 }).state,
    "exhausted",
  );
  assert.equal(
    classifyProductQuote(
      "6 Create",
      { paid_count: 6, free_count: 0 },
      { billingMode: "credits", maxCredits: 5 },
    ).overBudget,
    true,
  );
  assert.equal(
    classifyProductQuote(
      "6 Create",
      { paid_count: 6, free_count: 0 },
      { billingMode: "credits", maxCredits: 6 },
    ).state,
    "available",
  );
  assert.equal(classifyProductQuote("Create").state, "unknown");
  assert.equal(
    classifyProductQuote("6 Create", null, {
      billingMode: "credits",
      maxCredits: 6,
    }).state,
    "unknown",
  );
});
test("submission stores intent before clicking and matches only its prompt/response", async () => {
  const page = new EventEmitter(),
    saved = [];
  const req = {
    method: () => "POST",
    url: () => "https://api.dreamfaceapp.com/new/product/submit",
    postDataJSON: () => ({
      options: JSON.stringify({ prompt: "A specific bottle scene" }),
    }),
  };
  const receipt = await submitProductVideo({
    page,
    prompt: "A specific bottle scene",
    profileId: "profile-A",
    signal: new AbortController().signal,
    saveReceipt: (r) => saved.push({ ...r }),
    click: async () => {
      assert.equal(saved[0].state, "attempting");
      page.emit("request", req);
      page.emit("response", {
        request: () => req,
        ok: () => true,
        json: async () => ({
          status_code: "THS12140000000",
          data: { task_id: "actual-task" },
        }),
      });
    },
    timeoutMs: 1000,
  });
  assert.equal(receipt.id, "actual-task");
  assert.equal(saved.at(-1).state, "acknowledged");
  assert.equal(productTaskId({ data: { workflow_id: "template" } }), null);
  assert.equal(
    matchingProductWork(
      [
        { id: "old", file_type: "VIDEO", work_type: "AI_VIDEO" },
        { id: "actual-task", file_type: "VIDEO", work_type: "AI_VIDEO" },
      ],
      receipt,
    ).id,
    "actual-task",
  );
});
test("unknown submission remains uncertain and cannot return an old task", async () => {
  const page = new EventEmitter(),
    saved = [];
  await assert.rejects(
    submitProductVideo({
      page,
      prompt: "new scene",
      profileId: "A",
      signal: new AbortController().signal,
      saveReceipt: (r) => saved.push(r),
      click: async () => {},
      timeoutMs: 10,
    }),
    (e) => e.code === "PRODUCT_SUBMISSION_UNCONFIRMED",
  );
  assert.equal(saved[0].id, null);
  assert.equal(page.listenerCount("response"), 0);
});
test("15 second Product creates three scenes once and assembles a real isolated output", async (t) => {
  const store = new Store(
    path.resolve(".verification", `product-assembly-${randomUUID()}`),
  );
  store.state.settings.queuePaused = true;
  store.state.settings.renderAcceleration = "cpu";
  const project = store.createProject("Product QA");
  const image = store.add("media", {
    kind: "image",
    projectId: project.id,
    file: "qa.jpg",
  });
  const queue = new JobQueue(store, null, { intervalMs: 0 });
  const service = new ProductStudio(store, queue, {
    study: async () => ({
      imageMediaId: image.id,
      product: { name: "QA bottle", visibleFeatures: ["Visible cap"] },
      analysis: {
        scenes: Array.from({ length: 3 }, (_, i) => ({
          prompt: `Original bottle scene ${i}, slow camera movement.`,
          caption: `Scene ${i + 1}`,
        })),
        cta: "Explore the bottle",
      },
    }),
  });
  t.after(async () => {
    await service.close();
    await queue.close();
  });
  const request = {
    projectId: project.id,
    requestId: randomUUID(),
    imageMediaId: image.id,
  };
  const run = service.create(request);
  assert.equal(service.create(request).id, run.id);
  await service.worker;
  assert.equal(run.sceneJobIds.length, 3);
  service.render(run.id);
  assert.equal(store.state.jobs.length, 3);
  const file = path.join(store.root, "temp", "qa-clip.mp4");
  await runProcess(binary("ffmpeg", store.state.settings), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=180x320:rate=24",
    "-t",
    "5.175",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    file,
  ]);
  const clip = await importMedia(store, file, {
    projectId: project.id,
    generated: true,
    mediaType: "product-clip",
  });
  assert.equal(isPublishableVideo(clip), false);
  for (const id of run.sceneJobIds)
    store.patch("jobs", id, {
      status: "completed",
      mediaId: clip.id,
      progress: 100,
    });
  const assembled = queue.assemble(store.require("jobs", run.sceneJobIds[0]));
  assert.equal(
    assembled.payload.timeline.clips.reduce((s, c) => s + c.outSec, 0),
    15,
  );
  assert.equal(assembled.payload.timeline.texts.length, 4);
  assert.equal(assembled.production.autoCreateContent, false);
  store.state.settings.queuePaused = false;
  queue.tick();
  const end = Date.now() + 60000;
  while (
    assembled.status !== "completed" &&
    assembled.status !== "failed" &&
    Date.now() < end
  )
    await delay(100);
  assert.equal(assembled.status, "completed", assembled.error);
  const output = store.require("media", assembled.mediaId);
  assert.equal(isPublishableVideo(output), true);
  assert.match(output.file, /exports[\\/]products[\\/]final/);
  assert.ok(
    Math.abs((await probe(output.file, store.state.settings)).duration - 15) <
      0.15,
  );
  assert.equal(run.status, "completed");
  assert.equal(store.state.socialPosts.length, 0);
});

test("Product can use a logged-in MC-exhausted profile without resetting its News quota", async (t) => {
  const store = new Store(
      path.resolve(".verification", `product-profile-${randomUUID()}`),
    ),
    project = store.createProject("Profile QA");
  const account = store.add("accounts", {
      provider: "dreamface",
      name: "MC exhausted",
      status: "error",
      errorCode: "PROVIDER_QUOTA",
      quota: { blocked: true, state: "exhausted" },
      rotationDay: "2026-11-01",
    }),
    before = structuredClone(account.quota);
  const image = store.add("media", { kind: "image", projectId: project.id });
  let calls = 0;
  const queue = new JobQueue(store, null, {
    intervalMs: 0,
    generateDreamFace: async (_store, job, selected) => {
      calls++;
      assert.equal(selected.id, account.id);
      return { id: "qa-clip" };
    },
  });
  t.after(() => queue.close());
  const [job] = queue.enqueueGeneration({
    projectId: project.id,
    provider: "dreamface",
    model: "DreamFace video",
    kind: "video",
    mode: "reference",
    references: [image.id],
    prompts: ["Slow orbit around this bottle."],
    workflow: "product-video",
    productOptions: { billingMode: "free", resolution: "720p", maxCredits: 0 },
    duration: 5,
    ratio: "9:16",
    autoAssemble: false,
  });
  queue.tick();
  await Promise.all([...queue.running.values()].map((r) => r.promise));
  assert.equal(job.status, "completed");
  assert.equal(calls, 1);
  assert.deepEqual(account.quota, before);
  assert.equal(account.status, "error");
  assert.equal(account.rotationDay, "2026-11-01");
});
