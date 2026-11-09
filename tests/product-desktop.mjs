import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const root = path.resolve(".verification", `product-desktop-${randomUUID()}`);
await fs.mkdir(root, { recursive: true });
const env = { ...process.env, STUDIO_DATA_DIR: path.join(root, "workspace") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.resolve("release/win-unpacked/Viral Studio.exe"),
  args: [`--user-data-dir=${path.join(root, "shell")}`],
  env,
  timeout: 60000,
});
const report = { root, errors: [], passed: false };
try {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
    BrowserWindow.prototype.show = function () {};
  });
  let page;
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    page = app.windows().find((p) => p.url().startsWith("http://"));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, "Packaged app opened its local server");
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .click();
  await page.getByRole('heading', {name:'Research Product · US',exact:true}).waitFor();
  await page.getByRole('button', {name:'Research Free',exact:true}).click();
  await page
    .getByRole("heading", { name: "AI Research · Free", exact: true })
    .waitFor();
  await page
    .getByLabel("Sản phẩm / ngách cần tìm (tiếng Anh)")
    .fill("water bottle");
  assert.equal(
    await page
      .getByRole("button", { name: "Quét miễn phí", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(await page.getByLabel("FastMoss client_secret").count(), 0);
  assert.equal(await page.locator(".market-product").count(), 0);
  await page
    .getByRole("button", { name: "Product Studio", exact: true })
    .click();
  await page.locator(".product-studio-v2").waitFor();
  assert.equal(await page.getByLabel("Độ dài thành phẩm").inputValue(), "15");
  await page.getByRole("button", { name: "Dựng video", exact: true }).click();
  await page.getByRole('heading',{name:'Dựng video thủ công',exact:true}).waitFor();
  assert.equal(await page.locator('.production-panel').count(),0);
  await page.getByLabel('Loại video xuất từ timeline').selectOption('product');
  report.health = await page.evaluate(async () => {
    const r = await fetch("/api/health");
    const h = await r.json();
    return {
      tools: h.tools.map((t) => ({ name: t.name, available: t.available })),
      browser: h.browser.available,
    };
  });
  assert.ok(report.health.tools.every((t) => t.available));
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  assert.equal(state.accounts.length, 0);
  assert.deepEqual(state.productRuns, []);
  assert.deepEqual(state.productScans, []);
  report.packaged = await app.evaluate(({ app }) => {
    const fs = process.getBuiltinModule("fs"),
      path = process.getBuiltinModule("path");
    const source = fs.readFileSync(
      path.join(app.getAppPath(), "server", "product-intelligence.js"),
      "utf8",
    );
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      hasBoundedReferences: source.includes("candidateIndexes"),
      hasImageIdentityGuard: source.includes("familiar silhouette"),
    };
  });
  assert.equal(report.packaged.version, "0.15.0");
  assert.equal(report.packaged.packaged, true);
  assert.equal(report.packaged.hasBoundedReferences, true);
  assert.equal(report.packaged.hasImageIdentityGuard, true);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: path.join(root, "product-packaged.png") });
  report.passed = true;
} catch (e) {
  report.error = e.stack;
  process.exitCode = 1;
} finally {
  await app.close();
  await fs.writeFile(
    path.resolve(".verification/product-desktop-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
