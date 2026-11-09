import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import {
  FastMossClient,
  ProductMarket,
  normalizeSalesTrend,
  scoreProductTrend,
} from "../server/product-market.js";
const now = Date.parse("2026-11-08T15:00:00Z");
function raw() {
  return {
    overview: { region: "US", currency: "USD" },
    list: Array.from({ length: 14 }, (_, i) => ({
      dt: new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10),
      gmv: i < 7 ? 100 : 200 + (i - 7) * 100,
      units_sold: i < 7 ? 5 : 10 + i,
    })),
  };
}
test("recommendations use complete consecutive US days and explain observed growth", () => {
  const trend = normalizeSalesTrend(raw(), { now });
  const r = scoreProductTrend(trend, { now });
  assert.equal(r.label, "Ngon húp luôn");
  assert.equal(r.current7, 3500);
  assert.equal(r.previous7, 700);
  assert.equal(r.growth, 400);
  assert.equal(r.activeDays, 7);
  assert.equal(trend.measurement, "estimated_gmv");
});
test("missing days, stale data, zero baseline and incomplete days cannot create false winners", () => {
  const missing = raw();
  missing.list.splice(8, 1);
  assert.equal(
    scoreProductTrend(normalizeSalesTrend(missing, { now }), { now }).score,
    null,
  );
  assert.equal(
    scoreProductTrend(normalizeSalesTrend(raw(), { now }), {
      now: now + 4 * 86400000,
    }).eligible,
    false,
  );
  const zero = raw();
  zero.list.slice(0, 7).forEach((r) => (r.gmv = 0));
  const r = scoreProductTrend(normalizeSalesTrend(zero, { now }), { now });
  assert.equal(r.growth, null);
  assert.equal(r.eligible, false);
  const partial = raw();
  partial.list.push({ dt: "2026-11-08", gmv: 999999999, units_sold: 999 });
  const trend = normalizeSalesTrend(partial, { now });
  assert.equal(trend.series.at(-1).provisional, true);
  assert.equal(scoreProductTrend(trend, { now }).current7, 3500);
});
test("invalid currency, region, dates and sales are rejected without replacing them by zero", () => {
  for (const change of [
    (d) => (d.overview.region = "UK"),
    (d) => (d.overview.currency = "GBP"),
    (d) => d.list.push(d.list[0]),
    (d) => (d.list[0].gmv = null),
    (d) => (d.list[0].units_sold = -1),
    (d) => (d.list[0].dt = "2026-02-30"),
  ]) {
    const d = raw();
    change(d);
    assert.throws(() => normalizeSalesTrend(d, { now }));
  }
});

test("a single spike cannot earn the winning label", () => {
  const data = raw();
  data.list.slice(7).forEach((r) => {
    r.gmv = 100;
    r.units_sold = 10;
  });
  data.list.at(-1).gmv = 10000;
  const result = scoreProductTrend(normalizeSalesTrend(data, { now }), { now });
  assert.equal(result.eligible, false);
  assert.ok(result.growth > 50);
});
test("FastMoss protocol retains long identifiers and does not expose secrets on errors", async () => {
  let request;
  const client = new FastMossClient("secret-test-value", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        '{"code":0,"data":{"list":[{"product_id":1729421229342823356}]}}',
      );
    },
  });
  const result = await client.request("/product/v1/search", {
    filter: { region: "US" },
  });
  assert.equal(result.list[0].product_id, "1729421229342823356");
  assert.equal(request.url, "https://openapi.fastmoss.com/product/v1/search");
  assert.equal(
    request.options.headers.authorization,
    "Bearer secret-test-value",
  );
  assert.equal(request.options.redirect, "error");
  const denied = new FastMossClient("sensitive-key", {
    fetchImpl: async () =>
      new Response('{"message":"sensitive-key"}', { status: 403 }),
  });
  await assert.rejects(
    denied.request("/product/v1/search", {}),
    (e) =>
      !e.message.includes("sensitive-key") && e.code === "MARKET_SOURCE_FAILED",
  );
});
test("scan persists US products, daily and shop metrics, partial source failures and idempotency", async (t) => {
  const store = new Store(
    path.resolve(".verification", `product-market-${randomUUID()}`),
  );
  const project = store.createProject("Market QA");
  let calls = 0;
  const client = {
    calls: 0,
    request: async (endpoint, body) => {
      calls++;
      client.calls++;
      if (endpoint.endsWith("/salesTrend")) return raw();
      if (endpoint === "/product/v1/search") {
        assert.equal(body.filter.region, "US");
        return {
          list: [
            {
              product_id: "1729421229342823356",
              region: "US",
              title: "QA bottle",
              shop: { seller_id: "12345", name: "QA shop" },
            },
            {
              product_id: "1729421229342823357",
              region: "GB",
              title: "Wrong market",
            },
          ],
        };
      }
      if (endpoint === "/shop/v1/search")
        return {
          list: [
            {
              seller_id: "12345",
              region: "US",
              day7_total_gmv: 12345,
              day7_units_sold: 500,
            },
          ],
        };
      throw new Error("Video source temporarily unavailable");
    },
  };
  const service = new ProductMarket(store, {
    clientFactory: () => client,
    now: () => now,
  });
  t.after(() => service.close());
  const input = {
    projectId: project.id,
    requestId: randomUUID(),
    keywords: "bottle",
  };
  assert.throws(
    () => service.start(input),
    (e) => e.code === "MARKET_SOURCE_REQUIRED",
  );
  service.configure("test-key-never-real");
  const scan = service.start(input);
  assert.equal(service.start(input).id, scan.id);
  await Promise.all(service.running.values());
  assert.equal(scan.status, "completed");
  assert.equal(scan.products.length, 1);
  assert.equal(scan.products[0].shopRevenue7.revenue, 12345);
  assert.equal(scan.products[0].recommendation.eligible, true);
  assert.equal(scan.errors.length, 2);
  assert.equal(calls, 4);
  service.manage(scan.id, scan.products[0].id, "shortlisted");
  assert.equal(scan.products[0].management, "shortlisted");
  assert.throws(
    () => service.start({ ...input, keywords: "other" }),
    (e) => e.code === "REQUEST_CONFLICT",
  );
  assert.equal(
    JSON.stringify(store.publicSnapshot()).includes("test-key-never-real"),
    false,
  );
  const saved = await fs.readFile(
    path.join(store.root, ".private", "product-fastmoss.json"),
    "utf8",
  );
  assert.equal(saved.includes("test-key-never-real"), false);
});
