const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const spec = require('../shared/windows-runtime-assets.json');

function execute(file, args, timeout) {
  return new Promise(resolve => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => resolve({ code: error ? error.code : 0, killed: Boolean(error?.killed), stdout, stderr })));
}

async function probeNativeRuntime(resourcesPath) {
  return execute(path.join(resourcesPath, 'news-captions', 'whisper-cli.exe'), ['--help'], 15000);
}

async function installBundledRuntime(resourcesPath) {
  const file = path.join(resourcesPath, 'windows-runtime', spec.file);
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== spec.sha256) {
    throw new Error('Bộ cài Visual C++ đi kèm bị thiếu hoặc không đúng checksum. Tải lại bộ cài Viral Studio.');
  }
  // Run only the pinned Microsoft prerequisite; Windows owns the UAC prompt.
  // No restart is requested and a newer installed runtime is never removed.
  const quoted = "'" + file.replace(/'/g, "''") + "'";
  const script = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${quoted} -ArgumentList @('/install','/quiet','/norestart') -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode`;
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], 240000);
  if (![0, 3010, 1638].includes(result.code)) {
    throw new Error('Chưa cài được Microsoft Visual C++ Runtime. Cần chấp nhận yêu cầu quyền Administrator của Windows rồi mở lại Viral Studio.');
  }
  return result;
}

async function ensureWindowsRuntime(resourcesPath, { platform = process.platform, probe = probeNativeRuntime, install = installBundledRuntime, status = () => {} } = {}) {
  if (platform !== 'win32') return { status: 'not-required' };
  const initial = await probe(resourcesPath);
  if (initial.code === 0) return { status: 'ready' };
  const nativeCode = Number(initial.code) >>> 0;
  if (![0xc0000135, 0xc0000139, 14001].includes(nativeCode)) {
    throw new Error(`Bộ căn phụ đề không khởi động được (mã ${initial.code}). Kiểm tra bộ cài Windows x64 và phần mềm bảo mật; chưa gửi tác vụ tạo video.`);
  }
  status('Đang chuẩn bị Visual C++ Runtime; chấp nhận quyền Windows nếu được hỏi…');
  const installed = await install(resourcesPath);
  const checked = await probe(resourcesPath);
  if (checked.code !== 0) {
    throw new Error(installed.code === 3010
      ? 'Windows yêu cầu khởi động lại để hoàn tất Visual C++ Runtime. Lưu công việc, khởi động lại rồi mở Viral Studio.'
      : `Đã chạy bộ cài Visual C++ nhưng bộ căn phụ đề chưa hoạt động (mã ${checked.code}). Chưa gửi tác vụ tạo video.`);
  }
  return { status: 'installed', restartRequested: false };
}

module.exports = { ensureWindowsRuntime, probeNativeRuntime, installBundledRuntime };
