import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioError } from './store.js';
import { safeProviderMessage } from './dreamface-diagnostics.js';

export const newsNarrationHash = value => createHash('sha256').update(String(value || '').replace(/\s+/g, ' ').trim()).digest('hex');
const submission = value => /\/task(?:_v\d+)?\/(?:v\d+\/)?(?:submit|create_web_task)(?:[/?]|$)/i.test(value);
const failure = (message, code = 'PROVIDER_SUBMISSION_UNCONFIRMED') => new StudioError(message, code, 422);

function containsNarration(value, expected, depth = 0) {
  if (depth > 12) return false;
  if (typeof value === 'string') return newsNarrationHash(value) === expected;
  return value && typeof value === 'object' && Object.values(value).some(item => containsNarration(item, expected, depth + 1));
}

export function matchingNewsWork(rows, receipt) {
  if (!receipt?.id) return null;
  return rows.find(row => row.file_type === 'VIDEO' && row.work_type === 'ADVANCED_AVATAR'
    && [row.id, row.animate_id, row.work_id, row.task_id].filter(Boolean).includes(receipt.id)) || null;
}

export async function submitNewsAvatar({ page, narration, profileId, signal, click, saveReceipt, timeoutMs = 30000, onFailure = async () => {} }) {
  let receipt; let rejected; let submittedRequest;
  const onRequest = request => {
    if (request.method() !== 'POST') return;
    if (receipt) return;
    let payload; try { payload = request.postDataJSON(); } catch {}
    if (!submission(request.url()) && !containsNarration(payload, newsNarrationHash(narration))) return;
    submittedRequest = request;
    receipt = { id: null, profileId, promptHash: newsNarrationHash(narration), submittedAt: new Date().toISOString() };
    receipt.scriptMismatch = !containsNarration(payload, receipt.promptHash);
    saveReceipt(receipt);
  };
  const onResponse = async response => {
    if (response.request() !== submittedRequest) return;
    try {
      const body = await response.json();
      if (!receipt) return;
      const id = body.data?.animate_image_id || body.data?.animate_id || body.data?.task_id || body.data?.work_id || body.data?.id;
      if (id && response.ok() && (!body.status_code || body.status_code === 'THS12140000000')) { receipt = { ...receipt, id: String(id) }; saveReceipt(receipt); }
      else if (!response.ok() || (body.status_code && body.status_code !== 'THS12140000000')) {
        rejected = safeProviderMessage(body.status_msg || body.message || `HTTP ${response.status()}`).slice(0, 220);
        receipt = { ...receipt, rejected: true }; saveReceipt(receipt);
      }
    } catch { /* An unconfirmed submit is never permission to submit again. */ }
  };
  page.on('request', onRequest); page.on('response', onResponse);
  try {
    signal.throwIfAborted();
    await click();
    const deadline = Date.now() + timeoutMs;
    while (!receipt?.id && !rejected && Date.now() < deadline) {
      // The provider opens its credits drawer instead of submitting when the
      // selected Avatar has no free use left. A zero header balance alone is
      // NOT evidence: free image/avatar quotas are separate from paid credits.
      if (!receipt) {
        const text = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
        const balance = /Current Credits\s*(\d+)/i.exec(text);
        const price = /(\d+)\s*Generate\b/i.exec(text);
        if (balance && price && /Get More Credits|Purchase/i.test(text) && Number(balance[1]) < Number(price[1])) throw failure('Profile này đã hết lượt MC miễn phí hoặc không đủ credits cho lựa chọn hiện tại. Hãy dùng profile còn lượt hoặc bổ sung credits; chưa gửi tác vụ mới.', 'PROVIDER_QUOTA');
      }
      await delay(100, null, { signal });
    }
    if (rejected) throw failure(`DreamFace không nhận yêu cầu MC: ${rejected}`, /credit|quota|limit/i.test(rejected) ? 'PROVIDER_QUOTA' : 'PROVIDER_SUBMISSION_REJECTED');
    if (!receipt?.id) throw failure(receipt
      ? 'Chưa xác nhận được mã tác vụ MC. Kiểm tra Creations trước khi gửi lại; app không lấy video cũ thay thế.'
      : 'DreamFace chưa gửi yêu cầu MC sau khi bấm Generate. Kiểm tra thông báo trên profile rồi thử lại; app không lấy video cũ thay thế.');
    if (receipt.scriptMismatch) throw failure('DreamFace gửi lời đọc khác bản tóm tắt đã chọn. Đã lưu mã tác vụ để kiểm tra; không dùng video đó cho tin này.', 'PROVIDER_SCRIPT_MISMATCH');
    return receipt;
  } catch(error) {
    await Promise.resolve().then(() => onFailure(error, { requestObserved:Boolean(submittedRequest), receiptConfirmed:Boolean(receipt?.id), rejected:Boolean(rejected) })).catch(()=>{});
    throw error;
  } finally { page.off('request', onRequest); page.off('response', onResponse); }
}

