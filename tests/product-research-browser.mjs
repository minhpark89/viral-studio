import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startServer } from "../server/index.js";
import {
  parseAds,
  parseInterest,
} from "../server/product-research/providers.js";
import { evidence } from "../server/product-research/evidence.js";

const root = path.resolve(".verification", `product-research-ui-${Date.now()}`);
const app = await startServer({ port: 0, dataDir: root });
const project =
  app.store.state.projects[0] || app.store.createProject("Product Research UI");
const now = new Date().toISOString(),
  errors = [],
  report = { root, checks: [], fixtureData: true };
app.productResearch.providers.scan = async (source) => {
  if (source === "ads")
    return {
      records: parseAds(
        {
          ads: [
            {
              ad_archive_id: "1234567890123456789",
              page_name: "Fixture Christian Gifts",
              title: "Gift reveal reference",
              body: "A source-contract fixture for UI testing, not a real active advertisement.",
              is_active: true,
              publisher_platforms: ["facebook", "instagram"],
              start_date: now.slice(0, 10),
              link: "https://example.com/gift",
            },
          ],
        },
        now,
      ),
    };
  if (source === "interest")
    return {
      records: parseInterest(
        {
          interest_over_time: {
            timeline_data: Array.from({ length: 12 }, (_, i) => ({
              timestamp: String(
                Math.floor(Date.now() / 1000) - 86400 * (12 - i),
              ),
              values: [{ extracted_value: i === 5 ? null : i * 8 }],
            })),
          },
        },
        "Jesus wall art",
        now,
      ),
    };
  if (source === "youtube")
    return {
      records: [
        evidence({
          provider: "youtube_public",
          platform: "youtube",
          kind: "video",
          externalId: "fixture-video",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          title: "Fixture art product demo",
          description: "UI fixture",
          publishedAt: now,
          observedAt: now,
          metrics: { views: 52000 },
        }),
      ],
    };
  return { records: [], note: "Fixture empty response; no invented result." };
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.address);
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Research Product · US", exact: true })
    .waitFor();
  await page
    .getByLabel("Từ khóa / tên sản phẩm (tiếng Anh)")
    .fill("Jesus wall art");
  for (const source of ["Google Trends · biểu đồ ngách", "Meta Ads · Facebook"])
    await page
      .locator(".pr-sources label")
      .filter({ hasText: source })
      .locator("input")
      .check();
  await page
    .getByRole("button", { name: "Quét nguồn đã chọn", exact: true })
    .click();
  await page.locator(".pr-card").nth(2).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".pr-card").count(), 3);
  assert.equal(await page.locator(".pr-card.ad").count(), 0);
  assert.ok(
    (await page.locator(".pr-results").innerText()).includes("Chưa có dữ liệu"),
  );
  assert.equal(
    await page
      .getByRole("img", { name: "Mức quan tâm US: Jesus wall art" })
      .count(),
    1,
  );
  const adLink = page.getByRole("link", { name: "Xem quảng cáo / video gốc" });
  assert.equal(
    await adLink.getAttribute("href"),
    "https://www.facebook.com/ads/library/?id=1234567890123456789",
  );
  assert.equal(await adLink.getAttribute("target"), "_blank");
  report.checks.push(
    "Multi-source scan and charts; clickable canonical ad/video links; missing revenue remains unknown",
  );
  await page
    .getByText("Thêm dữ liệu miễn phí: CSV Google Trends / link mẫu social", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Nhập CSV Google Trends US")
    .setInputFiles({
      name: "multiTimeline.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Category: All categories\n\nWeek,Christian gifts: (United States)\n2026-10-01,25\n2026-10-08,\n2026-10-15,80\n",
      ),
    });
  await page
    .getByRole("img", { name: "Mức quan tâm US: Christian gifts" })
    .waitFor();
  await page.getByLabel("Tên mẫu tham khảo").fill("My selected Reel");
  await page
    .getByLabel("Link video / quảng cáo mẫu")
    .fill("https://www.instagram.com/reel/ExampleRef/");
  await page
    .getByLabel("Điểm muốn học từ mẫu")
    .fill("Gift reveal and close-up composition.");
  await page.getByRole("button", { name: "Lưu link mẫu", exact: true }).click();
  await page
    .getByRole("link", { name: "My selected Reel", exact: false })
    .waitFor();
  await page.getByLabel("Chọn Christian gifts", { exact: true }).check();
  await page.getByLabel("Chọn My selected Reel", { exact: true }).check();
  await page.getByRole("button", { name: "Lưu mẫu", exact: true }).click();
  await page.getByText("Theo dõi ngách này tự động", { exact: true }).click();
  await page
    .getByRole("button", { name: "Bật theo dõi cấu hình này", exact: true })
    .click();
  await page.getByRole("heading", { name: "Ngách đang theo dõi" }).waitFor();
  await page.getByRole("button", { name: "Tắt theo dõi", exact: true }).click();
  await page.getByRole("button", { name: "Bật lại", exact: true }).waitFor();
  report.checks.push(
    "Free Google CSV import; manual Instagram reference; persisted shortlist; watch on/off",
  );
  await page.screenshot({
    path: path.join(root, "research-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(root, "research-compact.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Sang Product Studio", exact: false })
    .click();
  await page
    .getByRole("heading", { name: "Product Studio", exact: true })
    .waitFor();
  await page
    .getByText("2 nguồn từ Research đa nguồn", { exact: true })
    .waitFor();
  assert.equal(app.store.state.productCampaigns.length, 0);
  const draft = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`product-draft-${id}`)),
    project.id,
  );
  assert.equal(draft.researchEvidence.length, 2);
  report.checks.push(
    "Product Studio receives the selected source context; no automatic render or publish",
  );
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .first()
    .click();
  await page.getByLabel("Chọn My selected Reel", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Chọn My selected Reel", { exact: true }).isChecked(),
    true,
  );
  await page
    .getByRole("button", { name: "Research Free", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "AI Research · Free", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Doanh thu · FastMoss", exact: true })
    .click();
  assert.ok((await page.locator("body").innerText()).includes("FastMoss"));
  report.checks.push(
    "Existing Research Free and FastMoss tabs remain available",
  );
  assert.deepEqual(errors, []);
} finally {
  report.errors = errors;
  await fs.writeFile(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await app.close();
  console.log(JSON.stringify(report, null, 2));
}
