import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { Store } from "../server/store.js";
import { startServer } from "../server/index.js";
import {
  normalizeSalesTrend,
  scoreProductTrend,
} from "../server/product-market.js";
const root = path.resolve(".verification", `product-ui-${Date.now()}`),
  store = new Store(root),
  project = store.createProject("Product & US Research QA");
store.state.settings.queuePaused = true;
store.state.settings.llm.enabled = true;
store.save();
const sourceImage = path.resolve(
  "../.maintenance/product-studio-us-20261108/study-workspace/media",
);
const image = store.add("media", {
  kind: "image",
  mediaType: "product",
  projectId: project.id,
  name: "QA image",
  file: path.join(root, "qa.png"),
});
await fs.writeFile(
  image.file,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const now = Date.parse("2026-11-08T15:00:00Z"),
  products = [0, 1].map((n) => {
    const trend = normalizeSalesTrend(
      {
        overview: { region: "US", currency: "USD" },
        list: Array.from({ length: 28 }, (_, i) => ({
          dt: new Date(Date.UTC(2026, 9, 11 + i)).toISOString().slice(0, 10),
          gmv: i < 21 ? 100 + n * 25 : (200 + (i - 21) * 100) * (1 + n * 0.2),
          units_sold: 20 + i,
        })),
      },
      { now },
    );
    return {
      id: `172942122934282335${n}`,
      name: `QA fixture ${n ? "Travel cup" : "Water bottle"} — test data`,
      sellerId: `shop-${n}`,
      sellerName: `QA shop ${n + 1}`,
      imageUrl: null,
      sourceUrl: "https://www.fastmoss.com",
      url: "https://example.com/product",
      trend,
      recommendation: scoreProductTrend(trend, { now }),
      shopRevenue7: { revenue: 10000 + n * 4000 },
      videos: [
        {
          id: "qa-video",
          title: "QA product video",
          url: "https://www.tiktok.com",
          views: 10000,
          gmv: 500,
          units: 30,
        },
      ],
      management: "new",
    };
  });
const scan = store.add("productScans", {
  projectId: project.id,
  request: {
    requestId: randomUUID(),
    keywords: "QA bottle",
    limit: 5,
    minWeeklyGmv: 1000,
    minGrowth: 50,
  },
  products,
  status: "completed",
  stage: "Quét hoàn tất",
  apiCalls: 7,
  errors: [],
});
store.patch("media", image.id, { marketProductId: products[0].id });
const app = await startServer({ port: 0, dataDir: root });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  report = { root, checks: [], fixtureData: true };
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.address);
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .click();
  await page.getByRole('heading',{name:'Research Product · US',exact:true}).waitFor();
  await page.getByRole('button',{name:'Research Free',exact:true}).click();
  await page.locator(".product-research-page").waitFor();
  await page.getByRole('heading',{name:'AI Research · Free',exact:true}).waitFor();
  assert.equal(await page.getByLabel('FastMoss client_secret').count(),0);
  await page.getByLabel('Sản phẩm / ngách cần tìm (tiếng Anh)').fill('water bottle');
  assert.equal(await page.getByRole('button',{name:'Quét miễn phí',exact:true}).isDisabled(),false);
  report.checks.push('Research Free remains available without a FastMoss key alongside the multi-source hub');
  await page.getByRole('button',{name:'Doanh thu · FastMoss',exact:true}).click();
  await page.getByLabel("FastMoss client_secret").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Quét thị trường US", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("img", { name: /Biểu đồ GMV/ }).count(), 1);
  assert.equal(await page.locator(".market-product").count(), 2);
  await page.locator(".market-product").nth(1).getByRole("checkbox").check();
  assert.equal(await page.locator(".revenue-chart polyline").count(), 2);
  await page.getByText("Bảng số liệu đầy đủ", { exact: true }).click();
  assert.equal(await page.locator(".product-data-table tbody tr").count(), 28);
  await page
    .getByRole("button", { name: "Nhặt sản phẩm", exact: true })
    .click();
  await page.waitForTimeout(200);
  assert.equal(
    app.store.require("productScans", scan.id).products[0].management,
    "shortlisted",
  );
  await page
    .getByRole("group", { name: "Lọc kết quả" })
    .getByRole("button", { name: "Đã nhặt", exact: true })
    .click();
  assert.equal(await page.locator(".market-product").count(), 1);
  await page.getByText("Bảng số liệu đầy đủ", { exact: true }).click();
  await page.screenshot({
    path: path.join(root, "research-desktop.png"),
    fullPage: true,
  });
  report.checks.push(
    "Real page renders source-labelled fixture charts, compare lines, full data table, filters and persisted shortlist; scanning disabled without key",
  );
  await page
    .getByRole("button", { name: "Đề xuất làm video", exact: true })
    .click();
  await page.locator(".product-studio-v2").waitFor();
  assert.equal(
    await page.getByLabel("Link sản phẩm", { exact: true }).inputValue(),
    "https://example.com/product",
  );
  assert.equal(
    await page.getByLabel("Hoặc dùng ảnh đã có").inputValue(),
    image.id,
  );
  assert.equal(await page.getByLabel("Độ dài thành phẩm").inputValue(), "15");
  await page.screenshot({
    path: path.join(root, "product-desktop.png"),
    fullPage: true,
  });
  report.checks.push(
    "Selected research product transfers image and listing into Product Studio with 15-second free default",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .last()
    .click();
  await page.getByRole('button',{name:'Research Free',exact:true}).click();
  await page.locator(".product-research-page").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(root, "research-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  report.checks.push(
    "Product and AI Research fit small screens without JavaScript errors",
  );
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  await page.screenshot({
    path: path.join(root, "failure.png"),
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.resolve(".verification/product-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await app.close();
}
