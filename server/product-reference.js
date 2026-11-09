import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioError } from "./store.js";
import { binary, runProcess } from "./media.js";
import { whisperWords } from "./news-captions.js";

export function sampleTimes(duration) {
  const end = Math.max(0, duration - 0.12);
  return [
    ...new Set(
      [
        0,
        0.5,
        1,
        2,
        3,
        ...Array.from({ length: 7 }, (_, i) => (end * i) / 6),
      ].map((t) => Math.round(Math.min(end, t) * 100) / 100),
    ),
  ].sort((a, b) => a - b);
}
export function validateProductReference(store, id, projectId) {
  if (!id) return null;
  const media = store.require("media", id);
  if (media.projectId !== projectId || media.kind !== "video")
    throw new StudioError(
      "Chọn video mẫu thuộc dự án này.",
      "PRODUCT_SAMPLE_INVALID",
    );
  if (media.duration > 600)
    throw new StudioError(
      "Video mẫu tối đa 10 phút. Cắt đoạn muốn học hỏi trước khi tải lên.",
      "PRODUCT_SAMPLE_TOO_LONG",
    );
  return media;
}
// Some models expand a requested sentence into named observations. Preserve
// those observations in readable text instead of failing a valid analysis.
export function referenceObservation(value, depth = 0) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (!value || depth > 3) return "";
  if (Array.isArray(value))
    return value
      .map((v) => referenceObservation(v, depth + 1))
      .filter(Boolean)
      .join("; ");
  if (typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, v]) =>
          `${key.replaceAll("_", " ")}: ${referenceObservation(v, depth + 1)}`,
      )
      .join("; ");
  return "";
}
const observation = (max) =>
  z.preprocess(
    (value) => referenceObservation(value),
    z.string().min(1).max(max),
  );
const analysisSchema = z.object({
  summary: observation(1800),
  hook: observation(1200),
  pacing: observation(1200),
  shots: z.preprocess(
    (value) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    z.array(observation(1200)).max(12),
  ),
  lighting: observation(1200),
  textAndCta: observation(1200),
  adaptation: observation(2400),
  limitations: z.preprocess(
    (value) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    z.array(observation(1600)).max(8),
  ),
});

