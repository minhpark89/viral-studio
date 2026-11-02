import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { binary, probe, runProcess } from './media.js';
import { StudioError } from './store.js';

export const GPU_ENCODERS = { nvidia: 'h264_nvenc', amd: 'h264_amf', intel: 'h264_qsv' };
const driverSites = {
  nvidia: 'https://www.nvidia.com/en-us/drivers/',
  amd: 'https://www.amd.com/en/support/download/drivers.html',
  intel: 'https://www.intel.com/content/www/us/en/support/detect.html',
};
const cache = new Map();
let adapterCache;

export function gpuVendor(name, deviceId = '') {
  if (/VEN_10DE|NVIDIA|GeForce|Quadro/i.test(name + ' ' + deviceId)) return 'nvidia';
  if (/VEN_1002|AMD|Radeon/i.test(name + ' ' + deviceId)) return 'amd';
  if (/VEN_8086|Intel/i.test(name + ' ' + deviceId)) return 'intel';
  return null;
}

export function videoEncodingArgs(encoder, { quality = 18, intermediate = false, threads = 2 } = {}) {
  if (encoder === 'h264_nvenc') return ['-c:v', encoder, '-preset', intermediate ? 'p2' : 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(quality), '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (encoder === 'h264_qsv') return ['-c:v', encoder, '-preset', intermediate ? 'veryfast' : 'medium', '-global_quality', String(quality), '-pix_fmt', 'nv12'];
  if (encoder === 'h264_amf') return ['-c:v', encoder, '-usage', 'transcoding', '-quality', intermediate ? 'speed' : 'balanced', '-rc', 'cqp', '-qp_i', String(quality), '-qp_p', String(quality), '-pix_fmt', 'nv12'];
  if (encoder !== 'libx264') throw new StudioError('Bộ mã hóa không được hỗ trợ.', 'INVALID_ENCODER');
  return ['-c:v', 'libx264', '-preset', intermediate ? 'ultrafast' : 'veryfast', '-crf', String(quality), '-pix_fmt', 'yuv420p', '-threads', String(Math.max(1, Math.min(32, Number(threads) || 2)))];
}

async function adapters({ force = false } = {}) {
  if (!force && adapterCache && Date.now() - adapterCache.at < 60000) return adapterCache.value;
  if (process.platform !== 'win32') return [];
  const { stdout } = await runProcess('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,PNPDeviceID) | ConvertTo-Json -Compress'], { timeout: 15000 });
  const raw = JSON.parse(stdout.replace(/^\uFEFF/, '') || '[]');
  const value = (Array.isArray(raw) ? raw : [raw]).map(item => ({ name: item.Name, driver: item.DriverVersion, vendor: gpuVendor(item.Name, item.PNPDeviceID) }));
  adapterCache = { at: Date.now(), value };
  return value;
}

function recommendation(adapter, error) {
  const required = /minimum required Nvidia driver[^\d]*(\d+(?:\.\d+)?)/i.exec(error || '')?.[1];
  return { vendor: adapter.vendor, gpu: adapter.name, installedDriver: adapter.driver, minimumDriver: required || null,
    product: { nvidia: 'NVIDIA WHQL cho đúng GeForce/RTX và Windows', amd: 'AMD Software cho đúng Radeon và Windows', intel: 'Intel Graphics / Arc cho đúng GPU và Windows' }[adapter.vendor],
    url: driverSites[adapter.vendor],
    message: required ? `Bộ FFmpeg này yêu cầu driver NVIDIA từ ${required}. Chọn bản WHQL hỗ trợ đúng card và Windows này.` : 'Cài driver đồ họa từ hãng đúng card và Windows, sau đó bấm Kiểm tra GPU lại.' };
}

export async function probeGpuEncoder(command, encoder, settings = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viral-gpu-probe-'));
  const output = path.join(directory, 'probe.mp4');
  try {
    await runProcess(command, ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-frames:v', '6', '-an', ...videoEncodingArgs(encoder), output], { timeout: 20000 });
    const metadata = await probe(output, settings);
    if (metadata.videoCodec !== 'h264' || metadata.width !== 1080 || metadata.height !== 1920 || metadata.duration <= 0) throw new Error('GPU tạo file không đúng định dạng.');
    await runProcess(command, ['-v', 'error', '-xerror', '-threads', '1', '-i', output, '-f', 'null', '-'], { timeout: 15000 });
    return { available: true, testedFrames: 6, width: 1080, height: 1920 };
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('viral-gpu-probe-')) await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
  }
}

