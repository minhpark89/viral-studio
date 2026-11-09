import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuVendor, inspectRenderHardware, selectRenderEncoder, videoEncodingArgs } from '../server/render-hardware.js';

test('automatic mode selects a verified GPU and falls back truthfully on machines without working drivers',async()=>{
  const unavailable={force:true,detectAdapters:async()=>[{name:'Intel test',vendor:'intel'}],testEncoder:async()=>{throw Error('driver missing');}};
  const fallback=await selectRenderEncoder({renderAcceleration:'auto'},unavailable);
  assert.equal(fallback.encoder,'libx264');assert.equal(fallback.gpu,false);assert.ok(fallback.fallbackReason);
  const hardware=await selectRenderEncoder({renderAcceleration:'auto'},{...unavailable,testEncoder:async()=>({available:true})});
  assert.equal(hardware.encoder,'h264_qsv');assert.equal(hardware.gpu,true);
  const noGpu=await selectRenderEncoder({renderAcceleration:'auto'},{force:true,detectAdapters:async()=>[]});
  assert.equal(noGpu.encoder,'libx264');
});

test('GPU mode requires a successful real probe, not just an encoder name or GPU inventory', async () => {
  const options = { force: true, detectAdapters: async () => [{ name: 'NVIDIA fixture', vendor: 'nvidia', driver: 'old' }], testEncoder: async () => { throw new Error('The minimum required Nvidia driver for nvenc is 610.00 or newer'); } };
  const report = await inspectRenderHardware({}, options);
  assert.equal(report.gpuAvailable, false); assert.equal(report.selected, null);
  assert.equal(report.candidates[0].recommendation.minimumDriver, '610.00');
  await assert.rejects(selectRenderEncoder({ renderAcceleration: 'gpu' }, options), error => error.code === 'GPU_UNAVAILABLE');
});
test('GPU selection tries supported vendors and retains the passing encoder instead of silently using CPU', async () => {
  const tried = [];
  const report = await inspectRenderHardware({}, { force: true, detectAdapters: async () => [
    { name: 'Intel fixture', vendor: 'intel', driver: 'test' }, { name: 'AMD fixture', vendor: 'amd', driver: 'test' }, { name: 'NVIDIA fixture', vendor: 'nvidia', driver: 'test' }],
  testEncoder: async (_command, encoder) => { tried.push(encoder); if (encoder === 'h264_nvenc') throw new Error('Driver unavailable'); return { available: true }; } });
  assert.deepEqual(tried, ['h264_nvenc', 'h264_amf', 'h264_qsv']); assert.equal(report.selected.encoder, 'h264_amf');
});
test('explicit CPU mode does not require GPU probing and unrecognized encoder names are rejected', async () => {
  assert.equal((await selectRenderEncoder({ renderAcceleration: 'cpu' }, { detectAdapters: () => { throw new Error('must not run'); } })).encoder, 'libx264');
  assert.throws(() => videoEncodingArgs('foreign-encoder'), error => error.code === 'INVALID_ENCODER');
  for (const encoder of ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf']) {
    const args = videoEncodingArgs(encoder, { quality: 18 }); assert.equal(args[args.indexOf('-c:v') + 1], encoder);
    if (encoder !== 'libx264') assert.ok(!args.includes('-crf'));
  }
  assert.equal(gpuVendor('Basic display', 'PCI\\VEN_10DE'), 'nvidia'); assert.equal(gpuVendor('Radeon'), 'amd'); assert.equal(gpuVendor('Intel Arc'), 'intel');
});
test('a machine without a compatible GPU cannot be mislabeled as GPU rendering', async () => {
  const options = { force: true, detectAdapters: async () => [] };
  const report = await inspectRenderHardware({}, options); assert.equal(report.gpuAvailable, false);
  await assert.rejects(selectRenderEncoder({ renderAcceleration: 'gpu' }, options), error => error.code === 'GPU_UNAVAILABLE');
});
