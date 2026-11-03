import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { providers } from "../../shared/contracts.js";
import { importMedia, probe, binary, runProcess } from "../media.js";
import { StudioError } from "../store.js";
import { ensureNewsMcImage } from "../mc-image.js";
import { submitNewsAvatar, waitForNewsAvatar } from "../dreamface-news-result.js";
import { ensureDreamFaceCredentials, getDreamFaceCredentials, getDreamFaceProxy, parseProxy } from "../dreamface-accounts.js";
import { profileStorage, profileLaunchArgs } from '../profile-storage.js';
import { resolveBrowserExecutable } from '../browser-runtime.js';
import {
  CAPTCHA_BROWSER_HOOK,
  applyCaptchaToken,
  buildCaptchaTask,
  buildGridTask,
  captchaTimeoutMs,
  createCaptchaClient,
  detectCaptcha,
  readCaptchaSettings,
} from "../captcha.js";

export const DREAMFACE_PROVIDER = "dreamface";
export const DREAMFACE_URL = providers.dreamface.url;
const DREAMFACE_HOST = "dreamfaceapp.com";
export const GOOGLE_SIGNUP_URL = "https://accounts.google.com/signup";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTCHA_RETRY_COOLDOWN_MS = 15000;
const LOGIN_CAPTCHA_ATTEMPTS = 2;
const LOGIN_CAPTCHA_SOLVES = 3;
const CAPTCHA_CONFIRM_GRACE_MS = 20000;
const GRID_START_TIMEOUT_MS = 12000;
const GRID_TASK_TIMEOUT_MS = 90000;
// A 4x4 dynamic challenge can need 4-6 paid rounds; each round waits for a
// worker answer, so the overall budget must be well above a single task.
const GRID_SOLVE_TIMEOUT_MS = 300000;

function domainMatches(value) {
  const host = String(value || "").replace(/^\./, "").toLowerCase();
  return host === DREAMFACE_HOST || host.endsWith(`.${DREAMFACE_HOST}`);
}

function providerError(message, code = "DREAMFACE_ERROR", status = 400) {
  return new StudioError(message, code, status);
}

export function isDreamFaceGenerateLabel(value) {
  return /^(?:\d+\s+)?Generate(?:\s+\d+)?$/i.test(String(value || "").replace(/\s+/g, " ").trim());
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

function generateButtonLocators(page) {
  // DreamFace shows the remaining free quota in the submit label, for
  // example "2 Generate".  The old exact "Generate" selector missed that
  // valid button and made a connected profile look unavailable.
  const label = /^(?:\d+\s+)?Generate(?:\s+\d+)?$/i;
  return [
    page.getByRole("button", { name: label }),
    page.locator("button:visible").filter({ hasText: label }),
    page.getByRole("button", { name: /Generate.*Avatar|Create.*Avatar/i }),
    page.getByRole("button", { name: /^(?:\d+\s+)?Free Daily$/i }),
    page.locator("button:visible").filter({ hasText: /^(?:\d+\s+)?Free Daily$/i }),
  ];
}

async function findGenerateButton(page) {
  return firstVisible(generateButtonLocators(page));
}

async function findAvailableRadio(radios, preferred, fallbackPattern = null, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const options = await radios.evaluateAll((nodes) => nodes.map((node, index) => {
      const style = getComputedStyle(node);
      return {
        index,
        label: String(node.innerText || "").trim(),
        visible: style.display !== "none" && style.visibility !== "hidden" && Boolean(node.getClientRects().length),
        disabled: Boolean(node.disabled) || node.getAttribute("aria-disabled") === "true",
      };
    }).filter((item) => item.visible && !item.disabled)).catch(() => []);
    for (const wanted of preferred) {
      const match = options.find((item) => item.label === wanted);
      if (match) return match;
    }
    if (fallbackPattern) {
      const match = options.find((item) => fallbackPattern.test(item.label));
      if (match) return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

export function classifyGoogleSignupPage({ url = "", body = "", captcha = false, formVisible = false } = {}) {
  const text = String(body || "");
  let hostname = "";
  try { hostname = new URL(String(url || "")).hostname; } catch {}
  if (captcha || /captcha|recaptcha|verify you(?:'|’)?re human|verify you are human|confirm you(?:'|’)?re not a robot|confirm you are not a robot/i.test(text)) {
    return {
      status: "verification",
      authStep: "captcha",
      message: "Google đang yêu cầu CAPTCHA. Hãy giải trong cửa sổ Chrome đang mở, rồi bấm Kiểm tra Gmail.",
    };
  }
  if (/phone number|verify your phone|enter the code|verification code|2-step verification|xác minh số điện thoại/i.test(text)) {
    return {
      status: "verification",
      authStep: "identity",
      message: "Google đang yêu cầu số điện thoại hoặc mã xác minh. Hãy hoàn tất trong cửa sổ Chrome, rồi bấm Kiểm tra Gmail.",
    };
  }
  if (/^(?:myaccount|mail)\.google\.com$/i.test(hostname) ||
      /your google account was created|welcome to your new google account|account created successfully/i.test(text)) {
    return {
      status: "created",
      authStep: "ready",
      message: "Gmail đã được tạo và đang đăng nhập trong profile Chrome này. Hãy tiếp tục kết nối DreamFace.",
    };
  }
  if (formVisible) {
    return {
      status: "pending",
      authStep: "form",
      message: "Google signup đang mở. App đã tự điền thông tin có thể điền; hãy hoàn tất các trường còn lại rồi bấm Kiểm tra Gmail.",
    };
  }
  return {
    status: "pending",
    authStep: "review",
    message: "Google signup đang chờ thao tác trong cửa sổ Chrome. Hoàn tất rồi bấm Kiểm tra Gmail.",
  };
}

export function classifyDreamFaceSignupPage({ body = "", captcha = false, formVisible = false } = {}) {
  const text = String(body || "");
  if (captcha || /captcha|recaptcha|verify you'?re human|verify you are human|confirm you'?re not a robot|confirm you are not a robot|i'?m not a robot|not a robot|human verification|security check/i.test(text)) {
    return {
      status: "verification",
      authStep: "captcha",
      message: "DreamFace đang yêu cầu CAPTCHA. Hãy giải trong cửa sổ Chrome đang mở, rồi bấm Kiểm tra phiên.",
    };
  }
  if (formVisible) {
    return {
      status: "pending",
      authStep: "credentials",
      message: "DreamFace đã được điền email và mật khẩu. Hãy hoàn tất bước đăng nhập/đăng ký còn lại trong cửa sổ Chrome.",
    };
  }
  return {
    status: "needs_login",
    authStep: "service",
    message: "DreamFace chưa xác nhận phiên. Hãy hoàn tất đăng nhập trong cửa sổ Chrome rồi bấm Kiểm tra phiên.",
  };
}

async function fillFirstVisible(page, selectors, value) {
  if (!value) return false;
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(String(value));
      return true;
    }
  }
  return false;
}

async function inspectGoogleSignupPage(page) {
  const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const captcha = await page.locator([
    'iframe[src*="captcha"]:visible',
    'iframe[src*="recaptcha"]:visible',
    '[id*="captcha"]:visible',
    '[class*="captcha"]:visible',
  ].join(",")).count().catch(() => 0);
  const formVisible = await page.locator([
    'input[name="firstName"]:visible',
    'input[name="Username"]:visible',
    'input[name="Passwd"]:visible',
    'input[autocomplete="username"]:visible',
    'input[autocomplete="new-password"]:visible',
  ].join(",")).count().catch(() => 0);
  return classifyGoogleSignupPage({
    url: page.url(),
    body,
    captcha: captcha > 0,
    formVisible: formVisible > 0,
  });
}

async function clickGoogleNext(page) {
  const next = await firstVisible([
    page.locator('#accountDetailsNext:visible'),
    page.locator('#identifierNext:visible'),
    page.getByRole("button", { name: /^Next$/i }),
    page.locator('[role="button"]:visible').filter({ hasText: /^Next$/i }),
    page.locator('input[type="submit"]:visible'),
  ]);
  if (!next) return false;
  await next.click().catch(() => {});
  return true;
}

async function dismissDreamFacePromos(page) {
  // DreamFace shows full-screen promo layers over the header. They absorb the
  // first login click, so close every promo layer before interacting.
  for (let round = 0; round < 4; round += 1) {
    let closed = false;
    const dialogs = page.locator('[role="dialog"]:visible');
    const count = await dialogs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const dialog = dialogs.nth(index);
      if (await dialog.locator('input[type="email"]:visible, input[type="password"]:visible').count()) continue;
      const close = await firstVisible([
        dialog.locator("button.ant-modal-close"),
        dialog.getByRole("button", { name: /^Close$/i }),
        dialog.locator('button[aria-label="Close"], button[aria-label="close"]'),
      ]);
      if (close) {
        await close.click({ force: true }).catch(() => {});
        closed = true;
      }
    }
    if (!closed) break;
    await page.waitForTimeout(180);
  }
}

async function loginFieldsVisible(email, password) {
  return (await email.isVisible().catch(() => false)) &&
    (await password.isVisible().catch(() => false));
}

async function openDreamFaceLogin(page) {
  const email = page.locator('input[type="email"]:visible').first();
  const password = page.locator('input[type="password"]:visible').first();
  // Try the short path first: a returning profile may already show the form.
  if (await loginFieldsVisible(email, password)) return { email, password };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dismissDreamFacePromos(page);
    if (await loginFieldsVisible(email, password)) break;
    const login = await firstVisible([
      page.locator("a.login"),
      page.getByText(/^Log\s*in\s*\/\s*Sign\s*up$/i),
      page.getByText(/^Log\s*In\s*\/\s*Sign\s*Up$/i),
      page.getByRole("button", { name: /log\s*in.*sign\s*up/i }),
    ]);
    if (login) await login.click({ force: true }).catch(() => {});
    // A click may open another promo instead of the form; loop closes it and
    // clicks again. Never block for the old 20-second form wait.
    await Promise.race([
      email.waitFor({ state: "visible", timeout: 2500 }).catch(() => {}),
      page.locator('[role="dialog"]:visible').first()
        .waitFor({ state: "visible", timeout: 2500 }).catch(() => {}),
    ]);
    if (!(await loginFieldsVisible(email, password))) await page.waitForTimeout(250);
  }
  return (await loginFieldsVisible(email, password)) ? { email, password } : null;
}

async function findLoginSubmit(page) {
  return firstVisible([
    pageDialog(page).getByRole("button", { name: /^Log\s*in$/i }),
    pageDialog(page).getByRole("button", { name: /^(?:Sign\s*up|Create\s*account|Register|Continue|Next)$/i }),
    page.getByRole("button", { name: /^Log\s*in$/i }),
    page.getByRole("button", { name: /^(?:Sign\s*up|Create\s*account|Register|Continue|Next)$/i }),
    page.locator('button[type="submit"]:visible'),
    page.locator('input[type="submit"]:visible'),
  ]);
}

