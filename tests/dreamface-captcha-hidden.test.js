import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { Store } from "../server/store.js";
import { SecretStore } from "../server/secret-store.js";
import { DreamFaceProvider } from "../server/providers/dreamface.js";
import { applyCaptchaToken } from "../server/captcha.js";
import { resolveBrowserExecutable } from "../server/browser-runtime.js";

const PAGE_HTML = `<!doctype html>
<html><body>
  <input type="email" placeholder="Email address">
  <input type="password" placeholder="Password">
  <button type="button" id="login">Log in</button>
  <script>
    window.__submits = 0;
    document.getElementById("login").addEventListener("click", () => {
      window.__submits += 1;
      if (window.__submits === 1) {
        setTimeout(() => {
          if (document.querySelector(".g-recaptcha")) return;
          const widget = document.createElement("div");
          widget.className = "g-recaptcha";
          widget.dataset.sitekey = "hidden-test-sitekey";
          widget.textContent = "captcha";
          document.body.appendChild(widget);
        }, 400);
      } else {
        setTimeout(() => { window.__ready = true; }, 200);
      }
    });
  </script>
</body></html>`;

async function openTestPage(t) {
  let executablePath;
  try {
    executablePath = resolveBrowserExecutable({});
  } catch {
    t.skip("Chrome/Edge is unavailable for the hidden CAPTCHA browser test.");
    return null;
  }
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("https://www.dreamfaceapp.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: PAGE_HTML }));
  await page.goto("https://www.dreamfaceapp.com/home");
  return { browser, context, page };
}

test("hidden CAPTCHA action fills saved credentials, waits for the late widget and submits twice", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-df-captcha-"));
  const browserFixture = await openTestPage(t);
  if (!browserFixture) {
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  const { browser, page } = browserFixture;
  try {
    const store = new Store(root);
    const account = store.add("accounts", {
      name: "Hidden CAPTCHA",
      provider: "dreamface",
      loginMethod: "credentials",
      status: "needs_login",
      hasCredentials: true,
    });
    const credentials = { email: "hidden.test@example.com", password: "HiddenPass123!" };
    new SecretStore(root).set(`dreamface-${account.id}`, credentials);

    const provider = new DreamFaceProvider({ store });
    const opened = [];
    const closed = [];
    let solveCalls = 0;
    let hiddenSession = null;
    provider.open = async (_account, options = {}) => {
      opened.push({ visible: options.visible === true });
      hiddenSession = { page, context: null, visible: options.visible === true, profileId: account.id };
      return hiddenSession;
    };
    provider.close = async () => { closed.push(account.id); };
    provider.inspect = async () => page.evaluate(() => window.__ready === true).then((ready) =>
      ready
        ? { status: "ready", authStep: "ready", message: "ready" }
        : { status: "needs_login", authStep: "service", message: "waiting" });
    provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) });
    provider.autoSolveCaptcha = async () => {
      solveCalls += 1;
      if (solveCalls === 1) return { solved: true, type: "recaptcha-v2", applied: { applied: 1, called: [] } };
      return { solved: false, reason: "error", message: "stub failure" };
    };

    const result = await provider.solveAccountCaptcha(account, { waitMs: 20000 });
    assert.equal(result.status, "ready");
    assert.match(result.message, /2Captcha/);
    assert.deepEqual(opened, [{ visible: false }]);
    assert.deepEqual(closed, [account.id]);
    assert.equal(solveCalls, 1);
    assert.equal(await page.locator('input[type="email"]').inputValue(), credentials.email);
    assert.equal(await page.locator('input[type="password"]').inputValue(), credentials.password);
    assert.ok(await page.evaluate(() => window.__submits) >= 2);

    const duplicate = await provider.recoverCaptcha(account, hiddenSession, { credentials });
    assert.equal(duplicate.reason, "cooldown");
    assert.equal(solveCalls, 1);

    await page.evaluate(() => { document.querySelector(".g-recaptcha").dataset.sitekey = "hidden-test-sitekey-2"; });
    hiddenSession.captchaState.at = 0;
    const failed = await provider.recoverCaptcha(account, hiddenSession, { credentials });
    assert.equal(failed.attempted, true);
    assert.equal(failed.solved, false);
    assert.equal(solveCalls, 2);

    await page.evaluate(() => { document.querySelector(".g-recaptcha").dataset.sitekey = "hidden-test-sitekey-3"; });
    hiddenSession.captchaState.at = 0;
    const failedAgain = await provider.recoverCaptcha(account, hiddenSession, { credentials });
    assert.equal(failedAgain.attempted, true);
    assert.equal(failedAgain.solved, false);
    assert.equal(failedAgain.errors, 2);
    assert.equal(solveCalls, 3);

    await page.evaluate(() => { document.querySelector(".g-recaptcha").dataset.sitekey = "hidden-test-sitekey-4"; });
    hiddenSession.captchaState.at = 0;
    const capped = await provider.recoverCaptcha(account, hiddenSession, { credentials });
    assert.equal(capped.reason, "limit");
    assert.equal(capped.errors, 2);
    assert.equal(solveCalls, 3);
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a solved token keeps waiting for DreamFace instead of aborting as a solve limit", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-df-captcha-grace-"));
  const browserFixture = await openTestPage(t);
  if (!browserFixture) {
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  const { browser, page } = browserFixture;
  try {
    const store = new Store(root);
    const account = store.add("accounts", {
      name: "Grace CAPTCHA",
      provider: "dreamface",
      loginMethod: "credentials",
      status: "needs_login",
      hasCredentials: true,
    });
    const credentials = { email: "grace.test@example.com", password: "GracePass123!" };
    new SecretStore(root).set(`dreamface-${account.id}`, credentials);

    const provider = new DreamFaceProvider({ store });
    provider.open = async (_account, options = {}) =>
      ({ page, context: null, visible: options.visible === true, profileId: account.id });
    provider.close = async () => {};
    provider.inspect = async () => page.evaluate(() => window.__ready === true).then((ready) =>
      ready
        ? { status: "ready", authStep: "ready", message: "ready" }
        : { status: "needs_login", authStep: "service", message: "waiting" });
    provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) });
    provider.recoverCaptcha = async () => ({
      attempted: false,
      reason: "limit",
      solves: 1,
      errors: 1,
    });
    await page.evaluate(() => setTimeout(() => { window.__ready = true; }, 3000));

    const started = Date.now();
    const result = await provider.solveAccountCaptcha(account, { waitMs: 20000 });
    assert.equal(result.status, "ready");
    assert.match(result.message, /2Captcha/);
    assert.doesNotMatch(result.message, /Đã thử giải CAPTCHA 2 lần/);
    assert.ok(Date.now() - started >= 1500, "a solved token should get a confirmation grace period");
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hidden CAPTCHA action generates and saves credentials when the profile has none", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-df-captcha-missing-"));
  const browserFixture = await openTestPage(t);
  if (!browserFixture) {
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  const { browser, page } = browserFixture;
  try {
    const store = new Store(root);
    const account = store.add("accounts", {
      name: "DreamFace profile 01",
      provider: "dreamface",
      loginMethod: "credentials",
      status: "needs_login",
      hasCredentials: false,
    });
    const provider = new DreamFaceProvider({ store });
    const progress = [];
    provider.open = async (_account, options = {}) =>
      ({ page, context: null, visible: options.visible === true, profileId: account.id });
    provider.close = async () => {};
    provider.inspect = async () => page.evaluate(() => window.__ready === true).then((ready) =>
      ready
        ? { status: "ready", authStep: "ready", message: "ready" }
        : { status: "needs_login", authStep: "service", message: "waiting" });
    provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) });
    provider.autoSolveCaptcha = async () => ({
      solved: true,
      type: "recaptcha-v2",
      applied: { applied: 1, called: [] },
    });

    const result = await provider.solveAccountCaptcha(account, {
      waitMs: 20000,
      onProgress: (item) => progress.push(item),
    });

    assert.equal(result.status, "ready");
    assert.doesNotMatch(result.message, /Không đọc được email/);
    const saved = new SecretStore(root).get(`dreamface-${account.id}`);
    assert.ok(saved?.email, "credentials should be saved");
    assert.ok(saved?.password, "password should be saved");
    assert.equal(account.email, saved.email);
    assert.equal(account.hasCredentials, true);
    assert.equal(await page.locator('input[type="email"]').inputValue(), saved.email);
    assert.equal(await page.locator('input[type="password"]').inputValue(), saved.password);
    assert.match(
      progress.map((item) => item.message).join(" "),
      /tự tạo và lưu email\/mật khẩu/,
    );
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hidden recovery hands the solved token to DreamFace's site callback without clicking Log in again", async (t) => {
  const browserFixture = await openTestPage(t);
  if (!browserFixture) return;
  const { browser, page } = browserFixture;
  try {
    await page.evaluate(() => {
      window.__submits = 0;
      const widget = document.createElement("div");
      widget.className = "g-recaptcha";
      widget.dataset.sitekey = "callback-sitekey";
      document.body.appendChild(widget);
    });
    const provider = new DreamFaceProvider({ store: { root: os.tmpdir() } });
    provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) });
    provider.autoSolveCaptcha = async () => ({
      solved: true,
      type: "recaptcha-v2",
      applied: { applied: 1, called: ["clients.0.I.I.callback"] },
    });
    const session = { page, captchaState: { key: "", at: 0, solves: 0 } };
    const result = await provider.recoverCaptcha(
      { id: "00000000-0000-4000-8000-000000000002", provider: "dreamface" },
      session,
      { credentials: { email: "callback@example.com", password: "CallbackPass123!" } },
    );
    assert.equal(result.attempted, true);
    assert.equal(result.solved, true);
    assert.equal(result.handedToPage, true);
    assert.equal(await page.evaluate(() => window.__submits), 0);
    assert.equal(await page.locator('input[type="email"]').inputValue(), "");
  } finally {
    await browser.close().catch(() => {});
  }
});

