import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { ensureWindowsRuntime } = createRequire(import.meta.url)('../desktop/windows-runtime.cjs');

test('a working caption runtime does not launch an installer or require administrator access',async()=>{
  const result=await ensureWindowsRuntime('resources',{platform:'win32',probe:async()=>({code:0}),install:async()=>assert.fail('unexpected install')});
  assert.equal(result.status,'ready');
});
test('a missing DLL triggers one bundled prerequisite installation then verifies the native executable',async()=>{
  const calls=[];
  const result=await ensureWindowsRuntime('resources',{platform:'win32',probe:async()=>{calls.push('probe');return{code:calls.length===1?-1073741515:0};},install:async()=>{calls.push('install');return{code:0};}});
  assert.deepEqual(calls,['probe','install','probe']);assert.equal(result.status,'installed');assert.equal(result.restartRequested,false);
});
test('a cancelled installer prevents startup instead of submitting jobs with an unusable runtime',async()=>{
  await assert.rejects(()=>ensureWindowsRuntime('resources',{platform:'win32',probe:async()=>({code:0xc0000135}),install:async()=>{throw Error('cancelled');}}),/cancelled/);
});
test('unrelated native failures do not repeatedly install Visual C++',async()=>{
  await assert.rejects(()=>ensureWindowsRuntime('resources',{platform:'win32',probe:async()=>({code:0xc000001d}),install:async()=>assert.fail('must not install')}),/không khởi động/);
});
test('a prerequisite needing restart is reported only when its native recheck still fails',async()=>{
  await assert.rejects(()=>ensureWindowsRuntime('resources',{platform:'win32',probe:async()=>({code:-1073741515}),install:async()=>({code:3010})}),/khởi động lại/);
});
test('non-Windows startup does not run a Windows prerequisite',async()=>{
  assert.equal((await ensureWindowsRuntime('resources',{platform:'linux',probe:async()=>assert.fail('must not probe')})).status,'not-required');
});
