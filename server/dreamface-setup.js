import { setTimeout as delay } from "node:timers/promises";
import { ensureDreamFaceCredentials, getDreamFaceCredentials } from "./dreamface-accounts.js";
import { DREAMFACE_CAPTCHA_REJECT_MESSAGE } from "./providers/dreamface.js";

const MANUAL_WAIT_MS = 3 * 60 * 1000;
const POLL_MS = 2000;
const MAX_CONCURRENCY = 4;

function clampConcurrency(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(MAX_CONCURRENCY, number);
}

/**
 * Prepares newly created DreamFace profiles in hidden Chrome windows only. The
 * queue runs a configurable number of profiles at once (Chrome lanes), waits for
 * CAPTCHA/2Captcha to finish, closes each window as soon as the profile is
 * ready, and never pops a visible window for verification.
 */
export class DreamFaceSetupQueue {
  constructor({ store, dreamface, manualWaitMs = MANUAL_WAIT_MS, pollMs = POLL_MS, concurrency } = {}) {
    this.store = store;
    this.dreamface = dreamface;
    this.manualWaitMs = manualWaitMs;
    this.pollMs = pollMs;
    this.limit = clampConcurrency(concurrency ?? store?.state?.settings?.dreamfaceConcurrency);
    this.pending = [];
    this.active = new Set();
    this.running = false;
    this.stopped = false;
    this.total = 0;
    this.done = 0;
  }

  enqueue(accounts, { concurrency } = {}) {
    this.limit = concurrency === undefined
      ? clampConcurrency(this.store.state.settings?.dreamfaceConcurrency)
      : clampConcurrency(concurrency);
    const ids = [...new Set(accounts.map((account) => account.id))];
    let queued = 0;
    for (const id of ids) {
      if (this.active.has(id) || this.pending.includes(id)) continue;
      const account = this.store.state.accounts.find((item) => item.id === id);
      if (!account || account.provider !== "dreamface") continue;
      if (["busy", "checking"].includes(account.status)) continue;
      this.pending.push(id);
      queued += 1;
    }
    this.total += queued;
    if (queued) this.run();
    return this.status(queued);
  }

  status(queued = 0) {
    const active = [...this.active];
    return {
      running: this.running,
      queued,
      total: this.total,
      done: this.done,
      concurrency: this.limit,
      active,
      current: active[0] || null,
      remaining: this.pending.length + active.length,
    };
  }