// The cache belongs to the current process/hardware, never to a portable workspace.
export async function inspectRenderHardware(settings = {}, { force = false, detectAdapters = adapters, testEncoder = probeGpuEncoder } = {}) {
  const command = binary('ffmpeg', settings);
  let detected, detectionError;
  try { detected = await detectAdapters({ force }); } catch { detected = []; detectionError = 'Không đọc được thông tin card. Kiểm tra quyền WMI/driver rồi thử lại.'; }
  const stat = await fs.stat(command).catch(() => null);
  const key = JSON.stringify([command, stat?.size, stat?.mtimeMs, detected]);
  if (!force && cache.has(key) && Date.now() - cache.get(key).at < 60000) return cache.get(key).promise;
  const promise = (async () => {
    const candidates = [];
    for (const vendor of ['nvidia', 'amd', 'intel']) {
      const adapter = detected.find(item => item.vendor === vendor);
      if (!adapter) continue;
      const encoder = GPU_ENCODERS[vendor];
      try { candidates.push({ ...adapter, encoder, ...(await testEncoder(command, encoder, settings)), recommendation: null }); }
      catch (error) { candidates.push({ ...adapter, encoder, available: false, error: String(error.message).slice(-2500), recommendation: recommendation(adapter, error.message) }); }
    }
    const selected = candidates.find(item => item.available) || null;
    return { checkedAt: new Date().toISOString(), adapters: detected, candidates, selected, gpuAvailable: Boolean(selected), detectionError: detectionError || null,
      message: selected ? `Sẵn sàng mã hóa bằng GPU: ${selected.name} (${selected.encoder}).` : detected.length ? 'Chưa có GPU mã hóa được với bộ công cụ hiện tại. Xem đề xuất driver bên dưới.' : 'Chưa nhận diện được GPU hỗ trợ mã hóa H.264. Cần GPU/driver phù hợp hoặc chủ động chọn CPU.',
      cpuAvailable: true, cpuNote: 'Hiệu ứng, chữ và âm thanh vẫn có phần xử lý CPU; chỉ báo GPU khi encoder thực tế dùng phần cứng.' };
  })();
  cache.set(key, { at: Date.now(), promise });
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}

export async function selectRenderEncoder(settings = {}, options = {}) {
  // Missing setting retains compatibility for old snapshots and direct renderer callers.
  if ((settings.renderAcceleration || 'cpu') === 'cpu') return { encoder: 'libx264', gpu: false, name: 'CPU' };
  const report = await inspectRenderHardware(settings, options);
  if (!report.selected) throw new StudioError('Chế độ GPU đang bật nhưng GPU/driver chưa sẵn sàng. Mở Cài đặt → GPU để xem driver phù hợp; MC và ảnh đã chuẩn bị được giữ để thử lại.', 'GPU_UNAVAILABLE', 422);
  return { encoder: report.selected.encoder, gpu: true, name: report.selected.name, driver: report.selected.driver };
}

export function recordRenderDevice(store, job, device) {
  if (store.state.jobs?.some(item => item.id === job.id)) store.patch('jobs', job.id, { renderDevice: device });
}

export async function nvidiaDriverRecommendation(settings = {}) {
  const hardware = await inspectRenderHardware(settings);
  const gpu = hardware.adapters.find(item => item.vendor === 'nvidia');
  if (!gpu) return { recommendation: null };
  // Official unified desktop packages: require explicit model and OS coverage.
  const url = 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid=120&pfid=895&osID=57&languageCode=1033&beta=0&isWHQL=1&dltype=-1&dch=1&sort1=0&numberOfResults=5';
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new StudioError('Không tra được driver NVIDIA; dùng liên kết hãng và thử lại.', 'DRIVER_LOOKUP_FAILED', 502);
  const body = await response.json();
  const normalize = value => String(value).replace(/^NVIDIA\s+/i, '').trim().toLowerCase();
  const row = (body.IDS || []).map(item => item.downloadInfo).find(item => item?.IsWHQL === '1' && item.IsBeta === '0'
    && item.OSList?.some(os => /Windows (10|11)/.test(decodeURIComponent(os.OSName)))
    && item.series?.some(series => series.products?.some(product => normalize(decodeURIComponent(product.productName)) === normalize(gpu.name))));
  if (!row) return { recommendation: { gpu: gpu.name, url: driverSites.nvidia, message: 'Chọn đúng model trên trang NVIDIA; chưa xác nhận được gói tải tự động cho card này.' } };
  const download = new URL(row.DownloadURL), details = new URL(row.DetailsURL);
  if (download.protocol !== 'https:' || download.hostname !== 'us.download.nvidia.com' || details.protocol !== 'https:' || details.hostname !== 'www.nvidia.com') throw new StudioError('Liên kết driver không hợp lệ.', 'DRIVER_LOOKUP_FAILED');
  return { recommendation: { gpu: gpu.name, version: row.Version, name: decodeURIComponent(row.Name), whql: true, date: row.ReleaseDateTime, url: details.href, download: download.href,
    message: 'Gói WHQL từ NVIDIA có tên card này trong danh sách hỗ trợ. Windows cần quyền Administrator để cài; app không tự thay driver.' } };
}
