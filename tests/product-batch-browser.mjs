import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { Store } from "../server/store.js";
import { startServer } from "../server/index.js";
import { binary, runProcess } from "../server/media.js";

const root = path.resolve(".verification", `product-batch-ui-${Date.now()}`),
  store = new Store(root),
  project = store.createProject("Batch UI verification");
store.state.settings.queuePaused = true;
store.state.settings.llm.enabled = true;
const scan = JSON.parse(
  await fs.readFile(
    path.resolve("../.maintenance/product-free-batch-20261108/live-free.json"),
    "utf8",
  ),
);
delete scan.id;
store.add("productFreeScans", {
  ...scan,
  projectId: project.id,
  request: { ...scan.request, projectId: project.id, requestId: randomUUID() },
});
store.save();
const sampleFile = path.join(root, "sample.mp4"),
  imageFile = path.join(root, "product.jpg");
await runProcess(binary("ffmpeg", store.state.settings), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x240:rate=12",
  "-t",
  "2",
  "-an",
  "-c:v",
  "libx264",
  sampleFile,
]);
await runProcess(binary("ffmpeg", store.state.settings), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=blue:s=200x200",
  "-frames:v",
  "1",
  imageFile,
]);
const app = await startServer({ port: 0, dataDir: root }),
  browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  report = { root, errors: [], checks: [], liveSourceSnapshot: true };
page.on("pageerror", (e) => report.errors.push(e.message));
try {
  await page.goto(app.address);
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .click();
  await page.getByRole('button', {name:'Research Free',exact:true}).click();
  await page
    .getByRole("heading", { name: "AI Research · Free", exact: true })
    .waitFor();
  assert.equal(await page.locator(".market-product").count(), 10);
  assert.ok((await page.locator(".free-evidence").innerText()).includes(scan.videos[0].views.toLocaleString('vi-VN')));
  assert.equal(await page.getByRole("img", { name: /GMV/ }).count(), 0);
  await page.screenshot({
    path: path.join(root, "free-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Làm video sản phẩm này", exact: true })
    .click();
  await page.locator(".product-studio-v2").waitFor();
  assert.equal(
    await page.getByLabel("Link sản phẩm", { exact: true }).inputValue(),
    "",
  );
  assert.match(
    await page
      .getByLabel("Link YouTube tham khảo thêm (tối đa 3)")
      .inputValue(),
    /youtube.com/,
  );
  report.checks.push(
    "Actual captured free-source views render without GMV claims; transfer retains source links and requires a real product",
  );
  await page
    .getByLabel("Tải ảnh sản phẩm", { exact: true })
    .setInputFiles(imageFile);
  await page.locator(".product-input-preview").waitFor();
  await page
    .getByLabel("Tải video mẫu", { exact: true })
    .setInputFiles(sampleFile);
  await page.locator(".product-sample-preview").waitFor();
  assert.equal(
    await page.getByLabel("Phong cách video", { exact: true }).inputValue(),
    "reference",
  );
  await page.getByLabel("Số lượng video / đợt", { exact: true }).fill("3");
  await page.getByLabel("Tự tạo video hằng ngày", { exact: true }).check();
  await page.getByLabel("Giờ tạo hằng ngày", { exact: true }).fill("23:59");
  await page.getByLabel("Múi giờ", { exact: true }).selectOption("UTC");
  await page.getByLabel("Tạo đợt đầu ngay hôm nay", { exact: true }).uncheck();
  assert.match(
    await page.locator(".product-budget").innerText(),
    /9 lượt Product/,
  );
  const outputDirectory=path.join(root,'Batch output');
  await page.getByLabel('Nơi lưu video Product',{exact:true}).selectOption('custom');
  await page.getByLabel('Đường dẫn thư mục Product',{exact:true}).fill(outputDirectory);
  await page
    .getByRole("button", { name: "Lưu sản phẩm & lịch hằng ngày", exact: true })
    .click();
  await page.locator(".campaign-card").waitFor();
  assert.equal(app.store.state.productCampaigns.length, 1);
  let campaign = app.store.state.productCampaigns[0];
  assert.equal(campaign.quantity, 3);
  assert.equal(campaign.request.style, "reference");
  assert.equal(campaign.request.outputDirectory,outputDirectory);
  assert.ok(campaign.request.sampleVideoMediaId);
  assert.equal(app.store.state.productRuns.length, 0);
  await page
    .getByRole("button", { name: "Đổi số lượng / phong cách", exact: true })
    .click();
  await page.getByLabel("Số video / đợt tiếp theo").fill("5");
  await page.getByLabel("Phong cách đợt tiếp theo").selectOption("cinematic");
  await page
    .getByRole("button", { name: "Lưu đợt tiếp theo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tạo thêm 5 video", exact: true })
    .waitFor();
  campaign = app.store.state.productCampaigns[0];
  assert.equal(campaign.quantity, 5);
  assert.equal(campaign.request.style, "cinematic");
  await page
    .getByRole("button", { name: "Tắt lịch hằng ngày", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bật lịch hằng ngày", exact: true })
    .waitFor();
  assert.equal(campaign.schedule.enabled, false);
  report.checks.push(
    "Real upload API, reference selection, 3-video budget, future daily schedule, quantity/style edits and pause persist correctly",
  );
  let sent;
  await page.route("**/api/product-campaigns/*/run", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ runIds: [] }),
    });
  });
  await page
    .getByRole("button", { name: "Tạo thêm 5 video", exact: true })
    .click();
  await page.waitForTimeout(150);
  assert.match(sent.requestId, /^[0-9a-f-]{36}$/);
  await page.unroute("**/api/product-campaigns/*/run");
  await page.screenshot({
    path: path.join(root, "product-batch-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(root, "product-batch-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .last()
    .click();
  await page.getByRole('button',{name:'Research Free',exact:true}).click();
  await page.locator(".free-research-page").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(root, "free-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.stack;
  process.exitCode = 1;
  await page.screenshot({
    path: path.join(root, "failure.png"),
    fullPage: true,
  });
} finally {
  await browser.close();
  await app.close();
  await fs.writeFile(
    path.resolve(".verification/product-batch-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
