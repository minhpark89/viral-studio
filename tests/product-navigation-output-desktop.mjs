import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../server/store.js";
import { binary, runProcess, importMedia } from '../server/media.js';

const root = path.resolve(
    ".verification",
    `product-links-output-${Date.now()}`,
  ),
  store = new Store(path.join(root, "workspace")),
  project = store.createProject("Links & Output QA");
store.state.settings.queuePaused = true;
store.state.settings.llm.enabled = false;
const timelineImage=path.join(store.root,'temp','timeline.png');
await runProcess(binary('ffmpeg',store.state.settings),['-y','-f','lavfi','-i','color=c=blue:s=80x80','-frames:v','1',timelineImage]);
const timelineMedia=await importMedia(store,timelineImage,{projectId:project.id,mediaType:'product'});
project.timeline.clips=[{id:randomUUID(),mediaId:timelineMedia.id,inSec:0,outSec:1,speed:1,zoom:1,fit:'cover',volume:0}];
const evidence = JSON.parse(
  await fs.readFile(
    path.resolve("../.maintenance/product-free-batch-20261108/live-free.json"),
    "utf8",
  ),
);
delete evidence.id;
store.add("productFreeScans", {
  ...evidence,
  projectId: project.id,
  request: {
    ...evidence.request,
    projectId: project.id,
    requestId: randomUUID(),
  },
});
store.save();
const env = { ...process.env, STUDIO_DATA_DIR: store.root };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = Boolean(process.env.PRODUCT_TEST_PACKAGED),
  exe = packaged
    ? "release/win-unpacked/Viral Studio.exe"
    : "node_modules/electron/dist/electron.exe";