export async function analyzeProductReference(
  store,
  request,
  { llm, signal, stage = () => {} },
) {
  const media = validateProductReference(
    store,
    request.sampleVideoMediaId,
    request.projectId,
  );
  if (!media) return null;
  const files = [],
    times = sampleTimes(media.duration),
    tiles = [];
  let transcript = [],
    transcriptWarning =
      "Không có lời nói đã xác minh; không suy ra nội dung âm thanh từ hình ảnh.";
  try {
    stage("Đang đọc khung hình video mẫu");
    for (const seconds of times) {
      const file = path.join(store.root, "temp", `sample-${randomUUID()}.jpg`);
      files.push(file);
      tiles.push(file);
      await runProcess(
        binary("ffmpeg", store.state.settings),
        [
          "-y",
          "-ss",
          String(seconds),
          "-i",
          media.file,
          "-vf",
          "scale=240:240:force_original_aspect_ratio=decrease,pad=240:240:(ow-iw)/2:(oh-ih)/2:black",
          "-frames:v",
          "1",
          file,
        ],
        { signal, timeout: 30000 },
      );
    }
    const contact = path.join(
      store.root,
      "temp",
      `sample-contact-${randomUUID()}.jpg`,
    );
    files.push(contact);
    const layout = tiles
      .map((_, i) => `${(i % 4) * 240}_${Math.floor(i / 4) * 240}`)
      .join("|");
    if (tiles.length === 1) await fs.copyFile(tiles[0], contact);
    else
      await runProcess(
        binary("ffmpeg", store.state.settings),
        [
          "-y",
          ...tiles.flatMap((f) => ["-i", f]),
          "-filter_complex",
          `xstack=inputs=${tiles.length}:layout=${layout}:fill=black[out]`,
          "-map",
          "[out]",
          "-frames:v",
          "1",
          contact,
        ],
        { signal, timeout: 45000 },
      );
    const cuts = await runProcess(
      binary("ffmpeg", store.state.settings),
      [
        "-hide_banner",
        "-i",
        media.file,
        "-t",
        "180",
        "-vf",
        "select='gt(scene,0.3)',showinfo",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { signal, timeout: 60000 },
    ).then((r) =>
      [...r.stderr.matchAll(/pts_time:([\d.]+)/g)]
        .map((m) => Number(m[1]))
        .slice(0, 30),
    );
    if (media.hasAudio) {
      const roots = [
        process.resourcesPath &&
          path.join(process.resourcesPath, "news-captions"),
        path.resolve(import.meta.dirname, "../runtime/news-captions"),
      ].filter(Boolean);
      for (const directory of roots) {
        const executable = path.join(directory, "whisper-cli.exe"),
          model = path.join(directory, "ggml-base.en.bin");
        if (
          !(await fs.stat(executable).catch(() => null)) ||
          !(await fs.stat(model).catch(() => null))
        )
          continue;
        stage("Đang chép lời video mẫu bằng bộ nhận dạng offline");
        const wav = path.join(
            store.root,
            "temp",
            `sample-voice-${randomUUID()}.wav`,
          ),
          output = path.join(store.root, "temp", `sample-asr-${randomUUID()}`);
        files.push(wav, output + ".json");
        try {
          await runProcess(
            binary("ffmpeg", store.state.settings),
            [
              "-y",
              "-i",
              media.file,
              "-t",
              "120",
              "-vn",
              "-ar",
              "16000",
              "-ac",
              "1",
              "-c:a",
              "pcm_s16le",
              wav,
            ],
            { signal, timeout: 45000 },
          );
          await runProcess(
            executable,
            [
              "-m",
              model,
              "-f",
              wav,
              "-l",
              "en",
              "-ojf",
              "-of",
              output,
              "-t",
              "2",
              "-ng",
            ],
            { signal, timeout: 180000 },
          );
          transcript = whisperWords(
            JSON.parse(await fs.readFile(output + ".json", "utf8")),
            Math.min(120, media.duration),
          ).slice(0, 600);
          transcriptWarning =
            "Bản chép tự động tiếng Anh, tối đa 120 giây; có thể nhận sai và không phải phân tích nhạc.";
        } catch (e) {
          signal?.throwIfAborted();
          transcriptWarning =
            "Không đọc được lời nói; chỉ phân tích bằng chứng hình ảnh.";
        }
        break;
      }
    }
    stage("Đang phân tích cách dựng video mẫu");
    const analysis = analysisSchema.parse(
      await llm(
        "Analyze this user-supplied reference video for an original product adaptation. Return JSON with STRING fields summary,hook,pacing,lighting,textAndCta,adaptation and arrays of STRINGS shots,limitations. Do not nest objects inside these fields. Keep each field concise (one or two sentences). The contact sheet is sampled frames in row-major order with provided timestamps. The first seconds are sampled more densely. Scene-change times are detector candidates, not confirmed edits. ASR is machine-recognized English, may be wrong. Distinguish observation, inference and advice. Preserve only techniques; do not copy faces, logos, script, music or footage. Never claim full-video viewing or verified conversion performance.",
        {
          duration: media.duration,
          sampleTimes: times,
          sceneChangeCandidates: cuts,
          sceneDetectionCoverageSeconds: Math.min(180, media.duration),
          transcript,
          transcriptWarning,
          styleNotes: request.styleNotes,
        },
        {
          signal,
          images: [
            `data:image/jpeg;base64,${(await fs.readFile(contact)).toString("base64")}`,
          ],
          maxTokens: 2200,
          timeoutSeconds: 180,
        },
      ),
    );
    return {
      mediaId: media.id,
      name: media.name,
      duration: media.duration,
      sampleTimes: times,
      sceneChangeCandidates: cuts,
      transcript,
      transcriptWarning,
      analysis,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await Promise.all(
      files.map((file) => fs.rm(file, { force: true }).catch(() => {})),
    );
  }
}
