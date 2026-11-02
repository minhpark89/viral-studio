import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Store } from '../server/store.js';
import { BrowserProfiles } from '../server/providers/browser-profiles.js';
import { DreamFaceProvider } from '../server/providers/dreamface.js';
import { createDreamFaceSlots } from '../server/dreamface-accounts.js';
import { profileStorage } from '../server/profile-storage.js';

for (const type of ['dreamface', 'google']) test(`new ${type} profiles inherit limits, stay isolated, skip active cleanup and retain login on reopen`, { timeout: 120000 }, async t => {
  const root = path.resolve('.verification', `new-profile-${type}-${randomUUID()}`);
  const store = new Store(root);
  assert.equal(store.state.settings.profileStorageOptimization, true);
  const browserProfiles = new BrowserProfiles(store);
  const provider = type === 'dreamface' ? new DreamFaceProvider({ store }) : browserProfiles;
  const accounts = type === 'dreamface' ? createDreamFaceSlots(store, { count: 3, namePrefix: 'QA new profile' })
    : ['dola', 'flow'].map(name => store.add('accounts', { name, provider: name, status: 'ready' }));
  const manager = profileStorage(store);
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Local profile QA</title><p>Session works</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const close = account => type === 'dreamface' ? provider.close(account) : provider.close(account.id);
  t.after(async () => {
    await Promise.allSettled(accounts.map(close));
    await new Promise(resolve => server.close(resolve));
    assert.ok(root.startsWith(path.resolve('.verification') + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(await fs.readdir(path.join(root, 'profiles')), [], 'Creating slots must not clone any old profile');
  for (const account of accounts) {
    const session = await provider.open(account, { visible: false });
    await session.page.goto('chrome://version/');
    const command = await session.page.locator('#command_line').innerText();
    assert.ok(command.includes('--disk-cache-size=67108864'));
    assert.ok(command.includes('--media-cache-size=33554432'));
    assert.ok(command.includes('OnDeviceModelBackgroundDownload'));
    await session.page.goto(origin);
    assert.equal(await session.page.evaluate(() => localStorage.getItem('fixture-login')), null);
    await session.page.evaluate(value => localStorage.setItem('fixture-login', value), account.id);
    await session.context.addCookies([{ name: 'fixture-login', value: account.id, url: origin, expires: Date.now() / 1000 + 3600 }]);
  }
  const active = await manager.clean(); assert.equal(active.skipped, accounts.length);
  for (const account of accounts) await close(account);
  // Grow a regenerable cache beyond its budget, then open through the actual provider.
  for (const account of accounts) {
    const directory = manager.directory(account.id);
    await fs.mkdir(path.join(directory, 'Default/Cache'), { recursive: true });
    const file = await fs.open(path.join(directory, 'Default/Cache/oversized-fixture'), 'w');
    await file.truncate(65 * 1024 ** 2); await file.close();
    await fs.mkdir(path.join(directory, 'OptGuideManifestModel'), { recursive: true });
    await fs.writeFile(path.join(directory, 'OptGuideManifestModel/fixture'), 'regenerable-model');
    const session = await provider.open(account, { visible: false });
    await assert.rejects(fs.stat(path.join(directory, 'Default/Cache/oversized-fixture')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(directory, 'OptGuideManifestModel/fixture')), { code: 'ENOENT' });
    await session.page.goto(origin);
    assert.equal(await session.page.evaluate(() => localStorage.getItem('fixture-login')), account.id);
    assert.equal((await session.context.cookies()).find(cookie => cookie.name === 'fixture-login')?.value, account.id);
    assert.equal(await session.page.locator('p').innerText(), 'Session works');
    await close(account);
  }
  assert.equal(manager.active.size, 0);
});

test('a failed new DreamFace browser launch releases the profile for the next attempt', async t => {
  const root = path.resolve('.verification', 'new-profile-failure-' + randomUUID());
  const store = new Store(root), [account] = createDreamFaceSlots(store, { count: 1, namePrefix: 'QA failure' });
  const provider = new DreamFaceProvider({ store, browserType: { launchPersistentContext: async () => { throw new Error('fixture launch failure'); } } });
  t.after(async () => { assert.ok(root.startsWith(path.resolve('.verification') + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(provider.open(account), /fixture launch failure/);
    assert.equal(profileStorage(store).active.size, 0);
  }
});
