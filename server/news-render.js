import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { binary, importMedia, probe, runProcess } from "./media.js";
import { StudioError, safeName } from "./store.js";
import { NEWS_MIN_SECONDS, NEWS_MAX_IMAGES } from '../shared/news-format.js';
import { renderNewsVisualTrack, directNewsBudget, directNewsVisualGraph } from './news-motion.js';
import { selectRenderEncoder, videoEncodingArgs, recordRenderDevice } from './render-hardware.js';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

function fontPaths(style = "news") {
  const roots = [
    path.resolve(import.meta.dirname, "../dist/fonts/news"),
    path.resolve(import.meta.dirname, "../public/fonts/news"),
  ];
  const find = (name) => roots.map((root) => path.join(root, name)).find((candidate) => fs.existsSync(candidate));
  const families = {
    news: { headline: "BarlowCondensed-ExtraBold.ttf", label: "BarlowCondensed-Bold.ttf", body: "BarlowCondensed-Regular.ttf" },
    viral: { headline: "Anton-Regular.ttf", label: "Anton-Regular.ttf", body: "BarlowCondensed-Bold.ttf" },
    minimal: { headline: "BeVietnamPro-ExtraBold.ttf", label: "BeVietnamPro-ExtraBold.ttf", body: "BarlowCondensed-Regular.ttf" },
  };
  const family = families[style] || families.news;
  const headline = find(family.headline) || find(families.news.headline);
  const label = find(family.label) || headline;
  const body = find(family.body) || label;
  return headline && label && body ? { headline, label, body } : null;
}

function clean(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function wrap(value, maxChars = 28, maxLines = 2) {
  const words = clean(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
    } else line = next;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines).join("\n");
}

function sentences(value) {
  return clean(value, 1000)
    .split(/(?<=[.!?])\s+/u)
    .map((item) => clean(item, 180))
    .filter((item) => item.length > 8)
    .slice(0, 5);
}

export function presenterFilter(width, height) {
  // Fit the decoded frame's display aspect ratio before cropping. DreamFace
  // can return landscape or square video as well as portrait video. Normalize
  // non-square pixels while scaling so the presenter keeps their proportions.
  return `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1,crop=${width}:${height}`;
}

async function writeText(directory, name, value) {
  const file = path.join(directory, name);
  await fsPromises.writeFile(file, String(value || ""), "utf8");
  return file;
}

function reportFromProgress(line, duration, update, stage, start, weight) {
  const match = /^out_time_us=(\d+)/.exec(line);
  if (!match) return;
  const ratio = Math.min(1, Number(match[1]) / 1_000_000 / Math.max(0.1, duration));
  update(Math.min(99, start + ratio * weight), stage);
}

