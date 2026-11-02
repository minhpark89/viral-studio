import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './media.js';
import { StudioError } from './store.js';

const MiB = 1024 ** 2;
// Deliberately exclude Network/Cookies, Local Storage, IndexedDB, Service Worker,
// Session Storage, Sessions, Login Data, Preferences, Local State and extensions.
export const PROFILE_CACHES = [
  ['Default/Cache', 64 * MiB], ['Default/Code Cache', 32 * MiB],
  ['Default/GPUCache', 16 * MiB], ['Default/DawnGraphiteCache', 16 * MiB], ['Default/DawnWebGPUCache', 16 * MiB],
  ['GrShaderCache', 16 * MiB], ['ShaderCache', 16 * MiB], ['GraphiteDawnCache', 16 * MiB],
  ['BrowserMetrics', 0], ['BrowserMetrics-spare.pma', 0], ['OptGuideManifestModel', 0], ['optimization_guide_model_store', 0],
];
const instances = new WeakMap();
const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function profileLaunchArgs(settings = {}) {
  if (settings.profileStorageOptimization === false) return [];
  return ['--disk-cache-size=67108864', '--media-cache-size=33554432',
    '--disable-features=OptimizationGuideModelExecution,OptimizationTargetPrediction,OnDeviceModelBackgroundDownload,OnDeviceModelPerformanceParams,OptimizationHints'];
}

async function runningProfilePaths() {
  if (process.platform !== 'win32') return null; // Unknown means never delete.
  try {
    const { stdout } = await runProcess('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\' OR Name=\'msedge.exe\'" | Select-Object -ExpandProperty CommandLine) | ConvertTo-Json -Compress'], { timeout: 15000 });
    const data = JSON.parse(stdout.replace(/^\uFEFF/, '') || '[]');
    const rows = Array.isArray(data) ? data : [data];
    const paths = [];
    for (const command of rows) {
      if (typeof command !== 'string') return null;
      const match = /"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+)/i.exec(command);
      if (!match) { if (command.includes('--user-data-dir')) return null; continue; }
      const file = path.resolve(match[1] || match[2] || match[3]);
      paths.push(await fs.realpath(file).catch(() => file));
    }
    return paths;
  } catch { return null; }
}

async function treeSize(file) {
  const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return { bytes: 0, files: 0, exists: false, unsafe: false };
  if (stat.isSymbolicLink()) return { bytes: 0, files: 0, exists: true, unsafe: true };
  if (stat.isFile()) return { bytes: stat.size, files: 1, exists: true, unsafe: false };
  if (!stat.isDirectory()) return { bytes: 0, files: 0, exists: true, unsafe: true };
  const result = { bytes: 0, files: 0, exists: true, unsafe: false };
  for (const name of await fs.readdir(file)) {
    const next = await treeSize(path.join(file, name));
    result.bytes += next.bytes; result.files += next.files; result.unsafe ||= next.unsafe;
  }
  return result;
}

