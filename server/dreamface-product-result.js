import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { StudioError } from "./store.js";

export const productPromptHash = (value) =>
  createHash("sha256")
    .update(
      String(value || "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .digest("hex");
const fail = (message, code = "PRODUCT_SUBMISSION_UNCONFIRMED") =>
  new StudioError(message, code, 422);
function containsPrompt(value, hash, depth = 0) {
  if (depth > 16) return false;
  if (typeof value === "string") {
    if (productPromptHash(value) === hash) return true;
    try {
      return containsPrompt(JSON.parse(value), hash, depth + 1);
    } catch {
      return false;
    }
  }
  return (
    value &&
    typeof value === "object" &&
    Object.values(value).some((v) => containsPrompt(v, hash, depth + 1))
  );
}
export function productTaskId(body) {
  const data = body?.data || body?.result || {};
  return (
    data.animate_image_id ||
    data.animate_id ||
    data.task_id ||
    data.work_id ||
    data.id ||
    null
  );
}
export function matchingProductWork(rows, receipt) {
  return rows.find(
    (w) =>
      w.file_type === "VIDEO" &&
      w.work_type === "AI_VIDEO" &&
      [w.id, w.animate_id, w.work_id, w.task_id]
        .filter(Boolean)
        .map(String)
        .includes(String(receipt.id)),
  );
}

export async function submitProductVideo({
  page,
  prompt,
  profileId,
  signal,
  click,
  saveReceipt,
  timeoutMs = 45000,
}) {
  let receipt = {
      id: null,
      profileId,
      promptHash: productPromptHash(prompt),
      submittedAt: new Date().toISOString(),
      state: "attempting",
    },
    request = null,
    rejection = null;
  // Persist before the click as well as before network acknowledgement. A crash
  // between click and response must never become permission to create twice.
  await saveReceipt(receipt);
  let pending = Promise.resolve();
  const persist = (next) => {
    receipt = next;
    pending = pending.then(() => saveReceipt(next));
  };
  const onRequest = (r) => {
    if (request || r.method() !== "POST") return;
    let url, payload;
    try {
      url = new URL(r.url());
      payload = r.postDataJSON();
    } catch {
      return;
    }
    if (
      !/(^|\.)dreamfaceapp\.com$/.test(url.hostname) ||
      !/\/(?:animate_image(?:_web)?|submit|generate)(?:\/|$)/.test(
        url.pathname,
      ) ||
      !containsPrompt(payload, receipt.promptHash)
    )
      return;
    request = r;
    persist({ ...receipt, state: "submitted", endpoint: url.pathname });
  };
  const onResponse = async (r) => {
    if (r.request() !== request) return;
    try {
      const body = await r.json();
      const id = productTaskId(body);
      if (
        r.ok() &&
        id &&
        (!body.status_code || body.status_code === "THS12140000000")
      )
        persist({ ...receipt, id: String(id), state: "acknowledged" });
      else if (
        !r.ok() ||
        (body.status_code && body.status_code !== "THS12140000000")
      ) {
        rejection = String(
          body.status_msg || body.message || `HTTP ${r.status()}`,
        ).slice(0, 300);
        persist({ ...receipt, rejected: true, state: "rejected", rejection });
      }
    } catch {}
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    signal.throwIfAborted();
    await click();
    const until = Date.now() + timeoutMs;
    while (!receipt.id && !rejection && Date.now() < until)
      await delay(150, null, { signal });
    await pending;
    if (rejection)
      throw fail(
        `DreamFace từ chối Product: ${rejection}`,
        "PRODUCT_SUBMISSION_REJECTED",
      );
    if (!receipt.id)
      throw fail(
        "Đã bấm tạo Product nhưng chưa nhận được mã tác vụ. Kiểm tra Creations; không tự gửi lại.",
      );
    return receipt;
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    await pending;
  }
}

export async function waitForProductVideo({
  page,
  receipt,
  prompt,
  profileId,
  signal,
  download,
  update = () => {},
  timeoutMs = 1800000,
  pollMs = 15000,
  creationUrl = "https://www.dreamfaceapp.com/creation",
}) {
  if (
    !receipt?.id ||
    receipt.profileId !== profileId ||
    receipt.promptHash !== productPromptHash(prompt)
  )
    throw fail(
      "Mã tác vụ Product không khớp profile hoặc prompt.",
      "PRODUCT_RECEIPT_MISMATCH",
    );
  let rows = [],
    failure = null;
  const onResponse = async (r) => {
    if (!/\/work\/v\d+\/get_recent_creation_list/.test(r.url())) return;
    try {
      const body = await r.json();
      if ([401, 403].includes(r.status()))
        failure = fail(
          "DreamFace cần đăng nhập lại để lấy Product.",
          "NEEDS_LOGIN",
        );
      if (Array.isArray(body.data?.list)) rows = body.data.list;
    } catch {}
  };
  page.on("response", onResponse);
  const started = Date.now();
  let nextRefresh = Date.now() + pollMs,
    lastUpdate = 0;
  try {
    await page.goto(creationUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    while (Date.now() - started < timeoutMs) {
      signal.throwIfAborted();
      if (failure) throw failure;
      const work = matchingProductWork(rows, receipt);
      if (
        work &&
        (Number(work.web_work_status) >= 400 ||
          Number(work.web_work_status) < 0)
      )
        throw fail(
          "DreamFace báo tác vụ Product thất bại.",
          "PRODUCT_RESULT_FAILED",
        );
      if (work && Number(work.web_work_status) === 200) {
        const images = page.locator("img");
        const index = await images.evaluateAll(
          (nodes, url) =>
            nodes.findIndex((n) => (n.currentSrc || n.src) === url),
          work.work_webp_path,
        );
        if (index >= 0) {
          let container = images.nth(index),
            button;
          for (let d = 0; d < 6; d++) {
            container = container.locator("xpath=..");
            const labeled = container
              .getByRole("button", { name: /download|save|export/i })
              .first();
            const icon = container
              .locator('button:has(svg path[d^="m11 12.845"])')
              .first();
            if (await labeled.count()) {
              button = labeled;
              break;
            }
            if (await icon.count()) {
              button = icon;
              break;
            }
          }
          if (!button)
            throw fail(
              "Nút tải Product đã đổi; dừng để tránh lấy nhầm video.",
              "PRODUCT_PROVIDER_UI_CHANGED",
            );
          await container.hover({ timeout: 5000 });
          const pending = page.waitForEvent("download", { timeout: 25000 });
          await button.click({ timeout: 5000 });
          const result = await pending;
          update({
            status: "downloading",
            progress: 88,
            stage: "Tải đúng video Product",
          });
          return await download(result, work);
        }
      }
      if (Date.now() - lastUpdate > 3000) {
        update({
          status: "rendering",
          progress: Math.min(
            80,
            15 + Math.floor((Date.now() - started) / 2000),
          ),
          stage: "DreamFace đang tạo Product",
          elapsedSeconds: Math.floor((Date.now() - started) / 1000),
        });
        lastUpdate = Date.now();
      }
      if (Date.now() >= nextRefresh) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
        nextRefresh = Date.now() + pollMs;
      }
      await delay(1000, null, { signal });
    }
    throw fail(
      "Hết thời gian theo dõi Product. Tác vụ đã lưu để khôi phục, không tạo lại.",
      "PROVIDER_TIMEOUT",
    );
  } finally {
    page.off("response", onResponse);
  }
}
