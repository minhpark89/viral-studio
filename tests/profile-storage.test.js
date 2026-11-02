import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { Store } from '../server/store.js';
import { ProfileStorage, profileLaunchArgs } from '../server/profile-storage.js';

async function fixture(t, runningPaths = async () => []) {
  const store = new Store(path.resolve('.verification', 'profile-storage-' + randomUUID()));
  const account = store.add('accounts', { name: 'Profile QA', status: 'ready', provider: 'dreamface' });
  const manager = new ProfileStorage(store, { runningPaths }); const directory = manager.directory(account.id);
  await fs.mkdir(directory, { recursive: true });
  const write = async (name, value = 'cache') => { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
  t.after(async () => { assert.ok(store.root.startsWith(path.resolve('.verification') + path.sep)); await fs.rm(store.root, { recursive: true, force: true }); });
  return { store, account, manager, directory, write };
}
test('profile cleanup removes only allowlisted cache and preserves authentication, storage, sessions and service workers byte for byte', async t => {
  const f = await fixture(t);
  const protectedFiles = ['Local State', 'Default/Network/Cookies', 'Default/Login Data', 'Default/Local Storage/leveldb/data', 'Default/IndexedDB/session', 'Default/Session Storage/data', 'Default/Sessions/current', 'Default/Service Worker/CacheStorage/offline', 'Default/Preferences'];
  for (const name of protectedFiles) await f.write(name, 'keep-' + name);
  await f.write('Default/Cache/Cache_Data/data', 'cache'); await f.write('OptGuideManifestModel/model.bin', 'model');
  const result = await f.manager.clean(); assert.equal(result.freedBytes, 10); assert.equal(result.skipped, 0);
  for (const name of protectedFiles) assert.equal(await fs.readFile(path.join(f.directory, name), 'utf8'), 'keep-' + name);
  assert.equal((await f.manager.inspect()).cacheBytes, 0);
  await assert.rejects(f.manager.safeTarget(f.account.id, '../Default/Network'), error => error.code === 'UNSAFE_CACHE_PATH');
  assert.throws(() => f.manager.directory('../other'), error => error.code === 'INVALID_PROFILE');
});
test('busy accounts, active leases and unknown external browser state block destructive cleanup', async t => {
  const f = await fixture(t); await f.write('Default/Cache/data');
  f.account.status = 'busy'; assert.equal((await f.manager.clean()).skipped, 1); f.account.status = 'ready';
  const release = await f.manager.beginSession(f.account.id);
  assert.equal((await f.manager.clean()).skipped, 1);
  await assert.rejects(f.manager.beginSession(f.account.id), error => error.code === 'PROFILE_STORAGE_BUSY');
  release(); f.manager.runningPaths = async () => null;
  assert.equal((await f.manager.clean()).skipped, 1);
  f.manager.runningPaths = async () => [f.directory]; assert.equal((await f.manager.clean()).skipped, 1);
  assert.equal(await fs.readFile(path.join(f.directory, 'Default/Cache/data'), 'utf8'), 'cache');
});
test('cache cleanup refuses junctions to protected or outside data', async t => {
  const f = await fixture(t); const outside = path.join(f.store.root, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'login'), 'keep');
  await fs.mkdir(path.join(f.directory, 'Default')); await fs.symlink(outside, path.join(f.directory, 'Default/Cache'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await f.manager.clean()).freedBytes, 0);
  assert.equal(await fs.readFile(path.join(outside, 'login'), 'utf8'), 'keep');
  await fs.unlink(path.join(f.directory, 'Default/Cache'));
});
test('automatic trim keeps small warm caches and excludes on-device AI model downloads from browser launch', async t => {
  const f = await fixture(t); await f.write('Default/Cache/small'); await f.write('OptGuideManifestModel/model', 'model');
  const release = await f.manager.beginSession(f.account.id); release();
  assert.equal(await fs.readFile(path.join(f.directory, 'Default/Cache/small'), 'utf8'), 'cache');
  await assert.rejects(fs.stat(path.join(f.directory, 'OptGuideManifestModel')));
  const args = profileLaunchArgs({}); assert.ok(args.includes('--disk-cache-size=67108864'));
  assert.ok(args.some(arg => arg.includes('OnDeviceModelBackgroundDownload'))); assert.ok(!args.includes('--disable-gpu'));
  assert.deepEqual(profileLaunchArgs({ profileStorageOptimization: false }), []);
});
test('persistent Chromium keeps cookie and localStorage login state across safe cache cleanup and restart', { timeout: 60000 }, async t => {
  const f = await fixture(t); let context;
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Session fixture</title><p>Profile works</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await context?.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  context = await chromium.launchPersistentContext(f.directory, { headless: true, args: profileLaunchArgs({}) });
  let page = await context.newPage(); await page.goto(origin);
  await context.addCookies([{ name: 'session-fixture', value: 'keep-login', url: origin, expires: Date.now() / 1000 + 3600 }]);
  await page.evaluate(() => localStorage.setItem('auth-fixture', 'keep-token'));
  await context.close(); context = null;
  await f.write('Default/Cache/qa-data');
  assert.ok((await f.manager.clean()).freedBytes > 0);
  context = await chromium.launchPersistentContext(f.directory, { headless: true, args: profileLaunchArgs({}) });
  page = await context.newPage(); await page.goto(origin);
  assert.equal(await page.evaluate(() => localStorage.getItem('auth-fixture')), 'keep-token');
  assert.equal((await context.cookies()).find(cookie => cookie.name === 'session-fixture')?.value, 'keep-login');
  assert.equal(await page.locator('p').innerText(), 'Profile works');
  await context.close(); context = null;
});