  stop() {
    this.stopped = true;
    this.pending = [];
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const workers = Math.max(1, Math.min(this.limit, this.pending.length));
      await Promise.all(Array.from({ length: workers }, () => this.worker()));
    } finally {
      this.running = false;
      // An account enqueued in the gap between the last loop check and this
      // block would otherwise wait forever.
      if (!this.stopped && this.pending.length) {
        this.run();
      } else {
        this.total = 0;
        this.done = 0;
      }
    }
  }

  async worker() {
    while (!this.stopped) {
      const id = this.pending.shift();
      if (!id) break;
      this.active.add(id);
      try {
        await this.setupAccount(id);
      } catch {
        // setupAccount already records the failure on the account.
      } finally {
        this.active.delete(id);
        this.done += 1;
      }
      // Give Chrome a moment to release the profile directory on Windows.
      await delay(300);
    }
  }

  patch(accountId, patch) {
    const account = this.store.state.accounts.find((item) => item.id === accountId);
    if (!account) return null;
    return this.store.patch("accounts", accountId, patch);
  }

  progressMessage(account, position, total) {
    return `Đang đăng nhập ẩn ${position}/${total}: ${account.name}…`;
  }

  async markReady(account, message) {
    await this.dreamface.close(account).catch(() => {});
    return this.patch(account.id, {
      status: "ready",
      gmailStatus: "ready",
      gmailAuthStep: "ready",
      gmailCheckedAt: new Date().toISOString(),
      message: message || "DreamFace đã sẵn sàng.",
    });
  }

  async setupAccount(id) {
    const account = this.store.require("accounts", id);
    const settings = this.dreamface.captchaSettings();
    const canAutoSolve = settings.enabled && settings.autoSolveDreamFace && Boolean(settings.apiKey);
    const total = this.total || 1;
    const position = Math.min(this.done + 1, total);
    const credentials = ensureDreamFaceCredentials(this.store, account);
    this.patch(id, {
      status: "checking",
      gmailStatus: "opening",
      gmailAuthStep: "browser",
      message: this.progressMessage(account, position, total),
    });

    let result;
    try {
      result = await this.dreamface.login(account, credentials, {
        visible: false,
        onProgress: (progress) => {
          if (progress?.status === "submitted")
            this.patch(id, {
              message: progress.kind === "grid"
                ? "Đã gửi ảnh lưới CAPTCHA tới 2Captcha. Đang chờ kết quả…"
                : "Đã gửi CAPTCHA ẩn tới 2Captcha. Đang chờ mã giải…",
            });
          else if (progress?.status === "processing")
            this.patch(id, {
              message: progress.kind === "grid"
                ? "2Captcha đang đọc lưới CAPTCHA trong profile…"
                : "2Captcha đang giải CAPTCHA ẩn…",
            });
          else if (progress?.message)
            this.patch(id, { message: progress.message });
        },
      });
    } catch (error) {
      await this.dreamface.close(account).catch(() => {});
      this.patch(id, {
        status: "needs_login",
        gmailStatus: "failed",
        gmailAuthStep: "error",
        message: error.message,
      });
      return;
    }

    if (result.status === "ready") {
      await this.markReady(account, result.message);
      return;
    }

    await this.waitForReady(account, result, canAutoSolve);
  }

  async waitForReady(account, initial, canAutoSolve) {
    const id = account.id;
    let deadline = Date.now() + this.manualWaitMs;
    this.patch(id, {
      status: "checking",
      gmailStatus: initial.status,
      gmailAuthStep: initial.authStep || "identity",
      message: canAutoSolve
        ? "Đang chờ DreamFace trong nền. App tự điền đăng nhập và giải CAPTCHA ẩn bằng 2Captcha khi trang hiển thị mã."
        : "Đang chờ DreamFace xác minh trong nền. Cửa sổ không mở ra; lưu API key 2Captcha để app tự giải CAPTCHA.",
    });
    while (!this.stopped) {
      const session = this.dreamface.sessions.get(id);
      if (!session || !session.page || session.page.isClosed?.()) break;
      let state;
      try {
        state = await this.dreamface.inspect(account, session);
      } catch {
        state = null;
      }
      if (state?.status === "ready") {
        await this.markReady(account, state.message);
        return;
      }

      let recovered = null;
      if (canAutoSolve && typeof this.dreamface.recoverCaptcha === "function") {
        try {
          recovered = await this.dreamface.recoverCaptcha(account, session, {
            credentials: getDreamFaceCredentials(this.store, account),
            onProgress: (progress) => {
              if (progress?.status === "submitted")
                this.patch(id, {
                  message: progress.kind === "grid"
                    ? "Đã gửi ảnh lưới CAPTCHA tới 2Captcha. Đang chờ kết quả…"
                    : "Đã gửi CAPTCHA ẩn tới 2Captcha. Đang chờ mã giải…",
                });
              else if (progress?.status === "processing")
                this.patch(id, {
                  message: progress.kind === "grid"
                    ? "2Captcha đang đọc lưới CAPTCHA trong profile…"
                    : "2Captcha đang giải CAPTCHA ẩn…",
                });
              else if (progress?.message)
                this.patch(id, { message: progress.message });
            },
          });
        } catch {
          recovered = null;
        }
      }
      if (recovered?.reason === "rejected" || session.captchaState?.rejectedAt) {
        // DreamFace answered the solved token with THS12140000001. Solving
        // again only buys another rejected token, so stop the paid attempts.
        // Re-check first: a rejected extra login must not flag a profile whose
        // existing session is still usable.
        try { state = await this.dreamface.inspect(account, session); } catch {}
        if (state?.status === "ready") {
          await this.markReady(account, state.message);
          return;
        }
        await this.dreamface.close(account).catch(() => {});
        this.patch(id, {
          status: "needs_login",
          gmailStatus: "verification",
          gmailAuthStep: "captcha",
          gmailCheckedAt: new Date().toISOString(),
          message: DREAMFACE_CAPTCHA_REJECT_MESSAGE,
        });
        return;
      }
      if (recovered?.solved) {
        // A solve can consume most of the original wait. Give the provider a
        // fresh minute to finish the authenticated session.
        deadline = Math.max(deadline, Date.now() + 60000);
        try {
          state = await this.dreamface.inspect(account, session);
        } catch {}
        if (state?.status === "ready") {
          await this.markReady(account, state.message);
          return;
        }
      }
      if (recovered?.reason === "limit") break;
      if (Date.now() >= deadline) break;

      const seconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      this.patch(id, {
        status: "checking",
        gmailStatus: state?.status || initial.status,
        gmailAuthStep: state?.authStep || "identity",
        message: recovered?.solved
          ? `Đã giải CAPTCHA; đang chờ DreamFace xác nhận (còn ${seconds}s)…`
          : `Đang chờ DreamFace sẵn sàng trong nền (còn ${seconds}s)${canAutoSolve ? " · tự giải CAPTCHA bằng 2Captcha" : ""}…`,
      });
      await delay(this.pollMs);
    }
    const session = this.dreamface.sessions.get(id);
    const solves = Number(session?.captchaState?.solves) || 0;
    await this.dreamface.close(account).catch(() => {});
    this.patch(id, {
      status: "needs_login",
      gmailStatus: "verification",
      gmailAuthStep: "captcha",
      message: canAutoSolve
        ? solves > 0
          ? "2Captcha đã giải CAPTCHA nhưng DreamFace chưa xác nhận phiên này. Kiểm tra proxy/IP hoặc mở profile để xử lý, rồi thử lại."
          : "DreamFace chưa chấp nhận đăng nhập ẩn hoặc chưa hiển thị CAPTCHA trong thời gian chờ. Bấm Giải CAPTCHA để thử lại ẩn."
        : "DreamFace cần xác minh nhưng chưa có API key 2Captcha. Lưu key trong Cài đặt để app tự giải ẩn, rồi bấm Giải CAPTCHA.",
    });
  }
}
