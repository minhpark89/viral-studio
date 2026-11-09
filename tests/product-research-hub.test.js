import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store, StudioError } from "../server/store.js";
import { ResearchRepository } from "../server/product-research/repository.js";
import { ProductResearch } from "../server/product-research/service.js";
import { evidence, rankEvidence } from "../server/product-research/evidence.js";
import {
  parseTrending,
  parseInterest,
  parseAds,
  parseSocial,
  ResearchProviders,
} from "../server/product-research/providers.js";
import {
  importGoogleCsv,
  manualReference,
} from "../server/product-research/imports.js";
import { productStudioRequest } from "../shared/product-contracts.js";

const now = Date.parse("2026-11-09T12:00:00Z"),
  at = new Date(now).toISOString();
const xml =
  "<rss><channel><item><title>Jesus wall art</title><pubDate>Mon, 9 Nov 2026 00:00:00 GMT</pubDate><ht:approx_traffic>1000+</ht:approx_traffic><ht:news_item_title>New art &amp; home decor</ht:news_item_title></item><item><title>party start</title><ht:news_item_title>Latest article</ht:news_item_title></item></channel></rss>";
const csv =
  "Category: All categories\n\nWeek,Jesus wall art: (United States)\n2026-10-01,20\n2026-10-08,\n2026-10-15,<1\n2026-10-22,100\n";
