import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { binary, runProcess } from '../server/media.js';
import { v3PhotoGraph } from '../server/news-v3-motion.js';

test('V3 decodes AVIF served as jpg alongside JPEG and PNG at the exact output frame rate', async t => {
  const root = path.resolve('.verification', 'avif-render-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ffmpeg = binary('ffmpeg'), signal = AbortSignal.timeout(60000);
  const avif = path.join(root, 'actual.avif'), disguised = path.join(root, 'cdn-photo.jpg');
  const jpeg = path.join(root, 'jpeg.jpg'), png = path.join(root, 'png.png');
  for (const [file, encoding] of [[avif, ['-c:v', 'libaom-av1', '-cpu-used', '8', '-still-picture', '1']], [jpeg, []], [png, []]]) {
    await runProcess(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240', '-frames:v', '1', ...encoding, '-threads', '1', file], { signal });
  }
  await fs.copyFile(avif, disguised);
  await assert.rejects(runProcess(ffmpeg, ['-v', 'error', '-framerate', '30', '-i', disguised, '-f', 'null', '-'], { signal }), /Option framerate not found/);
  for (const style of ['v3', 'v3-fast']) {
    const graph = v3PhotoGraph([disguised, jpeg, png].map(file => ({ file, width: 320, height: 240 })), 6, { style });
    const output = path.join(root, style + '.mp4');
    await runProcess(ffmpeg, ['-v', 'error', '-y', ...graph.inputs, '-filter_complex_threads', '1', '-filter_complex', graph.filters.join(';') + ';[photoTrack]scale=320:216[out]', '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', output], { signal });
    const { stdout } = await runProcess(binary('ffprobe'), ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output], { signal });
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(Number(stream.nb_read_frames), 180);
    assert.equal(stream.avg_frame_rate, '30/1');
    assert.equal(Number(stream.duration), 6);
    await runProcess(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-'], { signal });
  }
});
