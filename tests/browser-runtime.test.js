import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveBrowserExecutable } from '../server/browser-runtime.js';

test('a copied PC browser path and missing Playwright download fall back to installed Chrome or Edge', () => {
  const env = { PROGRAMFILES: path.resolve('fixture-programs'), 'PROGRAMFILES(X86)': path.resolve('fixture-programs-x86'), LOCALAPPDATA: path.resolve('fixture-local') };
  for (const relative of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
    const installed = path.join(env['PROGRAMFILES(X86)'], relative);
    assert.equal(resolveBrowserExecutable({ chromePath: 'Z:/old-pc/chrome.exe' }, '', { env, bundled: 'missing-browser.exe', isFile: file => file === installed }), installed);
  }
});

test('explicit browser selection is honored and missing browsers report an actionable error', () => {
  const options = { env: {}, bundled: 'fixture-browser.exe', isFile: file => ['configured.exe', 'explicit.exe', 'fixture-browser.exe'].includes(file) };
  assert.equal(resolveBrowserExecutable({ chromePath: 'configured.exe' }, 'explicit.exe', options), 'explicit.exe');
  assert.equal(resolveBrowserExecutable({ chromePath: 'configured.exe' }, '', options), 'configured.exe');
  assert.equal(resolveBrowserExecutable({}, '', options), 'fixture-browser.exe');
  assert.throws(() => resolveBrowserExecutable({}, '', { env: {}, bundled: '', isFile: () => false }), error => error.code === 'BROWSER_MISSING');
});
