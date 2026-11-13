import { StudioError } from './store.js';
import { v3PhotoFit } from './news-v3-photo-fit.js';
export const NEWS_FPS = 30;
export const NEWS_PHOTO_RECT = { x: 0, y: 272, w: 1080, h: 720 };

export function v3PhotoFilter(input, output, { frames, motion = 'smooth', direction = 'in', fit = 'contain', width = NEWS_PHOTO_RECT.w, height = NEWS_PHOTO_RECT.h }) {
  const amount = motion === 'smooth' && fit === 'cover' ? Math.min(.018, frames / NEWS_FPS * .0045) : 0;
  const p = `min(1,max(0,on/${Math.max(1, frames - 1)}))`, ease = `(3*pow(${p},2)-2*pow(${p},3))`;
  const z = `(1+${amount.toFixed(6)}*${direction === 'out' ? `(1-${ease})` : ease})`, x = `(W-W/${z})/2`, y = `(H-H/${z})/2`;
  const transform = amount ? `,perspective=x0='${x}':y0='${y}':x1='W-${x}':y1='${y}':x2='${x}':y2='H-${y}':x3='W-${x}':y3='H-${y}':sense=source:eval=frame:interpolation=cubic` : '';
  const fill = fit === 'cover'
    ? `[${input}:v]scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1:flags=lanczos,crop=${width}:${height},setsar=1,format=yuv420p`
    : `[${input}:v]split[${output}bg][${output}fg];` +
      `[${output}bg]scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1:flags=lanczos,crop=${width}:${height},setsar=1,format=yuv420p,boxblur=luma_radius=24:luma_power=2:chroma_radius=12:chroma_power=2,eq=brightness=-0.10:saturation=0.65[${output}blur];` +
      `[${output}fg]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1:flags=lanczos,setsar=1,format=yuv420p[${output}full];` +
      `[${output}blur][${output}full]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p`;
  // Build the background once, then loop the finished frame. No per-frame blur.
  return `${fill},loop=loop=-1:size=1:start=0,setpts=N/(${NEWS_FPS}*TB),trim=end_frame=${frames}${transform},settb=1/${NEWS_FPS},setpts=PTS-STARTPTS[${output}]`;
}

export function v3PhotoGraph(images, duration, { style = 'v3', visualMode = 'photo', transitionFrames = 9, visualVariant = 1 } = {}) {
  if (!images.length || images.length > 10 || !Number.isFinite(duration) || duration < 1 || duration > 600) throw new StudioError('Ảnh/thời lượng V3 không hợp lệ.', 'NEWS_VISUALS_INVALID', 422);
  const totalFrames = Math.round(duration * NEWS_FPS), distributed = totalFrames + (images.length - 1) * transitionFrames;
  const shots = images.map((image, index) => {
    const framing = v3PhotoFit(image, { visualMode });
    return { index, ...framing, frames: Math.floor(distributed / images.length) + (index < distributed % images.length ? 1 : 0), direction: visualVariant % 2 ? 'in' : 'out', motion: style === 'v3-fast' || framing.fit === 'contain' || (index + visualVariant - 1) % 2 ? 'static' : 'smooth' };
  });
  if (shots.some(s => s.frames - transitionFrames < 45)) throw new StudioError('Quá nhiều ảnh cho thời lượng clip.', 'NEWS_TOO_MANY_IMAGES', 422);
  const inputs = images.flatMap(image => ['-framerate', String(NEWS_FPS), '-i', image.file]);
  const filters = shots.map((shot, index) => v3PhotoFilter(index, `photo${index}`, shot));
  let output = 'photo0', elapsed = shots[0].frames; const transitions = [];
  for (let i = 1; i < shots.length; i++) {
    const startFrame = elapsed - transitionFrames, next = `dissolve${i}`;
    filters.push(`[${output}][photo${i}]xfade=transition=fade:duration=${transitionFrames / NEWS_FPS}:offset=${startFrame / NEWS_FPS}[${next}]`);
    transitions.push({ from: i - 1, to: i, startFrame, endFrame: elapsed, start: startFrame / NEWS_FPS, end: elapsed / NEWS_FPS });
    output = next; elapsed += shots[i].frames - transitionFrames;
  }
  if (elapsed !== totalFrames) throw new Error('Photo track changed the duration');
  filters.push(`[${output}]format=yuv420p[photoTrack]`);
  shots.forEach((shot, i) => {
    shot.labelStart = i ? Math.ceil((transitions[i - 1].startFrame + transitions[i - 1].endFrame) / 2) / NEWS_FPS : 0;
    shot.labelEnd = i < shots.length - 1 ? Math.ceil((transitions[i].startFrame + transitions[i].endFrame) / 2) / NEWS_FPS : totalFrames / NEWS_FPS;
    shot.zoomPercent = shot.motion === 'smooth' ? Math.min(.018, shot.frames / NEWS_FPS * .0045) * 100 : 0;
  });
  return { inputs, filters, output: 'photoTrack', totalFrames, shots, transitions };
}
