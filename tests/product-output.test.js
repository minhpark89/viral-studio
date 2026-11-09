import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Store } from "../server/store.js";
import {
  productOutputSettings,
  checkProductOutput,
  resolveProductOutput,
  mountProductOutput,
} from "../server/product-output.js";
import { ProductStudio } from "../server/product-studio.js";
import { ProductCampaigns } from "../server/product-campaigns.js";
import { importMedia, binary, runProcess } from "../server/media.js";
import express from "express";
const { externalWebUrl, openExternalWeb } = createRequire(import.meta.url)(
  "../desktop/external-links.cjs",
);
const fixture = () => {
  const store = new Store(
      path.resolve(".verification", `output-${randomUUID()}`),
    ),
    project = store.createProject("Output QA");
  return {
    store,
    project,
    request: {
      projectId: project.id,
      requestId: randomUUID(),
      productUrl: "https://example.com/product",
      autoRender: false,
    },
  };
};

test("reference links accept real web URLs and reject executable schemes and credentials", async () => {
  const opened = [];
  for (const url of [
    "https://www.youtube.com/watch?v=23o20G7GgB0",
    "https://youtu.be/23o20G7GgB0",
    "https://www.tiktok.com/@creator/video/123",
    "https://www.fastmoss.com",
    "https://www.dreamfaceapp.com/video",
    "https://www.ikea.com/us/en/",
    "http://example.com/source",
  ]) {
    assert.ok(externalWebUrl(url));
    await openExternalWeb({ openExternal: async (u) => opened.push(u) }, url);
  }
  assert.equal(opened.length, 7);
  for (const url of [
    "file:///C:/Windows/System32/cmd.exe",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "mailto:user@example.com",
    "https://user:secret@example.com",
    "not a url",
  ]) {
    assert.equal(externalWebUrl(url), null);
    await assert.rejects(
      openExternalWeb({ openExternal: () => assert.fail("unsafe open") }, url),
    );
  }
  await assert.rejects(
    openExternalWeb(
      {
        openExternal: async () => {
          throw new Error("Browser unavailable");
        },
      },
      "https://youtube.com",
    ),
    /Browser unavailable/,
  );
});
test("Product defaults stay in their own folder and reject unusable directories before rendering", async () => {
  const { store } = fixture();
  assert.equal(
    productOutputSettings(store).defaultDirectory,
    path.join(store.root, "exports", "products", "final"),
  );
  assert.equal(
    checkProductOutput(store),
    productOutputSettings(store).defaultDirectory,
  );
  assert.throws(
    () => resolveProductOutput(store, "relative/folder"),
    /đường dẫn/,
  );
  assert.throws(
    () => resolveProductOutput(store, "C:\\bad\0folder"),
    /đường dẫn/,
  );
  const file = path.join(store.root, "temp", "not-a-folder");
  await fs.writeFile(file, "do not change");
  assert.throws(() => checkProductOutput(store, file), /Không ghi/);
  assert.equal(await fs.readFile(file, "utf8"), "do not change");
  assert.deepEqual(await fs.readdir(checkProductOutput(store)), []);
});

