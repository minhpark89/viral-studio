import fs from 'node:fs/promises';
import path from 'node:path';

export const safeProviderMessage = value => String(value || '').replace(/Bearer\s+\S+|(?:sk|token|key)[_-][\w.-]{8,}/gi, '[redacted]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').replace(/https?:\/\/\S+/gi, '[URL]').replace(/\s+/g, ' ').slice(0, 500);

export async function captureNewsFailure(store, job, page, error, signals = {}) {
  const diagnostic = { at:new Date().toISOString(), code:error.code || 'PROVIDER_ERROR', message:safeProviderMessage(error.message), ...signals };
  try {
    const alerts = page.locator('[role="alert"], .ant-message-notice-content, .el-message, [role="dialog"]');
    for (let i = 0; i < Math.min(4, await alerts.count()); i++) {
      const alert = alerts.nth(i);
      if (!await alert.isVisible()) continue;
      const text = safeProviderMessage(await alert.innerText({ timeout:1500 }));
      if (!text) continue;
      diagnostic.notice = text;
      const dir = path.join(store.root, 'logs', 'provider');
      await fs.mkdir(dir, { recursive:true });
      const file = path.join(dir, `${job.id}-${Date.now()}.png`);
      await alert.screenshot({ path:file, timeout:2500, mask:[page.locator('input, textarea'), page.getByText(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)] });
      diagnostic.screenshotFile = file;
      break;
    }
  } catch { /* Diagnostics must not mask the original provider failure. */ }
  store.patch('jobs', job.id, { providerDiagnostics:diagnostic });
  return diagnostic;
}
