import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const safeProviderMessage = value => String(value || '')
  .replace(/Bearer\s+\S+|(?:sk|token|key)[_-][\w.-]{8,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[redacted]')
  .replace(/\b((?:access[_-]?|refresh[_-]?)?token|password|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
  .replace(/https?:\/\/\S+/gi, '[URL]').replace(/\s+/g, ' ').trim().slice(0, 500);

// DreamFace uses Radix Vue toasts (role=status), not only role=alert. Avoid
// generic status elements: they can contain account details and the whole UI.
const noticeSelectors = [
  '[data-radix-vue-collection-item][role="status"]',
  '[data-radix-vue-collection-item][role="alert"]',
  '.ant-message-notice-content, .el-message, [role="alert"]',
  '[role="dialog"]',
];

async function visibleNotice(page) {
  for (const selector of noticeSelectors) {
    const notices = page.locator(selector);
    for (let i = (await notices.count()) - 1; i >= Math.max(0, (await notices.count()) - 8); i--) {
      const element = notices.nth(i);
      if (!await element.isVisible().catch(() => false)) continue;
      const raw = await element.innerText({ timeout: 750 }).catch(() => '');
      const text = safeProviderMessage(raw);
      if (text) return { element, raw, text };
    }
  }
  return null;
}

export async function captureNewsFailure(store, job, page, error, signals = {}) {
  const diagnostic = { at:new Date().toISOString(), code:error.code || 'PROVIDER_ERROR', message:safeProviderMessage(error.message), ...signals };
  try {
    // A response event precedes the UI toast. Allow its next render to finish,
    // with a small fixed budget; diagnostics must not hold the queue open.
    const deadline = Date.now() + 800;
    let notice;
    do {
      notice = await visibleNotice(page);
      if (notice || page.isClosed() || Date.now() >= deadline) break;
      await delay(100);
    } while (true);
    if (notice) {
      diagnostic.notice = notice.text;
      // Text redaction cannot redact screenshot pixels. If this notice contains
      // credentials/URLs or exceeds our text limit, keep only its sanitized text.
      const raw = notice.raw.replace(/\s+/g, ' ').trim();
      if (notice.text !== raw) {
        diagnostic.screenshotOmitted = 'sensitive-or-long-notice';
      } else {
      const dir = path.join(store.root, 'logs', 'provider');
      await fs.mkdir(dir, { recursive:true });
      const file = path.join(dir, `${String(job.id).replace(/[^a-z0-9-]/gi, '_')}-${Date.now()}.png`);
      await notice.element.screenshot({ path:file, timeout:2500, mask:[page.locator('input, textarea, [contenteditable="true"]')] });
      diagnostic.screenshotFile = file;
      }
    }
  } catch { /* Diagnostics must not mask the original provider failure. */ }
  store.patch('jobs', job.id, { providerDiagnostics:diagnostic });
  return diagnostic;
}
