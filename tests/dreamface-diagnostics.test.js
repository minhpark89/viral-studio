import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { safeProviderMessage, captureNewsFailure } from '../server/dreamface-diagnostics.js';
import { traceDreamFaceSession } from '../server/dreamface-session-trace.js';
import { DreamFaceProvider } from '../server/providers/dreamface.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: [process.env.CHROME_PATH, 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p)) }); });
after(async () => browser?.close());

async function fixture(t) {
  const root = path.resolve('.verification', `provider-diagnostic-${randomUUID()}`);
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const job = { id: randomUUID() };
  const store = { root, patch(_collection, id, patch) { assert.equal(id, job.id); Object.assign(job, patch); } };
  t.after(async () => {
    await page.close();
    assert.ok(root.startsWith(path.resolve('.verification') + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, page, store, job };
}

test('a late Radix status toast is captured as a cropped notice, without the account page', async t => {
  const f = await fixture(t);
  await f.page.setContent('<p>private.account@example.com</p><div role="dialog">Unrelated account panel</div><style>li{position:fixed;bottom:20px;right:20px;width:280px;height:65px;background:#fee}</style>');
  // No dialog here: a content-check response can precede the toast by a frame.
  await f.page.locator('[role="dialog"]').evaluate(e => e.remove());
  await f.page.evaluate(() => setTimeout(() => { const e = document.createElement('li'); e.setAttribute('role', 'status'); e.setAttribute('data-radix-vue-collection-item', ''); e.textContent = 'Your text may involve restricted topics.'; document.body.append(e); }, 120));
  const diagnostic = await captureNewsFailure(f.store, f.job, f.page, { code: 'PROVIDER_CONTENT_REJECTED', message: 'Content check refused' }, { requestObserved: false });
  assert.equal(diagnostic.notice, 'Your text may involve restricted topics.');
  assert.equal(diagnostic.requestObserved, false);
  assert.equal(f.job.providerDiagnostics, diagnostic);
  const png = await fs.readFile(diagnostic.screenshotFile);
  assert.equal(png.readUInt32BE(16), 280); assert.equal(png.readUInt32BE(20), 65);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private\.account|example\.com|Unrelated account/);
});

test('Radix notices take priority over dialogs and redact credentials from text and screenshot', async t => {
  const f = await fixture(t);
  const secrets = 'user@example.com password="very private" access_token=abc123 Bearer secret-auth https://private.test/?token=secret';
  await f.page.setContent(`<div role="dialog">Unrelated settings</div><li role="status" data-radix-vue-collection-item></li>`);
  await f.page.locator('li').evaluate((e, text) => { e.textContent = text; }, secrets);
  const diagnostic = await captureNewsFailure(f.store, f.job, f.page, { message: secrets });
  assert.doesNotMatch(JSON.stringify(diagnostic), /user@example|very private|abc123|secret-auth|private\.test|Unrelated settings/);
  assert.match(diagnostic.notice, /\[email\]/);
  assert.equal(diagnostic.screenshotFile, undefined);
  assert.equal(diagnostic.screenshotOmitted, 'sensitive-or-long-notice');
});

test('closed page preserves the provider error and does not fail diagnostic capture', async t => {
  const f = await fixture(t); await f.page.close();
  const diagnostic = await captureNewsFailure(f.store, f.job, f.page, { code: 'PROVIDER_CONNECTION_LOST', message: 'Connection lost' });
  assert.equal(diagnostic.code, 'PROVIDER_CONNECTION_LOST');
  assert.equal(diagnostic.notice, undefined);
});

test('session traces only contain allowlisted metadata', async t => {
  const f = await fixture(t), profileId = randomUUID();
  await traceDreamFaceSession(f.store, { event: 'launch', profileId, visible: false, reason: 'news-generate', jobId: f.job.id, password: 'never-written', url: 'https://example.com/?token=private' });
  await traceDreamFaceSession(f.store, { event: 'reuse', profileId: 'private@example.com', visible: true, reason: 'password=secret', jobId: 'private-id' });
  const data = await fs.readFile(path.join(f.root, 'logs/provider/sessions.jsonl'), 'utf8');
  const rows = data.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].headless, true); assert.equal(rows[0].profileId, profileId); assert.equal(rows[0].reason, 'news-generate');
  assert.equal(rows[1].profileId, null); assert.equal(rows[1].jobId, null); assert.equal(rows[1].reason, 'session');
  assert.doesNotMatch(data, /password|private|never-written|example/);
  assert.doesNotMatch(safeProviderMessage('token: abc password="a b" eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYSJ9.abcdefgh'), /abc|a b|eyJ/);
});

test('checking a saved signup stays hidden and never interrupts a busy profile or a visible login', async () => {
  const provider = new DreamFaceProvider({ store: { root: 'fixture' } }), account = { id: randomUUID(), status: 'ready' };
  const opened = [];
  provider.open = async (_account, options) => { opened.push(options); return { visible: false }; };
  provider.inspect = async () => ({ status: 'ready' });
  assert.equal((await provider.checkDreamFaceSignup(account)).status, 'ready');
  assert.deepEqual(opened, [{ visible: false, reason: 'check-session' }]);
  await assert.rejects(provider.checkDreamFaceSignup({ ...account, status: 'busy' }), { code: 'PROFILE_BUSY' });
  provider.sessions.set(account.id, { visible: true, page: { isClosed: () => false } });
  assert.equal((await provider.checkDreamFaceSignup(account)).status, 'ready');
  assert.equal(opened.length, 1);
});
