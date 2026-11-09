import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { StudioError } from "./store.js";

const normalisePrompt = value => String(value || "").replace(/\s+/g, " ").trim();
const promptHash = value => createHash("sha256").update(normalisePrompt(value)).digest("hex");
const submitUrl = value => /\/task\/(?:v\d+\/)?submit(?:\?|$)/i.test(value);

function imageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "dreamfaceapp.com" || url.hostname.endsWith(".dreamfaceapp.com"));
  } catch { return false; }
}

export function matchingMcWork(rows, prompt, receipt) {
  return rows.find(row => {
    if (row.work_type !== "AI_IMAGE" || normalisePrompt(row.prompt) !== normalisePrompt(prompt)) return false;
    if (!receipt?.id) return true;
    return row.id === receipt.id || (row.work_details || []).some(work =>
      [work.animate_id, work.work_id, work.incomplete_work_id].includes(receipt.id));
  });
}

function completedImage(work) {
  return (work?.work_details || []).filter(item => Number(item.work_status) === 200 && item.valid !== false)
    .flatMap(item => item.image_urls || []).find(imageUrl);
}

function serviceError(message, fallback = "MC_IMAGE_SUBMIT_FAILED") {
  const text = String(message || "").replace(/https?:\/\/\S+/gi, "[endpoint]").slice(0, 180);
  if (/insufficient.*credits?|not enough.*credits?|credits?.*(?:exhausted|required|insufficient)|quota|daily.*limit|free.*limit/i.test(text))
    return new StudioError("DreamFace không còn lượt tạo ảnh MC trên profile này. Chọn ảnh MC có sẵn hoặc dùng profile còn lượt.", "MC_IMAGE_QUOTA", 402);
  if (/captcha|verification|verify.*human/i.test(text))
    return new StudioError("DreamFace yêu cầu xác minh trước khi tạo ảnh MC. Mở profile và hoàn tất xác minh.", "VERIFICATION", 401);
  if (/unauthori[sz]ed|login|sign.?in|token.*expir/i.test(text))
    return new StudioError("Phiên DreamFace đã hết hạn. Mở profile và đăng nhập lại.", "NEEDS_LOGIN", 401);
  return new StudioError(`DreamFace chưa tạo được ảnh MC${text ? `: ${text}` : "."}`, fallback, 502);
}