async function submitDreamFaceLogin(page) {
  const submit = await findLoginSubmit(page);
  if (submit) {
    await submit.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  await page.locator('input[type="password"]:visible').first().press("Enter").catch(() => {});
  return false;
}

async function fillDreamFaceLogin(page, credentials) {
  if (!credentials?.email || !credentials?.password) return false;
  const fields = await openDreamFaceLogin(page);
  if (!fields) return false;
  const { email, password } = fields;
  if (await email.inputValue().catch(() => "") !== credentials.email)
    await email.fill(credentials.email).catch(() => {});
  if (await password.inputValue().catch(() => "") !== credentials.password)
    await password.fill(credentials.password).catch(() => {});
  return true;
}

async function gotoDreamFaceHome(page) {
  try {
    const url = new URL(page.url());
    if (domainMatches(url.hostname) && ["/", "/home"].includes(url.pathname)) return;
  } catch {}
  await page.goto(DREAMFACE_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  // The /video SPA renders its shell first and hydrates the saved session a
  // moment later. Checking immediately reports a signed-in profile as logged
  // out and opens the login form on top of a working session.
  await page.waitForFunction(
    () => (document.body?.innerText || "").trim().length > 40,
    null,
    { timeout: 5000 },
  ).catch(() => {});
}

async function dreamFaceComposer(page) {  return firstVisible([
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"]'),
    page.locator('textarea[placeholder="Type or paste text here"]:visible'),
    page.locator('textarea:visible'),
  ]);
}

function pageDialog(page) {
  return page.locator('[role="dialog"]:visible').last();
}

function collectUrls(value, result = [], depth = 0) {
  if (depth > 18 || value === null || value === undefined) return result;
  if (typeof value === "string") {
    if (/^(?:https?:|blob:)/i.test(value)) result.push(value);
    else if (/^[\[{]/.test(value)) {
      try { collectUrls(JSON.parse(value), result, depth + 1); } catch {}
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, result, depth + 1);
    return result;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, result, depth + 1);
  }
  return result;
}

async function importBrowserDownload(store, job, download, signal) {
  signal.throwIfAborted();
  const temporary = path.join(store.root, "temp", `${randomUUID()}.mp4`);
  try {
    await download.saveAs(temporary);
    signal.throwIfAborted();
    const metadata = await probe(temporary, store.state.settings);
    if (!metadata.duration || metadata.duration <= 0) throw providerError("DreamFace returned an invalid video.", "INVALID_PROVIDER_RESULT");
    return await importMedia(store, temporary, {
      name: `${job.name}.mp4`,
      projectId: job.projectId,
      generated: true,
      move: true,
      jobId: job.id,
      mediaType: "news-presenter",
    });
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function downloadResult(store, session, job, url, signal) {
  signal.throwIfAborted();
  const temporary = path.join(store.root, "temp", `${randomUUID()}.mp4`);
  try {
    let body;
    if (url.startsWith("blob:")) {
      const encoded = await session.page.evaluate(async (source) => {
        const blob = await (await fetch(source)).blob();
        if (blob.size > 500 * 1024 * 1024) throw new Error("Tệp DreamFace vượt quá 500 MB.");
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }, url);
      body = Buffer.from(encoded, "base64");
    } else {
      const response = await session.context.request.get(url, {
        timeout: 120000,
        headers: { Referer: session.page.url() },
      });
      if (!response.ok()) throw providerError(`Tải video DreamFace thất bại: HTTP ${response.status()}.`, "DOWNLOAD_FAILED");
      if (Number(response.headers()["content-length"]) > 500 * 1024 * 1024) throw providerError("Tệp DreamFace vượt quá 500 MB.", "DOWNLOAD_FAILED");
      body = await response.body();
      await response.dispose();
    }
    signal.throwIfAborted();
    await fs.writeFile(temporary, body);
    const metadata = await probe(temporary, store.state.settings);
    if (!metadata.duration || metadata.duration <= 0) throw providerError("DreamFace không trả về video hợp lệ.", "INVALID_PROVIDER_RESULT");
    return await importMedia(store, temporary, {
      name: `${job.name}.mp4`,
      projectId: job.projectId,
      generated: true,
      move: true,
      jobId: job.id,
      mediaType: "news-presenter",
    });
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function configureDreamFace(page, task) {
  await dismissDreamFacePromos(page);
  const settingButton = await firstVisible([
    page.getByRole("button", { name: /^(?:Setting|Settings|Preferences)$/i }),
    page.locator('button[aria-label="Settings"]'),
  ]);
  if (!settingButton) throw providerError("DreamFace video settings are unavailable. Open the profile and check the Video tool.","PROVIDER_NOT_READY");
  await settingButton.click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  if (!(await dialog.isVisible().catch(() => false))) throw providerError("Không mở được cài đặt DreamFace.", "PROVIDER_NOT_READY");
  const duration = dialog.getByText(new RegExp(`^\\s*${Number(task.duration)}s\\s*$`, "i")).first();
  if (!(await duration.isVisible().catch(() => false))) {
    await settingButton.click().catch(() => {});
    throw providerError(`DreamFace không có lựa chọn ${task.duration} giây trong tài khoản này.`, "UNSUPPORTED_DURATION");
  }
  await duration.click();
  const ratioLabel = task.ratio === "16:9" ? "Landscape" : task.ratio === "9:16" ? "Portrait" : "";
  if (!ratioLabel) {
    await settingButton.click().catch(() => {});
    throw providerError("DreamFace hiện chỉ hỗ trợ tỷ lệ 16:9 hoặc 9:16.", "UNSUPPORTED_RATIO");
  }
  const ratio = dialog.getByText(ratioLabel, { exact: true }).first();
  if (!(await ratio.isVisible().catch(() => false))) {
    await settingButton.click().catch(() => {});
    throw providerError(`DreamFace không có lựa chọn tỷ lệ ${task.ratio}.`, "UNSUPPORTED_RATIO");
  }
  await ratio.click();
  const selected=await ratio.locator("..").getAttribute("class");
  if(!/active|selected|checked/i.test(selected||""))throw providerError("DreamFace did not confirm the selected video ratio.","PROVIDER_NOT_READY");
  await settingButton.click().catch(() => {});
}

export async function prepareDreamFaceReferences(store,page,task) {
  const references=(task.references||[]).map(id=>store.require("media",id));
  if(references.some(media=>media.kind!=="image"||media.projectId&&media.projectId!==task.projectId))throw providerError("Choose reference images from this project.","INVALID_REFERENCE");
  const mode=references.length>1?"References to Video":"Image or Text";
  const tab=page.getByText(mode,{exact:true}).first();
  if(!await tab.isVisible())throw providerError("The DreamFace reference mode is unavailable.","PROVIDER_NOT_READY");
  await tab.click();
  if(!references.length)return [];
  const temporary=[];
  try {
    const files=[];
    for(const media of references) {
      if(/\.(png|jpe?g)$/i.test(media.file))files.push(media.file);
      else {
        const file=path.join(store.root,"temp",`${randomUUID()}.png`);
        temporary.push(file);
        await runProcess(binary("ffmpeg",store.state.settings),["-y","-i",media.file,"-frames:v","1",file]);
        files.push(file);
      }
    }
    const inputs=page.locator('input[type="file"]');let selected;
    for(let i=0;i<await inputs.count();i++) {
      const candidate=inputs.nth(i);
      if(await candidate.locator("..").isVisible()&&(files.length===1||await candidate.getAttribute("multiple")!==null)){selected=candidate;break;}
    }
    if(!selected)throw providerError("DreamFace's image upload control is unavailable.","PROVIDER_NOT_READY");
    await selected.setInputFiles(files);
    await selected.locator("..").locator("..").locator("img").first().waitFor({state:"visible",timeout:30000});
    return temporary;
  } catch(error) {await Promise.all(temporary.map(file=>fs.rm(file,{force:true})));throw error;}
}

function validateProxy(value) {
  if (!value) return { server: "", username: "", password: "" };
  try { return typeof value === "string" ? parseProxy(value) : value; }
  catch (error) { throw providerError(error.message, error.code || "INVALID_PROXY"); }
}

const DREAMFACE_CAPTCHA_REJECT_CODE = "THS12140000001";
export const DREAMFACE_CAPTCHA_REJECT_MESSAGE = "DreamFace đã từ chối CAPTCHA mà 2Captcha giải (mã THS12140000001 – Failed to pass Google Captcha). App dừng tự giải để không tốn thêm lượt. Hãy mở trình duyệt profile để giải tay, hoặc gắn proxy cho profile rồi thử lại.";

function trackDreamFaceLogin(page, session) {
  if (!page || typeof page.on !== "function" || !session || page.__viralLoginTracked) return;
  page.__viralLoginTracked = true;
  page.on("response", (response) => {
    let url = "";
    try { url = response.url(); } catch { return; }
    if (!/\/dw-server\/user\/login(?:[?#]|$)/.test(url)) return;
    response.json().then((payload) => {
      const code = String(payload?.status_code || payload?.statusCode || payload?.code || "").trim();
      const message = String(payload?.statusMsg || payload?.status_msg || payload?.message || "").trim();
      session.loginResponse = {
        at: Date.now(),
        httpStatus: response.status(),
        code,
        message,
        captchaRejected: code === DREAMFACE_CAPTCHA_REJECT_CODE || /failed to pass google captcha/i.test(message),
      };
    }).catch(() => {});
  });
}

function normaliseCookie(item) {
  if (!item || typeof item.name !== "string" || typeof item.value !== "string") return null;
  if (!item.name || /[\s;=]/.test(item.name)) throw providerError("Tên cookie DreamFace không hợp lệ.", "INVALID_COOKIE");
  const domain = item.domain || `.${DREAMFACE_HOST}`;
  if (!domainMatches(domain)) return null;
  const expires = Number(item.expires ?? item.expirationDate ?? -1);
  return {
    name: item.name,
    value: item.value,
    domain,
    path: item.path || "/",
    expires: Number.isFinite(expires) && expires > 100000000000 ? expires / 1000 : (Number.isFinite(expires) ? expires : -1),
    httpOnly: Boolean(item.httpOnly),
    secure: item.secure !== false,
    sameSite: ["Strict", "Lax", "None"].includes(item.sameSite) ? item.sameSite : "Lax",
  };
}

/** Parse Cookie-Editor JSON, Netscape export, or a Cookie header for DreamFace only. */
export function parseDreamFaceCookies(input) {
  const source = String(input || "").trim();
  if (!source || source.length > 2 * 1024 * 1024) {
    throw providerError("Dữ liệu cookie DreamFace trống hoặc quá lớn.", "INVALID_COOKIE");
  }
  let entries;
  if (source.startsWith("[") || source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      entries = Array.isArray(parsed) ? parsed : parsed.cookies;
    } catch {
      throw providerError("JSON cookie DreamFace không hợp lệ.", "INVALID_COOKIE");
    }
  } else if (source.split(/\r?\n/).some((line) => line.split("\t").length >= 7)) {
    entries = source.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#") || line.startsWith("#HttpOnly_")).map((line) => {
      const httpOnly = line.startsWith("#HttpOnly_");
      const [domain, , cookiePath, secure, expiry, name, ...values] = line.replace(/^#HttpOnly_/, "").split("\t");
      return { domain, path: cookiePath, secure: secure === "TRUE", expires: Number(expiry) || -1, name, value: values.join("\t"), httpOnly };
    });
  } else {
    entries = source.replace(/^cookie\s*:\s*/i, "").split(/[;\r\n]+/).map((part) => {
      const separator = part.indexOf("=");
      return separator > 0 ? { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim(), domain: `.${DREAMFACE_HOST}`, secure: true } : null;
    });
  }
  if (!Array.isArray(entries)) throw providerError("Cookie DreamFace phải là mảng JSON hoặc Cookie-Editor.", "INVALID_COOKIE");
  const cookies = [];
  const seen = new Set();
  for (const item of entries) {
    const cookie = normaliseCookie(item);
    if (!cookie || (cookie.expires !== -1 && cookie.expires <= Date.now() / 1000)) continue;
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      cookies.push(cookie);
    }
  }
  if (!cookies.length) throw providerError("Không có cookie DreamFace còn hạn trong dữ liệu đã nhập.", "INVALID_COOKIE");
  return cookies;
}

function accountId(account) {
  const id = account?.profileId || account?.id;
  if (!UUID_PATTERN.test(String(id || ""))) throw providerError("Profile DreamFace cần một account UUID hợp lệ.", "INVALID_ACCOUNT");
  return id;
}

function executableFrom(store, explicit) {
  return resolveBrowserExecutable(store?.state?.settings, explicit);
}

/**
 * Chrome's headless mode advertises "HeadlessChrome" in the UA, which makes
 * reCAPTCHA serve endless image rounds. Present the same build as regular
 * Chrome for hidden sessions (visible sessions already have a normal UA).
 */
async function hideHeadlessUserAgent(context, page) {
  if (typeof context?.newCDPSession !== "function") return;
  const rawUa = await page.evaluate(() => navigator.userAgent).catch(() => "");
  const userAgent = String(rawUa || "").replace(/\bHeadlessChrome\//i, "Chrome/");
  if (!userAgent || userAgent === rawUa) return;
  const cdp = await context.newCDPSession(page).catch(() => null);
  await cdp?.send("Network.setUserAgentOverride", { userAgent }).catch(() => {});
  // reCAPTCHA runs in a cross-site iframe (OOPIF), which keeps its own UA.
  await context.setExtraHTTPHeaders?.({ "User-Agent": userAgent }).catch(() => {});
  await context.addInitScript?.((agent) => {
    try {
      Object.defineProperty(Navigator.prototype, "userAgent", { get: () => agent, configurable: true });
      Object.defineProperty(Navigator.prototype, "appVersion", {
        get: () => agent.replace(/^Mozilla\//, ""),
        configurable: true,
      });
    } catch {}
  }, userAgent).catch(() => {});
}

function recaptchaFrame(page, kind) {
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return frames.find((frame) => new RegExp(`/recaptcha/(?:api2|enterprise)/${kind}`, "i").test(frame.url())) || null;
}

// Playwright evaluates and screenshots can wait forever if a frame is stuck
// mid-navigation. Bound every call so a wedged challenge cannot hang login.
const PAGE_OP_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * Frames keep their DOM after reCAPTCHA hides/expires the challenge, so cell
 * counts alone can describe a dead grid. Visibility must come from the parent
 * page's iframe element.
 */
async function recaptchaFrameShown(page, kind) {
  return withTimeout(page.evaluate((target) => {
    const pattern = new RegExp(`/recaptcha/(?:api2|enterprise)/${target}`, "i");
    const frame = [...document.querySelectorAll("iframe")].find((el) => pattern.test(el.src || ""));
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    return rect.width > 0 && rect.height > 0
      && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }, kind), PAGE_OP_TIMEOUT_MS, false);
}

async function recaptchaResponseToken(page) {
  return withTimeout(page.evaluate(() => {
    const field = document.querySelector('textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"], #g-recaptcha-response');
    return field ? String(field.value || "").trim() : "";
  }), PAGE_OP_TIMEOUT_MS, "");
}

async function readRecaptchaGrid(bframe) {
  return withTimeout(bframe.evaluate(() => {
    const table = document.querySelector("table");
    const cells = table ? [...table.querySelectorAll("td.rc-imageselect-tile")] : [];
    const rows = table ? table.querySelectorAll("tr").length : 0;
    const visible = (el) => Boolean(el) && el.getClientRects().length > 0
      && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const error = [...document.querySelectorAll(".rc-imageselect-error-select-more, .rc-imageselect-error-dynamic-more, .rc-imageselect-error-select-something, .rc-imageselect-incorrect-response")]
      .filter(visible).map((el) => (el.innerText || "").trim()).filter(Boolean).join(" | ");
    const main = document.querySelector(".rc-imageselect-desc-no-canonical")
      || document.querySelector(".rc-imageselect-desc")
      || document.querySelector(".rc-imageselect-desc-wrapper");
    const imgs = cells.map((cell) => {
      const img = cell.querySelector("img");
      return {
        src: img?.getAttribute("src") || "",
        style: img?.getAttribute("style") || "",
        loaded: Boolean(img?.complete && img?.naturalWidth),
      };
    });
    return {
      title: (main?.innerText || "").replace(/\s+/g, " ").trim(),
      rows,
      columns: rows ? Math.round(cells.length / rows) : 0,
      cellCount: cells.length,
      error,
      signature: imgs.map((img) => `${img.src}|${img.style}`).join("~"),
      allLoaded: imgs.every((img) => img.loaded),
      checked: cells.map((cell) => /dynamic-selected/.test(cell.className)),
    };
  }), PAGE_OP_TIMEOUT_MS, null);
}

async function stableRecaptchaGrid(page, bframe, deadline = Infinity) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (Date.now() > deadline) return null;
    const first = await readRecaptchaGrid(bframe);
    if (!first?.cellCount) {
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(900);
    const second = await readRecaptchaGrid(bframe);
    if (second?.cellCount && second.signature === first.signature && first.allLoaded && second.allLoaded)
      return second;
  }
  return Date.now() > deadline ? null : readRecaptchaGrid(bframe);
}

async function hideRecaptchaCheckOverlays(bframe) {
  await withTimeout(bframe.evaluate(() => {
    if (document.getElementById("vs-hide-captcha-checkmarks")) return;
    const style = document.createElement("style");
    style.id = "vs-hide-captcha-checkmarks";
    style.textContent = ".rc-imageselect-checkbox{display:none!important}";
    document.head.appendChild(style);
  }), PAGE_OP_TIMEOUT_MS, null);
}

const GRID_FAILURE_MESSAGES = {
  timeout: "Hết thời gian chờ 2Captcha giải lưới CAPTCHA trong profile.",
  "challenge-stalled": "Lưới CAPTCHA bị treo; đã mở lại lượt CAPTCHA mới.",
  "challenge-expired": "Lưới CAPTCHA đã hết hạn; đã mở lại lượt CAPTCHA mới.",
  "grid-not-shown": "DreamFace chưa hiển thị lưới CAPTCHA trong profile.",
  rejected: "DreamFace đã từ chối CAPTCHA vừa giải trong profile.",
};

export function cleanRecaptchaGridInstruction(value) {
  return String(value || "Select all matching images")
    .replace(/\s*Click verify[^.]*\.?$/i, "")
    .replace(/\s*If there are none,? click skip\.?/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Select all matching images";
}

/**
 * Solve a reCAPTCHA v2 image grid inside the profile's own browser. The token
 * is minted by the same browser/IP that later submits DreamFace's login;
 * externally solved tokens are rejected by DreamFace (THS12140000001).
 */
async function resetRecaptchaWidget(page) {
  await withTimeout(page.evaluate(() => {
    try { window.grecaptcha?.reset?.(); } catch {}
  }), PAGE_OP_TIMEOUT_MS, null);
  await page.waitForTimeout(1500);
}

export async function solveRecaptchaGridInPage(page, {
  client,
  onProgress = null,
  timeoutMs = GRID_SOLVE_TIMEOUT_MS,
  startTimeoutMs = GRID_START_TIMEOUT_MS,
  loginPattern = /\/dw-server\/user\/login/,
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(30000, Number(timeoutMs) || GRID_SOLVE_TIMEOUT_MS);
  const report = (message) => {
    if (!message) return;
    try { onProgress?.({ message }); } catch {}
  };
  let loginSubmitted = false;
  let loginRejected = false;
  let verifyClicks = 0;
  const onResponse = (response) => {
    const url = typeof response?.url === "function" ? response.url() : String(response?.url || "");
    if (!loginPattern.test(url)) return;
    // The rejection that opens the challenge belongs to the first form submit;
    // only a response to a token we submitted ourselves may end the solve.
    const settle = (rejected) => {
      if (verifyClicks === 0) return;
      if (rejected) loginRejected = true;
      else loginSubmitted = true;
    };
    response?.json?.().then((payload) => {
      const code = String(payload?.status_code || payload?.statusCode || payload?.code || "").trim();
      const message = String(payload?.statusMsg || payload?.status_msg || payload?.message || "").trim();
      settle(code === DREAMFACE_CAPTCHA_REJECT_CODE || /failed to pass google captcha/i.test(message));
    }).catch(() => settle(false));
  };
  page.on?.("response", onResponse);
  let previousId = null;
  let lastChallengeKey = "";
  let cost = 0;
  let gridSeen = false;
  let lastAnchorAt = 0;
  let lastTaskAt = Date.now();
  let reloads = 0;
  let stalls = 0;
  let resets = 0;
  // A dead/expired challenge keeps its DOM but no longer accepts answers.
  // Reset the widget so the anchor can start a fresh challenge instead of
  // burning the remaining budget on an unsolvable grid.
  const restartChallenge = async (reason) => {
    if (resets >= 2) return { solved: false, inPage: true, reason, cost, gridSeen };
    resets += 1;
    previousId = null;
    lastAnchorAt = 0;
    reloads = 0;
    stalls = 0;
    await resetRecaptchaWidget(page);
    return null;
  };
  try {
    while (Date.now() < deadline) {
      if (loginRejected) return { solved: false, inPage: true, reason: "rejected", cost, gridSeen };
      if (loginSubmitted) return { solved: true, inPage: true, loginSubmitted: true, token: "", cost, gridSeen };
      const token = await recaptchaResponseToken(page);
      if (token) return { solved: true, inPage: true, loginSubmitted, token, cost, gridSeen };
      let bframe = recaptchaFrame(page, "bframe");
      let cellCount = bframe && await recaptchaFrameShown(page, "bframe")
        ? await bframe.locator("td.rc-imageselect-tile").count().catch(() => 0)
        : 0;
      if (!cellCount) {
        // Always allow the anchor to start/restart a challenge. gating this on
        // the first grid left expired challenges waiting until the deadline.
        const anchor = recaptchaFrame(page, "anchor");
        const checkbox = anchor?.locator("#recaptcha-anchor");
        if (checkbox && Date.now() - lastAnchorAt > 5000 && await checkbox.isVisible().catch(() => false)) {
          const checked = await checkbox.getAttribute("aria-checked").catch(() => "false");
          if (checked !== "true") {
            lastAnchorAt = Date.now();
            await checkbox.click({ timeout: 5000 }).catch(() => {});
            report(gridSeen
              ? "CAPTCHA đã hết hạn trong profile. Đang mở lại lưới ảnh…"
              : "Đã mở CAPTCHA trong profile. Đang chờ lưới ảnh…");
          }
          const waitUntil = Math.min(deadline, Date.now() + Math.max(3000, Number(startTimeoutMs) || 0));
          while (Date.now() < waitUntil) {
            await page.waitForTimeout(700);
            if (loginRejected) return { solved: false, inPage: true, reason: "rejected", cost, gridSeen };
      if (loginSubmitted) return { solved: true, inPage: true, loginSubmitted: true, token: "", cost, gridSeen };
            const quickToken = await recaptchaResponseToken(page);
            if (quickToken) return { solved: true, inPage: true, loginSubmitted: false, token: quickToken, cost, gridSeen };
            bframe = recaptchaFrame(page, "bframe");
            cellCount = bframe && await recaptchaFrameShown(page, "bframe")
              ? await bframe.locator("td.rc-imageselect-tile").count().catch(() => 0)
              : 0;
            if (cellCount) break;
          }
        }
        if (!cellCount) {
          if (!gridSeen && Date.now() - startedAt > startTimeoutMs)
            return { solved: false, inPage: true, reason: "grid-not-shown", cost };
          if (gridSeen && Date.now() - Math.max(lastTaskAt, lastAnchorAt) > 20000) {
            const exhausted = await restartChallenge("challenge-stalled");
            if (exhausted) return exhausted;
          }
          await page.waitForTimeout(1200);
          continue;
        }
      }
      gridSeen = true;
      const info = await stableRecaptchaGrid(page, bframe, deadline);
      if (!info?.cellCount) {
        await page.waitForTimeout(800);
        continue;
      }
      const challengeKey = `${info.title}|${info.rows}x${info.columns}`;
      if (challengeKey !== lastChallengeKey) {
        lastChallengeKey = challengeKey;
        previousId = null;
      }
      if (/try again|multiple correct|incorrect/i.test(info.error)) {
        reloads += 1;
        const before = info.signature;
        await bframe.locator("#recaptcha-reload-button").click({ timeout: 3000 }).catch(() => {});
        previousId = null;
        await page.waitForTimeout(3500);
        const reloaded = bframe ? await readRecaptchaGrid(bframe) : null;
        if (reloaded && !reloaded.error) reloads = 0;
        // Two reloads that leave the same broken grid mean the challenge is
        // dead: reset the widget and let the anchor start a new one.
        if (reloads >= 2 && reloaded?.error && reloaded.signature === before) {
          const exhausted = await restartChallenge("challenge-expired");
          if (exhausted) return exhausted;
        }
        continue;
      }
      await hideRecaptchaCheckOverlays(bframe);
      let shot = await bframe.locator(".rc-imageselect-target").first()
        .screenshot({ type: "png", timeout: PAGE_OP_TIMEOUT_MS }).catch(() => null);
      if (!shot) {
        stalls += 1;
        if (stalls >= 3) {
          const exhausted = await restartChallenge("challenge-stalled");
          if (exhausted) return exhausted;
          continue;
        }
        await page.waitForTimeout(1000);
        continue;
      }
      stalls = 0;
      if (shot.length > 450000)
        shot = await bframe.locator(".rc-imageselect-target").first()
          .screenshot({ type: "jpeg", quality: 85, timeout: PAGE_OP_TIMEOUT_MS }).catch(() => shot);
      let task;
      try {
        task = buildGridTask({
          body: shot.toString("base64"),
          comment: cleanRecaptchaGridInstruction(info.title),
          rows: info.rows,
          columns: info.columns,
          imgType: "recaptcha",
          previousId,
        });
      } catch (error) {
        return { solved: false, inPage: true, reason: "invalid-grid", message: error.message, cost };
      }
      report(`2Captcha đang đọc lưới CAPTCHA trong profile (${info.columns}×${info.rows})…`);
      const answer = await client.solveGrid(task);
      previousId = answer.taskId;
      lastTaskAt = Date.now();
      reloads = 0;
      cost += Number(answer.cost) || 0;
      // Dynamic reCAPTCHA grids swap images while the worker decides; a stale
      // answer must not be clicked into the new grid.
      const fresh = await readRecaptchaGrid(bframe);
      if (!fresh || fresh.signature !== info.signature) continue;
      const toClick = answer.clicks.filter((index) => index < fresh.cellCount && !fresh.checked[index]);
      report(answer.clicks.length
        ? `2Captcha chọn ${answer.clicks.length} ô. Đang bấm trực tiếp trong profile…`
        : "2Captcha không thấy ô phù hợp. Đang bấm bỏ qua…");
      for (const index of toClick) {
        const tile = bframe.locator("td.rc-imageselect-tile").nth(index);
        await tile.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await tile.click({ timeout: 4000, force: true }).catch(() => {});
        await page.waitForTimeout(550);
      }
      if (toClick.length) await page.waitForTimeout(1800);
      const after = await readRecaptchaGrid(bframe);
      if (toClick.length && after && after.signature !== fresh.signature) continue;
      const verifyClicked = await bframe.locator("#recaptcha-verify-button").click({ timeout: 4000 })
        .then(() => true).catch(() => false);
      if (verifyClicked) verifyClicks += 1;
      report("Đã điền lưới CAPTCHA. Đang chờ Google xác nhận…");
      const verifyUntil = Date.now() + 14000;
      while (Date.now() < verifyUntil) {
        await page.waitForTimeout(700);
        if (loginRejected) return { solved: false, inPage: true, reason: "rejected", cost, gridSeen };
      if (loginSubmitted) return { solved: true, inPage: true, loginSubmitted: true, token: "", cost, gridSeen };
        const nextToken = await recaptchaResponseToken(page);
        if (nextToken) return { solved: true, inPage: true, loginSubmitted: false, token: nextToken, cost, gridSeen };
        const next = await readRecaptchaGrid(bframe);
        if (next?.error) break;
        if (next && next.signature !== info.signature) break;
      }
    }
    return { solved: false, inPage: true, reason: "timeout", cost, gridSeen };
  } catch (error) {
    return { solved: false, inPage: true, reason: "error", message: error.message, code: error.code, cost, gridSeen };
  } finally {
    page.off?.("response", onResponse);
  }
}

/**
 * Playwright-owned DreamFace profile. Automation is headless by default. Login
 * opens a visible window for sign-in and registration. Verification remains
 * in the service's own UI; only a verified session can enter the render queue.
 */
export class DreamFaceProvider {
  constructor({ store, browserType = chromium, executablePath } = {}) {
    if (!store?.root) throw providerError("DreamFace provider cần Store có thư mục dữ liệu.", "INVALID_PROVIDER");
    this.store = store;
    this.browserType = browserType;
    this.executablePath = executablePath;
    this.sessions = new Map();
    this.opening = new Map();
  }

  profileDirectory(account) {
    const id = accountId(account);
    const root = path.resolve(this.store.root, "profiles");
    const directory = path.resolve(root, id);
    if (directory !== path.join(root, id)) throw providerError("Đường dẫn profile DreamFace không hợp lệ.", "INVALID_PROFILE");
    return directory;
  }

  async open(account, { visible = false } = {}) {
    const id = accountId(account);
    const prior = this.opening.get(id) || Promise.resolve();
    const pending = prior.catch(() => {}).then(async () => {
      let existing = this.sessions.get(id);
      let existingBrowser = null;
      try { existingBrowser = existing?.context?.browser?.(); } catch { existingBrowser = null; }
      if (existingBrowser && !existingBrowser.isConnected()) {
        existing.releaseStorage?.();
        this.sessions.delete(id);
        existing = null;
      }
      if (existing?.context && existing.visible === visible) {
        let closed = true;
        try { closed = existing.page.isClosed(); } catch { closed = true; }
        const page = closed ? await existing.context.newPage() : existing.page;
        existing.page = page;
        if (!visible) await hideHeadlessUserAgent(existing.context, page);
        return existing;
      }
      if (existing) {
        try { await this.close(account); } catch { this.sessions.delete(id); }
      }
      const directory = this.profileDirectory(account);
      await fs.mkdir(directory, { recursive: true });
      const proxy = validateProxy(getDreamFaceProxy(this.store, account));
      const releaseStorage = await profileStorage(this.store).beginSession(id);
      let context;
      try { context = await this.browserType.launchPersistentContext(directory, {
        headless: !visible,
        executablePath: executableFrom(this.store, this.executablePath),
        viewport: { width: 1360, height: 940 },
        locale: "en-US",
        args: [
          ...profileLaunchArgs(this.store.state.settings),
          // Playwright leaves navigator.webdriver=true, which reCAPTCHA treats
          // as a bot signal and answers with endless image rounds.
          "--disable-blink-features=AutomationControlled",
        ],
        proxy: proxy.server ? {
          server: proxy.server,
          username: proxy.username || undefined,
          password: proxy.password || undefined,
        } : undefined,
      }); } catch (error) { releaseStorage(); throw error; }
      context.on?.('close', releaseStorage);
      try {
      const page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(12000);
      if (!visible) await hideHeadlessUserAgent(context, page);
      // Remember Turnstile/hCaptcha callbacks on every navigation so a solved
      // token can be handed back to the page without clicking the widget.
      await page.addInitScript(CAPTCHA_BROWSER_HOOK).catch(() => {});
      const session = { context, browser: context.browser?.(), page, visible, profileId: id, releaseStorage };
      trackDreamFaceLogin(page, session);
      this.sessions.set(id, session);
      return session;
      } catch (error) { await context.close().catch(() => {}); releaseStorage(); throw error; }
    });
    this.opening.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.opening.get(id) === pending) this.opening.delete(id);
    }
  }

  async inspect(account, session, { navigate = false } = {}) {
    const page = session.page.isClosed() ? await session.context.newPage() : session.page;
    session.page = page;
    trackDreamFaceLogin(page, session);
    if (navigate || page.url() === "about:blank") {
      await page.goto(DREAMFACE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator('[contenteditable="true"],textarea,input[type="email"],a[href*="login"]').first().waitFor({state:"visible",timeout:10000}).catch(()=>{});
    }
    await dismissDreamFacePromos(page);
    const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const cookies = await session.context.cookies();
    const captcha = await page.locator('iframe[src*="captcha"]:visible, [class*="captcha"]:visible, [id*="captcha"]:visible').count().catch(() => 0);
    if (captcha || /verify you are human|confirm you.re not a robot|captcha|i'?m not a robot|not a robot|human verification|security check|xác minh bạn là người/i.test(body)) {
      return { status: "verification", authStep: "captcha", message: "DreamFace đang yêu cầu CAPTCHA." };
    }
    // DreamFace's current web client stores the authenticated identity and
    // bearer token in a protected localStorage record. It does not set an
    // auth cookie, so a cookie-only check incorrectly reported this valid
    // session as needs_login after the user completed sign-in/CAPTCHA.
    const localStorageSession = await page.evaluate(() => {
      let found = false;
      for (const key of Object.keys(localStorage)) {
        try {
          const value = JSON.parse(localStorage.getItem(key));
          if (value && typeof value === "object" && value.userId && value.accountId && value.token) {
            found = true;
            break;
          }
        } catch {}
      }
      return found;
    }).catch(() => false);
    const cookieSession = cookies.some((cookie) => cookie.value && domainMatches(cookie.domain) && /session|token|auth|sid/i.test(cookie.name));
    const loginFields = await page.locator('input[type="email"]:visible, input[type="password"]:visible').count().catch(() => 0);
    const loginCta = await firstVisible([
      page.getByText(/^Log\s*in\s*\/\s*Sign\s*up$/i),
      page.getByText(/^Log\s*In\s*\/\s*Sign\s*Up$/i),
      page.getByRole("button", { name: /log\s*in.*sign\s*up/i }),
    ]);
    const composer = await dreamFaceComposer(page);
    const hasSession = localStorageSession || cookieSession;
    if (domainMatches(new URL(page.url()).hostname) && hasSession && loginFields === 0 && !loginCta && (composer || /Generate avatar videos|Want Avatar to Say|Generate video/i.test(body))) {
      return { status: "ready", authStep: "ready", renderReady: true, message: "Sẵn sàng render DreamFace News." };
    }
    return { status: "needs_login", authStep: "service", message: "DreamFace chưa xác nhận phiên. Hãy đăng nhập bằng tài khoản của bạn hoặc nhập cookie hợp lệ rồi kiểm tra lại." };
  }

  async check(account) {
    if(account.status==="busy")throw providerError("This profile is rendering. Wait for it to finish.","PROFILE_BUSY",409);
    const existing=this.sessions.get(account.id);
    // A hidden session can retain an in-memory DreamFace login after the
    // browser profile has expired. Reopen it for a real check so the badge
    // reflects what the next queue run can actually use. Keep a visible
    // session intact because it may contain a CAPTCHA the user is solving.
    if (existing && !existing.visible) {
      await this.close(account).catch(() => {});
    }
    const session = existing?.visible&&!existing.page.isClosed()?existing:await this.open(account, { visible: false });
    const result = await this.inspect(account, session, { navigate: !existing?.visible });
    const checkedAt = new Date().toISOString();
    // Keep the row badges honest: a confirmed session must not keep showing an
    // old "Email chờ xác minh"/"Email cần thử lại" warning from a previous
    // hidden login attempt.
    if (result.status === "ready")
      return { ...result, gmailStatus: "ready", gmailAuthStep: "ready", gmailCheckedAt: checkedAt, checkedAt };
    if (result.status === "verification")
      return { ...result, gmailStatus: "verification", gmailAuthStep: "captcha", gmailCheckedAt: checkedAt, checkedAt };
    return { ...result, checkedAt };
  }

  async checkProxy(account) {
    const proxy = validateProxy(getDreamFaceProxy(this.store, account));
    if (!proxy.server) return { status: "missing", message: "Profile này chưa có proxy." };
    let browser;
    const startedAt = Date.now();
    try {
      browser = await this.browserType.launch({
        headless: true,
        executablePath: executableFrom(this.store, this.executablePath),
        proxy: {
          server: proxy.server,
          username: proxy.username || undefined,
          password: proxy.password || undefined,
        },
      });
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      const response = await page.goto("https://api.ipify.org?format=json", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      if (!response?.ok()) throw providerError(`Proxy trả về HTTP ${response?.status() || "?"}.`, "PROXY_CHECK_FAILED");
      const body = await page.locator("body").innerText({ timeout: 5000 });
      let ip = "";
      try { ip = JSON.parse(body).ip || ""; } catch {}
      if (!ip) throw providerError("Proxy đã kết nối nhưng không đọc được địa chỉ IP.", "PROXY_CHECK_FAILED");
      return {
        status: "ready",
        ip,
        elapsedMs: Date.now() - startedAt,
        message: `Proxy hoạt động · IP hiện tại ${ip}.`,
      };
    } catch (error) {
      throw providerError(`Không kết nối được proxy: ${error.message}`, "PROXY_CHECK_FAILED", 502);
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  captchaSettings() {
    return readCaptchaSettings(this.store);
  }

  /**
   * Solve the captcha currently shown on DreamFace with the user's own
   * 2Captcha key, then hand the token back to the page. Returns a result
   * instead of throwing so the manual flow can always continue.
   */
  async autoSolveCaptcha(page, { onProgress, proxy = null } = {}) {
    const settings = this.captchaSettings();
    if (!settings.enabled) return { solved: false, reason: "disabled" };
    if (!settings.autoSolveDreamFace) return { solved: false, reason: "disabled-for-dreamface" };
    if (!settings.apiKey) return { solved: false, reason: "missing-key" };
    const detected = await detectCaptcha(page);
    if (!detected) return { solved: false, reason: "not-detected" };
    if (!detected.sitekey) return { solved: false, reason: "missing-sitekey", type: detected.type };
    // Standard reCAPTCHA v2 image challenges are solved inside the profile
    // browser (2Captcha GridTask reads the same grid a human would). Tokens
    // minted by 2Captcha's proxy workers are rejected by DreamFace with
    // THS12140000001, while tokens from this browser/IP pass.
    if (detected.type === "recaptcha-v2" && !detected.invisible) {
      let client;
      try {
        client = createCaptchaClient({
          apiKey: settings.apiKey,
          timeoutMs: GRID_TASK_TIMEOUT_MS,
          pollIntervalMs: 2500,
          onProgress,
        });
      } catch (error) {
        return { solved: false, reason: "invalid-task", type: detected.type, message: error.message };
      }
      const inPage = await solveRecaptchaGridInPage(page, {
        client,
        onProgress,
        timeoutMs: GRID_SOLVE_TIMEOUT_MS,
      });
      if (inPage.solved) {
        return {
          solved: true,
          inPage: true,
          type: detected.type,
          token: inPage.token || "",
          applied: {
            applied: inPage.token ? 1 : 0,
            called: inPage.loginSubmitted ? ["in-page-login"] : [],
          },
          cost: inPage.cost,
        };
      }
      return {
        solved: false,
        inPage: true,
        reason: inPage.reason || "error",
        type: detected.type,
        message: inPage.message || GRID_FAILURE_MESSAGES[inPage.reason] || "",
        code: inPage.code,
        cost: inPage.cost,
      };
    }
    // 2Captcha workers emulate the supplied UA; the "HeadlessChrome" marker
    // understates the real browser build and can lower token trust.
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "")
      .then((value) => String(value || "").replace(/\bHeadlessChrome\//, "Chrome/"));
    let task;
    try {
      task = buildCaptchaTask({
        type: detected.type,
        pageUrl: detected.pageUrl || page.url() || DREAMFACE_URL,
        sitekey: detected.sitekey,
        action: detected.action,
        invisible: detected.invisible,
        enterprise: Boolean(detected.enterprise),
        userAgent,
        // 2Captcha must solve from the same egress as the profile; DreamFace
        // rejects tokens generated from a mismatched IP/user-agent pair.
        proxy: proxy?.server ? proxy : null,
      });
    } catch (error) {
      return { solved: false, reason: "invalid-task", type: detected.type, message: error.message };
    }
    const client = createCaptchaClient({
      apiKey: settings.apiKey,
      timeoutMs: captchaTimeoutMs(settings.timeoutSeconds),
      onProgress,
    });
    try {
      const solution = await client.solve(task);
      const applied = await applyCaptchaToken(page, { type: detected.type, token: solution.token });
      return { solved: true, type: detected.type, applied, cost: solution.cost };
    } catch (error) {
      return {
        solved: false,
        reason: "error",
        type: detected.type,
        message: error.message,
        code: error.code,
      };
    }
  }

  /**
   * Solve the CAPTCHA currently shown on a DreamFace profile in a hidden
   * window. DreamFace only renders its reCAPTCHA after the login request
   * (usually 10-20 seconds later), so saved credentials are submitted first
   * and the page is polled until the widget appears.
   */
  async recoverCaptcha(account, session, { credentials = null, onProgress } = {}) {
    const page = session?.page;
    if (!page || (typeof page.isClosed === "function" && page.isClosed()))
      return { attempted: false, reason: "no-session" };
    const settings = this.captchaSettings();
    if (!settings.enabled || !settings.autoSolveDreamFace || !settings.apiKey)
      return { attempted: false, reason: "not-configured" };
    trackDreamFaceLogin(page, session);
    session.captchaState ||= { key: "", at: 0, solves: 0, errors: 0 };
    const captchaState = session.captchaState;
    captchaState.errors ||= 0;
    const lastSolveAt = Number(captchaState.attemptAt) || 0;
    if (!captchaState.rejectedAt && lastSolveAt && session.loginResponse?.captchaRejected && session.loginResponse.at >= lastSolveAt) {
      captchaState.rejectedAt = Date.now();
      captchaState.rejectionMessage = session.loginResponse.message;
    }
    // DreamFace answered the last solved token with THS12140000001 ("Failed to
    // pass Google Captcha"). Solving again just buys another rejected token, so
    // stay stopped until the user opens the profile or changes its proxy.
    if (captchaState.rejectedAt)
      return {
        attempted: false,
        reason: "rejected",
        message: captchaState.rejectionMessage,
        solves: captchaState.solves,
        errors: captchaState.errors,
      };
    let detected = null;
    try { detected = await detectCaptcha(page); } catch { detected = null; }
    if (!detected?.sitekey) {
      captchaState.key = "";
      return { attempted: false, reason: "not-detected" };
    }
    const key = `${detected.type || "captcha"}:${detected.sitekey}`;
    const now = Date.now();
    if (captchaState.key === key && now - captchaState.at < CAPTCHA_RETRY_COOLDOWN_MS)
      return { attempted: false, reason: "cooldown", type: detected.type };
    // Only failed paid tasks count toward the error limit. A successful token
    // handed to DreamFace must not turn the next poll into a false "limit".
    if (captchaState.errors >= LOGIN_CAPTCHA_ATTEMPTS || captchaState.solves >= LOGIN_CAPTCHA_SOLVES)
      return {
        attempted: false,
        reason: "limit",
        type: detected.type,
        solves: captchaState.solves,
        errors: captchaState.errors,
      };
    captchaState.key = key;
    captchaState.at = now;
    const attemptStartedAt = Date.now();
    captchaState.attemptAt = attemptStartedAt;
    let proxy = null;
    try { proxy = validateProxy(getDreamFaceProxy(this.store, account)); } catch {}
    const attempt = await this.autoSolveCaptcha(page, { onProgress, proxy });
    if (!attempt.solved) {
      // In-page grid solving spends money per image round, so any failure after
      // the challenge opened counts toward the stop limit, not just API errors.
      const paidFailure = attempt.inPage ? attempt.reason !== "grid-not-shown" : attempt.reason === "error";
      if (paidFailure) captchaState.errors += 1;
      if (attempt.reason === "not-detected") {
        captchaState.key = "";
        captchaState.at = 0;
      } else {
        captchaState.at = Date.now();
      }
      return {
        attempted: true,
        detected: detected.type,
        ...attempt,
        solves: captchaState.solves,
        errors: captchaState.errors,
      };
    }
    captchaState.solves += 1;
    // DreamFace renders the widget with grecaptcha.render(..., { callback });
    // that callback sends the login request with the solved token and resets
    // the widget. Handing the token to the site callback is therefore enough —
    // clicking Log in again would only start a fresh challenge.
    const callbacks = Array.isArray(attempt.applied?.called) ? attempt.applied.called : [];
    const handedToPage = callbacks.length > 0;
    let filled = false;
    if (!handedToPage) {
      filled = credentials ? await fillDreamFaceLogin(page, credentials) : false;
      await page.waitForTimeout(800);
      await submitDreamFaceLogin(page);
    }
    await page.waitForTimeout(handedToPage ? 3500 : 2500);
    captchaState.at = Date.now();
    const login = session.loginResponse;
    if (login?.captchaRejected && login.at >= attemptStartedAt) {
      captchaState.rejectedAt = Date.now();
      captchaState.rejectionMessage = login.message;
      return {
        ...attempt,
        attempted: true,
        detected: detected.type,
        filled,
        handedToPage,
        solved: false,
        reason: "rejected",
        serverRejected: true,
        code: login.code,
        message: login.message,
        solves: captchaState.solves,
        errors: captchaState.errors,
      };
    }
    return {
      attempted: true,
      detected: detected.type,
      filled,
      handedToPage,
      ...attempt,
      solves: captchaState.solves,
      errors: captchaState.errors,
    };
  }

  async solveAccountCaptcha(account, { visible = false, onProgress, waitMs = 90000 } = {}) {
    const session = await this.open(account, { visible });
    const page = session.page;
    const settings = this.captchaSettings();
    const canSolve = settings.enabled && settings.autoSolveDreamFace && Boolean(settings.apiKey);
    const wantsCredentials = account.hasCredentials || account.loginMethod === "credentials";
    let credentials = wantsCredentials ? getDreamFaceCredentials(this.store, account) : null;
    const report = (message) => {
      if (!message) return;
      try { onProgress?.({ message }); } catch {}
    };
    try {
      await gotoDreamFaceHome(page);
      let state = await this.inspect(account, session);
      if (state.status === "ready") return { ...state, message: "DreamFace đã sẵn sàng." };
      if (!canSolve) {
        return {
          ...state,
          message: "Chưa lưu API key 2Captcha. Vào Settings → CAPTCHA để bật tự động giải ẩn, rồi thử lại.",
        };
      }
      if (wantsCredentials && !credentials) {
        credentials = ensureDreamFaceCredentials(this.store, account);
        report("Đã tự tạo và lưu email/mật khẩu mới cho profile này.");
      }
      let deadline = Date.now() + Math.max(30000, Number(waitMs) || 90000);
      let submittedAt = 0;
      let submits = 0;
      const fields = await fillDreamFaceLogin(page, credentials);
      if (fields) {
        await submitDreamFaceLogin(page);
        submittedAt = Date.now();
        submits += 1;
        report("Đã tự điền email/mật khẩu và gửi đăng nhập ẩn. Đang chờ DreamFace hiển thị CAPTCHA…");
      } else if (!(await page.locator('input[type="password"]:visible').count().catch(() => 0))) {
        await page.waitForTimeout(2500);
        state = await this.inspect(account, session);
        if (state.status === "ready") return { ...state, message: "DreamFace đã sẵn sàng." };
        let captchaVisible = null;
        try { captchaVisible = await detectCaptcha(page); } catch {}
        if (!captchaVisible) {
          return {
            ...state,
            message: "Không mở được form đăng nhập DreamFace trong cửa sổ ẩn. Bấm Kiểm tra phiên hoặc mở trình duyệt profile để xử lý.",
          };
        }
      }
      while (Date.now() < deadline) {
        state = await this.inspect(account, session);
        if (state.status === "ready") break;
        let recovered;
        try {
          recovered = await this.recoverCaptcha(account, session, {
            credentials,
            onProgress: (progress) => {
              if (progress?.status === "submitted")
                report(progress.kind === "grid"
                  ? "Đã gửi ảnh lưới CAPTCHA tới 2Captcha. Đang chờ kết quả…"
                  : "Đã gửi CAPTCHA ẩn tới 2Captcha. Đang chờ mã giải…");
              else if (progress?.status === "processing")
                report(progress.kind === "grid"
                  ? "2Captcha đang đọc lưới CAPTCHA trong profile…"
                  : "2Captcha đang giải CAPTCHA ẩn…");
              else if (progress?.message) report(progress.message);
            },
          });
        } catch (error) {
          recovered = { attempted: false, reason: "error", message: error.message };
        }
        if (recovered.reason === "rejected" || session.captchaState?.rejectedAt) {
          state = await this.inspect(account, session);
          return { ...state, message: DREAMFACE_CAPTCHA_REJECT_MESSAGE };
        }
        if (recovered.attempted) {
          report(recovered.solved
            ? recovered.inPage
              ? "Đã giải CAPTCHA ngay trong profile. Đang chờ DreamFace xác nhận đăng nhập…"
              : recovered.handedToPage
                ? "Đã gửi token CAPTCHA vào DreamFace. Đang chờ xác nhận đăng nhập…"
                : "Đã áp dụng token CAPTCHA và gửi đăng nhập lại. Đang chờ DreamFace xác nhận…"
            : `2Captcha chưa giải được CAPTCHA: ${recovered.message || recovered.reason}.`);
        }
        if (recovered.reason === "limit") {
          const solves = Number(recovered.solves ?? session.captchaState?.solves) || 0;
          const errors = Number(recovered.errors ?? session.captchaState?.errors) || 0;
          if (!solves) {
            state = await this.inspect(account, session);
            return {
              ...state,
              message: "2Captcha chưa giải được CAPTCHA sau 2 lần thử. Kiểm tra API key và số dư 2Captcha rồi thử lại.",
            };
          }
          // A solved token was already handed to DreamFace. Its login request
          // reloads the page, so give the site time to finish before failing.
          const graceUntil = Math.min(deadline, Date.now() + CAPTCHA_CONFIRM_GRACE_MS);
          state = await this.inspect(account, session);
          while (state.status !== "ready" && Date.now() < graceUntil) {
            await page.waitForTimeout(1500);
            state = await this.inspect(account, session);
          }
          return {
            ...state,
            message: state.status === "ready"
              ? "Đã tự điền đăng nhập và giải CAPTCHA ẩn bằng 2Captcha. DreamFace sẵn sàng."
              : "2Captcha đã giải CAPTCHA nhưng DreamFace chưa xác nhận phiên. Kiểm tra email/mật khẩu đã lưu hoặc mở trình duyệt profile để xử lý.",
          };
        }
        if (recovered.attempted && recovered.solved) {
          // The solve can consume most of the original wait; keep watching
          // long enough for DreamFace's post-login reload to complete.
          deadline = Math.max(deadline, Date.now() + 30000);
          await page.waitForTimeout(2500);
          continue;
        }
        if (!recovered.attempted && credentials && Date.now() - submittedAt > 15000 && submits < 3) {
          if (await page.locator('input[type="email"]:visible').count().catch(() => 0)) {
            if (await fillDreamFaceLogin(page, credentials)) {
              await submitDreamFaceLogin(page);
              submittedAt = Date.now();
              submits += 1;
              report("DreamFace chưa hiện CAPTCHA; đã gửi lại đăng nhập ẩn…");
            }
          }
        }
        await page.waitForTimeout(1500);
      }
      state = await this.inspect(account, session);
      if (state.status === "ready")
        return { ...state, message: "Đã tự điền đăng nhập và giải CAPTCHA ẩn bằng 2Captcha. DreamFace sẵn sàng." };
      if (session.captchaState?.rejectedAt)
        return { ...state, message: DREAMFACE_CAPTCHA_REJECT_MESSAGE };
      const solves = Number(session.captchaState?.solves) || 0;
      const errors = Number(session.captchaState?.errors) || 0;
      return {
        ...state,
        message: solves > 0
          ? "2Captcha đã giải CAPTCHA nhưng DreamFace chưa xác nhận phiên. Kiểm tra email/mật khẩu đã lưu hoặc mở trình duyệt profile để xử lý."
          : errors > 0
            ? "2Captcha chưa giải được CAPTCHA. Kiểm tra API key và số dư 2Captcha rồi thử lại."
            : "DreamFace chưa xác nhận phiên sau khi gửi đăng nhập ẩn. Kiểm tra proxy/IP, mật khẩu đã lưu hoặc thử lại.",
      };
    } finally {
      if (!visible) await this.close(account).catch(() => {});
    }
  }

  async login(account, input = {}, { visible = true, onProgress } = {}) {
    const startedAt = Date.now();
    const report = (message) => {
      if (!message) return;
      try { onProgress?.({ message }); } catch {}
    };
    const cookies = input.cookies ? parseDreamFaceCookies(input.cookies) : null;
    const hasCredentials = Boolean(input.email && input.password);
    if (!cookies && !hasCredentials) throw providerError("Enter DreamFace email and password, or create a profile with saved sign-in details.", "CREDENTIALS_REQUIRED");
    if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) throw providerError("Email DreamFace không hợp lệ.", "INVALID_CREDENTIALS");
    report(visible ? "Đang mở DreamFace và kiểm tra phiên đăng nhập…" : "Đang mở DreamFace ẩn và kiểm tra phiên đăng nhập…");
    const session = await this.open(account, { visible });
    if (cookies) {
      await session.context.addCookies(cookies);
      return this.inspect(account, session, { navigate: true });
    }
    await session.page.goto(DREAMFACE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    // The /video SPA renders its shell before hydrating the saved session.
    // Inspecting immediately would mark a signed-in profile as logged out and
    // submit the login form (and its CAPTCHA) on top of a working session.
    await session.page.waitForFunction(
      () => (document.body?.innerText || "").trim().length > 40,
      null,
      { timeout: 5000 },
    ).catch(() => {});
    // Never submit the login form on a profile that still has a working
    // session: the extra sign-in can start a fresh CAPTCHA that DreamFace
    // rejects even though the profile was already usable.
    const existing = await this.inspect(account, session);
    if (existing.status === "ready") {
      return {
        ...existing,
        gmailStatus: "ready",
        gmailAuthStep: "ready",
        gmailCheckedAt: new Date().toISOString(),
        message: "DreamFace is connected. This saved profile can render videos.",
      };
    }
    report("Đang mở form đăng nhập DreamFace…");
    const fields = await openDreamFaceLogin(session.page);
    if (!fields) {
      return {
        ...existing,
        status: "needs_login",
        authStep: "service",
        message: visible
          ? "DreamFace is open. Complete sign-in or registration in its window, then check the session."
          : "Không mở được form đăng nhập DreamFace trong cửa sổ ẩn. Kiểm tra kết nối proxy rồi thử lại.",
      };
    }
    const { email: emailField, password: passwordField } = fields;
    report("Đang tự điền email/mật khẩu…");
    await emailField.fill(input.email);
    await passwordField.fill(input.password);
    // DreamFace renders a reCAPTCHA v2 widget inside the login dialog. When the
    // user saved a 2Captcha key we solve it and inject the token before the
    // click; otherwise the widget stays for the user to solve manually.
    report("Đã điền đăng nhập. Đang giải CAPTCHA bằng 2Captcha…");
    const preCaptcha = await this.autoSolveCaptcha(session.page, { onProgress });
    // DreamFace's widget callback sends the login request itself. Clicking
    // Log in after that would start a brand-new challenge (and can show the
    // "Verification challenge expired" message), so only click when the token
    // was not handed to the page.
    const preHanded = Array.isArray(preCaptcha.applied?.called) && preCaptcha.applied.called.length > 0;
    if (!preHanded) {
      report("Đã điền đăng nhập. Đang gửi yêu cầu đăng nhập ẩn…");
      const submit = await findLoginSubmit(session.page);
      if (submit) await submit.click().catch(() => passwordField.press("Enter"));
      else await passwordField.press("Enter");
    }
    await Promise.race([
      passwordField.waitFor({state:"hidden",timeout:8000}),
      session.page.locator('iframe[src*="captcha"]:visible').first().waitFor({state:"visible",timeout:8000}),
      session.page.locator('[contenteditable="true"], textarea:visible').first().waitFor({state:"visible",timeout:8000}),
    ]).catch(()=>{});
    // Some widgets only appear (or are enforced) after the first submit.
    let postCaptcha = { solved: false };
    if (!preHanded) {
      postCaptcha = await this.autoSolveCaptcha(session.page, { onProgress });
      if (postCaptcha.solved) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const postHanded = Array.isArray(postCaptcha.applied?.called) && postCaptcha.applied.called.length > 0;
        if (!postHanded) {
          const retrySubmit = await findLoginSubmit(session.page);
          if (retrySubmit) await retrySubmit.click().catch(() => {});
        }
        await Promise.race([
          passwordField.waitFor({state:"hidden",timeout:6000}),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]).catch(()=>{});
      }
    }
    const result = await this.inspect(account, session);
    const ready = result.status === "ready"
      ? { ...result, gmailStatus: "ready", gmailAuthStep: "ready", gmailCheckedAt: new Date().toISOString() }
      : result;
    if (ready.status !== "ready" && session.loginResponse?.captchaRejected && session.loginResponse.at >= startedAt)
      return { ...ready, message: DREAMFACE_CAPTCHA_REJECT_MESSAGE };
    const solvedNote = preCaptcha.solved || postCaptcha.solved ? " CAPTCHA đã được giải tự động qua 2Captcha." : "";
    const hiddenHint = ready.status === "ready"
      ? "DreamFace is connected. This saved profile can render videos."
      : ready.status === "verification"
        ? "DreamFace cần xác minh CAPTCHA. Cửa sổ ẩn sẽ tiếp tục tự giải bằng 2Captcha khi key đã lưu."
        : "Đã gửi đăng nhập trong cửa sổ ẩn. Hàng đợi sẽ tiếp tục kiểm tra profile.";
    return {...ready,message:(ready.status==="ready"?"DreamFace is connected. This saved profile can render videos.":ready.status==="verification"?(visible?`DreamFace needs CAPTCHA verification. Complete it in the open window, then click Check session.${preCaptcha.reason==="missing-key"?" Add a 2Captcha API key in Settings to automate it.":""}`:hiddenHint):(visible?"Sign-in details are saved. Complete registration in the DreamFace window, then click Check session.":hiddenHint))+solvedNote};
  }

  async startDreamFaceSignup(account, credentials) {
    if (!credentials?.email || !credentials?.password)
      throw providerError("DreamFace email and password are required.", "CREDENTIALS_REQUIRED");
    const result = await this.login(account, credentials);
    if (result.status === "verification") {
      return {
        ...result,
        authStep: "captcha",
        message: /2Captcha/i.test(result.message || "")
          ? result.message
          : "DreamFace requires CAPTCHA verification. Solve it in the open Chrome window, then click Check session.",
      };
    }
    if (result.status === "ready") return result;
    const session = this.sessions.get(account.id);
    const page = session?.page;
    if (page && !page.isClosed()) {
      const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      const formVisible = await page.locator('input[type="email"]:visible, input[type="password"]:visible').count().catch(() => 0);
      const hint = classifyDreamFaceSignupPage({ body, formVisible: formVisible > 0 });
      return { ...result, authStep: hint.authStep, message: hint.message };
    }
    return result;
  }

  async checkDreamFaceSignup(account) {
    const existing = this.sessions.get(account.id);
    const session = existing?.visible && !existing.page.isClosed()
      ? existing
      : await this.open(account, { visible: true });
    return this.inspect(account, session, { navigate: !existing?.visible });
  }

  // Compatibility aliases for older saved UI actions. These actions now stay
  // on DreamFace and never open a Google signup page.
  async startGmailSignup(account, credentials) {
    return this.startDreamFaceSignup(account, credentials);
  }

  async checkGmailSignup(account) {
    return this.checkDreamFaceSignup(account);
  }

  async importCookies(account, input) {
    const cookies = parseDreamFaceCookies(input);
    const session = await this.open(account, { visible: false });
    await session.context.addCookies(cookies);
    const result = await this.inspect(account, session, { navigate: true });
    return { ...result, cookieCount: cookies.length };
  }

  async withAuthenticatedSession(account, action) {
    const session = await this.open(account, { visible: false });
    const state = await this.inspect(account, session, { navigate: true });
    if (state.status !== "ready") throw providerError(state.message, state.status === "verification" ? "VERIFICATION" : "NEEDS_LOGIN", 401);
    return action(session);
  }

  /** Create a narrated presenter clip in DreamFace's Avatar tool. */
  async generateNewsAvatar(store, job, account, signal, update) {
    try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.generateNewsAvatarOnce(store, job, account, signal, update);
      } catch (error) {
        const closed = /target page|context.*closed|browser.*closed|page has been closed|page\.goto/i.test(String(error?.message || ""));
        if (!closed || attempt > 0) throw error;
        const id = accountId(account);
        const priorSession = this.sessions.get(id);
        this.sessions.delete(id);
        try { await priorSession?.context?.close?.(); } catch {}
        update({ status: "retrying", workflow: "avatar-news", retry: 1, progress: 1 });
        store.log(job, "DreamFace browser session closed unexpectedly; reopened the profile and retried once.");
      }
    }
    throw providerError("DreamFace presenter could not be reopened.", "PROVIDER_NOT_READY");
    } finally {
      // A finished/failed background task must not keep a Chrome profile in
      // memory while FFmpeg renders or the account pool moves to other PCs.
      // Leave a visible session explicitly opened by the user alone.
      if (this.sessions.get(accountId(account))?.visible === false) await this.close(account);
    }
  }

  async recoverExistingNewsAvatar(store, job, account, signal, update) {
    const session = await this.open(account, { visible: false });
    const state = await this.inspect(account, session, { navigate: true });
    if (state.status !== "ready") throw providerError(state.message, state.status === "verification" ? "VERIFICATION" : "NEEDS_LOGIN", 401);
    return waitForNewsAvatar({ page: session.page, narration: job.payload.newsPlan?.narration,
      profileId: accountId(account), receipt: job.payload.newsAvatarRequest, signal, update,
      timeoutMs: Math.max(2, Number(store.state.settings.maxWaitMinutes || 30)) * 60000,
      pollMs: Math.max(8000, Number(store.state.settings.pollSeconds || 5) * 2000),
      download: download => importBrowserDownload(store, job, download, signal) });
  }

  async generateNewsAvatarOnce(store, job, account, signal, update) {
    if (job.payload.newsAvatarRequest?.id || job.payload.recoverSubmitted) return this.recoverExistingNewsAvatar(store, job, account, signal, update);
    if (job.payload.newsAvatarRequest?.submittedAt && !job.payload.newsAvatarRequest.rejected) throw providerError("The previous MC submission is unconfirmed. Check Creations before submitting again.", "PROVIDER_SUBMISSION_UNCONFIRMED");
    const session = await this.open(account, { visible: false });
    const state = await this.inspect(account, session, { navigate: true });
    if (state.status !== "ready") {
      throw providerError(state.message, state.status === "verification" ? "VERIFICATION" : "NEEDS_LOGIN", 401);
    }
    const { page } = session;
    const plan = job.payload.newsPlan || {};
    // Avatar 3.0 Fast needs a processed still. Generate one original AI MC
    // automatically, reuse it for this DreamFace profile, and fall back to the
    // DreamFace Image tool only when the configured Highlight-compatible image
    // endpoint is unavailable.
    const avatarMedia = await ensureNewsMcImage(store, session, job, account, plan, signal, update);
    if (avatarMedia.kind !== "image") throw providerError("The generated MC still is not a valid image.", "INVALID_AVATAR_IMAGE", 422);

    await page.goto("https://www.dreamfaceapp.com/avatar", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.getByText("More", { exact: true }).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1800);
    // A profile can remember its previous Audio tab on another PC/session.
    const textTab = page.getByText('Text', { exact: true }).first();
    if (await textTab.isVisible().catch(() => false)) await textTab.click();
    await page.getByPlaceholder("Type or paste text here").waitFor({ state: "visible", timeout: 30000 });
    // Upload the saved still first. This unlocks the Avatar 3.0 family in the
    // current DreamFace UI and makes the selected effect explicit and testable.
    const imageInput = page.locator('input[type="file"]').first();
    if (!await imageInput.count()) throw providerError("DreamFace Avatar image upload is unavailable.", "PROVIDER_NOT_READY");
    await imageInput.setInputFiles(avatarMedia.file);
    await page.waitForTimeout(1800);

    const prompt = page.getByPlaceholder("Type or paste text here");
    const narration = String(plan.narration || '').trim();
    if (!narration || narration.length > 500) throw providerError('The news narration must fit within 500 characters including the full CTA.', 'NEWS_SCRIPT_TOO_LONG', 422);
    await prompt.fill(narration);
    const effect = page.getByRole("button", { name: /Animate Effect/i }).first();
    if (!await effect.isVisible().catch(() => false)) throw providerError("DreamFace Animate Effect is unavailable.", "PROVIDER_NOT_READY");
    await effect.click();
    // The uploaded still is processed asynchronously. Open the effect menu and
    // wait for DreamFace to enable the Avatar 3.0 family instead of relying on
    // a short fixed delay, which can race the image-processing request.
    // The provider can keep the composer visible while the uploaded image is
    // still processing, so allow the motion options to settle before reading them.
    await page.waitForTimeout(6500);
    const radios = page.getByRole("radio");
    const effectChoice = await findAvailableRadio(radios, ["Avatar 3.0 Fast", "Avatar 3.0", "Avatar 2.0", "Avatar"], /avatar/i);
    const selectedRadio = effectChoice ? radios.nth(effectChoice.index) : null;
    const selectedEffect = effectChoice?.label || "";
    if (!selectedRadio) throw providerError("DreamFace chưa có Avatar effect khả dụng cho ảnh MC này. Hãy đổi ảnh MC hoặc kiểm tra quota profile.", "PROVIDER_NOT_READY");
    await selectedRadio.click();
    if (await selectedRadio.getAttribute("aria-checked") === "false") throw providerError("DreamFace không xác nhận Avatar effect.", "PROVIDER_NOT_READY");
    if (selectedEffect !== "Avatar 3.0 Fast") store.log(job, `Avatar 3.0 Fast unavailable; using ${selectedEffect}.`);

    const resolution = page.getByRole("button", { name: /Resolution/i }).first();
    if (!await resolution.isVisible().catch(() => false)) throw providerError("DreamFace resolution selector is unavailable.", "PROVIDER_NOT_READY");
    await resolution.click();
    const resolutionRadios = page.getByRole("radio");
    const resolutionChoice = await findAvailableRadio(resolutionRadios, ["720p", "480p", "1080p"]);
    const selectedResolutionRadio = resolutionChoice ? resolutionRadios.nth(resolutionChoice.index) : null;
    const selectedResolution = resolutionChoice?.label || "";
    if (!selectedResolutionRadio) throw providerError("DreamFace không có độ phân giải khả dụng cho profile này.", "PROVIDER_NOT_READY");
    await selectedResolutionRadio.click();
    update({ status: "configured", workflow: "avatar-news", effect: selectedEffect, resolution: selectedResolution, progress: 3 });
    let generate = null;
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => /generate|free\s+daily/i.test(button.innerText.trim())), null, { timeout: 30000 }).catch(() => {});
    generate = await findGenerateButton(page);
    if (!generate) throw providerError("DreamFace Avatar chưa có nút Generate khả dụng. Hãy kiểm tra effect, quota và ảnh MC.", "PROVIDER_NOT_READY");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => /generate|free\s+daily/i.test(button.innerText.trim()) && !button.disabled), null, { timeout: 30000 }).catch(async () => {
      const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      if (/\b0\s+Free\b|not enough credits|insufficient credits|daily free.*limit/i.test(body)) {
        throw providerError("DreamFace has no free generation credit left on this profile today.", "PROVIDER_QUOTA");
      }
      throw providerError("DreamFace Avatar vẫn đang tải presenter. Hãy thử lại profile sau ít giây.", "PROVIDER_NOT_READY");
    });
    generate = await findGenerateButton(page);
    if (!generate || await generate.isDisabled().catch(() => true)) throw providerError("DreamFace Avatar chưa mở nút Generate khả dụng.", "PROVIDER_NOT_READY");
    update({ quota: (await generate.innerText()).trim() });
    // Model/image hydration can replace a previously filled composer. Check
    // the exact narration immediately before submission, after all controls.
    if (await prompt.inputValue() !== narration) await prompt.fill(narration);
    await page.waitForTimeout(250);
    if (await prompt.inputValue() !== narration) throw providerError("DreamFace reset the news narration before submission. Please retry.", "PROVIDER_NOT_READY");
    update({ status: "submitting", workflow: "avatar-news", progress: 5 });
    const receipt = await submitNewsAvatar({ page, narration, profileId: accountId(account), signal,
      click: () => generate.click({ timeout: 15000 }),
      saveReceipt: receipt => {
        store.patch('jobs', job.id, { payload: { ...job.payload, accountId: account.id, newsAvatarRequest: receipt } });
        update({ submittedAt: receipt.submittedAt, workflow: 'avatar-news', progress: 8 });
      } });
    store.log(job, "DreamFace acknowledged the MC task; waiting for its matching Creations result.");
    const media = await waitForNewsAvatar({ page, narration, profileId: accountId(account), receipt, signal, update,
      timeoutMs: Math.max(2, Number(store.state.settings.maxWaitMinutes || 30)) * 60000,
      pollMs: Math.max(8000, Number(store.state.settings.pollSeconds || 5) * 2000),
      download: download => importBrowserDownload(store, job, download, signal) });
    store.log(job, 'Verified MC task downloaded: ' + media.duration.toFixed(2) + ' seconds.');
    return media;
  }

  /**
   * Submit a text-to-video task through DreamFace's authenticated web UI.
   * The provider intentionally waits for a new media URL rendered by the site
   * (or returned by its task response) instead of relying on private API
   * endpoints that can change without notice.
   */
  async generate(store, job, account, signal, update) {
    if (job.payload.kind !== "video") throw providerError("DreamFace hiện chỉ hỗ trợ tạo video.", "UNSUPPORTED_KIND");
    if (!["text","reference"].includes(job.payload.mode)) {
      throw providerError("DreamFace supports text and reference images for this workflow.", "UNSUPPORTED_MODE");
    }
    const session = await this.open(account, { visible: false });
    const state = await this.inspect(account, session, { navigate: true });
    if (state.status !== "ready") {
      throw providerError(state.message, state.status === "verification" ? "VERIFICATION" : "NEEDS_LOGIN", 401);
    }
    const { page } = session;
    const temporaryReferences=await prepareDreamFaceReferences(store,page,{...job.payload,projectId:job.projectId});
    const prompt = await dreamFaceComposer(page);
    if (!prompt) {
      await Promise.all(temporaryReferences.map(file=>fs.rm(file,{force:true})));
      throw providerError("Không tìm thấy ô prompt DreamFace. Giao diện dịch vụ có thể đã thay đổi.", "PROVIDER_NOT_READY");
    }
    const baseline = new Set(await page.locator("video:visible, video source:visible").evaluateAll((nodes) => nodes.map((node) => node.currentSrc || node.src).filter(Boolean)));
    const candidates = new Set();
    const responseListener = async (response) => {
      if (!/task|work|generate|status|download/i.test(response.url())) return;
      try {
        const contentType = String(response.headers()["content-type"] || "");
        if (!contentType.includes("json")) return;
        for (const url of collectUrls(await response.json())) {
          if (/\.mp4(?:[?#]|$)|video|download|source/i.test(url)) candidates.add(url);
        }
      } catch {}
    };
    page.on("response", responseListener);
    try {
      await configureDreamFace(page, job.payload);
      await prompt.fill(String(job.payload.prompt || "").slice(0, 1500));
      const send = await firstVisible([
        page.getByRole("button", { name: /^Send$/i }),
        page.getByRole("button", { name: /^\d+\s+Free\s+Daily$/i }),
        page.locator('button[aria-label="Send"]'),
        prompt.locator("xpath=ancestor::*[contains(@class, 'generator')][1]").locator('button[aria-label="Send"]:visible'),
      ]);
      if (!send) throw providerError("Không tìm thấy nút tạo video DreamFace.", "PROVIDER_NOT_READY");
      update({ status: "submitting", submittedAt: new Date().toISOString(), providerPage: page.url(), progress: 5 });
      await send.click({ timeout: 15000 });
      update({ status: "rendering", progress: 15, elapsedSeconds: 0 });
      const deadline = Date.now() + Math.max(2, Number(store.state.settings.maxWaitMinutes || 20)) * 60000;
      const started = Date.now();
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const body = await page.locator("body").innerText().catch(() => "");
        if (/verify you are human|confirm you.re not a robot|captcha/i.test(body)) throw providerError("DreamFace yêu cầu xác minh. Hoàn tất trong cửa sổ tài khoản rồi kiểm tra lại.", "VERIFICATION", 401);
        if (/not enough credits|insufficient credits|failed to generate|daily free.*limit/i.test(body)) throw providerError("DreamFace báo thiếu lượt hoặc không thể tạo video. Kiểm tra hạn mức trong tài khoản.", "PROVIDER_QUOTA");
        const rendered = await page.locator("video:visible, video source:visible").evaluateAll((nodes) => nodes.map((node) => node.currentSrc || node.src).filter(Boolean)).catch(() => []);
        for (const url of rendered) if (!baseline.has(url)) candidates.add(url);
        for (const url of candidates) {
          candidates.delete(url);
          update({ status: "downloading", progress: 90 });
          try {
            const media = await downloadResult(store, session, job, url, signal);
            store.log(job, `Đã tải video DreamFace: ${media.width}×${media.height}, ${media.duration.toFixed(2)} giây.`);
            return media;
          } catch (error) {
            store.log(job, `Video DreamFace chưa tải được (${error.message}); tiếp tục chờ kết quả mới.`);
          }
        }
        update({ elapsedSeconds: Math.floor((Date.now() - started) / 1000) });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, Math.max(3000, Number(store.state.settings.pollSeconds || 5) * 1000));
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason || new Error("aborted")); }, { once: true });
        });
      }
      throw providerError("Hết thời gian theo dõi DreamFace. Yêu cầu có thể vẫn đang chạy; kiểm tra trong tài khoản trước khi tạo lại.", "PROVIDER_TIMEOUT", 408);
    } finally {
      page.off("response", responseListener);
      await Promise.all(temporaryReferences.map(file=>fs.rm(file,{force:true})));
    }
  }

  async close(account) {
    const id = accountId(account);
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await session.context.close().catch(() => {});
    session.releaseStorage?.();
  }
}

export function createDreamFaceProvider(options) {
  return new DreamFaceProvider(options);
}