test("DreamFace's THS12140000001 rejection stops further paid solves", async (t) => {
  let executablePath;
  try {
    executablePath = resolveBrowserExecutable({});
  } catch {
    t.skip("Chrome/Edge is unavailable for the hidden CAPTCHA browser test.");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-df-captcha-reject-"));
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  try {
    await page.route("https://www.dreamfaceapp.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: PAGE_HTML }));
    await page.route("https://www.dreamfaceapp.com/dw-server/user/login", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status_code: "THS12140000001", statusMsg: "Failed to pass Google Captcha." }),
      }));
    await page.goto("https://www.dreamfaceapp.com/home");
    await page.evaluate(() => {
      const widget = document.createElement("div");
      widget.className = "g-recaptcha";
      widget.dataset.sitekey = "reject-sitekey";
      document.body.appendChild(widget);
    });

    const provider = new DreamFaceProvider({ store: { root } });
    provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) });
    let solveCalls = 0;
    provider.autoSolveCaptcha = async (targetPage) => {
      solveCalls += 1;
      await targetPage.evaluate(() => fetch("/dw-server/user/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).then((response) => response.json()));
      return { solved: true, type: "recaptcha-v2", applied: { applied: 1, called: ["grecaptcha.0.callback"] } };
    };
    const session = { page, captchaState: { key: "", at: 0, solves: 0, errors: 0 } };
    const account = { id: "00000000-0000-4000-8000-000000000003", provider: "dreamface" };
    const credentials = { email: "reject.test@example.com", password: "RejectPass123!" };

    const first = await provider.recoverCaptcha(account, session, { credentials });
    assert.equal(first.attempted, true);
    assert.equal(first.reason, "rejected");
    assert.equal(first.serverRejected, true);
    assert.equal(first.solved, false);
    assert.equal(first.code, "THS12140000001");
    assert.equal(solveCalls, 1);

    await page.evaluate(() => { document.querySelector(".g-recaptcha").dataset.sitekey = "reject-sitekey-2"; });
    session.captchaState.at = 0;
    const second = await provider.recoverCaptcha(account, session, { credentials });
    assert.equal(second.attempted, false);
    assert.equal(second.reason, "rejected");
    assert.equal(solveCalls, 1, "a rejected token must not trigger another paid solve");
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applying a solved token invokes success callbacks but not expired callbacks", async (t) => {
  const browserFixture = await openTestPage(t);
  if (!browserFixture) return;
  const { browser, page } = browserFixture;
  try {
    await page.evaluate(() => {
      window.__token = "";
      window.__expired = 0;
      window.___grecaptcha_cfg = {
        clients: {
          0: { I: { I: {
            callback: (token) => { window.__token = token; },
            "expired-callback": () => { window.__expired += 1; },
          } } },
        },
      };
    });
    const applied = await applyCaptchaToken(page, { type: "recaptcha-v2", token: "solved-token" });
    assert.deepEqual(applied.called, ["grecaptcha.0.I.I.callback"]);
    assert.equal(await page.evaluate(() => window.__token), "solved-token");
    assert.equal(await page.evaluate(() => window.__expired), 0);
    assert.equal(await page.evaluate(() => document.querySelector("#g-recaptcha-response")?.value), "solved-token");
  } finally {
    await browser.close().catch(() => {});
  }
});

test("CAPTCHA action stays hidden and returns a key message when 2Captcha is not configured", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-df-captcha-nokey-"));
  const provider = new DreamFaceProvider({ store: { root } });
  const opened = [];
  const closed = [];
  const page = {
    url: () => "about:blank",
    goto: async () => {},
    waitForFunction: async () => {},
  };
  provider.open = async (_account, options = {}) => {
    opened.push({ visible: options.visible === true });
    return { page, context: null, visible: options.visible === true };
  };
  provider.inspect = async () => ({ status: "verification", authStep: "captcha", message: "CAPTCHA" });
  provider.close = async () => { closed.push(true); };
  provider.captchaSettings = () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "" });
  const account = {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "dreamface",
    loginMethod: "cookie",
    status: "verification",
  };

  const result = await provider.solveAccountCaptcha(account);
  assert.deepEqual(opened, [{ visible: false }]);
  assert.equal(closed.length, 1);
  assert.equal(result.status, "verification");
  assert.match(result.message, /API key 2Captcha/);
  fs.rmSync(root, { recursive: true, force: true });
});
