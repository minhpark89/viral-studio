import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { requestDreamFaceMcImage } from "../server/dreamface-image.js";
import { Store } from "../server/store.js";

const prompt = "Original fictional news presenter in a blue studio.";
const resultUrl = "https://uss3.dreamfaceapp.com/server/common/work/right-mc.png";
const profileId = "image-test-profile";
const receipt = { id: "submitted-image", profileId, promptHash: createHash("sha256").update(prompt).digest("hex"), submittedAt: "2026-11-02T07:00:00Z" };
let browser;
before(async () => {
  const executablePath = [process.env.CHROME_PATH, "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(value => value && existsSync(value));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); });

function work(status = 200) {
  return { id: "work-session", work_type: "AI_IMAGE", prompt, session_status: status, work_details: [{ animate_id: receipt.id, work_status: status, valid: true, image_urls: status === 200 ? [resultUrl] : [] }] };
}

async function fixture(t, options = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(() => context.close());
  const log = { submits: [], downloads: [], receipts: [] };
  let polls = 0;
  const success = data => ({ status_code: "THS12140000000", data });
  await page.route("https://www.dreamfaceapp.com/**", async route => {
    const url = new URL(route.request().url());
    let payload;
    if (url.pathname === "/image") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><p>0 credits</p><textarea placeholder="Type or paste text here"></textarea><button id="model" hidden></button><button id="create" disabled>Create</button><img src="data:image/png;base64,AA=="><script>
        const input=document.querySelector('textarea'),button=document.querySelector('#create');
        let model=false,history=false,submitted=${Boolean(options.pending)};
        const sync=()=>{button.disabled=!(model&&history&&input.value)};
        input.addEventListener('input',sync);
        fetch('/dw-server/model_config/ai_image/list/en').then(r=>r.json()).then(()=>{model=true;document.querySelector('#model').textContent='Dream Image 2.0';document.querySelector('#model').hidden=false;input.value='';sync()});
        async function poll(){await fetch('/dw-server/work_session/list').then(r=>r.json());if(!history){history=true;input.value='';sync()}}
        poll();setInterval(()=>{if(submitted)poll()},100);
        button.addEventListener('click',async()=>{const response=await fetch('/dw-server/task/v2/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:input.value})});const data=await response.json();if(data.data?.animate_image_id){submitted=true;poll()}});
      </script>` });
    }
    if (url.pathname.includes("/model_config/")) {
      await new Promise(resolve => setTimeout(resolve, options.modelDelay ?? 300));
      payload = success([{ model_name: "Dream Image 2.0", model_key: "dreamImage", is_active: true, features: [{ key: "free" }], credit_rules: [] }]);
    } else if (url.pathname.endsWith("/work_session/list")) {
      polls++;
      await new Promise(resolve => setTimeout(resolve, options.historyDelay ?? 150));
      const unrelated = { ...work(), id: "unrelated", prompt: "A landscape photograph", work_details: [{ animate_id: "other", work_status: 200, image_urls: ["https://uss3.dreamfaceapp.com/wrong.png"] }] };
      const completed = options.existing || (!options.neverFinishes && (log.submits.length > 0 || options.pending) && polls > 2);
      payload = success({ list: [unrelated, ...(completed ? [work()] : options.pending || log.submits.length ? [work(0)] : [])] });
    } else if (url.pathname.endsWith("/task/v2/submit")) {
      log.submits.push(route.request().postDataJSON());
      payload = options.quota ? { status_code: "QUOTA_LIMIT", status_msg: "Not enough credits" } : success({ animate_image_id: receipt.id });
    } else return route.fulfill({ status: 404, body: "Missing fixture route" });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) }).catch(() => {});
  });
  const session = { page, profileId, context: { request: { get: async url => {
    log.downloads.push(url);
    return { ok: () => true, headers: () => ({ "content-type": "image/png" }), body: async () => Buffer.alloc(1400, 4), dispose: async () => {} };
  } } } };
  return { page, log, run: extra => requestDreamFaceMcImage({ session, prompt, signal: new AbortController().signal, onRequest: value => log.receipts.push(value), readyTimeoutMs: 4000, confirmationTimeoutMs: 1500, timeoutMs: 3000, ...extra }) };
}

test("slow DreamFace hydration preserves the MC prompt and submits exactly once despite zero paid credits", async t => {
  const { run, log } = await fixture(t, { modelDelay: 650, historyDelay: 850 });
  const result = await run();
  assert.equal(result.bytes.length, 1400);
  assert.deepEqual(log.submits, [{ prompt }]);
  assert.deepEqual(log.downloads, [resultUrl]);
  assert.equal(log.receipts.at(-1).id, receipt.id);
});

test("an existing MC with the same prompt is recovered without another submission", async t => {
  const { run, log } = await fixture(t, { existing: true });
  await run();
  assert.equal(log.submits.length, 0);
  assert.deepEqual(log.downloads, [resultUrl]);
});

test("a pending MC receipt resumes polling without spending another generation", async t => {
  const { run, log } = await fixture(t, { pending: true });
  await run({ previousRequest: receipt });
  assert.equal(log.submits.length, 0);
  assert.deepEqual(log.downloads, [resultUrl]);
});

test("quota rejection is reported immediately instead of a generic image timeout", async t => {
  const { run, log } = await fixture(t, { quota: true });
  await assert.rejects(run(), error => error.code === "MC_IMAGE_QUOTA");
  assert.equal(log.submits.length, 1);
  assert.equal(log.downloads.length, 0);
});

test("a composer that never becomes ready cannot submit an image request", async t => {
  const { run, log } = await fixture(t, { modelDelay: 1500 });
  await assert.rejects(run({ readyTimeoutMs: 300 }), error => error.code === "MC_IMAGE_NOT_READY");
  assert.equal(log.submits.length, 0);
});

test("image timeout retains the acknowledged receipt and never clicks Create again", async t => {
  const { run, log } = await fixture(t, { neverFinishes: true });
  await assert.rejects(run({ timeoutMs: 350 }), error => error.code === "MC_IMAGE_TIMEOUT");
  assert.equal(log.receipts.at(-1).id, receipt.id);
  assert.equal(log.submits.length, 1);
});

test("cancelling image preparation removes listeners and does not submit", async t => {
  const { run, log, page } = await fixture(t, { modelDelay: 1200 });
  const controller = new AbortController();
  const requestListeners = page.listenerCount("request"), responseListeners = page.listenerCount("response");
  const timer = setTimeout(() => controller.abort(), 250);
  t.after(() => clearTimeout(timer));
  await assert.rejects(run({ signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(log.submits.length, 0);
  assert.equal(page.listenerCount("request"), requestListeners);
  assert.equal(page.listenerCount("response"), responseListeners);
});

test("restarting during MC image generation recovers the job and keeps its receipt", async t => {
  const directory = path.resolve(".verification", `mc-restart-${randomUUID()}`);
  const store = new Store(directory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  store.add("jobs", { type: "news", status: "generating_mc_image", payload: { mcImageRequest: receipt } });
  const recovered = new Store(directory).state.jobs[0];
  assert.equal(recovered.status, "interrupted");
  assert.deepEqual(recovered.payload.mcImageRequest, receipt);
});
