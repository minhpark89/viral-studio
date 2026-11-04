import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { selectDreamFaceRadio } from '../server/providers/dreamface.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }); });
after(async () => { await browser?.close(); });

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(`<button id="menu" onclick="panel.hidden=!panel.hidden">Animate Effect</button>
    <div id="panel" hidden><button role="radio" aria-checked="false">Avatar 3.0 Fast</button><button role="radio" aria-checked="false">Avatar 2.0</button></div>
    <button id="generate" onclick="window.submissions++">Generate</button>
    <script>window.submissions=0;panel.onclick=e=>{if(e.target.getAttribute('role')!=='radio'||e.target.getAttribute('aria-disabled')==='true')return;for(const n of panel.children)n.setAttribute('aria-checked',String(n===e.target));if(window.closeOnSelect)panel.hidden=true;};</script>`);
  return page;
}

// Force a real DOM update in the gap between discovering options and clicking.
function hydrateAfterRead(page, hydrate) {
  let changed = false;
  return {
    isClosed: () => page.isClosed(), waitForTimeout: ms => page.waitForTimeout(ms),
    getByRole(role, options) {
      const locator = page.getByRole(role, options);
      if (options) return locator;
      return new Proxy(locator, { get(target, key) {
        if (key === 'evaluateAll') return async (...args) => {
          const result = await target.evaluateAll(...args);
          if (result.length && !changed) { changed = true; await page.evaluate(hydrate); }
          return result;
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  };
}

test('DreamFace selection follows the label after radio order changes', async t => {
  const page = await fixture(t);
  const hydrating = hydrateAfterRead(page, () => panel.prepend(panel.lastElementChild));
  assert.equal(await selectDreamFaceRadio(hydrating, page.locator('#menu'), ['Avatar 3.0 Fast']), 'Avatar 3.0 Fast');
  assert.equal(await page.getByRole('radio', { name: 'Avatar 3.0 Fast', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#generate').evaluate(() => window.submissions), 0);
});

test('DreamFace reopens a menu replaced by image hydration before click', async t => {
  const page = await fixture(t);
  const hydrating = hydrateAfterRead(page, () => { panel.hidden = true; panel.innerHTML = panel.innerHTML; });
  assert.equal(await selectDreamFaceRadio(hydrating, page.locator('#menu'), ['Avatar 3.0 Fast'], null, { timeoutMs: 6000 }), 'Avatar 3.0 Fast');
  assert.equal(await page.evaluate(() => window.submissions), 0);
});

test('DreamFace waits for enabled options and verifies selection when the menu closes', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    for (const radio of panel.children) radio.setAttribute('aria-disabled', 'true');
    window.closeOnSelect = true;
    setTimeout(() => panel.firstElementChild.setAttribute('aria-disabled', 'false'), 550);
  });
  assert.equal(await selectDreamFaceRadio(page, page.locator('#menu'), ['Avatar 3.0 Fast'], null, { timeoutMs: 4000 }), 'Avatar 3.0 Fast');
  assert.equal(await page.evaluate(() => window.submissions), 0);
});

test('DreamFace refuses an unconfirmed selection without clicking Generate', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { panel.onclick = () => {}; });
  await assert.rejects(selectDreamFaceRadio(page, page.locator('#menu'), ['Avatar 3.0 Fast'], null, { timeoutMs: 700 }), error => error.code === 'PROVIDER_NOT_READY');
  assert.equal(await page.evaluate(() => window.submissions), 0);
});
