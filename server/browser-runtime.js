import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { StudioError } from './store.js';

export function resolveBrowserExecutable(settings = {}, explicit = '', { env = process.env, bundled = chromium.executablePath(), isFile = file => fs.existsSync(file) && fs.statSync(file).isFile() } = {}) {
  const roots = [...new Set([env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean))];
  const candidates = [explicit, settings.chromePath,
    ...roots.map(root => path.join(root, 'Google/Chrome/Application/chrome.exe')),
    ...roots.map(root => path.join(root, 'Microsoft/Edge/Application/msedge.exe')),
    bundled];
  const executable = candidates.find(file => file && isFile(file));
  if (!executable) throw new StudioError('Chưa tìm thấy Chrome/Edge. Cài trình duyệt hoặc chọn đường dẫn trong Cài đặt.', 'BROWSER_MISSING');
  return executable;
}
