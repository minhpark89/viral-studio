import { StudioError } from './store.js';

// Upload/model hydration can restore the provider's remembered Audio tab or
// replace its textarea. Re-select Text after those operations and resolve the
// visible editor again; never fill a hidden, stale composer or click Generate.
export async function selectNewsAvatarTextTab(page, { signal, timeoutMs = 30000 } = {}) {
  signal?.throwIfAborted();
  const prompt = page.locator('textarea[placeholder="Type or paste text here"]:visible').first();
  if (!await prompt.isVisible().catch(() => false)) {
    const textTab = page.getByText('Text', { exact: true }).first();
    if (await textTab.isVisible().catch(() => false)) {
      try { await textTab.click({ timeout: timeoutMs }); }
      catch (error) {
        if (/^locator\.click: Timeout \d+ms exceeded/m.test(String(error.message))) {
          throw new StudioError('DreamFace chưa chuyển được sang ô lời dẫn Text. Chưa gửi yêu cầu MC.', 'PROVIDER_EDITOR_NOT_READY', 503);
        }
        throw error;
      }
    }
  }
  await prompt.waitFor({ state: 'visible', timeout: timeoutMs });
  signal?.throwIfAborted();
  return prompt;
}

export async function fillNewsAvatarNarration(page, narration, { signal, timeoutMs = 30000 } = {}) {
  const prompt = await selectNewsAvatarTextTab(page, { signal, timeoutMs });
  if (await prompt.inputValue({ timeout: timeoutMs }) !== narration) await prompt.fill(narration, { timeout: timeoutMs });
  await page.waitForTimeout(250);
  signal?.throwIfAborted();
  if (await prompt.inputValue({ timeout: timeoutMs }) !== narration) {
    throw new StudioError('DreamFace đã thay ô lời dẫn khi tải giao diện. Chưa gửi yêu cầu MC; hãy thử lại khi trang sẵn sàng.', 'PROVIDER_EDITOR_NOT_READY', 503);
  }
  return prompt;
}

export function canRetryNewsEditor(job, error) {
  const receipt = job?.payload?.newsAvatarRequest;
  if (job?.submittedAt || receipt?.submittedAt || receipt?.id || job?.payload?.presenterMediaId) return false;
  return error?.code === 'PROVIDER_EDITOR_NOT_READY'
    || /^locator\.(?:fill|setInputFiles|waitFor|inputValue): Timeout \d+ms exceeded/m.test(String(error?.message || ''));
}
