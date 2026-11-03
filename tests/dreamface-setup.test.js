import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { DreamFaceSetupQueue } from "../server/dreamface-setup.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-setup-"));
  const store = new Store(root);
  const accounts = ["Alpha", "Beta"].map((name) => store.add("accounts", {
    name,
    provider: "dreamface",
    loginMethod: "credentials",
    status: "needs_login",
    gmailStatus: "idle",
  }));
  const calls = [];
  const closed = [];
  const provider = {
    captchaSettings: () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) }),
    login: async (account, credentials, options = {}) => {
      calls.push({ name: account.name, visible: options.visible === true, hasCredentials: Boolean(credentials.email) });
      return { status: "ready", authStep: "ready", message: `${account.name} ready` };
    },
    close: async (account) => { closed.push(account.name); },
    sessions: new Map(),
  };
  return { root, store, accounts, calls, closed, provider };
}

async function waitForIdle(queue, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (queue.running || queue.pending.length) {
    if (Date.now() > deadline) throw new Error("setup queue did not finish");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("setup queue signs profiles in hidden, one at a time, closes them and marks ready", async () => {
  const { root, store, accounts, calls, closed, provider } = fixture();
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider });
  const status = queue.enqueue(accounts);
  assert.equal(status.queued, 2);
  await waitForIdle(queue);

  assert.deepEqual(calls.map((call) => call.name), ["Alpha", "Beta"]);
  assert.equal(calls.every((call) => call.visible === false), true);
  assert.equal(calls.every((call) => call.hasCredentials), true);
  assert.deepEqual(closed, ["Alpha", "Beta"]);
  assert.deepEqual(store.state.accounts.map((account) => account.status), ["ready", "ready"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue waits for a hidden profile to become ready instead of opening a window", async () => {
  const { root, store, accounts, calls, closed, provider } = fixture();
  provider.login = async (account, credentials, options = {}) => {
    calls.push({ name: account.name, visible: options.visible === true });
    if (account.name === "Alpha") {
      provider.sessions.set(account.id, { page: { isClosed: () => false } });
      return { status: "verification", authStep: "captcha", message: "CAPTCHA" };
    }
    return { status: "ready", authStep: "ready", message: "ready" };
  };
  provider.inspect = async (account) => ({ status: "ready", authStep: "ready", message: `${account.name} verified` });
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider, manualWaitMs: 1000, pollMs: 5 });
  queue.enqueue(accounts);
  await waitForIdle(queue);

  assert.deepEqual(calls, [
    { name: "Alpha", visible: false },
    { name: "Beta", visible: false },
  ]);
  assert.deepEqual(closed, ["Alpha", "Beta"]);
  assert.deepEqual(store.state.accounts.map((account) => account.status), ["ready", "ready"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue solves a late CAPTCHA hidden and waits for the profile to become ready", async () => {
  const { root, store, accounts, calls, closed, provider } = fixture();
  const recoveries = [];
  let inspected = 0;
  provider.login = async (account, credentials, options = {}) => {
    calls.push({ name: account.name, visible: options.visible === true, hasCredentials: Boolean(credentials.email) });
    if (account.name === "Alpha") {
      provider.sessions.set(account.id, {
        page: { isClosed: () => false },
        captchaState: { key: "", at: 0, solves: 0 },
      });
      return { status: "verification", authStep: "captcha", message: "CAPTCHA appears late" };
    }
    return { status: "ready", authStep: "ready", message: "ready" };
  };
  provider.recoverCaptcha = async (account) => {
    recoveries.push(account.name);
    return { attempted: true, solved: true, type: "recaptcha-v2" };
  };
  provider.inspect = async (account) => {
    inspected += 1;
    if (account.name === "Alpha" && inspected === 1)
      return { status: "verification", authStep: "captcha", message: "waiting" };
    return { status: "ready", authStep: "ready", message: `${account.name} ready` };
  };
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider, manualWaitMs: 5000, pollMs: 5 });
  queue.enqueue(accounts);
  await waitForIdle(queue);

  assert.deepEqual(recoveries, ["Alpha"]);
  assert.deepEqual(calls, [
    { name: "Alpha", visible: false, hasCredentials: true },
    { name: "Beta", visible: false, hasCredentials: true },
  ]);
  assert.deepEqual(closed, ["Alpha", "Beta"]);
  assert.deepEqual(store.state.accounts.map((account) => account.status), ["ready", "ready"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue stops retrying when the hidden CAPTCHA solve limit is reached", async () => {
  const { root, store, accounts, provider } = fixture();
  let recoveries = 0;
  provider.login = async (account) => {
    provider.sessions.set(account.id, {
      page: { isClosed: () => false },
      captchaState: { key: "recaptcha-v2:test", at: Date.now(), solves: 2 },
    });
    return { status: "verification", authStep: "captcha", message: "CAPTCHA" };
  };
  provider.inspect = async () => ({ status: "verification", authStep: "captcha", message: "still waiting" });
  provider.recoverCaptcha = async () => {
    recoveries += 1;
    return { attempted: true, solved: false, reason: "limit" };
  };
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider, manualWaitMs: 5000, pollMs: 5 });
  queue.enqueue([accounts[0]]);
  await waitForIdle(queue);

  assert.equal(recoveries, 1);
  const account = store.state.accounts[0];
  assert.equal(account.status, "needs_login");
  assert.equal(account.gmailStatus, "verification");
  assert.match(account.message, /2Captcha đã giải CAPTCHA/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue stops at DreamFace's CAPTCHA rejection instead of waiting out the timeout", async () => {
  const { root, store, accounts, provider } = fixture();
  provider.login = async (account) => {
    provider.sessions.set(account.id, {
      page: { isClosed: () => false },
      captchaState: { key: "", at: 0, solves: 0 },
    });
    return { status: "verification", authStep: "captcha", message: "CAPTCHA" };
  };
  provider.inspect = async () => ({ status: "verification", authStep: "captcha", message: "still waiting" });
  let recoveries = 0;
  provider.recoverCaptcha = async () => {
    recoveries += 1;
    return { attempted: false, solved: false, reason: "rejected" };
  };
  const started = Date.now();
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider, manualWaitMs: 60000, pollMs: 5 });
  queue.enqueue([accounts[0]]);
  await waitForIdle(queue);

  assert.equal(recoveries, 1);
  assert.ok(Date.now() - started < 10000, "rejection must end the wait immediately");
  const account = store.state.accounts[0];
  assert.equal(account.status, "needs_login");
  assert.match(account.message, /THS12140000001/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue keeps a usable profile ready after a rejected extra CAPTCHA", async () => {
  const { root, store, accounts, provider } = fixture();
  provider.login = async (account) => {
    provider.sessions.set(account.id, {
      page: { isClosed: () => false },
      captchaState: { key: "", at: 0, solves: 0 },
    });
    return { status: "verification", authStep: "captcha", message: "CAPTCHA" };
  };
  let inspected = 0;
  provider.inspect = async () => {
    inspected += 1;
    if (inspected === 1) return { status: "verification", authStep: "captcha", message: "still waiting" };
    return { status: "ready", authStep: "ready", message: "Sẵn sàng render DreamFace News." };
  };
  provider.recoverCaptcha = async () => {
    provider.sessions.get(accounts[0].id).captchaState.rejectedAt = Date.now();
    return { attempted: false, solved: false, reason: "rejected" };
  };
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider, manualWaitMs: 60000, pollMs: 5 });
  queue.enqueue([accounts[0]]);
  await waitForIdle(queue);

  const account = store.state.accounts[0];
  assert.equal(account.status, "ready");
  assert.equal(account.gmailStatus, "ready");
  assert.equal(account.gmailAuthStep, "ready");
  assert.match(account.message, /Sẵn sàng/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue shows the login and CAPTCHA beginning in the row message", async () => {
  const { root, store, accounts, provider } = fixture();
  const messages = [];
  const originalPatch = store.patch.bind(store);
  store.patch = (collection, id, patch) => {
    if (collection === "accounts" && patch?.message) messages.push(patch.message);
    return originalPatch(collection, id, patch);
  };
  provider.login = async (account, credentials, options = {}) => {
    options.onProgress?.({ message: "Đang mở DreamFace ẩn và kiểm tra phiên đăng nhập…" });
    options.onProgress?.({ message: "Đang tự điền email/mật khẩu…" });
    options.onProgress?.({ status: "submitted", taskId: "task-1" });
    options.onProgress?.({ status: "processing", taskId: "task-1" });
    return { status: "ready", authStep: "ready", message: `${account.name} ready` };
  };
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider });
  queue.enqueue([accounts[0]]);
  await waitForIdle(queue);

  assert.ok(messages.some((message) => /Đang mở DreamFace ẩn/.test(message)));
  assert.ok(messages.some((message) => /Đang tự điền email\/mật khẩu/.test(message)));
  assert.ok(messages.some((message) => /Đã gửi CAPTCHA ẩn tới 2Captcha/.test(message)));
  assert.ok(messages.some((message) => /2Captcha đang giải CAPTCHA ẩn/.test(message)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue runs as many hidden Chrome lanes as requested", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-setup-"));
  const store = new Store(root);
  const accounts = ["One", "Two", "Three", "Four"].map((name) => store.add("accounts", {
    name,
    provider: "dreamface",
    loginMethod: "credentials",
    status: "needs_login",
    gmailStatus: "idle",
  }));
  let active = 0;
  let peak = 0;
  const provider = {
    captchaSettings: () => ({ enabled: true, autoSolveDreamFace: true, apiKey: "a".repeat(32) }),
    login: async (account) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return { status: "ready", authStep: "ready", message: `${account.name} ready` };
    },
    close: async () => {},
    sessions: new Map(),
  };
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider });
  const status = queue.enqueue(accounts, { concurrency: 2 });
  assert.equal(status.concurrency, 2);
  await waitForIdle(queue);

  assert.equal(peak, 2);
  assert.equal(store.state.accounts.every((account) => account.status === "ready"), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("setup queue skips a profile that is already busy", () => {
  const { root, store, accounts, provider } = fixture();
  store.patch("accounts", accounts[0].id, { status: "busy" });
  const queue = new DreamFaceSetupQueue({ store, dreamface: provider });
  const status = queue.enqueue([accounts[0]]);
  assert.equal(status.queued, 0);
  assert.equal(queue.running, false);
  fs.rmSync(root, { recursive: true, force: true });
});
