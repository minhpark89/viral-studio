import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { binary, runProcess } from "../server/media.js";
import { presenterFilter } from "../server/news-render.js";

const cases = [
  { name: "portrait 3:4", width: 540, height: 720 },
  { name: "portrait 9:16", width: 360, height: 640 },
  { name: "DreamFace landscape 4:3", width: 1056, height: 792 },
  { name: "landscape 16:9", width: 1280, height: 720 },
  { name: "square", width: 512, height: 512 },
  { name: "small landscape requiring upscaling", width: 160, height: 90 },
  { name: "non-square input pixels", width: 720, height: 480, sar: "4/3", pixelAspect: 4 / 3 },
  { name: "odd input dimensions", width: 641, height: 359 },
];

for (const input of cases) {
  test(`news MC fits the panel without stretching: ${input.name}`, { timeout: 30000 }, async t => {
    const verification = path.resolve(".verification");
    const root = path.join(verification, `news-presenter-${randomUUID()}`);
    await fs.mkdir(root, { recursive: true });
    t.after(async () => {
      assert.ok(path.resolve(root).startsWith(verification + path.sep));
      await fs.rm(root, { recursive: true, force: true });
    });
    // A square in display coordinates must remain square after fitting and
    // cropping, even when the source uses non-square pixels.
    const boxHeight = 48;
    const boxWidth = boxHeight / (input.pixelAspect || 1);
    const fixture = `nullsrc=s=${input.width}x${input.height}:r=1,format=rgb24,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,drawbox=x=(iw-${boxWidth})/2:y=(ih-${boxHeight})/2:w=${boxWidth}:h=${boxHeight}:color=white:t=fill,setsar=${input.sar || "1"}`;
    const file = path.join(root, "panel.rgb");
    await runProcess(binary("ffmpeg"), ["-y", "-v", "error", "-f", "lavfi", "-i", fixture,
      "-vf", `${presenterFilter(342, 384)},format=rgb24`, "-frames:v", "1", "-threads", "1", "-c:v", "rawvideo", "-f", "rawvideo", file]);
    const pixels = await fs.readFile(file);
    assert.equal(pixels.length, 342 * 384 * 3, "Output must fill the exact MC panel");
    let left = 342, top = 384, right = -1, bottom = -1;
    for (let y = 0; y < 384; y++) {
      for (let x = 0; x < 342; x++) {
        const offset = (y * 342 + x) * 3;
        if (pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    assert.ok(right > left && bottom > top, "The center subject must stay visible");
    assert.ok(Math.abs((right - left) - (bottom - top)) <= 2,
      `The subject was stretched: ${right - left + 1}x${bottom - top + 1}`);
    assert.ok(Math.abs((left + right) / 2 - 342 / 2) < 4, "The subject must remain centered horizontally");
    assert.ok(Math.abs((top + bottom) / 2 - 384 / 2) < 4, "The subject must remain centered vertically");
  });
}