test('invalid output never reserves an empty campaign or overwrites its valid configuration',async()=>{
 const {store,request}=fixture(),file=path.join(store.root,'temp','not-directory');await fs.writeFile(file,'retained');const studio=new ProductStudio(store,{}, {study:async()=>({analysis:{concept:'Fixture',scenes:[]}})}),campaigns=new ProductCampaigns(store,studio,{intervalMs:0});
 try{assert.throws(()=>campaigns.create({request:{...request,outputDirectory:file},quantity:2}),/Không ghi/);assert.equal(store.state.productCampaigns.length,0);assert.equal(store.state.productBatches.length,0);const result=campaigns.create({request,startNow:false});assert.throws(()=>campaigns.update(result.campaign.id,{request:{outputDirectory:file}}),/Không ghi/);assert.equal(result.campaign.request.outputDirectory,'');assert.equal(await fs.readFile(file,'utf8'),'retained');}finally{campaigns.close();await studio.close();}
});
test("batch output is frozen across default changes and applies a manual override only to that batch", async () => {
  const { store, request } = fixture(),
    a = path.join(store.root, "output-a"),
    b = path.join(store.root, "output-b"),
    manual = path.join(store.root, "manual");
  store.state.settings.productOutputDirectory = a;
  const studio = new ProductStudio(
      store,
      {},
      {
        study: async () => ({
          analysis: { concept: "fixture", scenes: [] },
          product: { name: "Fixture" },
        }),
      },
    ),
    campaigns = new ProductCampaigns(store, studio, { intervalMs: 0 });
  try {
    const first = campaigns.create({ request, quantity: 2 });
    await studio.worker;
    assert.equal(first.batch.outputDirectory, a);
    assert.ok(store.state.productRuns.every((r) => r.outputDirectory === a));
    store.state.settings.productOutputDirectory = b;
    assert.equal(
      campaigns.create({ request, quantity: 2 }).batch.id,
      first.batch.id,
    );
    assert.ok(store.state.productRuns.every((r) => r.outputDirectory === a));
    for (const r of store.state.productRuns)
      store.patch("productRuns", r.id, { status: "completed" });
    const second = campaigns.run(first.campaign.id, {
      requestId: randomUUID(),
    });
    await studio.worker;
    assert.equal(second.outputDirectory, b);
    for (const r of store.state.productRuns)
      store.patch("productRuns", r.id, { status: "completed" });
    campaigns.update(first.campaign.id, {
      request: { outputDirectory: manual },
    });
    const third = campaigns.run(first.campaign.id, { requestId: randomUUID() });
    await studio.worker;
    assert.equal(third.outputDirectory, manual);
    assert.equal(productOutputSettings(store).defaultDirectory, b);
  } finally {
    campaigns.close();
    await studio.close();
  }
});
test("custom Product output imports real MP4s without moving News or raw Product clips", async () => {
  const { store, project } = fixture(),
    file = path.join(store.root, "temp", "clip.mp4"),
    destination = path.join(store.root, "manual-products");
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
  const one = await importMedia(store, file, {
    projectId: project.id,
    generated: true,
    mediaType: "product-video",
    outputDirectory: destination,
    name: "Bottle - Video 1.mp4",
  });
  const two = await importMedia(store, file, {
    projectId: project.id,
    generated: true,
    mediaType: "product-video",
    outputDirectory: destination,
    name: "Bottle - Video 1.mp4",
  });
  assert.equal(path.dirname(one.file), destination);
  assert.match(path.basename(one.file), /^Bottle - Video 1-/);
  assert.notEqual(one.file, two.file);
  assert.ok(one.duration > 0);
  const news = await importMedia(store, file, {
    projectId: project.id,
    generated: true,
    mediaType: "news-video",
    outputDirectory: destination,
  });
  const raw = await importMedia(store, file, {
    projectId: project.id,
    generated: true,
    mediaType: "product-clip",
    outputDirectory: destination,
  });
  assert.equal(path.dirname(news.file), path.join(store.root, "exports"));
  assert.equal(
    path.dirname(raw.file),
    path.join(store.root, "exports", "products", "clips"),
  );
});
test("output settings API persists only Product default and supports resetting to app directory", async (t) => {
  const { store } = fixture(),
    app = express();
  app.use(express.json());
  mountProductOutput(app, store);
  app.use((e, req, res, next) => res.status(400).json({ error: e.message }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/product-output/settings`;
  const before = structuredClone(store.state.settings);
  const directory = path.join(store.root, "new-default");
  let response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).defaultDirectory, directory);
  assert.deepEqual(store.state.settings, {
    ...before,
    productOutputDirectory: directory,
  });
  const fresh = new Store(store.root);
  assert.equal(productOutputSettings(fresh).defaultDirectory, directory);
  response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: "" }),
  });
  assert.equal(
    (await response.json()).defaultDirectory,
    path.join(store.root, "exports", "products", "final"),
  );
});
