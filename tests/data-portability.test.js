import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { binary } from "../server/media.js";
import { dataDirectory } from "../desktop/data-directory.cjs";

function workspace(t) {
  const base = path.resolve(".verification");
  const root = path.join(base, `portable-${randomUUID()}`);
  t.after(() => {
    assert.ok(root.startsWith(base + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("a copied legacy workspace uses its local media even while the old copy exists", t => {
  const root = workspace(t);
  const oldRoot = path.join(root, "PC A", "Viral Data");
  const newRoot = path.join(root, "PC B", "Dữ liệu thử");
  const original = new Store(oldRoot);
  const media = original.add("media", {
    file: path.join(oldRoot, "exports", "presenter.mp4"),
    thumbnail: path.join(oldRoot, "thumbs", "presenter.jpg"),
    previewFile: path.join(oldRoot, "thumbs", "preview.mp4"),
    sourceUrl: "https://example.test/exports/presenter.mp4",
  });
  for (const key of ["file", "thumbnail", "previewFile"]) fs.writeFileSync(media[key], key);
  delete original.state.dataRoot; // Existing releases did not record a root.
  original.save();
  fs.cpSync(oldRoot, newRoot, { recursive: true });
  const copied = new Store(newRoot);
  const backup = JSON.parse(fs.readFileSync(copied.file + ".before-portability.bak", "utf8"));
  assert.equal(backup.media[0].file, media.file);
  for (const field of ["file", "thumbnail", "previewFile"]) {
    assert.equal(copied.state.media[0][field], path.join(newRoot, path.relative(oldRoot, media[field])));
    assert.equal(fs.readFileSync(copied.state.media[0][field], "utf8"), field);
  }
  assert.equal(copied.state.media[0].sourceUrl, media.sourceUrl);
  assert.equal(new Store(oldRoot).state.media[0].file, media.file);
  assert.deepEqual(new Store(newRoot).state.media, copied.state.media);
});

test("old Windows drive and username paths are relinked without changing settings or URLs", t => {
  const root = workspace(t);
  const store = new Store(root);
  fs.writeFileSync(path.join(root, "media", "image.png"), "image");
  store.state.dataRoot = "C:\\Users\\Other User\\Viral Data";
  store.state.media = [
    { file: "C:\\Users\\Other User\\Viral Data\\media\\image.png" },
    { file: "C:\\Users\\Other User\\Viral Data\\media\\missing.png" },
    { file: "C:\\unrelated\\media\\image.png" },
    { file: "C:\\Users\\Other User\\Viral Data\\media\\..\\..\\image.png" },
  ];
  store.state.settings.llm.apiKey = "fixture-not-a-real-secret";
  store.state.settings.chromePath = "C:\\Other\\chrome.exe";
  store.save();
  const restored = new Store(root);
  assert.equal(restored.state.media[0].file, path.join(root, "media", "image.png"));
  assert.deepEqual(restored.state.media.slice(1), store.state.media.slice(1));
  assert.deepEqual(restored.state.settings, store.state.settings);
  assert.equal(restored.state.dataRoot, root);
});

test("recorded roots survive a second move and missing copies stay detectable", t => {
  const root = workspace(t);
  const a = new Store(path.join(root, "first"));
  fs.mkdirSync(path.join(a.root, "exports", "nested"));
  const file = path.join(a.root, "exports", "nested", "video.mp4");
  fs.writeFileSync(file, "video");
  a.add("media", { file });
  for (const destination of ["second", "third"]) {
    const source = destination === "second" ? a.root : path.join(root, "second");
    const target = path.join(root, destination);
    fs.cpSync(source, target, { recursive: true });
    const restored = new Store(target);
    assert.equal(restored.state.media[0].file, path.join(target, "exports", "nested", "video.mp4"));
  }
});

test("portable startup owns adjacent data and installed upgrades still find legacy data", () => {
  const executable = path.resolve("Installed", "Viral Studio.exe");
  const portable = path.resolve("USB", "Viral Studio");
  const local = path.resolve("LocalAppData");
  const installed = path.join(local, "Programs", "Viral Studio", "Viral Data");
  const legacy = path.join(local, "Programs", "Dropship Studio", "Dropship Data");
  const options = { isPackaged: true, executable, env: { LOCALAPPDATA: local }, exists: p => [installed, legacy].includes(p) };
  assert.equal(dataDirectory({ ...options, env: { ...options.env, PORTABLE_EXECUTABLE_DIR: portable } }), path.join(portable, "Viral Data"));
  assert.equal(dataDirectory(options), installed);
  assert.equal(dataDirectory({ ...options, exists: p => p === legacy }), legacy);
  assert.equal(dataDirectory({ ...options, env: { STUDIO_DATA_DIR: portable } }), portable);
  assert.equal(dataDirectory({ ...options, env: { PORTABLE_EXECUTABLE_DIR: portable }, exists: p => p === path.join(portable, "Dropship Data") }), path.join(portable, "Dropship Data"));
});

test("missing absolute tool overrides fall back to the shipped tools", t => {
  const root = workspace(t);
  for (const name of ["ffmpeg", "ffprobe"]) {
    assert.equal(binary(name, { [`${name}Path`]: path.join(root, "old-pc", name + ".exe") }), binary(name));
    assert.equal(binary(name, { [`${name}Path`]: "C:\\Missing-PC\\" + name + ".exe" }), binary(name));
    assert.equal(binary(name, { [`${name}Path`]: "custom-command" }), "custom-command");
  }
});

test('fresh installed data lives outside the removable app directory while a moved install follows its preserved pointer', () => {
  const root = path.resolve('Programs', 'Viral Studio');
  const relocated = path.resolve('Older installation.data', 'Viral Data');
  const options = { isPackaged: true, executable: path.join(root, 'Viral Studio.exe'), env: {}, exists: () => false, readText: () => { throw new Error('No pointer'); } };
  assert.equal(dataDirectory(options), path.join(root + '.data', 'Viral Data'));
  assert.equal(dataDirectory({ ...options, exists: p => p === relocated, readText: () => relocated }), relocated);
  assert.equal(dataDirectory({ ...options, exists: () => true, readText: () => 'relative-path' }), path.join(root + '.data', 'Viral Data'));
  assert.equal(dataDirectory({ ...options, env: { PORTABLE_EXECUTABLE_DIR: root }, exists: p => p === relocated, readText: () => relocated }), path.join(root, 'Viral Data'));
});
