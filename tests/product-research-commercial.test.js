import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { Store } from "../server/store.js";
import {
  parseShopping,
  parseSocial,
  parseAds,
} from "../server/product-research/providers.js";
import { prioritizeProducts } from "../server/product-research/opportunities.js";
import { ResearchPreview } from "../server/product-research/preview.js";
import { mountProductResearch } from "../server/product-research/service.js";
import { rankEvidence } from "../server/product-research/evidence.js";
import { JobQueue } from "../server/queue.js";
import { binary, runProcess, importMedia } from "../server/media.js";
import { renderTimeline } from "../server/render.js";

const at = "2026-11-09T04:00:00Z";
const root = () =>
  path.resolve(".verification", `commercial-${Date.now()}-${randomUUID()}`);
test("Shopping keeps merchant identity, price, reviews and missing values without inventing sales", () => {
  const data = {
    shopping_results: [
      {
        product_id: "1234567890123456789",
        title: "Jesus art print",
        product_link: "https://google.com/shopping/product/123",
        source: "Shop A",
        price: "$25",
        extracted_price: 25,
        rating: 4.5,
        reviews: 12,
      },
      {
        product_id: "1234567890123456789",
        title: "Jesus art print",
        product_link: "https://google.com/shopping/product/123",
        source: "Shop B",
      },
      { title: "Bad URL", product_link: "javascript:alert(1)" },
    ],
  };
  const records = parseShopping(data, at);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].id, records[1].id);
  assert.deepEqual(records[0].metrics, { price: 25, rating: 4.5, reviews: 12 });
  assert.equal(records[1].metrics.price, null);
  assert.equal(rankEvidence(records[0]).salesScore, null);
  assert.match(rankEvidence(records[0]).label, /chưa xác nhận bán chạy/);
});
test("Commercial ad ranking surfaces gift merchandise ahead of sermons without calling it sales", () => {
  const ads = parseAds(
    {
      ads: [
        {
          ad_archive_id: "1",
          title: "Sunday service",
          body: "Pastor was live",
          page_name: "Church",
        },
        {
          ad_archive_id: "2",
          title: "When Words Fail, Give a Portrait of Faith",
          body: "Christian gifts: personalized canvas",
          page_name: "Art shop",
          call_to_action: "Shop now",
          link: "https://example.com/products/art",
        },
        {
          ad_archive_id: "3",
          title: "Christian Gifts",
          body: "Unboxing a mug and gift box",
          call_to_action: "Learn more",
        },
      ],
    },
    at,
  );
  const sorted = prioritizeProducts(ads, "Christian gifts");
  assert.equal(sorted[0].externalId, "2");
  assert.equal(sorted.at(-1).externalId, "1");
  assert.equal(sorted.at(-1).productSignals.likelyProduct, false);
  assert.equal(sorted[0].productSignals.likelyProduct, true);
  assert.deepEqual(sorted[0].metrics, {});
});
test("Short video metadata extracts TikTok, Instagram and Facebook with bounded preview and no invented views", () => {
  const rows = parseSocial(
    {
      short_video_results: [
        {
          link: "https://www.tiktok.com/@store/video/123",
          title: "Gift set",
          channel: "Store",
          duration: "0:15",
          clip: "https://encrypted-vtbn0.gstatic.com/video?q=demo",
        },
        { link: "https://www.instagram.com/reel/abc/", title: "Bible cover" },
        {
          link: "https://www.facebook.com/store/videos/bible-cover/123/",
          title: "Gift",
        },
        {
          link: "https://www.youtube.com/shorts/abc",
          title: "Not a selected social platform",
        },
      ],
    },
    at,
  );
  assert.deepEqual(
    rows.map((r) => r.platform),
    ["tiktok", "instagram", "facebook"],
  );
  assert.equal(rows[0].durationText, "0:15");
  assert.equal(rows[0].creator, "Store");
  assert.deepEqual(rows[0].metrics, {});
});
test("Preview coalesces downloads, caches real file and rejects active content or private-network sources", async (t) => {
  let calls = 0;
  const preview = new ResearchPreview(root(), {
    fetchResource: async () => {
      calls++;
      return { type: "image/png", bytes: Buffer.from("image fixture") };
    },
  });
  t.after(() => preview.close());
  const record = { thumbnailUrl: "https://example.com/image.png" };
  const [a, b] = await Promise.all([
    preview.load(record, "image"),
    preview.load(record, "image"),
  ]);
  assert.equal(a.file, b.file);
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(a.file, "utf8"), "image fixture");
  await preview.load(record, "image");
  assert.equal(calls, 1);
  const bad = new ResearchPreview(root(), {
    fetchResource: async () => ({
      type: "image/svg+xml",
      bytes: Buffer.from("<svg/>"),
    }),
  });
  t.after(() => bad.close());
  await assert.rejects(
    bad.load(record, "image"),
    (e) => e.code === "RESEARCH_PREVIEW_TYPE",
  );
  const network = new ResearchPreview(root());
  t.after(() => network.close());
  await assert.rejects(
    network.load({ mediaUrl: "http://127.0.0.1/private" }, "video"),
    (e) => e.code === "PRODUCT_URL_PRIVATE",
  );
});
test("Preview route scopes records to project and supports range playback without loosening News CSP", async (t) => {
  const store = new Store(root()),
    p = store.createProject("Research preview"),
    other = store.createProject("Other"),
    app = express();
  app.use(express.json());
  const service = mountProductResearch(app, store, {
    schedule: false,
    fetchResource: async () => ({
      type: "video/mp4",
      bytes: Buffer.from("0123456789"),
    }),
    providers: {
      scan: async () => ({
        records: parseAds(
          {
            ads: [
              {
                ad_archive_id: "55",
                title: "Gift",
                videos: [{ video_hd: "https://example.com/v.mp4" }],
              },
            ],
          },
          at,
        ),
      }),
    },
  });
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await service.close();
    await new Promise((r) => server.close(r));
  });
  const scan = service.start({
    requestId: randomUUID(),
    projectId: p.id,
    keywords: "gift",
    sources: ["ads"],
  });
  await service.running.get(scan.id);
  const record = service.scan(scan.id, p.id).records[0];
  const url = `http://127.0.0.1:${server.address().port}/api/product-research/scans/${scan.id}/media/${record.id}/video`;
  const denied = await fetch(`${url}?projectId=${other.id}`);
  assert.equal(denied.status, 404);
  const result = await fetch(`${url}?projectId=${p.id}`, {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-type"), "video/mp4");
  assert.equal(await result.text(), "2345");
});
test("Manual Product timeline freezes selected output, creates a real MP4 there and leaves News routing untouched", async (t) => {
  const store = new Store(root()),
    project = store.createProject("Timeline output"),
    file = path.join(store.root, "temp", "clip.mp4");
  await runProcess(binary("ffmpeg", store.state.settings), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=120x160:rate=12",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    file,
  ]);
  const input = await importMedia(store, file, {
    projectId: project.id,
    mediaType: "product-clip",
  });
  const timeline = {
    ...project.timeline,
    resolution: 480,
    quality: "draft",
    clips: [{ id: randomUUID(), mediaId: input.id, inSec: 0, outSec: 1 }],
    texts: [],
    images: [],
    music: null,
  };
  const queue = new JobQueue(store, {}, { intervalMs: 0 });
  t.after(() => queue.close());
  store.state.settings.queuePaused = true;
  const custom = path.join(store.root, "selected-output"),
    later = path.join(store.root, "future-output");
  store.state.settings.productOutputDirectory = custom;
  const product = queue.enqueueRender(
    { projectId: project.id, name: "Product custom", timeline },
    { production: { contentType: "product", autoCreateContent: false } },
  );
  assert.equal(product.production.productOutputDirectory, custom);
  store.state.settings.productOutputDirectory = later;
  assert.equal(product.production.productOutputDirectory, custom);
  const result = await renderTimeline(
    store,
    product,
    new AbortController().signal,
    () => {},
  );
  assert.equal(path.dirname(result.file), custom);
  assert.equal(result.mediaType, "product-video");
  assert.ok(result.duration >= 0.95);
  const newsProduction = { contentType: "news", title: "Untouched" };
  const news = queue.enqueueRender(
    { projectId: project.id, timeline },
    { production: newsProduction },
  );
  assert.deepEqual(news.production, {...newsProduction, newsOutputDirectory:path.join(store.root,'exports')});
  const invalid = path.join(store.root, "temp", "not-a-directory");
  await fs.writeFile(invalid, "keep");
  const count = store.state.jobs.length;
  assert.throws(
    () =>
      queue.enqueueRender(
        { projectId: project.id, timeline },
        {
          production: {
            contentType: "product",
            productOutputDirectory: invalid,
          },
        },
      ),
    /Không ghi/,
  );
  assert.equal(store.state.jobs.length, count);
});
