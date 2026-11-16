import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const app = process.env.VIRAL_STORAGE_CHECK_APP;
const { Store } = await import(app ? pathToFileURL(path.join(app, 'server/store.js')).href : '../server/store.js');
const { commitFileSync } = await import(app ? pathToFileURL(path.join(app, 'server/atomic-file.js')).href : '../server/atomic-file.js');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-file-lock-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('viral-file-lock-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = new Store(root); store.save();
  return store;
}

async function reader(file, milliseconds) {
  const script = `$ErrorActionPreference='Stop'
$stream=[IO.File]::Open($env:VIRAL_LOCK_TEST_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${milliseconds} } finally { $stream.Dispose() }`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, VIRAL_LOCK_TEST_FILE: file } });
  const done = once(child, 'exit');
  await Promise.race([once(child.stdout, 'data').then(([data]) => assert.match(String(data), /locked/)), done.then(() => { throw new Error('Reader exited before acquiring lock'); })]);
  return { done };
}

test('Store commits after a real Windows reader releases a temporary file lock', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const store = workspace(t), original = fs.readFileSync(store.file, 'utf8');
  const { done } = await reader(store.file, 450);
  const probe = path.join(store.root, 'locked-commit.tmp');
  fs.copyFileSync(store.file, probe);
  assert.throws(() => fs.renameSync(probe, store.file), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
  let changes = 0; store.on('change', () => changes++);
  store.state.settings.pollSeconds = 17;
  try { store.save(); } finally { await done; }
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).settings.pollSeconds, 17);
  assert.notEqual(fs.readFileSync(store.file, 'utf8'), original);
  assert.equal(changes, 1);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});

test('An enduring Windows lock preserves the previous state and pending snapshot without reporting a successful save', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const store = workspace(t), original = fs.readFileSync(store.file, 'utf8');
  const { done } = await reader(store.file, 2700);
  let changes = 0; store.on('change', () => changes++);
  store.state.settings.pollSeconds = 19;
  const started = performance.now();
  try { assert.throws(() => store.save(), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)); } finally { await done; }
  assert.ok(performance.now() - started < 5000);
  assert.equal(fs.readFileSync(store.file, 'utf8'), original);
  assert.equal(JSON.parse(fs.readFileSync(`${store.file}.tmp`, 'utf8')).settings.pollSeconds, 19);
  assert.equal(changes, 0);
  store.save();
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).settings.pollSeconds, 19);
  assert.equal(changes, 1);
});

test('Unrelated file errors are not retried or hidden', t => {
  const store = workspace(t), original = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => commitFileSync(path.join(store.root, 'absent.tmp'), store.file), { code: 'ENOENT' });
  assert.equal(fs.readFileSync(store.file, 'utf8'), original);
});
