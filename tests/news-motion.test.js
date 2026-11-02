import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { binary, runProcess, probe } from '../server/media.js';
import { renderNewsVisualTrack, directNewsBudget } from '../server/news-motion.js';

test('direct News requires enough free memory for all configured workers and at most five images', () => {
  assert.equal(directNewsBudget(5, { renderConcurrency: 4 }, 8 * 1024 ** 3), true);
  assert.equal(directNewsBudget(5, { renderConcurrency: 4 }, 6 * 1024 ** 3), false);
  assert.equal(directNewsBudget(5, { renderConcurrency: 1 }, 4 * 1024 ** 3), true);
  assert.equal(directNewsBudget(10, {}, 64 * 1024 ** 3), false);
  assert.equal(directNewsBudget(1, {}, 1 * 1024 ** 3), false);
});

test('ten distinct photos survive bounded pairwise transitions in the correct order and duration', { timeout: 240000 }, async t => {
  const root = path.resolve('.verification', 'ten-news-photos-' + randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ffmpeg = binary('ffmpeg');
  const colors = [[220,30,30],[30,210,40],[40,40,210],[220,210,40],[210,40,210],[30,210,210],[160,100,30],[100,40,160],[230,130,170],[100,170,230]];
  const images = [];
  for (const [i, color] of colors.entries()) {
    const file = path.join(root, i + '.ppm');
    await fs.writeFile(file, Buffer.concat([Buffer.from('P6\n2 2\n255\n'), Buffer.from([...color, ...color, ...color, ...color])]));
    images.push({ file });
  }
  const file = await renderNewsVisualTrack({ ffmpeg, directory: root, images, duration: 25, visualVariant: 2, preset: { dark: '#071526', panel: '#ffffff' }, visualMode: 'photo', signal: new AbortController().signal, timeout: 120000, update: () => {} });
  const metadata = await probe(file);
  assert.ok(Math.abs(metadata.duration - 25) < 0.1);
  const sample = path.join(root, 'samples.rgb');
  await runProcess(ffmpeg, ['-y','-v','error','-i',file,'-vf','fps=2,crop=2:2:540:500,format=rgb24','-threads','1','-c:v','rawvideo','-f','rawvideo',sample]);
  const pixels = await fs.readFile(sample); const seen = [];
  for (let i = 0; i < pixels.length; i += 12) {
    const actual = [...pixels.subarray(i, i + 3)];
    const index = colors.findIndex(color => color.every((channel, j) => Math.abs(channel - actual[j]) <= 12));
    if (index >= 0 && seen.at(-1) !== index) seen.push(index);
  }
  assert.deepEqual(seen, colors.map((_, i) => i), 'Every photo, including photos 6–10, must appear once in story order');
});