// Wait for the composer's model and saved-work data before filling the prompt.
// A visible textarea exists before hydration; early input can be reset silently.
// Only accept images belonging to this prompt/submission, never arbitrary page thumbnails.
export async function requestDreamFaceMcImage({ session, prompt, signal, previousRequest, onRequest = () => {}, update = () => {}, timeoutMs = 30 * 60000, readyTimeoutMs = 30000, confirmationTimeoutMs = 30000 }) {
  const { page, context } = session;
  const text = String(prompt).slice(0, 1500);
  const hash = promptHash(text);
  let receipt = previousRequest?.promptHash === hash && previousRequest.profileId === session.profileId ? previousRequest : null;
  let models = null, rows = null, failure, submitting = false, listening = true;
  const pending = new Set();
  const remember = patch => {
    receipt = { ...receipt, promptHash: hash, profileId: session.profileId, ...patch };
    onRequest(receipt);
  };
  const requestListener = request => {
    if (submitting && !receipt && request.method() === "POST" && imageUrl(request.url()) && submitUrl(request.url()))
      remember({ id: null, submittedAt: new Date().toISOString() });
  };
  const responseListener = response => {
    const url = response.url();
    if (!imageUrl(url)) return;
    const modelResponse = /\/model_config\/ai_image\/list\//.test(url);
    const workResponse = /\/work_session\/list(?:\?|$)/.test(url);
    const submissionResponse = submitting && submitUrl(url);
    const rightsResponse = submitting && /\/rights\/get_free_rights(?:\?|$)/.test(url);
    if (!modelResponse && !workResponse && !submissionResponse && !rightsResponse) return;
    const task = (async () => {
      try {
        const payload = await response.json();
        if (!listening) return;
        if (!response.ok() || payload.status_code && payload.status_code !== "THS12140000000") {
          failure = serviceError(payload.status_msg || payload.message || `HTTP ${response.status()}`);
          return;
        }
        if (modelResponse && Array.isArray(payload.data)) models = payload.data;
        if (workResponse && Array.isArray(payload.data?.list)) rows = payload.data.list;
        if (rightsResponse && payload.data?.remain_count === 0) failure = serviceError("Daily free limit reached.");
        if (submissionResponse) {
          if (!payload.data?.animate_image_id) failure = serviceError("Không nhận được mã yêu cầu tạo ảnh.");
          else remember({ id: payload.data.animate_image_id, submittedAt: receipt?.submittedAt || new Date().toISOString() });
        }
      } catch (error) {
        if (listening) failure = serviceError(error.message);
      }
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  const wait = async (condition, milliseconds, error, interval = 150) => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (failure) throw failure;
      const result = await condition();
      if (result) return result;
      await delay(interval, undefined, { signal });
    }
    throw error;
  };
  page.on("request", requestListener);
  page.on("response", responseListener);
  try {
    update({ status: "generating_mc_image", provider: "dreamface-image", progress: 2, stage: "Đang chuẩn bị ảnh MC trên DreamFace…" });
    await page.goto("https://www.dreamfaceapp.com/image", { waitUntil: "domcontentloaded", timeout: 45000 });
    let historyOpened = false;
    await wait(async () => {
      // New profiles open the Template tab, which does not request saved
      // works. Open My Image after model hydration so history can load before
      // checking for an existing submission or spending another generation.
      if (models && rows === null && !historyOpened) {
        const history = page.getByText("My Image", { exact: true }).first();
        if (await history.isVisible()) {
          await history.click();
          historyOpened = true;
        }
      }
      return models && rows;
    }, readyTimeoutMs,
      new StudioError("Trang tạo ảnh DreamFace chưa tải xong. Chưa gửi yêu cầu tạo ảnh MC; hãy kiểm tra kết nối và thử lại.", "MC_IMAGE_NOT_READY", 422));
    const input = page.getByPlaceholder("Type or paste text here");
    await input.waitFor({ state: "visible", timeout: readyTimeoutMs });
    let work = matchingMcWork(rows, text, receipt);
    if (!work && !receipt) {
      const freeModel = models.find(model => model.is_active !== false && model.features?.some(feature => feature.key === "free") && !model.credit_rules?.length);
      if (!freeModel) throw new StudioError("DreamFace chưa có model ảnh miễn phí khả dụng. Chọn ảnh MC có sẵn hoặc cấu hình dịch vụ tạo ảnh.", "MC_IMAGE_NOT_READY", 422);
      await page.getByRole("button", { name: freeModel.model_name, exact: true }).waitFor({ state: "visible", timeout: readyTimeoutMs });
      const create = page.getByRole("button", { name: "Create", exact: true }).first();
      await wait(async () => {
        if (await input.inputValue() !== text) await input.fill(text);
        await delay(200, undefined, { signal });
        return await input.inputValue() === text && await create.isEnabled();
      }, readyTimeoutMs, new StudioError("DreamFace chưa sẵn sàng nhận nội dung ảnh MC. Chưa gửi yêu cầu; hãy mở profile kiểm tra.", "MC_IMAGE_NOT_READY", 422));
      submitting = true;
      await create.click();
      await wait(() => receipt?.id || matchingMcWork(rows, text, receipt), confirmationTimeoutMs,
        new StudioError("DreamFace chưa xác nhận yêu cầu tạo ảnh MC. Kiểm tra My Image trong profile trước khi thử lại.", "MC_IMAGE_UNCONFIRMED", 408));
    }
    update({ status: "generating_mc_image", provider: "dreamface-image", progress: 2, stage: "Đang chờ ảnh MC đã gửi lên DreamFace…" });
    const started = Date.now();
    let lastProgress = 0;
    const url = await wait(async () => {
      work = matchingMcWork(rows, text, receipt);
      const found = completedImage(work);
      if (found) return found;
      if (Number(work?.session_status) >= 400 || work?.work_details?.some(item => Number(item.work_status) >= 400))
        throw serviceError("Dịch vụ báo tạo ảnh thất bại. Chọn ảnh MC có sẵn hoặc kiểm tra My Image.", "MC_IMAGE_FAILED");
      const body = await page.locator("body").innerText().catch(() => "");
      const warning = body.match(/insufficient credits|not enough credits|daily free[^\n]*limit|failed to generate|verify you are human|confirm you.re not a robot/i);
      if (warning) throw serviceError(warning[0]);
      const seconds = Math.floor((Date.now() - started) / 1000);
      if (seconds >= lastProgress + 10) {
        lastProgress = seconds;
        update({ stage: `Đang chờ ảnh MC từ DreamFace (${seconds} giây)…` });
      }
      return null;
    }, timeoutMs, new StudioError("DreamFace chưa trả ảnh MC trong thời gian chờ đã cấu hình. Yêu cầu đã được lưu; thử lại sẽ kiểm tra ảnh đã gửi trước.", "MC_IMAGE_TIMEOUT", 408), Math.min(1000, timeoutMs / 4));
    signal.throwIfAborted();
    const response = await context.request.get(url, { timeout: 60000, headers: { Referer: page.url() } });
    try {
      const type = String(response.headers()["content-type"] || "").toLowerCase();
      if (!response.ok() || !type.startsWith("image/")) throw new StudioError("Không tải được ảnh MC do DreamFace trả về.", "MC_IMAGE_DOWNLOAD", 502);
      const bytes = await response.body();
      signal.throwIfAborted();
      if (bytes.length < 1000) throw new StudioError("Ảnh MC DreamFace trả về không hợp lệ.", "MC_IMAGE_OUTPUT_INVALID", 502);
      return { bytes, extension: /jpe?g/.test(type) ? ".jpg" : ".png" };
    } finally { await response.dispose(); }
  } finally {
    listening = false;
    page.off("request", requestListener);
    page.off("response", responseListener);
    await Promise.allSettled([...pending]);
  }
}
