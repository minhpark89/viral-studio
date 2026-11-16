import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioError } from './store.js';
import { safeProviderMessage } from './dreamface-diagnostics.js';

export const newsNarrationHash = value => createHash('sha256').update(String(value || '').replace(/\s+/g, ' ').trim()).digest('hex');
const submission = value => /\/task(?:_v\d+)?\/(?:v\d+\/)?(?:submit|create_web_task)(?:[/?]|$)/i.test(value);
// DreamFace sends the full script to language detection and text validation
// before creating an Avatar. Those requests must never become a receipt.
const avatarSubmission = value => /\/(?:avatar|batch_task)(?:_v\d+)?\/(?:v\d+\/)?(?:generate|submit|create_web_task|batch_submit)(?:[/?]|$)/i.test(value);
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
  let receipt; let rejected; let submittedRequest; let preflightFailure; let textCheck; let listening = true;
  const onRequest = request => {
    if (request.method() !== 'POST') return;
    if (receipt) return;
    let payload; try { payload = request.postDataJSON(); } catch {}
    if (!submission(request.url()) && !(avatarSubmission(request.url()) && containsNarration(payload, newsNarrationHash(narration)))) return;
    submittedRequest = request;
    receipt = { id: null, profileId, promptHash: newsNarrationHash(narration), submittedAt: new Date().toISOString(), submissionPath: new URL(request.url()).pathname };
    receipt.scriptMismatch = !containsNarration(payload, receipt.promptHash);
    saveReceipt(receipt);
  };
  const onResponse = async response => {
    // The provider's own content check runs before task creation. A rejection
    // is a terminal preflight result, not an ambiguous paid submission.
    if (/\/batch_task\/v\d+\/batch_check_text(?:[/?]|$)/i.test(response.url())) {
      try {
        const texts = response.request().postDataJSON()?.texts;
        const index = Array.isArray(texts) ? texts.findIndex(text => typeof text === 'string' && newsNarrationHash(text) === newsNarrationHash(narration)) : -1;
        if (index >= 0) {
          const body = await response.json();
          if (!listening) return;
          if (response.ok() && body.status_code === 'THS12140000000' && body.data?.[index] === false) {
            textCheck = { path: new URL(response.url()).pathname, matchedIndex: index, accepted: false, httpStatus: response.status(), providerCode: body.status_code };
            preflightFailure = failure('DreamFace đánh dấu lời dẫn thuộc chủ đề bị hạn chế, nhưng không cho biết từ hoặc câu cụ thể. Chưa gửi yêu cầu tạo video MC. Chạy lại nguyên lời dẫn sẽ không giải quyết lỗi; hãy xem lại nội dung hoặc dùng dịch vụ MC phù hợp.', 'PROVIDER_CONTENT_REJECTED');
          } else if ([401, 403].includes(response.status()) || /login|sign.in|session.*expir/i.test(body.status_msg || '')) {
            preflightFailure = failure('DreamFace cần đăng nhập lại để kiểm tra lời dẫn; chưa gửi tác vụ MC.', 'NEEDS_LOGIN');
          } else if (!response.ok() || (body.status_code && body.status_code !== 'THS12140000000')) {
            const message = safeProviderMessage(body.status_msg || body.message || `HTTP ${response.status()}`);
            preflightFailure = failure(`DreamFace chưa kiểm tra được lời dẫn: ${message}. Chưa gửi tác vụ MC.`, /credit|quota|limit/i.test(message) || response.status() === 429 ? 'PROVIDER_QUOTA' : 'PROVIDER_PREFLIGHT_FAILED');
          }
        }
      } catch {}
      return;
    }
    if (response.request() !== submittedRequest) return;
    try {
      const body = await response.json();
      if (!listening || !receipt) return;
      const id = body.data?.animate_image_id || body.data?.animate_id || body.data?.task_id || body.data?.work_id || body.data?.id;
      if (id && response.ok() && (!body.status_code || body.status_code === 'THS12140000000')) { receipt = { ...receipt, id: String(id) }; saveReceipt(receipt); }
      else if (!response.ok() || (body.status_code && body.status_code !== 'THS12140000000')) {
        rejected = safeProviderMessage(body.status_msg || body.message || `HTTP ${response.status()}`).slice(0, 220);
        receipt = { ...receipt, rejected: true }; saveReceipt(receipt);
      }
    } catch { /* An unconfirmed submit is never permission to submit again. */ }
  };
  const onRequestFailed = request => {
    if (!listening || receipt || !/\/batch_task\/v\d+\/batch_check_text(?:[/?]|$)/i.test(request.url())) return;
    try {
      if (!request.postDataJSON()?.texts?.some(text => typeof text === 'string' && newsNarrationHash(text) === newsNarrationHash(narration))) return;
      const network = String(request.failure()?.errorText || '');
      if (/\bERR_(?:ABORTED|NETWORK_CHANGED|CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|TIMED_OUT|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|EMPTY_RESPONSE)\b/.test(network))
        preflightFailure = failure('Kết nối bị ngắt khi kiểm tra lời dẫn; chưa gửi tác vụ MC.', 'PROVIDER_PREFLIGHT_NETWORK');
    } catch {}
  };
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onRequestFailed);
  try {
    signal.throwIfAborted();
    await click();
    const deadline = Date.now() + timeoutMs;
    while (!receipt?.id && !rejected && Date.now() < deadline) {
      if (preflightFailure && !receipt) throw preflightFailure;
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
    if (preflightFailure && !receipt) throw preflightFailure;
    if (rejected) throw failure(`DreamFace không nhận yêu cầu MC: ${rejected}`, /credit|quota|limit/i.test(rejected) ? 'PROVIDER_QUOTA' : 'PROVIDER_SUBMISSION_REJECTED');
    if (!receipt?.id) throw failure(receipt
      ? 'Chưa xác nhận được mã tác vụ MC. Kiểm tra Creations trước khi gửi lại; app không lấy video cũ thay thế.'
      : 'DreamFace chưa gửi yêu cầu MC sau khi bấm Generate. Kiểm tra thông báo trên profile rồi thử lại; app không lấy video cũ thay thế.');
    if (receipt.scriptMismatch) throw failure('DreamFace gửi lời đọc khác bản tóm tắt đã chọn. Đã lưu mã tác vụ để kiểm tra; không dùng video đó cho tin này.', 'PROVIDER_SCRIPT_MISMATCH');
    return receipt;
  } catch(error) {
    await Promise.resolve().then(() => onFailure(error, { requestObserved:Boolean(submittedRequest), receiptConfirmed:Boolean(receipt?.id), rejected:Boolean(rejected), ...(textCheck ? {textCheck} : {}) })).catch(()=>{});
    throw error;
  } finally { listening = false; page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onRequestFailed); }
}