export class ProfileStorage {
  constructor(store, { runningPaths = runningProfilePaths } = {}) {
    this.store = store; this.root = path.resolve(store.root, 'profiles');
    this.active = new Map(); this.maintenance = new Set(); this.runningPaths = runningPaths;
    this.lastCleanup = null;
  }
  directory(id) {
    if (!validId(id)) throw new StudioError('Profile không hợp lệ.', 'INVALID_PROFILE');
    return path.join(this.root, id);
  }
  busy(id) {
    return this.active.has(id) || this.maintenance.has(id) || this.store.state.accounts?.some(account => (account.profileId || account.id) === id && ['busy', 'checking'].includes(account.status));
  }
  async safeTarget(id, relative) {
    if (!PROFILE_CACHES.some(([name]) => name === relative)) throw new StudioError('Không cho phép dọn đường dẫn này.', 'UNSAFE_CACHE_PATH');
    const directory = this.directory(id);
    const base = await fs.realpath(this.root);
    const profile = await fs.lstat(directory).catch(() => null);
    if (!profile || !profile.isDirectory() || profile.isSymbolicLink()) return null;
    const actual = await fs.realpath(directory);
    if (!samePath(path.dirname(actual), base)) return null;
    let current = directory;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat || stat.isSymbolicLink()) return null;
    }
    const resolved = await fs.realpath(current);
    const expected = path.join(actual, ...relative.split('/'));
    return samePath(resolved, expected) ? resolved : null;
  }
  async externalBusy(id, running) {
    if (!running) return true;
    const directory = this.directory(id);
    const actual = await fs.realpath(directory).catch(() => directory);
    return running.some(item => samePath(path.resolve(item), actual));
  }
  async cleanLocked(id, mode, running) {
    const result = { id, freedBytes: 0, removedFiles: 0, paths: [], skipped: null, errors: [] };
    if (await this.externalBusy(id, running)) { result.skipped = running ? 'profile-open' : 'process-check-unavailable'; return result; }
    const candidates = [];
    for (const [relative, limit] of PROFILE_CACHES) {
      const target = await this.safeTarget(id, relative);
      if (!target) continue;
      const info = await treeSize(target);
      if (info.unsafe || !info.exists || (mode === 'trim' && info.bytes <= limit)) continue;
      candidates.push({ relative, target, info });
    }
    if (!candidates.length) return result;
    // Recheck external browsers immediately before deleting; app launches are
    // excluded by the shared per-profile lease/maintenance lock.
    if (await this.externalBusy(id, await this.runningPaths())) { result.skipped = 'profile-open-or-unverified'; return result; }
    for (const candidate of candidates) {
      try {
        const checked = await this.safeTarget(id, candidate.relative);
        if (!checked || !samePath(checked, candidate.target) || (await treeSize(checked)).unsafe) { result.errors.push('unsafe-cache-path'); continue; }
        // Only a revalidated absolute allowlisted cache, never the profile root.
        await fs.rm(checked, { recursive: true, force: false });
        result.freedBytes += candidate.info.bytes; result.removedFiles += candidate.info.files; result.paths.push(candidate.relative);
      } catch (error) { result.errors.push(`${candidate.relative}: ${error.code || 'cleanup-failed'}`); }
    }
    return result;
  }
  async beginSession(id) {
    this.directory(id);
    if (this.active.has(id) || this.maintenance.has(id)) throw new StudioError('Profile đang mở hoặc đang dọn cache. Hãy chờ thao tác hiện tại hoàn tất.', 'PROFILE_STORAGE_BUSY', 409);
    const token = Symbol(id); this.active.set(id, token);
    const release = () => { if (this.active.get(id) === token) this.active.delete(id); };
    try {
      if (this.store.state.settings.profileStorageOptimization !== false) {
        await fs.mkdir(this.directory(id), { recursive: true });
        await this.cleanLocked(id, 'trim', await this.runningPaths()).catch(() => {});
      }
      return release;
    } catch (error) { release(); throw error; }
  }
  async ids() {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    return entries.filter(item => item.isDirectory() && !item.isSymbolicLink() && validId(item.name)).map(item => item.name);
  }
  async inspect() {
    const profiles = [], running = await this.runningPaths();
    for (const id of await this.ids()) {
      const total = await treeSize(this.directory(id)); let cacheBytes = 0;
      for (const [relative] of PROFILE_CACHES) {
        const target = await this.safeTarget(id, relative);
        if (target) { const info = await treeSize(target); if (!info.unsafe) cacheBytes += info.bytes; }
      }
      const account = this.store.state.accounts?.find(item => (item.profileId || item.id) === id);
      profiles.push({ id, name: account?.name || 'Profile', bytes: total.bytes, cacheBytes, busy: this.busy(id) || await this.externalBusy(id, running) });
    }
    return { profiles, totalBytes: profiles.reduce((sum, item) => sum + item.bytes, 0), cacheBytes: profiles.reduce((sum, item) => sum + item.cacheBytes, 0),
      profileCount: profiles.length, activeCount: profiles.filter(item => item.busy).length, processCheckAvailable: Boolean(running), lastCleanup: this.lastCleanup,
      limits: { httpCacheMiB: 64, codeCacheTrimMiB: 32, shaderCacheTrimMiB: 16 }, optimized: this.store.state.settings.profileStorageOptimization !== false };
  }
  async clean({ mode = 'clear' } = {}) {
    if (!['clear', 'trim'].includes(mode)) throw new StudioError('Chế độ dọn không hợp lệ.', 'INVALID_CLEANUP_MODE');
    const results = [], running = await this.runningPaths();
    for (const id of await this.ids()) {
      if (this.busy(id)) { results.push({ id, freedBytes: 0, skipped: 'profile-busy' }); continue; }
      this.maintenance.add(id);
      try { results.push(await this.cleanLocked(id, mode, running)); }
      catch (error) { results.push({ id, freedBytes: 0, skipped: 'profile-unavailable', errors: [error.code || 'cleanup-failed'] }); }
      finally { this.maintenance.delete(id); }
    }
    this.lastCleanup = { finishedAt: new Date().toISOString(), mode, freedBytes: results.reduce((sum, item) => sum + item.freedBytes, 0), skipped: results.filter(item => item.skipped).length, results };
    return this.lastCleanup;
  }
}

export function profileStorage(store) {
  if (!instances.has(store)) instances.set(store, new ProfileStorage(store));
  return instances.get(store);
}