export async function waitForNewsAvatar({ page, narration, profileId, receipt, signal, download, update = () => {}, timeoutMs = 1800000, pollMs = 10000, creationUrl = 'https://www.dreamfaceapp.com/creation' }) {
  if (!receipt?.id) throw failure('Bản ghi cũ chưa lưu mã tác vụ MC nên không thể xác nhận đúng video để khôi phục. Không tải video chỉ vì cùng tiêu đề.', 'PROVIDER_RECEIPT_REQUIRED');
  if (receipt.scriptMismatch) throw failure('Tác vụ MC đã gửi chứa lời đọc khác bản tóm tắt.', 'PROVIDER_SCRIPT_MISMATCH');
  if (receipt.profileId !== profileId || receipt.promptHash !== newsNarrationHash(narration)) throw failure('Mã tác vụ MC không khớp profile hoặc lời đọc của tin này.', 'PROVIDER_RECEIPT_MISMATCH');
  let rows = []; let lastDownloadError; let providerFailure;
  const onResponse = async response => {
    if (!/\/work\/v\d+\/get_recent_creation_list(?:\?|$)/i.test(response.url())) return;
    try {
      const body = await response.json();
      if ([401, 403].includes(response.status()) || /login|sign.in|session.*expir/i.test(body.status_msg || '')) providerFailure = failure('DreamFace cần đăng nhập lại để lấy đúng tác vụ MC đã gửi.', 'NEEDS_LOGIN');
      if (Array.isArray(body.data?.list)) rows = body.data.list;
    } catch {}
  };
  page.on('response', onResponse);
  const start = Date.now(), deadline = start + timeoutMs;
  let nextRefresh = 0;
  try {
    await page.goto(creationUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    nextRefresh = Date.now() + pollMs;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (providerFailure) throw providerFailure;
      const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      if (/verify you are human|confirm you.re not a robot|captcha/i.test(bodyText)) throw failure('DreamFace cần xác minh trong cửa sổ profile trước khi tiếp tục.', 'VERIFICATION');
      const work = matchingNewsWork(rows, receipt);
      if (work && (Number(work.web_work_status) >= 400 || Number(work.web_work_status) < 0)) throw failure('DreamFace báo tác vụ MC đã gửi không thành công.', 'PROVIDER_RESULT_FAILED');
      if (work && Number(work.web_work_status) === 200) {
        const thumbnail = work.work_webp_path;
        const images = page.locator('img');
        const index = await images.evaluateAll((nodes, url) => nodes.findIndex(node => (node.currentSrc || node.src) === url), thumbnail);
        if (thumbnail && index >= 0) {
          // Choose the official Download control belonging to this exact work.
          // No page-wide URL, recent title, or unrelated browser download can
          // stand in for the submitted task.
          let container = images.nth(index); let button;
          for (let depth = 0; depth < 6; depth++) {
            container = container.locator('xpath=..');
            const buttons = container.locator('button');
            if (await buttons.count()) {
              const labeled = container.getByRole('button', { name: /download|save|export/i }).first();
              const icon = container.locator('button:has(svg path[d^="m11 12.845"])').first();
              button = await labeled.count() ? labeled : await icon.count() ? icon : null;
              if (!button) throw failure('DreamFace đã đổi nút tải tác vụ MC; app dừng để tránh bấm nhầm thao tác.', 'PROVIDER_UI_CHANGED');
              break;
            }
          }
          if (button) {
            await container.hover({ timeout: 5000 });
            const pending = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
            await button.click({ timeout: 5000 });
            const received = await pending;
            if (received) {
              update({ status: 'downloading', workflow: 'avatar-news', progress: 82 });
              try {
                const media = await download(received);
                if (!media.hasAudio) throw failure('DreamFace Avatar result has no audio track.', 'NEWS_PRESENTER_AUDIO_REQUIRED');
                return media;
              } catch (error) { signal.throwIfAborted(); lastDownloadError = error; }
            }
          }
        }
      }
      if (Date.now() >= nextRefresh) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        nextRefresh = Date.now() + pollMs;
      }
      update({ status: 'rendering', workflow: 'avatar-news', elapsedSeconds: Math.floor((Date.now() - start) / 1000), progress: 20 + Math.min(55, Math.floor((Date.now() - start) / 1000)) });
      await delay(Math.min(1000, pollMs), null, { signal });
    }
    throw failure(lastDownloadError ? `Không tải được đúng tác vụ MC: ${lastDownloadError.message}` : 'Hết thời gian chờ đúng tác vụ MC đã gửi. Có thể khôi phục tác vụ này mà không tạo lại.', 'PROVIDER_TIMEOUT');
  } finally { page.off('response', onResponse); }
}