export async function waitForNewsAvatar({ page, narration, profileId, receipt, signal, download, update = () => {}, timeoutMs = 1800000, pollMs = 10000, navigationRetryMs = 1000, creationUrl = 'https://www.dreamfaceapp.com/creation' }) {
  if (!receipt?.id) throw failure('Bản ghi cũ chưa lưu mã tác vụ MC nên không thể xác nhận đúng video để khôi phục. Không tải video chỉ vì cùng tiêu đề.', 'PROVIDER_RECEIPT_REQUIRED');
  if (receipt.scriptMismatch) throw failure('Tác vụ MC đã gửi chứa lời đọc khác bản tóm tắt.', 'PROVIDER_SCRIPT_MISMATCH');
  if (receipt.profileId !== profileId || receipt.promptHash !== newsNarrationHash(narration)) throw failure('Mã tác vụ MC không khớp profile hoặc lời đọc của tin này.', 'PROVIDER_RECEIPT_MISMATCH');
  let rows = []; let lastDownloadError; let providerFailure; let downloadAttempts = 0;
  const onResponse = async response => {
    if (!/\/work\/v\d+\/get_recent_creation_list(?:\?|$)/i.test(response.url())) return;
    try {
      const body = await response.json();
      if ([401, 403].includes(response.status()) || /login|sign.in|session.*expir/i.test(body.status_msg || '')) providerFailure = failure('DreamFace cần đăng nhập lại để lấy đúng tác vụ MC đã gửi.', 'NEEDS_LOGIN');
      if (Array.isArray(body.data?.list)) {
        // Pagination may return several lists. Keep the known task across
        // responses while allowing a newer status of that task to replace it.
        const known = matchingNewsWork(rows, receipt);
        rows = body.data.list;
        if (known && !matchingNewsWork(rows, receipt)) rows = [...rows, known];
      }
    } catch {}
  };
  page.on('response', onResponse);
  const start = Date.now(), deadline = start + timeoutMs;
  update({status:'rendering',workflow:'avatar-news',stage:'DreamFace đang tạo video MC',progress:8});
  let nextRefresh = 0;
  const navigate = async (reload = false) => {
    // A Creations navigation is read-only. Recover a temporary connection loss
    // without re-entering Generate, changing the receipt, or accepting old work.
    // Chromium may leave an error page after ERR_ABORTED; retries must navigate
    // to Creations explicitly instead of reloading that error page.
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw failure('Hết thời gian kết nối Creations. Mã tác vụ MC đã được giữ để khôi phục mà không tạo lại.', 'PROVIDER_TIMEOUT');
      try {
        const options = { waitUntil: 'domcontentloaded', timeout: Math.min(45000, remaining) };
        if (reload && attempt === 0) await page.reload(options);
        else await page.goto(creationUrl, options);
        return;
      } catch (error) {
        signal.throwIfAborted();
        const networkCode = /\bERR_(?:ABORTED|NETWORK_CHANGED|CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|TIMED_OUT|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|EMPTY_RESPONSE)\b/.exec(String(error?.message || ''))?.[0];
        if (!networkCode && error.name !== 'TimeoutError') throw error;
        if (attempt >= 3) throw failure(`Không kết nối được Creations sau 3 lần thử lại (${networkCode || 'timeout'}). Mã tác vụ MC đã được giữ; có thể khôi phục khi kết nối ổn định mà không tạo lại.`, 'PROVIDER_CONNECTION_LOST');
        update({ status: 'retrying', workflow: 'avatar-news', stage: `Đang kết nối lại Creations (${attempt + 1}/3), giữ nguyên tác vụ MC`, navigationRetry: attempt + 1 });
        await delay(Math.max(1, Math.min(navigationRetryMs * 2 ** attempt, deadline - Date.now())), null, { signal });
      }
    }
  };
  try {
    await navigate();
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
            downloadAttempts++;
            try { await container.hover({ timeout: 1500 }); }
            catch (error) {
              signal.throwIfAborted();
              if (error.name !== 'TimeoutError') throw error;
              // Card animations must not discard an already finished MC.
              // The download control is scoped to the confirmed receipt.
            }
            const pending = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
            try { await button.click({ timeout: 2000 }); }
            catch (error) {
              signal.throwIfAborted();
              if (error.name !== 'TimeoutError') throw error;
              await button.evaluate(element => element.click());
            }
            const received = await pending;
            if (received) {
              update({ status: 'downloading', workflow: 'avatar-news', stage:'Đang tải video MC đã xác minh', progress: 82 });
              try {
                const media = await download(received);
                if (!media.hasAudio) throw failure('DreamFace Avatar result has no audio track.', 'NEWS_PRESENTER_AUDIO_REQUIRED');
                return media;
              } catch (error) {
                signal.throwIfAborted();
                if (['NEWS_PRESENTER_AUDIO_REQUIRED', 'INVALID_MEDIA', 'INVALID_VIDEO', 'NEEDS_LOGIN', 'VERIFICATION'].includes(error.code)) throw error;
                lastDownloadError = error;
              }
            }
            if (downloadAttempts >= 3) throw failure(`Không tải được video MC sau 3 lần thử. Mã tác vụ đã được giữ để khôi phục.${lastDownloadError ? ` ${safeProviderMessage(lastDownloadError.message)}` : ''}`, 'PROVIDER_DOWNLOAD_FAILED');
          }
        }
      }
      if (Date.now() >= nextRefresh) {
        await navigate(true);
        nextRefresh = Date.now() + pollMs;
      }
      update({ status: 'rendering', workflow: 'avatar-news', stage:'DreamFace đang tạo video MC', elapsedSeconds: Math.floor((Date.now() - start) / 1000), progress: 20 + Math.min(55, Math.floor((Date.now() - start) / 1000)) });
      await delay(Math.min(1000, pollMs), null, { signal });
    }
    throw failure(lastDownloadError ? `Không tải được đúng tác vụ MC: ${lastDownloadError.message}` : 'Hết thời gian chờ đúng tác vụ MC đã gửi. Có thể khôi phục tác vụ này mà không tạo lại.', 'PROVIDER_TIMEOUT');
  } finally { page.off('response', onResponse); }
}
