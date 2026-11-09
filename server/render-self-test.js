import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { binary, importMedia, probe, runProcess } from "./media.js";
import { presenterFilter, renderNewsBroadcast } from "./news-render.js";
import { renderTimeline } from "./render.js";
import { inspectRenderHardware } from './render-hardware.js';

async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

// Called only by the explicit desktop --render-self-test=<empty directory>
// command. No server, account, scheduler or provider is started by this mode.
export async function runRenderSelfTest(directory, { gpu = false } = {}) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  if (fs.readdirSync(root).length) throw new Error("Render test requires a new, empty results directory.");
  const report = {
    schemaVersion: 1,
    version: JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
    startedAt: new Date().toISOString(), passed: false, finished: false,
    machine: { platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10 },
    settings: { renderConcurrency: 1, renderThreads: 2, renderAcceleration: gpu ? 'gpu' : 'cpu' },
    tools: [], cases: [], errors: [],
  };
  const save = stage => {
    report.stage = stage;
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
    fs.appendFileSync(path.join(root, "progress.log"), `${new Date().toISOString()} ${stage}\n`);
  };
  const signal = AbortSignal.timeout(30 * 60 * 1000);
  save("Checking bundled tools");
  try {
    const store = new Store(path.join(root, "workspace"));
    store.state.settings.queuePaused = true;
    store.state.settings.renderThreads = 2;
    store.state.settings.renderAcceleration = gpu ? 'gpu' : 'cpu';
    store.state.settings.renderConcurrency = 1;
    store.state.settings.content.autoPublishNews = false;
    store.save();
    const project = store.createProject("Offline render compatibility test");
    // Ignore environment overrides in this diagnostic: every PC must test the
    // exact binaries distributed with this build, not a global FFmpeg install.
    for (const name of ["ffmpeg", "ffprobe"]) {
      const candidates = [process.resourcesPath && path.join(process.resourcesPath, "bin", name + ".exe"), path.resolve(import.meta.dirname, "../bin", name + ".exe")].filter(Boolean);
      const file = candidates.find(candidate => fs.existsSync(candidate));
      assert.ok(file, `Bundled ${name} is missing`);
      store.state.settings[name + "Path"] = file;
      const version = await runProcess(file, ["-version"], { signal, timeout: 30000 });
      report.tools.push({ name, sha256: await hash(file), version: version.stdout.split(/\r?\n/)[0] });
    }
    const ffmpeg = binary("ffmpeg", store.state.settings);
    if (gpu) {
      report.hardware = await inspectRenderHardware(store.state.settings, { force: true });
      assert.ok(report.hardware.gpuAvailable, report.hardware.message);
    }
    const inputs = [
      { name: "portrait-3-4", width: 540, height: 720 },
      { name: "portrait-9-16", width: 360, height: 640 },
      { name: "landscape-4-3", width: 1056, height: 792 },
      { name: "landscape-16-9", width: 1280, height: 720 },
      { name: "square", width: 512, height: 512 },
      { name: "small", width: 160, height: 90 },
      { name: "non-square-pixels", width: 720, height: 480, sar: "4/3", pixelAspect: 4 / 3 },
      { name: "odd-dimensions", width: 641, height: 359 },
    ];
    for (const input of inputs) {
      const start = Date.now();
      save(`Checking presenter geometry: ${input.name}`);
      const boxWidth = 48 / (input.pixelAspect || 1);
      const fixture = `nullsrc=s=${input.width}x${input.height}:r=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,drawbox=x=(iw-${boxWidth})/2:y=(ih-48)/2:w=${boxWidth}:h=48:color=white:t=fill,setsar=${input.sar || "1"}`;
      const file = path.join(root, "panel.rgb");
      await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", fixture, "-vf", `${presenterFilter(342, 384)},format=rgb24`, "-frames:v", "1", "-threads", "1", "-c:v", "rawvideo", "-f", "rawvideo", file], { signal, timeout: 30000 });
      const pixels = fs.readFileSync(file);
      assert.equal(pixels.length, 342 * 384 * 3);
      let left = 342, top = 384, right = -1, bottom = -1;
      for (let y = 0; y < 384; y++) for (let x = 0; x < 342; x++) {
        const offset = (y * 342 + x) * 3;
        if (pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      assert.ok(right > left && bottom > top, "Presenter center is missing");
      assert.ok(Math.abs(right - left - (bottom - top)) <= 2, "Presenter aspect ratio was stretched");
      assert.ok(Math.abs((left + right) / 2 - 171) < 4 && Math.abs((top + bottom) / 2 - 192) < 4, "Presenter is not centered");
      report.cases.push({ name: input.name, type: "geometry", passed: true, elapsedMs: Date.now() - start });
    }
    fs.unlinkSync(path.join(root, "panel.rgb"));
    const images = [];
    const colors = ['#dc1e1e','#1ed228','#2828d2','#dcd228','#d228d2','#1ed2d2','#a0641e','#6428a0','#e682aa','#64aae6'];
    for (const [index, color] of (gpu ? colors : colors.slice(0, 3)).entries()) {
      const file = path.join(root, `editorial-${index}.png`);
      const photoSize = ['1600x900', '900x1400', '1200x800'][index % 3];
      await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${photoSize}`, "-frames:v", "1", "-threads", "1", "-update", "1", file], { signal, timeout: 30000 });
      images.push(await importMedia(store, file, { projectId: project.id, name: path.basename(file), move: true }));
    }
    for (const size of ["540x720", "1056x792"]) {
      const start = Date.now();
      save(`Rendering full News composition: ${size}`);
      const input = path.join(root, `presenter-${size}.mp4`);
      const presenterSeconds = gpu ? 25 : 13;
      await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=${size}:r=30:d=${presenterSeconds}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${presenterSeconds}`, "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input], { signal, timeout: 120000 });
      const presenter = await importMedia(store, input, { projectId: project.id, name: path.basename(input), move: true });
      const result = await renderNewsBroadcast(store, { id: randomUUID(), name: `Offline ${size}`, projectId: project.id }, presenter, {
        headline: "Viral Studio offline render test", narration: "This synthetic sample checks the same broadcast renderer on each PC. The presenter should stay centered and the audio tone should be audible.", source: "SYNTHETIC TEST", brand: "RENDER TEST",
        ...(size === '1056x792' ? { newsRenderStyle: 'v3-fast' } : {}),
      }, gpu && size === '540x720' ? images.slice(0, 5) : images, signal);
      const output = path.join(root, `NEWS-${size}.mp4`);
      fs.copyFileSync(result.file, output);
      const metadata = await probe(output, store.state.settings);
      assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1920);
      assert.equal(metadata.videoCodec, "h264"); assert.equal(metadata.audioCodec, "aac");
      assert.equal(result.newsRenderStyle, size === '1056x792' ? 'v3-fast' : 'v3');
      assert.doesNotMatch(result.newsCaptionWarning || '', /Chưa có bộ|Không căn được/, 'Bundled offline caption runtime must execute');
      assert.ok(Math.abs(metadata.duration - (gpu ? 25 : 15)) < 0.25);
      await runProcess(ffmpeg, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], { signal, timeout: 120000 });
      const volume = await runProcess(ffmpeg, ["-hide_banner", "-i", output, "-vn", "-af", "volumedetect", "-f", "null", "-"], { signal, timeout: 60000 });
      const meanVolumeDb = Number(/mean_volume:\s*([\d.-]+) dB/.exec(volume.stderr)?.[1]);
      assert.ok(Number.isFinite(meanVolumeDb) && meanVolumeDb > -60, "No audible test tone");
      let photoOrder;
      if (gpu) {
        assert.equal(result.renderDevice?.gpu, true);
        const expected = colors.slice(0, size === '540x720' ? 5 : 10).map(color => [1,3,5].map(offset => parseInt(color.slice(offset, offset + 2), 16)));
        const sample = path.join(root, 'photo-order.rgb');
        await runProcess(ffmpeg, ['-y','-v','error','-i',output,'-vf','fps=2,crop=2:2:540:500,format=rgb24','-threads','1','-c:v','rawvideo','-f','rawvideo',sample], { signal, timeout: 120000 });
        const pixels = fs.readFileSync(sample); photoOrder = [];
        for (let offset = 0; offset < pixels.length; offset += 12) {
          const actual = [...pixels.subarray(offset, offset + 3)];
          const index = expected.findIndex(color => color.every((channel, j) => Math.abs(channel - actual[j]) <= 12));
          if (index >= 0 && photoOrder.at(-1) !== index) photoOrder.push(index);
        }
        assert.deepEqual(photoOrder, expected.map((_, index) => index), 'Every photo must remain in order');
        fs.unlinkSync(sample);
      }
      assert.ok(result.newsLayout.shots.some(shot => shot.fit === 'cover'), 'Landscape photo fill must execute');
      assert.ok(result.newsLayout.shots.some(shot => shot.background === 'same-image-blur'), 'Portrait background must execute');
      report.cases.push({ name: size, type: "full-news", passed: true, elapsedMs: Date.now() - start, output: path.basename(output), metadata, meanVolumeDb, fullyDecoded: true, renderDevice: result.renderDevice, renderPipeline: result.renderPipeline, photoOrder, photoFraming: result.newsLayout.shots, newsRenderStyle: result.newsRenderStyle, captionTiming: result.newsCaptionTiming, captionRuntimeExecuted: true });
    }
    save("Rendering timeline with a logo, text and looped music");
    const start = Date.now();
    const musicFile = path.join(root, "music.wav");
    await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", musicFile], { signal, timeout: 30000 });
    const music = await importMedia(store, musicFile, { projectId: project.id, name: "music.wav", move: true });
    const presenter = store.state.media.find(media => media.name === "presenter-1056x792.mp4");
    const timeline = structuredClone(project.timeline);
    timeline.resolution = 480; timeline.quality = "draft";
    timeline.clips = [
      { id: randomUUID(), mediaId: presenter.id, inSec: 0, outSec: 2, speed: 2, zoom: 1, fit: "contain", volume: 0.5 },
      { id: randomUUID(), mediaId: images[0].id, inSec: 0, outSec: 4, speed: 1, zoom: 1, fit: "contain", volume: 1 },
    ];
    timeline.texts = [{ id: randomUUID(), text: "Viral Studio · Kiểm tra timeline", startSec: 0, endSec: 5, x: 0.5, y: 0.75, size: 28, color: "#ffffff", background: true }];
    timeline.images = [{ id: randomUUID(), mediaId: images[1].id, startSec: 0, endSec: 5, x: 0.8, y: 0.2, scale: 0.15, opacity: 0.6 }];
    timeline.music = { mediaId: music.id, volume: 0.3, offsetSec: 0.1, startSec: 0.2, speed: 1.25, loop: true, fadeIn: 0.3, fadeOut: 0.4 };
    const rendered = await renderTimeline(store, { id: randomUUID(), name: "Offline timeline", projectId: project.id, payload: { timeline } }, signal, () => {});
    const output = path.join(root, "TIMELINE.mp4");
    fs.copyFileSync(rendered.file, output);
    const metadata = await probe(output, store.state.settings);
    assert.equal(metadata.width, 480); assert.equal(metadata.height, 854);
    assert.equal(metadata.videoCodec, "h264"); assert.equal(metadata.audioCodec, "aac");
    assert.ok(Math.abs(metadata.duration - 5) < 0.15);
    await runProcess(ffmpeg, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], { signal, timeout: 60000 });
    if (gpu) assert.equal(rendered.renderDevice?.gpu, true);
    report.cases.push({ name: "logo-and-looped-music", type: "timeline", passed: true, elapsedMs: Date.now() - start, output: path.basename(output), metadata, fullyDecoded: true, renderDevice: rendered.renderDevice });
    report.passed = true;
  } catch (error) {
    report.errors.push({ stage: report.stage, code: error.code || "SELF_TEST_FAILED", message: error.message });
  }
  report.finished = true;
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  fs.writeFileSync(path.join(root, "RESULT.txt"), [
    `Viral Studio ${report.version}: ${report.passed ? "PASS" : "FAIL"}`,
    `${report.cases.length} checks passed; elapsed ${(report.elapsedMs / 1000).toFixed(1)} seconds.`,
    ...report.errors.map(error => `${error.stage}: ${error.message}`),
    "Open both NEWS-*.mp4 files and TIMELINE.mp4; check playback, seeking, picture and sound.",
    "This offline test does not contact DreamFace, an LLM or a publishing service.",
    "See report.json for machine configuration, binary hashes and timings.",
  ].join("\r\n"));
  save(report.passed ? "PASS" : "FAIL");
  return report;
}