export async function createNewsSourceCard(store, research, signal) {
  const headline = clean(research.headline || research.topic, 100);
  const cached = store.state.media.find(media => media.projectId === research.projectId && media.visualRole === 'source-card'
    && media.sourceCardHeadline === headline && media.newsResearchIds?.includes(research.id) && media.file && fs.existsSync(media.file));
  if (cached) return cached;
  const fonts = fontPaths();
  if (!fonts) throw new StudioError('The bundled news font is missing.', 'NEWS_FONT_MISSING', 500);
  const tempRoot = path.resolve(store.root, 'temp');
  const directory = await fsPromises.mkdtemp(path.join(tempRoot, 'news-source-card-'));
  try {
    signal.throwIfAborted();
    await fsPromises.copyFile(fonts.headline, path.join(directory, 'headline.ttf'));
    await fsPromises.copyFile(fonts.body, path.join(directory, 'body.ttf'));
    const article = research.articles?.[0];
    const source = /Google News/i.test(article?.source || '') ? article?.title?.split(' - ').at(-1) : article?.source;
    await writeText(directory, 'headline.txt', wrap(headline, 27, 5).toUpperCase());
    await writeText(directory, 'label.txt', 'NEWS BRIEF');
    await writeText(directory, 'source.txt', wrap(`SOURCE: ${clean(source || 'Source report', 80)}`, 55, 2));
    await writeText(directory, 'note.txt', 'SOURCE SUMMARY / NO EVENT PHOTO');
    const filter = [
      'drawbox=x=40:y=40:w=1120:h=1040:color=#29435e:t=3',
      'drawbox=x=80:y=100:w=12:h=65:color=#f6c945:t=fill',
      'drawtext=fontfile=body.ttf:textfile=label.txt:expansion=none:fontsize=44:fontcolor=#f6c945:x=116:y=110',
      'drawtext=fontfile=headline.ttf:textfile=headline.txt:expansion=none:fontsize=68:fontcolor=white:line_spacing=18:x=80:y=260',
      'drawbox=x=80:y=860:w=1040:h=2:color=#29435e:t=fill',
      'drawtext=fontfile=body.ttf:textfile=source.txt:expansion=none:fontsize=30:fontcolor=#b2c8dc:line_spacing=8:x=80:y=900',
      'drawtext=fontfile=body.ttf:textfile=note.txt:expansion=none:fontsize=24:fontcolor=#b2c8dc:x=80:y=1010',
    ].join(',');
    await runProcess(binary('ffmpeg', store.state.settings), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=#0b1629:s=1200x1120', '-vf', filter, '-frames:v', '1', '-threads', '1', '-update', '1', 'card.png'], { cwd: directory, signal, timeout: 30000 });
    const media = await importMedia(store, path.join(directory, 'card.png'), { projectId: research.projectId, name: `News brief · ${headline}.png`, move: true, mediaType: 'news-editorial' });
    return store.patch('media', media.id, { visualRole: 'source-card', sourceCardHeadline: headline, newsResearchIds: [research.id], sourceUrl: article?.url || '', attribution: 'Source-based text card · Viral Studio' });
  } finally {
    if (path.resolve(directory).startsWith(tempRoot + path.sep)) await fsPromises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Produce the news broadcast composition around a real DreamFace Avatar file.
 * The Avatar video remains one continuous foreground track while the editorial
 * background uses animated Ken Burns shots and overlapping xfade transitions.
 */
export async function renderNewsBroadcast(store, job, presenter, plan, images, signal, update = () => {}, { allowDirect = true } = {}) {
  if (!presenter?.file || presenter.kind !== "video" || !presenter.hasAudio) {
    throw new StudioError("DreamFace did not return a presenter video with audio.", "NEWS_PRESENTER_AUDIO_REQUIRED", 422);
  }
  const presenterDuration = Number(presenter.duration);
  if (!Number.isFinite(presenterDuration) || presenterDuration <= 0 || presenterDuration > 600) throw new StudioError('The presenter duration is invalid.', 'NEWS_PRESENTER_DURATION_INVALID', 422);
  const duration = Math.max(NEWS_MIN_SECONDS, presenterDuration);
  const padDuration = Math.max(0, duration - presenterDuration);
  const usable = [...new Map(images.filter((item) => item?.file && item.kind === "image").map(item => [item.contentHash || item.file, item])).values()]
    .slice(0, Math.min(NEWS_MAX_IMAGES, Math.max(1, Math.floor(duration / 2.5))));
  if (!usable.length) throw new StudioError("News broadcast needs at least one verified editorial image.", "NEWS_IMAGES_REQUIRED", 422);
  const fonts = fontPaths(plan?.fontStyle);
  if (!fonts) throw new StudioError("The bundled news font is missing.", "NEWS_FONT_MISSING", 500);
  const visualVariant = Math.max(1, Math.min(100, Number(plan?.visualVariant || plan?.variation || 1)));
  const tempRoot = path.join(store.root, "temp");
  const ffmpeg = binary("ffmpeg", store.state.settings);
  const device = await selectRenderEncoder(store.state.settings);
  signal.throwIfAborted();
  recordRenderDevice(store, job, device);
  const directory = await fsPromises.mkdtemp(path.join(tempRoot, "news-broadcast-"));
  const safePlan = {
    headline: clean(plan?.headline || "News update", 100),
    narration: clean(plan?.narration || "", 500),
    source: clean(plan?.source || "News report", 100),
    brand: clean(plan?.brand || "NEWS UPDATE", 24).toUpperCase(),
  };
  const preset = {
    news: { accent: "#d71920", cta: "#f6c945", panel: "#f7f5ef", ink: "#081a32", dark: "#071526", headlineSize: 55, bodySize: 35 },
    viral: { accent: "#ff6b35", cta: "#facc15", panel: "#fff7ed", ink: "#24120b", dark: "#201018", headlineSize: 62, bodySize: 38 },
    minimal: { accent: "#1f2937", cta: "#e5e7eb", panel: "#ffffff", ink: "#111827", dark: "#111827", headlineSize: 52, bodySize: 32 },
  }[plan?.fontStyle] || { accent: "#d71920", cta: "#f6c945", panel: "#f7f5ef", ink: "#081a32", dark: "#071526", headlineSize: 55, bodySize: 35 };
  try {
    signal.throwIfAborted();
    await Promise.all([
      fsPromises.copyFile(fonts.headline, path.join(directory, "news-headline.ttf")),
      fsPromises.copyFile(fonts.label, path.join(directory, "news-label.ttf")),
      fsPromises.copyFile(fonts.body, path.join(directory, "news-body.ttf")),
    ]);
    const headlineFile = await writeText(directory, "headline.txt", wrap(safePlan.headline, 27, 3).toUpperCase());
    const sourceFile = await writeText(directory, "source.txt", `SOURCE: ${clean(safePlan.source, 42).toUpperCase()}`);
    const brandFile = await writeText(directory, "brand.txt", safePlan.brand.toUpperCase());
    const cornerFile = await writeText(directory, "corner.txt", "US NEWS");
    const captionLabelFile = await writeText(directory, "caption-label.txt", "WHAT WE KNOW");
    const presenterLabelFile = await writeText(directory, "presenter-label.txt", "ON CAMERA");
    await writeText(directory, 'visual-label.txt', plan.visualMode === 'source-card' ? 'SOURCE SUMMARY / NO EVENT PHOTO' : 'CONTEXT IMAGE / NOT EVENT FOOTAGE');
    const ctaFile = await writeText(directory, "cta.txt", "FULL STORY\nIN THE FIRST COMMENT");
    const captionFiles = [];
    const captionList = sentences(safePlan.narration).filter((item) => !/first comment/i.test(item));
    const usableCaptionList = captionList.length ? captionList : [safePlan.headline];
    for (let index = 0; index < usableCaptionList.length; index += 1) {
      captionFiles.push(await writeText(directory, `caption-${index}.txt`, wrap(usableCaptionList[index], 31, 2).toUpperCase()));
    }
    const timeout = Math.max(120000, Number(store.state.settings.maxWaitMinutes || 30) * 60000);
    const direct = allowDirect && directNewsBudget(usable.length, store.state.settings);
    const graph = direct ? directNewsVisualGraph({ images: usable, duration, visualVariant, preset, visualMode: plan.visualMode }) : null;
    const visualTrack = direct ? null : await renderNewsVisualTrack({ ffmpeg, directory, images: usable, duration, visualVariant, preset, visualMode: plan.visualMode, signal, timeout, update, encoder: device.encoder });
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-progress", "pipe:1", "-stats_period", "0.5", ...(direct ? graph.inputs : ['-i', visualTrack]), '-i', presenter.file];
    const presenterInput = direct ? usable.length : 1;
    const filters = direct ? [...graph.filters] : [];
    const pFilter = presenterFilter(342, 384);
    filters.push(`[${presenterInput}:v]${pFilter},setsar=1,format=rgba,tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(3)}[mc]`);
    filters.push(`[${presenterInput}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=${padDuration.toFixed(3)}[voice]`);
    filters.push(`[${direct ? graph.output : '0:v'}]drawbox=x=48:y=42:w=984:h=74:color=${preset.accent}:t=fill,drawtext=fontfile=news-label.ttf:textfile=brand.txt:expansion=none:fontcolor=white:fontsize=31:x=78:y=62[header]`);
    filters.push(`[header]drawbox=x=700:y=42:w=332:h=74:color=${preset.cta}:t=fill,drawtext=fontfile=news-label.ttf:textfile=cta.txt:expansion=none:fontcolor=${preset.dark}:fontsize=22:line_spacing=0:x=725:y=58[headerCta]`);
    filters.push(`[headerCta]drawbox=x=48:y=1068:w=390:h=420:color=${preset.dark}@0.96:t=fill[mcframe]`);
    filters.push(`[mcframe][mc]overlay=x=72:y=1092:enable='lt(t,${duration.toFixed(3)})'[presenter]`);
    filters.push(`[presenter]drawbox=x=48:y=1068:w=390:h=52:color=${preset.accent}:t=fill,drawtext=fontfile=news-label.ttf:textfile=presenter-label.txt:expansion=none:fontcolor=white:fontsize=27:x=72:y=1082:enable='lt(t,${duration.toFixed(3)})'[label]`);
    filters.push(`[label]drawbox=x=460:y=1068:w=572:h=250:color=${preset.dark}@0.94:t=fill,drawtext=fontfile=news-label.ttf:textfile=caption-label.txt:expansion=none:fontcolor=${preset.cta}:fontsize=24:x=488:y=1096:enable='lt(t,${duration.toFixed(3)})'[captionPanel]`);
    filters.push(`[captionPanel]drawbox=x=48:y=1518:w=984:h=220:color=${preset.panel}@0.98:t=fill,drawbox=x=48:y=1518:w=12:h=220:color=${preset.accent}:t=fill,drawtext=fontfile=news-headline.ttf:textfile=headline.txt:expansion=none:fontcolor=${preset.ink}:fontsize=${preset.headlineSize}:line_spacing=4:x=86:y=1548:enable='lt(t,${duration.toFixed(3)})'[headline]`);
    filters.push(`[headline]drawbox=x=872:y=1518:w=160:h=220:color=${preset.accent}:t=fill,drawtext=fontfile=news-label.ttf:textfile=corner.txt:expansion=none:fontcolor=white:fontsize=26:x='872+(160-text_w)/2':y=1610:enable='lt(t,${duration.toFixed(3)})'[corner]`);
    filters.push(`[corner]drawbox=x=48:y=1738:w=984:h=62:color=${preset.dark}@0.94:t=fill,drawtext=fontfile=news-body.ttf:textfile=source.txt:expansion=none:fontcolor=white:fontsize=24:x=78:y=1757:enable='lt(t,${duration.toFixed(3)})'[sourcebar]`);
    let captionVideo = "sourcebar";
    const captionDuration = duration / usableCaptionList.length;
    for (let index = 0; index < captionFiles.length; index += 1) {
      const start = index * captionDuration;
      const end = Math.min(duration, (index + 1) * captionDuration + 0.08);
      const output = `caption${index}`;
      filters.push(`[${captionVideo}]drawbox=x=460:y=1128:w=572:h=190:color=${preset.dark}@0.94:t=fill:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})',drawtext=fontfile=news-body.ttf:textfile=caption-${index}.txt:expansion=none:fontcolor=white:fontsize=${preset.bodySize}:line_spacing=4:borderw=1:bordercolor=${preset.dark}:shadowcolor=#000000@0.65:shadowx=2:shadowy=3:x=488:y=1160:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${output}]`);
      captionVideo = output;
    }
    const ctaStart = Math.max(0, duration - 4.2);
    filters.push(`[${captionVideo}]drawbox=x=700:y=42:w=332:h=74:color=${preset.cta}:t=fill:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=fontfile=news-label.ttf:textfile=cta.txt:expansion=none:fontcolor=${preset.dark}:fontsize=22:line_spacing=0:x=725:y=58:enable='gte(t,${ctaStart.toFixed(3)})'[outv]`);
    const renderThreads = String(Math.max(1, Math.min(4, Number(store.state.settings.renderThreads) || 2)));
    args.push("-filter_complex_threads", renderThreads, "-filter_complex", filters.join(";"), "-map", "[outv]", "-map", "[voice]", "-t", duration.toFixed(3), "-r", String(FPS), ...videoEncodingArgs(device.encoder, { quality: 18, threads: Number(renderThreads) }), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "output.mp4");
    update(46, "Đang ghép MC, lời đọc và đồ họa");
    try { await runProcess(ffmpeg, args, {
      signal,
      cwd: directory,
      timeout: Math.max(120000, Number(store.state.settings.maxWaitMinutes || 30) * 60000),
      onLine: (line) => reportFromProgress(line, duration, update, "Rendering broadcast graphics", 46, 48),
    }); } catch (error) {
      signal.throwIfAborted();
      if (direct && /cannot allocate memory|out of memory|ENOMEM/i.test(error.message)) {
        update(2, 'RAM không đủ cho ghép trực tiếp; chuyển sang dựng từng nhóm với cùng GPU');
        return await renderNewsBroadcast(store, job, presenter, plan, images, signal, update, { allowDirect: false });
      }
      throw error;
    }
    signal.throwIfAborted();
    const output = path.join(directory, "output.mp4");
    const metadata = await probe(output, store.state.settings);
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT || !metadata.hasAudio || Math.abs(metadata.duration - duration) > 0.5) {
      throw new StudioError("The broadcast output failed its audio, frame size or duration check.", "NEWS_OUTPUT_VALIDATION_FAILED", 500);
    }
    update(98, "Validating news broadcast");
    const media = await importMedia(store, output, {
      projectId: job.projectId,
      name: `${safeName(job.name || "News broadcast")}.mp4`,
      generated: true,
      move: true,
      jobId: job.id,
      mediaType: "news-video",
    });
    return store.patch('media', media.id, { newsVisualCount: usable.length, newsImageMediaIds: usable.map(image => image.id), newsTargetDuration: plan.newsDuration || 'auto', renderDevice: device, renderPipeline: direct ? 'direct' : 'bounded' });
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(tempRoot) + path.sep)) await fsPromises.rm(resolved, { recursive: true, force: true }).catch(() => {});
  }
}
