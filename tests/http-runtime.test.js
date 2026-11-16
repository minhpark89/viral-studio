import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test('HTTP runtime survives closed paused bodies, cancellation, and truncated replies in a separate process', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.resolve('tests/fixtures/http-runtime-check.cjs')], { timeout: 20000, windowsHide: true });
  const report = JSON.parse(stdout);
  assert.equal(report.passed, true);
  assert.equal(report.activeUndici, '8.12.4');
  assert.equal(report.checks.length, 5);
});
