import path from 'node:path';
import { runProcess } from './media.js';

const FPS = 30;
const OVERLAP_FRAMES = 12;

// Render one source photo at a time, then merge pairs in a balanced tree.
// A ten-photo story must not keep ten full-resolution image decoders and two
// parallel ten-way xfade graphs alive on a small PC.
export async function renderNewsVisualTrack({ ffmpeg, directory, images, duration, visualVariant, preset, visualMode, signal, timeout, update }) {
  const totalFrames = Math.ceil(duration * FPS);
  const framesWithOverlaps = totalFrames + (images.length - 1) * OVERLAP_FRAMES;
  const baseFrames = Math.floor(framesWithOverlaps / images.length);
  const encoding = ['-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '2'];
  const run = async (inputs, filter, frames, name) => {
    signal.throwIfAborted();
    const file = path.join(directory, name + '.mp4');
    await runProcess(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...inputs, '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[out]', '-frames:v', String(frames), ...encoding, file], { cwd: directory, signal, timeout });
    return { file, frames };
  };
  let clips = [];
  for (let i = 0; i < images.length; i++) {
    const frames = baseFrames + (i < framesWithOverlaps % images.length ? 1 : 0);
    const seed = (visualVariant - 1) * 5 + i;
    const zoom = seed % 2 ? `1.14-0.1*on/${frames - 1}` : `1.02+0.1*on/${frames - 1}`;
    const panX = [0.22, 0.48, 0.70, 0.36, 0.58][seed % 5];
    const panY = [0.24, 0.42, 0.64, 0.76][seed % 4];
    const label = ['illustration', 'source-card'].includes(visualMode)
      ? ',drawbox=x=96:y=964:w=888:h=52:color=#071526@0.94:t=fill,drawtext=fontfile=news-label.ttf:textfile=visual-label.txt:expansion=none:fontcolor=white:fontsize=26:x=118:y=978' : '';
    const filter = [
      '[0:v]split=2[bgsrc][herosrc]',
      `[bgsrc]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=z='${zoom}':x='(iw-iw/zoom)*${panX}':y='(ih-ih/zoom)*${panY}':d=${frames}:s=1080x1920:fps=${FPS},setsar=1,format=yuv420p,drawbox=x=0:y=0:w=iw:h=ih:color=${preset.dark}@0.30:t=fill,drawbox=x=48:y=140:w=984:h=900:color=${preset.panel}@0.98:t=fill[bg]`,
      `[herosrc]scale=920:860:force_original_aspect_ratio=decrease,pad=920:860:(ow-iw)/2:(oh-ih)/2:color=#0b1629,zoompan=z=1:d=${frames}:s=920x860:fps=${FPS},setsar=1,format=yuv420p[hero]`,
      `[bg][hero]overlay=x=80:y=160,drawbox=x=48:y=140:w=984:h=900:color=#ffffff@0.74:t=4${label}[out]`,
    ].join(';');
    clips.push(await run(['-loop', '1', '-i', images[i].file], filter, frames, `visual-${i}`));
    update(5 + (i + 1) / images.length * 20, `Đang dựng ảnh minh họa ${i + 1}/${images.length}`);
  }
  let level = 0; let merged = 0;
  while (clips.length > 1) {
    const next = [];
    for (let i = 0; i < clips.length; i += 2) {
      if (!clips[i + 1]) { next.push(clips[i]); continue; }
      const [a, b] = [clips[i], clips[i + 1]];
      const filter = `[0:v]settb=1/30,setpts=PTS-STARTPTS[a];[1:v]settb=1/30,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${OVERLAP_FRAMES / FPS}:offset=${(a.frames - OVERLAP_FRAMES) / FPS},format=yuv420p[out]`;
      next.push(await run(['-i', a.file, '-i', b.file], filter, a.frames + b.frames - OVERLAP_FRAMES, `transition-${level}-${i}`));
      update(25 + (++merged) / Math.max(1, images.length - 1) * 20, 'Đang ghép chuyển cảnh');
    }
    clips = next; level++;
  }
  return clips[0].file;
}
