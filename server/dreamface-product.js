import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StudioError } from "./store.js";
import { importMedia, probe } from "./media.js";
import {
  configureProductVideo,
  readProductQuote,
} from "./dreamface-product-ui.js";
import {
  submitProductVideo,
  waitForProductVideo,
} from "./dreamface-product-result.js";

export async function generateProductVideo(
  provider,
  store,
  job,
  account,
  signal,
  update,
) {
  const profileId = account.profileId || account.id;
  let temporary = null;
  try {
    const session = await provider.open(account, { visible: false });
    const state = await provider.inspect(account, session, { navigate: true });
    if (state.status !== "ready")
      throw new StudioError(
        state.message,
        state.status === "verification" ? "VERIFICATION" : "NEEDS_LOGIN",
        401,
      );
    const { page } = session;
    let credits = null;
    const onResponse = async (r) => {
      if (!/\/credits\/get_remaining_credits/.test(r.url())) return;
      try {
        const b = await r.json();
        if (b.status_code === "THS12140000000") credits = b.data;
      } catch {}
    };
    page.on("response", onResponse);
    try {
      let receipt = job.payload.productRequest;
      if (receipt?.submittedAt && !receipt.id)
        throw new StudioError(
          "Product đã gửi nhưng chưa rõ mã tác vụ. Kiểm tra Creations trước khi tạo lại.",
          "PRODUCT_SUBMISSION_UNCONFIRMED",
          409,
        );
      if (!receipt?.id) {
        update({ stage: "Chuẩn bị ảnh và cấu hình Product", progress: 2 });
        const configured = await configureProductVideo(
          store,
          page,
          job,
          signal,
        );
        temporary = configured.temporary;
        const { button, quote } = await readProductQuote(
          page,
          configured.options,
          () => credits,
          signal,
        );
        const checkedAt = new Date().toISOString();
        store.patch("accounts", account.id, {
          productQuota: {
            ...quote,
            ...configured.options,
            duration: job.payload.duration,
            checkedAt,
            nextCheckAt:
              quote.state === "available"
                ? null
                : new Date(Date.now() + 30 * 60000).toISOString(),
            scope: "Dream Video 1.5 · WAN",
          },
        });
        if (quote.state === "unknown")
          throw new StudioError(
            "Chưa xác nhận được tín dụng Product. Không gửi tác vụ.",
            "PRODUCT_QUOTA_UNKNOWN",
            422,
          );
        if (quote.state !== "available")
          throw new StudioError(
            quote.overBudget
              ? "Giá Product vượt giới hạn credits đã chọn."
              : "Profile không còn lượt Product phù hợp; đang chờ profile khác.",
            "PRODUCT_QUOTA",
            409,
          );
        await configured.prompt.fill(job.payload.prompt);
        signal.throwIfAborted();
        receipt = await submitProductVideo({
          page,
          prompt: job.payload.prompt,
          profileId,
          signal,
          click: async () => {
            const current = await readProductQuote(
              page,
              configured.options,
              () => credits,
              signal,
            );
            if (
              current.quote.state !== "available" ||
              current.quote.kind !== quote.kind ||
              current.quote.cost !== quote.cost
            )
              throw new StudioError(
                "Giá Product thay đổi trước khi tạo.",
                "PRODUCT_QUOTE_CHANGED",
                409,
              );
            await current.button.click({ timeout: 15000 });
          },
          saveReceipt: (receipt) => {
            store.patch("jobs", job.id, {
              payload: {
                ...job.payload,
                accountId: account.id,
                productRequest: receipt,
              },
              submittedAt: receipt.submittedAt,
            });
            update({
              status: "submitting",
              progress: 8,
              stage: "Đang gửi Product",
            });
          },
        });
        store.patch("accounts", account.id, {
          productQuota: {
            ...account.productQuota,
            ...quote,
            state: quote.kind === "daily" ? "exhausted" : "unknown",
            remaining: quote.kind === "daily" ? 0 : undefined,
            checkedAt: new Date().toISOString(),
            nextCheckAt: new Date(Date.now() + 30 * 60000).toISOString(),
          },
        });
      }
      return await waitForProductVideo({
        page,
        receipt,
        prompt: job.payload.prompt,
        profileId,
        signal,
        update,
        timeoutMs:
          Math.max(2, Number(store.state.settings.maxWaitMinutes || 30)) *
          60000,
        pollMs: Math.max(
          10000,
          Number(store.state.settings.pollSeconds || 5) * 2000,
        ),
        download: async (download) => {
          const file = path.join(
            store.root,
            "temp",
            `product-result-${randomUUID()}.mp4`,
          );
          try {
            await download.saveAs(file);
            signal.throwIfAborted();
            const info = await probe(file, store.state.settings);
            if (
              info.kind !== "video" ||
              info.duration < job.payload.duration - 0.3
            )
              throw new StudioError(
                "Video Product trả về ngắn hơn cảnh đã yêu cầu.",
                "PRODUCT_RESULT_INVALID",
              );
            return await importMedia(store, file, {
              projectId: job.projectId,
              name: `${job.name}.mp4`,
              generated: true,
              move: true,
              jobId: job.id,
              mediaType: "product-clip",
            });
          } finally {
            await fs.rm(file, { force: true }).catch(() => {});
          }
        },
      });
    } finally {
      page.off("response", onResponse);
    }
  } finally {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
    if (provider.sessions.get(profileId)?.visible === false)
      await provider.close(account);
  }
}