const application = await electron.launch({
  executablePath: path.resolve(exe),
  args: [
    ...(packaged ? [] : ["."]),
    `--user-data-dir=${path.join(root, "shell")}`,
  ],
  env,
  timeout: 60000,
});
const report = { root, packaged, checks: [], errors: [], passed: false };
let page;
try {
  await application.evaluate(({ BrowserWindow, shell, dialog }) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    BrowserWindow.prototype.show = function () {};
    globalThis.__openedWeb = [];
    globalThis.__openedFolders = [];
    globalThis.__folderChoice = null;
    globalThis.__folderDialogCalls = [];
    shell.openExternal = async (url) => {
      globalThis.__openedWeb.push(url);
      if (globalThis.__failOpen) throw new Error("Simulated missing browser");
    };
    shell.openPath = async (folder) => {
      globalThis.__openedFolders.push(folder);
      return "";
    };
    dialog.showOpenDialog = async (window, options) => {
      globalThis.__folderDialogCalls.push(options);
      return globalThis.__folderChoice
        ? { canceled: false, filePaths: [globalThis.__folderChoice] }
        : { canceled: true, filePaths: [] };
    };
  });
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    page = application.windows().find((p) => p.url().startsWith("http://"));
    if (page) break;
    await delay(100);
  }
  assert.ok(page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page
    .getByRole("button", { name: "AI Research · US", exact: true })
    .click();
  await page.getByRole('button', {name:'Research Free',exact:true}).click();
  await page
    .getByRole("link", { name: "Xem video trên YouTube", exact: true })
    .first()
    .click();
  assert.deepEqual(await application.evaluate(() => globalThis.__openedWeb), [
    evidence.videos[0].url,
  ]);
  assert.equal(
    application.windows().filter((p) => p.url().startsWith("http://")).length,
    1,
  );
  assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/);
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://www.fastmoss.com";
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.append(a);
    a.click();
    a.remove();
  });
  await delay(100);
  assert.ok(
    (await application.evaluate(() => globalThis.__openedWeb)).includes(
      "https://www.fastmoss.com/",
    ),
  );
  const rejected = await page.evaluate(async () => {
    try {
      await window.studioDesktop.openExternal(
        "file:///C:/Windows/System32/cmd.exe",
      );
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  await application.evaluate(() => {
    globalThis.__failOpen = true;
  });
  await page
    .getByRole("link", { name: "Xem video trên YouTube", exact: true })
    .first()
    .click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /sao chép link/);
  await application.evaluate(() => {
    globalThis.__failOpen = false;
  });
  report.checks.push(
    "Actual Electron click forwards YouTube to OS browser, opens no app popup, allows FastMoss, rejects file URLs and surfaces browser errors",
  );
  await page
    .getByRole("button", { name: "Product Studio", exact: true })
    .click();
  const picker = page.locator(".product-output-picker");
  await picker.waitFor();
  const outputBox=await picker.boundingBox();assert.ok(outputBox.y<500,'Folder picker is near the top of Product Studio');
  const systemDefault = path.join(store.root, "exports", "products", "final");
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".product-output-path")?.textContent === expected,
    systemDefault,{polling:100,timeout:15000},
  );
  await picker
    .getByRole("button", { name: "Mở thư mục Output", exact: true })
    .click();
  assert.deepEqual(
    await application.evaluate(() => globalThis.__openedFolders),
    [systemDefault],
  );
  const custom = path.join(root, "Selected Product Output");
  await application.evaluate((_, folder) => {
    globalThis.__folderChoice = folder;
  }, custom);
  await picker
    .getByRole("button", { name: "Chọn thư mục…", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Đường dẫn thư mục Product").inputValue(),
    custom,
  );
  const dialogs = await application.evaluate(
    () => globalThis.__folderDialogCalls,
  );
  assert.deepEqual(dialogs[0].properties, ["openDirectory", "createDirectory"]);
  await page.getByLabel("Đường dẫn thư mục Product").fill("");
  assert.equal(
    await page.getByLabel("Đường dẫn thư mục Product").isVisible(),
    true,
  );
  await page.getByLabel("Đường dẫn thư mục Product").fill(custom);
  await picker
    .getByRole("button", { name: "Đặt làm mặc định Product", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Về mặc định của app", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Nơi lưu video Product", { exact: true })
      .inputValue(),
    "default",
  );
  const saved = await page.evaluate(async () =>
    (await fetch("/api/product-output/settings")).json(),
  );
  assert.equal(saved.defaultDirectory, custom);
  await picker
    .getByRole("button", { name: "Mở thư mục Output", exact: true })
    .click();
  assert.ok(
    (await application.evaluate(() => globalThis.__openedFolders)).includes(
      custom,
    ),
  );
  await application.evaluate(() => {
    globalThis.__folderChoice = null;
  });
  await picker
    .getByRole("button", { name: "Chọn thư mục…", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Nơi lưu video Product", { exact: true })
      .inputValue(),
    "default",
  );
  await picker
    .getByRole("button", { name: "Về mặc định của app", exact: true })
    .click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".product-output-path")?.textContent === expected,
    systemDefault,{polling:100,timeout:15000},
  );
  report.checks.push(
    "Native folder dialog IPC supports choose/cancel; custom default persists, folder opening targets correct path and reset restores Product-only app folder",
  );
  await picker.evaluate(element=>element.scrollIntoView({block:'center'}));
  await page.screenshot({ path: path.join(root, "output-controls.png") });
  await page.getByRole('button',{name:'Dựng video',exact:true}).click();
  await page.getByLabel('Loại video xuất từ timeline').selectOption('product');
  await page.getByRole('button',{name:'Xuất video',exact:true}).click();
  const modal=page.locator('.modal');
  await modal.getByLabel('Nơi lưu video Product từ timeline').waitFor();
  const timelineOutput=path.join(root,'Timeline Product Output');
  await application.evaluate((_,folder)=>{globalThis.__folderChoice=folder;},timelineOutput);
  await modal.getByRole('button',{name:'Chọn thư mục…',exact:true}).click();
  assert.equal(await modal.getByLabel('Đường dẫn thư mục Product').inputValue(),timelineOutput);
  await modal.getByRole('button',{name:'Bắt đầu xuất',exact:true}).click();
  await page.waitForFunction(async expected=>{const s=await(await fetch('/api/state')).json();return s.jobs.some(j=>j.production?.productOutputDirectory===expected);},timelineOutput);
  const queued=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).jobs);
  assert.equal(queued.at(-1).production.productOutputDirectory,timelineOutput);
  report.checks.push('Product timeline export exposes native folder selection and freezes it on the queued job');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.error = e.stack;
  process.exitCode = 1;
  if (page)
    await page.screenshot({
      path: path.join(root, "failure.png"),
      fullPage: true,
    });
} finally {
  await application.close();
  await fs.writeFile(
    path.resolve(
      `.verification/product-links-output-${packaged ? "packaged" : "source"}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
