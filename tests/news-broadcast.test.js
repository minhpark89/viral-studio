import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { binary, importMedia, probe, runProcess } from "../server/media.js";
import { renderNewsBroadcast } from "../server/news-render.js";
import { rankNewsImages, writeNewsNarration } from "../server/news-plan.js";

test("news preparation bounds long source labels and respects empty image ranking", async () => {
  const research = {
    headline: "Trump rallies Michigan Republicans",
    script: "A verified report describes a political rally in Michigan.",
    articles: [{
      source: '"President Donald Trump rallies Michigan Republicans in Port Huron - The Detroit News when:1d" - Google News',
      summary: "A report describes the event and its location.",
      url: "https://news.example.test/story",
    }],
  };
  const narration = await writeNewsNarration({}, research, {
    llm: async () => ({
      headline: "Trump rallies Michigan Republicans",
      summary: "A Michigan rally drew attention today. The report says supporters gathered as the political event unfolded.",
      imageQueries: ["Trump rally", "Michigan supporters"],
    }),
  });
  assert.ok(narration.source.length <= 100);

  const candidates = [
    { id: "wikimedia:1", title: "Trump rally photo", query: "Trump rally", imageUrl: "https://upload.wikimedia.org/one.jpg" },
    { id: "wikimedia:2", title: "Michigan supporters photo", query: "Michigan supporters", imageUrl: "https://upload.wikimedia.org/two.jpg" },
  ];
  const ranked = await rankNewsImages({}, research, candidates, { llm: async () => ({ selectedImageIds: [] }) });
  assert.deepEqual(ranked, [], 'Rejected images must not be added back as a fallback');
});

test('image ranking uses bounded groups, ignores foreign IDs and retains verified selections when another group times out', async () => {
  const candidates = Array.from({ length: 25 }, (_, i) => ({ id: `image-${i}`, title: `Named subject ${i}`, description: 'caption '.repeat(100) }));
  let calls = 0; const warnings = [];
  const result = await rankNewsImages({}, { headline: 'Named subject report', script: 'Named subject confirmed the development.', articles: [] }, candidates, { maxImages: 8, onWarning: warning => warnings.push(warning), llm: async (_store, _prompt, input) => {
    calls++;
    assert.ok(input.candidates.length <= 6);
    assert.ok(input.candidates.every(image => image.description.length <= 350));
    if (calls === 1) throw new Error('Gateway timeout');
    return { selectedImageIds: ['not-a-candidate', ...input.candidates.slice(0, 4).map(image => image.id)] };
  } });
  assert.equal(calls, 4);
  assert.deepEqual(result.map(image => image.id), Array.from({length:8},(_,i)=>`image-${i}`));
  assert.equal(warnings.length, 1);
});

for (const presenterSize of ["540x720", "1056x792"]) {
  test(`news broadcast uses a narrated presenter (${presenterSize}), animated editorial images and the first-comment CTA`, { timeout: 240000 }, async (t) => {
    const root = path.resolve(".verification", `news-broadcast-${randomUUID()}`);
    const store = new Store(root);
    store.state.settings.renderAcceleration = 'cpu';
    const project = store.createProject("News broadcast QA");
    const ffmpeg = binary("ffmpeg", store.state.settings);
    const presenterFile = path.join(root, "presenter.mp4");
    await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=${presenterSize}:r=30:d=13`, "-f", "lavfi", "-i", "sine=frequency=440:duration=13", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", presenterFile]);
    const presenter = await importMedia(store, presenterFile, { projectId: project.id, name: "DreamFace presenter.mp4", generated: true });
    const images = [];
    for (const [index, color] of ["#16324f", "#8d2f3d", "#d99b2b"].entries()) {
      const imageFile = path.join(root, `editorial-${index}.png`);
      await runProcess(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=900x1400`, "-frames:v", "1", "-update", "1", imageFile]);
      images.push(await importMedia(store, imageFile, { projectId: project.id, name: `Editorial ${index}.png` }));
    }
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const plan = {
      headline: "A new technology report draws attention",
      narration: "A new technology report is drawing attention today. Officials say the development is being reviewed as more details emerge. Read the full story through the link in the first comment.",
      source: "Test News",
      brand: "VIRAL NEWS",
      newsRenderStyle: 'classic',
    };
    const result = await renderNewsBroadcast(store, { id: randomUUID(), name: "News broadcast QA", projectId: project.id }, presenter, plan, images, new AbortController().signal);
    const output = await probe(result.file, store.state.settings);
    assert.equal(output.width, 1080);
    assert.equal(output.height, 1920);
    assert.equal(output.videoCodec, "h264");
    assert.equal(output.audioCodec, "aac");
    assert.equal(output.hasAudio, true);
    assert.ok(Math.abs(output.duration - Math.max(15, presenter.duration)) < 0.2);
    assert.equal(result.newsVisualCount, 3);
    assert.equal((await fs.readdir(path.join(root, "temp"))).length, 0);
  });
}
