import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { binary, runProcess } from "./media.js";
import { StudioError } from "./store.js";

const error = (message, code = "PRODUCT_PROVIDER_UI_CHANGED") =>
  new StudioError(message, code, 422);
export function classifyProductQuote(
  label,
  credits,
  { billingMode = "free", maxCredits = 0 } = {},
) {
  label = String(label || "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^1\s+Free Daily$/i.test(label))
    return { state: "available", kind: "daily", remaining: 1, cost: 0, label };
  const match =
    /^(\d+)\s*(?:Create|Generate)$/i.exec(label) ||
    /^(?:Create|Generate)\s*(\d+)$/i.exec(label);
  if (!match) return { state: "unknown", label };
  const cost = Number(match[1]);
  if (billingMode === "free")
    return { state: "exhausted", kind: "daily", remaining: 0, cost, label };
  const balance = Number(credits?.paid_count) + Number(credits?.free_count);
  if (!Number.isFinite(balance)) return { state: "unknown", cost, label };
  return {
    state: balance >= cost && cost <= maxCredits ? "available" : "exhausted",
    kind: "credits",
    balance,
    cost,
    label,
    overBudget: cost > maxCredits,
  };
}

export async function configureProductVideo(store, page, job, signal) {
  const task = job.payload,
    options = task.productOptions || {
      billingMode: "free",
      resolution: "720p",
      maxCredits: 0,
    };
  signal?.throwIfAborted();
  if ((task.references || []).length !== 1)
    throw error("Product cần đúng một ảnh sản phẩm.", "PRODUCT_IMAGE_REQUIRED");
  const media = store.require("media", task.references[0]);
  if (
    media.kind !== "image" ||
    (media.projectId && media.projectId !== job.projectId)
  )
    throw error("Ảnh sản phẩm không thuộc dự án.", "INVALID_REFERENCE");
  if (options.billingMode === "free" && task.duration !== 5)
    throw error(
      "Lượt miễn phí chỉ dùng cảnh Product 5 giây.",
      "PRODUCT_FREE_DURATION",
    );
  const temporary = path.join(
    store.root,
    "temp",
    `product-reference-${randomUUID()}.png`,
  );
  const [width, height] = task.ratio === "16:9" ? [1280, 720] : [720, 1280];
  try {
    // The image workflow takes its aspect ratio from the uploaded image.
    // Letterboxing preserves the entire product instead of cropping its edges.
    await runProcess(
      binary("ffmpeg", store.state.settings),
      [
        "-y",
        "-i",
        media.file,
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,setsar=1`,
        "-frames:v",
        "1",
        temporary,
      ],
      { signal, timeout: 30000 },
    );
    await page.goto("https://www.dreamfaceapp.com/video", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const tab = page.getByText("Image or Text", { exact: true }).first();
    await tab.waitFor({ state: "visible", timeout: 20000 });
    await tab.click();
    const model = page
      .getByRole("button", {
        name: /^(?:Dream Video|Vidu|Kling|Veo|Seedance)/i,
      })
      .first();
    await model.waitFor({ state: "visible", timeout: 15000 });
    if (!/^Dream Video 1\.5$/i.test((await model.innerText()).trim())) {
      await model.click();
      const choice = page.getByText("Dream Video 1.5", { exact: true }).last();
      await choice.waitFor({ state: "visible", timeout: 10000 });
      await choice.click();
    }
    await page
      .getByRole("button", { name: "Dream Video 1.5", exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    // Current DreamFace hides the native input with display:none. Its parent
    // visibility is not evidence that the active input is unusable.
    const input = page.locator('input[type="file"][accept*=".jpg"]').first();
    await input.setInputFiles(temporary);
    const setting = page.getByRole("button", { name: /^Settings?$/i }).first();
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll("button")].find((x) =>
          /^Settings?$/i.test(x.getAttribute("aria-label") || ""),
        );
        return b && !/16:9|9:16/.test(b.innerText);
      },
      {},
      { timeout: 30000 },
    );
    await setting.click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    await dialog
      .getByRole("button", {
        name: new RegExp(`^${options.resolution || "720p"}$`, "i"),
      })
      .click();
    await dialog
      .getByRole("button", {
        name: new RegExp(`^${task.duration}s(?:\\s*Free)?$`, "i"),
      })
      .click();
    await page.keyboard.press("Escape");
    const expected = new RegExp(
      `${options.resolution || "720p"}\\s*·\\s*${task.duration}s`,
      "i",
    );
    if (!expected.test(await setting.innerText()))
      throw error("DreamFace chưa xác nhận cấu hình Product đã chọn.");
    const prompt = page
      .locator('textarea[placeholder="Type or paste text here"]:visible')
      .first();
    if (!task.prompt || task.prompt.length > 1500)
      throw error(
        "Prompt Product phải có từ 1 đến 1500 ký tự.",
        "PRODUCT_PROMPT_INVALID",
      );
    await prompt.fill(task.prompt);
    return { temporary, prompt, options };
  } catch (e) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw e;
  }
}

export async function readProductQuote(page, options, credits, signal) {
  let previous = "",
    stable = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    signal?.throwIfAborted();
    const button = page
      .getByRole("button", {
        name: /^(?:1\s+Free Daily|\d+\s*(?:Create|Generate))$/i,
      })
      .last();
    const label = await button.innerText({ timeout: 1000 }).catch(() => "");
    stable = label && label === previous ? stable + 1 : 0;
    previous = label;
    if (stable >= 3 && !(await button.isDisabled().catch(() => true)))
      return { button, quote: classifyProductQuote(label, credits(), options) };
    await page.waitForTimeout(350);
  }
  throw error("Chưa đọc được nút tạo và giá Product hiện tại.");
}
