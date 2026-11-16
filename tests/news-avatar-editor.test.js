import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { resolveBrowserExecutable } from '../server/browser-runtime.js';
import { fillNewsAvatarNarration } from '../server/news-avatar-editor.js';
import { DreamFaceProvider } from '../server/providers/dreamface.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: resolveBrowserExecutable({}, process.env.CHROME_PATH) }); });
after(async () => { await browser?.close(); });
const narration = 'A confirmed development. Read the full report through the link in the first comment.';
async function fixture(t, extra = '') {
  const page = await browser.newPage();t.after(() => page.close());
  await page.setContent(`${extra}<button onclick="window.textClicks++;editor.hidden=false">Text</button><button onclick="editor.hidden=true">Audio</button>
    <input type="file" onchange="editor.hidden=true"><div id="editor"><textarea placeholder="Type or paste text here"></textarea></div>
    <button onclick="window.submissions++">Generate</button><script>window.submissions=0;window.textClicks=0;</script>`);
  return page;
}

test('an upload restoring the Audio tab reproduces the old fill timeout and the new editor restores Text without submitting', async t => {
  const page = await fixture(t);
  await page.locator('input[type=file]').setInputFiles({ name: 'original-host.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
  assert.equal(await page.getByPlaceholder('Type or paste text here').isVisible(), false);
  await assert.rejects(page.getByPlaceholder('Type or paste text here').fill(narration, { timeout: 75 }), /Timeout/);
  const prompt = await fillNewsAvatarNarration(page, narration);
  assert.equal(await prompt.inputValue(), narration);
  assert.equal(await page.locator('input[type=file]').evaluate(e => e.files[0].name), 'original-host.png');
  assert.equal(await page.evaluate(() => window.submissions), 0);
});

test('hidden duplicate editors and replacement after model hydration never receive the final narration', async t => {
  const page = await fixture(t, '<textarea hidden placeholder="Type or paste text here">Keep hidden content</textarea>');
  await fillNewsAvatarNarration(page, narration);
  assert.equal(await page.evaluate(() => window.textClicks), 0, 'An already active Text editor must not be clicked again');
  await page.evaluate(() => { editor.hidden = true; editor.innerHTML = '<textarea placeholder="Type or paste text here">Previous draft</textarea>'; });
  const prompt = await fillNewsAvatarNarration(page, narration);
  assert.equal(await prompt.inputValue(), narration);
  assert.equal(await page.locator('textarea[hidden]').inputValue(), 'Keep hidden content');
  assert.equal(await page.evaluate(() => window.textClicks), 1);
  assert.equal(await page.evaluate(() => window.submissions), 0);
});

test('a provider reset after filling is detected before any Generate click', async t => {
  const page = await fixture(t);
  await page.locator('#editor textarea').evaluate(e => e.addEventListener('input', () => setTimeout(() => { e.value = 'Provider restored an earlier draft'; }, 60)));
  await assert.rejects(fillNewsAvatarNarration(page, narration), { code: 'PROVIDER_EDITOR_NOT_READY' });
  assert.equal(await page.evaluate(() => window.submissions), 0);
});

test('the actual provider retries a pre-submit image or text timeout once and keeps its inputs', async () => {
  for (const operation of ['fill', 'setInputFiles', 'waitFor', 'inputValue', 'reset']) {
    const provider = new DreamFaceProvider({ store: { root: 'fixture' } });let attempts = 0;
    const job = { payload: { avatarMediaId: 'original-host', imageMediaIds: ['photo-one'], newsPlan: { narration } } }, initial = structuredClone(job);
    provider.generateNewsAvatarOnce = async () => { if (++attempts === 2) return { id: 'presenter' };throw Object.assign(new Error(`locator.${operation}: Timeout 12000ms exceeded.`), operation === 'reset' ? { code: 'PROVIDER_EDITOR_NOT_READY' } : {}); };
    assert.equal((await provider.generateNewsAvatar({ log() {} }, job, { id: randomUUID() }, new AbortController().signal, () => {})).id, 'presenter');
    assert.equal(attempts, 2);assert.deepEqual(job, initial);
  }
});

test('submission evidence or an existing MC blocks automatic editor retries', async () => {
  for (const evidence of [{ submittedAt: new Date().toISOString() }, { payload: { newsAvatarRequest: { submittedAt: new Date().toISOString() } } }, { payload: { newsAvatarRequest: { id: 'confirmed' } } }, { payload: { presenterMediaId: 'existing-mc' } }]) {
    const provider = new DreamFaceProvider({ store: { root: 'fixture' } });let attempts = 0;
    provider.generateNewsAvatarOnce = async () => { attempts++;throw new Error('locator.fill: Timeout 12000ms exceeded.'); };
    await assert.rejects(provider.generateNewsAvatar({ log() {} }, { payload: {}, ...evidence }, { id: randomUUID() }, new AbortController().signal, () => {}), /Timeout/);
    assert.equal(attempts, 1);
  }
});

test('persistent editor trouble has a two-attempt limit and Generate click timeouts are never replayed', async () => {
  for (const operation of ['fill', 'setInputFiles', 'click']) {
    const provider = new DreamFaceProvider({ store: { root: 'fixture' } });let attempts = 0;
    provider.generateNewsAvatarOnce = async () => { attempts++;throw new Error(`locator.${operation}: Timeout 12000ms exceeded.`); };
    await assert.rejects(provider.generateNewsAvatar({ log() {} }, { payload: {} }, { id: randomUUID() }, new AbortController().signal, () => {}), /Timeout/);
    assert.equal(attempts, operation === 'click' ? 1 : 2);
  }
});