const cleanups = new Map();
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "product-research-test-"));
  t.after(async () => {
    await cleanups.get(root)?.();
    cleanups.delete(root);
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function repository(t) {
  const root = temp(t),
    repo = new ResearchRepository(root, { now: () => now });
  cleanups.set(root, () => repo.close());
  return repo;
}
function video(views = 20000, observedAt = at) {
  return evidence(
    {
      provider: "youtube_public",
      platform: "youtube",
      kind: "video",
      externalId: "a",
      title: "Christian gift demo",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      publishedAt: "2026-11-01",
      observedAt,
      metrics: { views },
    },
    now,
  );
}
function setup(t, provider, options = {}) {
  const root = temp(t),
    store = new Store(root),
    project = store.createProject("Product test");
  const service = new ProductResearch(store, {
    now: () => now,
    schedule: false,
    providers: { scan: provider || (async () => ({ records: [video()] })) },
    ...options,
  });
  cleanups.set(root, () => service.close());
  const request = {
    requestId: randomUUID(),
    projectId: project.id,
    keywords: "Jesus wall art",
    sources: ["youtube"],
  };
  return { root, store, project, service, request };
}
async function done(service, scan) {
  await service.running.get(scan.id);
  return service.repo.get("scan", scan.id);
}

test("Google RSS matches whole words and meaningful niche overlap, not art inside party", () => {
  const r = parseTrending(xml, "Jesus wall art", 20, at);
  assert.equal(r.total, 2);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].trafficText, "1000+");
  assert.equal(r.records[0].description, "New art & home decor");
  assert.deepEqual(r.records[0].metrics, {});
  assert.equal(parseTrending(xml, "Christian gifts", 20, at).records.length, 0);
  assert.throws(() => parseTrending("<html>blocked</html>", "art"), /RSS/);
});
test("Trends preserves zero vs missing and partial periods; empty source produces no invented chart", () => {
  const points = [
    { timestamp: "1793491200", date: "a", values: [{ extracted_value: 0 }] },
    { timestamp: "1793577600", values: [{ value: "No data" }] },
    {
      timestamp: "1793664000",
      is_partial: true,
      values: [{ extracted_value: 80 }],
    },
  ];
  const [r] = parseInterest(
    { interest_over_time: { timeline_data: points } },
    "gifts",
    at,
  );
  assert.deepEqual(
    r.series.map((p) => p.value),
    [0, null, 80],
  );
  assert.equal(r.series[2].partial, true);
  assert.deepEqual(r.metrics, {});
  assert.deepEqual(parseInterest({}, "gifts", at), []);
});
test("Meta listing maps real ad video fields and never treats page likes or ad spend as sales/views", () => {
  const [r] = parseAds(
    {
      ads: [
        {
          ad_archive_id: "1234567890123456789",
          page_name: "Gift Store",
          page_likes: 999999,
          spend: "$1M",
          is_active: true,
          publisher_platforms: ["facebook", "instagram"],
          start_date: "2026-11-01",
          videos: [
            {
              video_hd: "https://video.fbcdn.net/example.mp4",
              video_preview_image: "https://images.fbcdn.net/example.jpg",
            },
          ],
          link: "https://example.com/product",
        },
      ],
    },
    at,
  );
  assert.equal(r.externalId, "1234567890123456789");
  assert.equal(r.mediaUrl, "https://video.fbcdn.net/example.mp4");
  assert.equal(r.active, true);
  assert.deepEqual(r.metrics, {});
  const score = rankEvidence(r, { now });
  assert.equal(score.salesScore, null);
  assert.equal(score.contentScore, null);
});
test("Social discovery validates platform and video path; search snippet views are not counted", () => {
  const results = [
    {
      link: "https://www.instagram.com/reel/ABCDE/?utm=1",
      title: "100M views",
      snippet: "100M views",
    },
    { link: "https://instagram.com.evil.test/reel/x", title: "fake" },
    { link: "https://www.tiktok.com/@store/video/12345", title: "demo" },
    { link: "https://facebook.com/profile", title: "profile" },
    { link: "javascript:alert(1)" },
  ];
  const records = parseSocial({ organic_results: results }, at);
  assert.equal(records.length, 2);
  assert.equal(records[0].url, "https://www.instagram.com/reel/ABCDE/");
  assert.deepEqual(records[0].metrics, {});
});
test("CSV uses actual US data, zero/missing/below-one semantics and rejects other regions", () => {
  const record = importGoogleCsv(csv, now);
  assert.deepEqual(
    record.series.map((p) => p.value),
    [20, null, null, 100],
  );
  assert.equal(record.series[2].belowOne, true);
  assert.equal(record.title, "Jesus wall art");
  assert.throws(
    () => importGoogleCsv(csv.replace("United States", "Vietnam"), now),
    /United States/,
  );
  const quoted = csv.replace(
    "Jesus wall art: (United States)",
    '"Jesus, art: (United States)"',
  );
  assert.equal(importGoogleCsv(quoted, now).title, "Jesus, art");
  assert.throws(
    () => importGoogleCsv('Week,Gift: (United States)\n2026-10-01,"x', now),
    /nháy/,
  );
});
test("Manual sources carry unverified provenance, cannot inject metrics or executable URLs", () => {
  const r = manualReference(
    {
      url: "https://www.facebook.com/ads/library/?id=12345",
      title: "Gift",
      description: "Hook",
      views: 1000000,
    },
    now,
  );
  assert.equal(r.kind, "ad");
  assert.equal(r.marketEvidence, "unverified");
  assert.deepEqual(r.metrics, {});
  assert.throws(() => manualReference({ url: "javascript:alert(1)" }, now));
  assert.throws(() =>
    manualReference(
      { url: "https://facebook.com.evil.test/ads/library/?id=123" },
      now,
    ),
  );
});
test("No growth without two genuine observations; cached reads do not create fresh snapshots", (t) => {
  const repo = repository(t);
  repo.observe(video(10000, new Date(now - 7200000).toISOString()));
  repo.observe(video());
  repo.observe(video());
  assert.equal(repo.history(video().id).length, 2);
  const result = rankEvidence(video(), {
    history: repo.history(video().id),
    now,
  });
  assert.equal(result.growth.delta, 10000);
  assert.equal(result.label, "Video đang tăng");
  assert.equal(
    rankEvidence(video(), {
      history: [{ observedAt: at, metrics: { views: 20000 } }],
      now,
    }).growth,
    null,
  );
  assert.equal(
    rankEvidence(video(20000, new Date(now + 1000).toISOString()), { now })
      .sourceFresh,
    false,
  );
});
test("Quota reserves failures and persists across restarts without storing source API keys", (t) => {
  const root = temp(t);
  let repo = new ResearchRepository(root, { now: () => now });
  const id = repo.reserve("serpapi", { dailyLimit: 1, monthlyLimit: 3 });
  repo.finishRequest(id, "failed");
  repo.close();
  repo = new ResearchRepository(root, { now: () => now });
  cleanups.set(root, () => repo.close());
  assert.equal(repo.usage("serpapi").daily, 1);
  assert.throws(
    () => repo.reserve("serpapi", { dailyLimit: 1, monthlyLimit: 3 }),
    (e) => e.code === "RESEARCH_BUDGET_EXCEEDED",
  );
});
test("SerpApi cache preserves observation time, charges once, and handles long IDs", async (t) => {
  const repo = repository(t);
  let calls = 0;
  const provider = new ResearchProviders(
    repo,
    () => ({ key: "secret", dailyLimit: 3, monthlyLimit: 5 }),
    {
      fetchResource: async (url) => {
        calls++;
        assert.equal(new URL(url).searchParams.get("api_key"), "secret");
        return {
          bytes: Buffer.from(
            '{"ads":[{"ad_archive_id":1234567890123456789,"page_name":"Test"}]}',
          ),
        };
      },
    },
  );
  const req = { keywords: "gifts", limit: 10 },
    signal = new AbortController().signal;
  const first = await provider.scan("ads", req, signal),
    second = await provider.scan("ads", req, signal);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(first.records[0].observedAt, second.records[0].observedAt);
  assert.equal(first.records[0].externalId, "1234567890123456789");
  assert.equal(repo.usage("serpapi").daily, 1);
});
test("SerpApi transport secrets are redacted and errors are not automatically retried", async (t) => {
  const repo = repository(t);
  let calls = 0;
  const p = new ResearchProviders(
    repo,
    () => ({ key: "TOP_SECRET", dailyLimit: 3, monthlyLimit: 5 }),
    {
      fetchResource: async () => {
        calls++;
        throw new Error("fetch failed https://serpapi.com?api_key=TOP_SECRET");
      },
    },
  );
  await assert.rejects(
    p.scan(
      "ads",
      { keywords: "gifts", limit: 5 },
      new AbortController().signal,
    ),
    (e) => !e.message.includes("TOP_SECRET"),
  );
  assert.equal(calls, 1);
  assert.equal(repo.usage("serpapi").daily, 1);
});
test("Scan idempotency and concurrent guard; missing source retains good results without touching News JSON", async (t) => {
  let calls = 0;
  const { service, store, request } = setup(t, async (source) => {
    calls++;
    if (source === "ads")
      throw new StudioError("Need key", "RESEARCH_KEY_REQUIRED");
    return { records: [video()] };
  });
  const before = fs.readFileSync(store.file, "utf8");
  request.sources = ["youtube", "ads"];
  const scan = service.start(request);
  assert.equal(service.start(request).id, scan.id);
  assert.throws(
    () => service.start({ ...request, keywords: "different" }),
    (e) => e.code === "RESEARCH_REQUEST_CONFLICT",
  );
  assert.throws(
    () => service.start({ ...request, requestId: randomUUID() }),
    (e) => e.code === "RESEARCH_BUSY",
  );
  const result = await done(service, scan);
  assert.equal(calls, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.records.length, 1);
  assert.equal(result.sources[1].status, "needs_key");
  assert.equal(fs.readFileSync(store.file, "utf8"), before);
});
test("Failed and empty scans are distinct, and key is never returned by public state", async (t) => {
  const { service, project, request } = setup(t, async () => ({ records: [] }));
  service.configure({ key: "DO_NOT_EXPOSE", dailyLimit: 20, monthlyLimit: 30 });
  const scan = await done(service, service.start(request));
  assert.equal(scan.status, "completed");
  assert.equal(scan.sources[0].status, "empty");
  assert.equal(
    JSON.stringify(service.state(project.id)).includes("DO_NOT_EXPOSE"),
    false,
  );
});
test("Project isolation and research transfer carry selected evidence into render contract", async (t) => {
  const { service, store, project, request } = setup(t);
  const scan = await done(service, service.start(request)),
    other = store.createProject("Other");
  assert.throws(
    () => service.scan(scan.id, other.id),
    (e) => e.status === 404 || e.code === "PRODUCT_RESEARCH_NOT_FOUND",
  );
  const added = service.addReference(scan.id, project.id, {
    type: "google_csv",
    text: csv,
  });
  const draft = service.prepare(
    scan.id,
    project.id,
    added.records.map((r) => r.id),
  );
  assert.equal(draft.researchEvidence.length, 2);
  assert.equal(draft.productUrl, "");
  assert.equal(draft.inspirationUrls.length, 1);
  const parsed = productStudioRequest.parse({
    ...draft,
    projectId: project.id,
    requestId: randomUUID(),
    productUrl: "https://example.com/products/art",
  });
  assert.equal(parsed.researchEvidence.length, 2);
});
test("Cancel interrupts sources and leaves prior evidence in the scan", async (t) => {
  let ready;
  const entered = new Promise((r) => (ready = r));
  const { service, request } = setup(t, async (source, req, signal) => {
    if (source === "youtube") return { records: [video()] };
    ready();
    return new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("abort")), {
        once: true,
      }),
    );
  });
  request.sources = ["youtube", "ads"];
  const scan = service.start(request);
  await entered;
  service.cancel(scan.id, request.projectId);
  const result = await done(service, scan);
  assert.equal(result.status, "cancelled");
  assert.equal(result.records.length, 1);
});
test("Watch survives restart, handles one missed interval and can pause without touching News settings", async (t) => {
  let time = now;
  const { service, store, request } = setup(t, undefined, { now: () => time });
  const original = JSON.stringify(store.state.settings);
  const watch = service.watch({ request, everyHours: 6 });
  time += 24 * 3600000;
  service.tick();
  const jobs = [...service.running.values()];
  assert.equal(jobs.length, 1);
  await Promise.all(jobs);
  assert.equal(
    service.repo.get("watch", watch.id).nextAt,
    new Date(time + 6 * 3600000).toISOString(),
  );
  service.tick();
  assert.equal(service.running.size, 0);
  service.manageWatch(watch.id, request.projectId, { enabled: false });
  time += 24 * 3600000;
  service.tick();
  assert.equal(service.running.size, 0);
  assert.equal(JSON.stringify(store.state.settings), original);
});
test("Restart recovers interrupted scans, resumes saved watches and preserves source history", async (t) => {
  const root = temp(t),
    store = new Store(root),
    project = store.createProject("Persisted Product");
  let time = now;
  let service = new ProductResearch(store, {
    now: () => time,
    schedule: false,
    providers: { scan: async () => ({ records: [video()] }) },
  });
  const request = {
    requestId: randomUUID(),
    projectId: project.id,
    keywords: "gifts",
    sources: ["youtube"],
  };
  const watch = service.watch({ request, everyHours: 6 });
  service.repo.put("scan", {
    id: "interrupted-example",
    projectId: project.id,
    status: "running",
    records: [],
    request,
  });
  service.repo.observe(video());
  await service.close();
  time += 7 * 3600000;
  service = new ProductResearch(store, {
    now: () => time,
    schedule: false,
    providers: { scan: async () => ({ records: [video()] }) },
  });
  cleanups.set(root, () => service.close());
  assert.equal(
    service.repo.get("scan", "interrupted-example").status,
    "interrupted",
  );
  assert.equal(service.repo.history(video().id).length, 1);
  service.tick();
  await Promise.all(service.running.values());
  assert.ok(service.repo.get("watch", watch.id).lastScanId);
});
test("Social uses one Short Videos request and never caches the API key", async (t) => {
  const repo = repository(t);
  let calls = 0;
  const p = new ResearchProviders(
    repo,
    () => ({ key: "PRIVATE_KEY_123", dailyLimit: 5, monthlyLimit: 5 }),
    {
      fetchResource: async (url) => {
        calls++;
        assert.equal(
          new URL(url).searchParams.get("engine"),
          "google_short_videos",
        );
        assert.equal(new URL(url).searchParams.get("q"), "gifts");
        return {
          bytes: Buffer.from(
            JSON.stringify({
              search_parameters: { api_key: "PRIVATE_KEY_123" },
              short_video_results: [
                {
                  link: "https://www.tiktok.com/@gift/video/1234",
                  title: "A gift",
                  snippet: "PRIVATE_KEY_123",
                },
              ],
            }),
          ),
        };
      },
    },
  );
  const result = await p.scan(
    "social",
    { keywords: "gifts", limit: 10 },
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.equal(result.platforms.tiktok, 1);
  assert.ok(result.records.length);
  assert.equal(JSON.stringify(result).includes("PRIVATE_KEY_123"), false);
  const saved = repo.db.prepare("SELECT body FROM cache").all();
  assert.equal(JSON.stringify(saved).includes("PRIVATE_KEY_123"), false);
});
