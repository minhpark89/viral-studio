import fs from 'node:fs/promises';
import path from 'node:path';
import { binary, probe, runProcess, importMedia } from './media.js';
import { StudioError, safeName } from './store.js';
import { selectRenderEncoder, videoEncodingArgs, recordRenderDevice } from './render-hardware.js';
import { presenterFilter } from './news-render-common.js';
import { createNewsTypography } from './news-typography.js';
import { createNewsCaptions } from './news-captions.js';
import { newsV3Editorial, newsPhotoCaption } from './news-v3-editorial.js';
import { v3PhotoGraph, NEWS_FPS as FPS, NEWS_PHOTO_RECT as HERO } from './news-v3-motion.js';
import { NEWS_MIN_SECONDS, NEWS_MAX_IMAGES } from '../shared/news-format.js';

export async function renderNewsV3(store,job,presenter,plan,images,signal,update=()=>{}){
 const started=performance.now(),style=plan.newsRenderStyle||'v3';signal.throwIfAborted();
 if(!presenter?.file||presenter.kind!=='video'||!presenter.hasAudio)throw new StudioError('MC phải là video có lời đọc.','NEWS_PRESENTER_AUDIO_REQUIRED',422);
 if(!Number.isFinite(presenter.duration)||presenter.duration<=0||presenter.duration>600)throw new StudioError('Thời lượng MC không hợp lệ.','NEWS_PRESENTER_DURATION_INVALID',422);
 const duration=Math.ceil(Math.max(NEWS_MIN_SECONDS,presenter.duration)*FPS)/FPS,padDuration=Math.max(0,duration-presenter.duration);
 const usable=[...new Map(images.filter(i=>i?.file&&i.kind==='image').map(i=>[i.contentHash||i.sourceImageUrl||i.file,i])).values()].slice(0,Math.min(NEWS_MAX_IMAGES,Math.floor(duration/1.8)));
 if(!usable.length)throw new StudioError('News broadcast needs at least one verified editorial image.','NEWS_IMAGES_REQUIRED',422);
 const device=await selectRenderEncoder(store.state.settings);signal.throwIfAborted();recordRenderDevice(store,job,device);
 const tempRoot=path.resolve(store.root,'temp'),directory=await fs.mkdtemp(path.join(tempRoot,'news-v3-'));
 const threads=Math.max(1,Math.min(4,Number(store.state.settings.renderThreads)||2));
 const ffmpeg=binary('ffmpeg',store.state.settings);
 try{
  const typography=await createNewsTypography(directory,plan.fontStyle);
  const captions=await createNewsCaptions(store,presenter,plan.narration,duration,directory,signal,update);
  signal.throwIfAborted();
  const editorial=newsV3Editorial(plan,captions,duration),photo=v3PhotoGraph(usable,duration,{style,visualMode:plan.visualMode});
  const credits=usable.map(image=>newsPhotoCaption(image,plan.visualMode));
  const filters=[...photo.filters],rectangles=[],inputs=[...photo.inputs,'-i',presenter.file],presenterInput=usable.length;
  let chain='base',serial=0;
  const add=filter=>{const out='layer'+serial++;filters.push(`[${chain}]${filter}[${out}]`);chain=out;};
  const when=(a,b)=>`gte(t,${a.toFixed(6)})*lt(t,${b.toFixed(6)})`;
  const box=(id,x,y,w,h,color)=>{rectangles.push({id,x,y,w,h,color});add(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`);};
  async function text(id,value,x,y,{font='label',size=42,min=size,width=880,lines=1,color='white',start=0,end=duration,fade=false,lineSpacing=8}={}){
   if(!String(value||'').trim())return;
   const t=await typography.fit(id,value,{font,size,min,width,lines});Object.assign(typography.audit.at(-1),{x,y,start,end,color,lineSpacing});
   const alpha=fade?`:alpha='min(1,max(0,(t-${start.toFixed(6)})/0.12))'`:'';
   add(`drawtext=fontfile=${font}.ttf:textfile=${t.file}:expansion=none:fontcolor=${color}:fontsize=${t.size}:line_spacing=${lineSpacing}:x=${x}:y=${y}${alpha}:enable='${when(start,end)}'`);
  }
  filters.push(`color=c=#101f34:s=1080x1920:r=${FPS}:d=${duration}[background]`);
  filters.push(`[background][${photo.output}]overlay=x=${HERO.x}:y=${HERO.y}:eof_action=repeat[base]`);
  const mc={x:64,y:1064,w:240,h:300};
  filters.push(`[${presenterInput}:v]${presenterFilter(mc.w,mc.h)},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(6)},setpts=PTS-STARTPTS[mc]`);
  filters.push(`[${chain}][mc]overlay=x=${mc.x}:y=${mc.y}:eof_action=repeat[presenter]`);chain='presenter';rectangles.push({id:'presenter',...mc});
  box('brand-rule',64,124,8,58,'#de2946');
  await text('brand',editorial.brand,92,126,{size:46,min:32,width:430});
  box('edition-tab',696,126,248,48,'#b91e37');
  await text('edition',editorial.edition,716,137,{size:28,min:23,width:208});
  box('brand-divider',64,202,880,2,'#3a4c62');
  await text('dateline',editorial.dateline,64,220,{size:30,min:24,width:880,color:'#c6d3e4'});
  for(const shot of photo.shots){
   const credit=credits[shot.index],timing={start:shot.labelStart,end:shot.labelEnd};
   await text('photo-label'+shot.index,credit.label,64,1012,{size:24,min:22,width:526,color:'#b6c5d8',...timing});
   await text('photo-credit'+shot.index,credit.credit,610,1000,{size:20,min:16,width:334,lines:2,lineSpacing:4,color:'#b6c5d8',...timing});
  }
  box('photo-rule',64,1046,880,2,'#314257');
  box('mc-nameplate',64,1326,240,38,'#091423');
  await text('ai','AI PRESENTER',78,1335,{size:25,min:22,width:212});
  for(const [i,beat]of editorial.beats.entries()){
   const timing={start:beat.start,end:beat.end,fade:true};
   await text('section'+i,beat.title,338,1072,{size:30,min:26,width:606,color:'#ff687b',...timing});
   await text('headline'+i,beat.headline,338,1124,{font:'headline',size:64,min:36,width:606,lines:4,...timing});
  }
  box('caption-panel',64,1408,880,132,'#091423');
  for(const [i,cue]of captions.cues.entries())await text('caption'+i,cue.text,90,1428,{size:47,min:34,width:826,lines:2,start:cue.start,end:cue.end});
  await text('source',editorial.source,64,1566,{size:24,min:20,width:650,lines:2,lineSpacing:4,color:'#b6c5d8'});
  await text('date',editorial.date,756,1566,{size:28,min:24,width:188,color:'#b6c5d8'});
  box('bottom-rule',64,1620,880,3,'#34455c');
  filters.push(`[${presenterInput}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=${padDuration.toFixed(6)},atrim=duration=${duration},asetpts=PTS-STARTPTS[voice]`);
  add('format=yuv420p');
  const output=path.join(directory,'output.mp4');
  await fs.writeFile(path.join(directory,'filter.ffgraph'),filters.join(';'));
  const creditText=credits.map((c,i)=>`${i+1}. ${c.name}\n${c.label}\n${c.fullCredit}\n${c.url}\n${c.licenseUrl}\nDisplay: resized to fit, gentle zoom on selected frames; original composition retained.`).join('\n\n');
  const args=['-hide_banner','-v','error','-y','-nostdin','-progress','pipe:1',...inputs,'-filter_complex_threads',String(threads),'-filter_complex_script','filter.ffgraph','-map',`[${chain}]`,'-map','[voice]','-t',String(duration),'-r',String(FPS),...videoEncodingArgs(device.encoder,{quality:18,threads}),'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-metadata','comment='+creditText,'-movflags','+faststart',output];
  update(20,'Đang dựng '+(style==='v3-fast'?'V3 nhanh':'V3 chuẩn'));
  const encodeStarted=performance.now();
  await runProcess(ffmpeg,args,{cwd:directory,signal,timeout:Math.max(120000,Number(store.state.settings.maxWaitMinutes||30)*60000),onLine:line=>{const match=/^out_time_us=(\d+)/.exec(line);if(match)update(Math.min(96,20+Number(match[1])/1e6/duration*76),'Đang ghép ảnh, MC và phụ đề V3');}});
  const encodeSeconds=(performance.now()-encodeStarted)/1000;signal.throwIfAborted();
  const metadata=await probe(output,store.state.settings);
  if(metadata.width!==1080||metadata.height!==1920||metadata.fps!==FPS||!metadata.hasAudio||Math.abs(metadata.duration-duration)>.1)throw new StudioError('Video V3 không đạt kiểm tra đầu ra.','NEWS_OUTPUT_VALIDATION_FAILED',500);
  update(98,'Đang kiểm tra video V3');
  const media=await importMedia(store,output,{projectId:job.projectId,name:safeName(job.name||'News broadcast')+'.mp4',generated:true,move:true,jobId:job.id,mediaType:'news-video'});
  const result=store.patch('media',media.id,{newsPresenterMediaId:presenter.id,newsVisualCount:usable.length,newsImageMediaIds:usable.map(i=>i.id),newsTargetDuration:plan.newsDuration||'auto',newsRenderStyle:style,renderDevice:device,renderPipeline:'v3-single-pass',newsCaptionTiming:captions.method,newsCaptionWarning:captions.warning,newsCaptionCues:captions.cues,newsPhotoCredits:credits,newsRenderMetrics:{seconds:(performance.now()-started)/1000,encodeSeconds,captionCacheHit:Boolean(captions.cached),frames:photo.totalFrames},newsLayout:{hero:HERO,rectangles,text:typography.audit,shots:photo.shots,transitions:photo.transitions}});
  if(store.state.jobs.some(j=>j.id===job.id))store.patch('jobs',job.id,{newsRenderStyle:style,newsCaptionTiming:captions.method,newsCaptionWarning:captions.warning});
  return result;
 }finally{
  const resolved=path.resolve(directory);if(resolved.startsWith(tempRoot+path.sep))await fs.rm(resolved,{recursive:true,force:true}).catch(()=>{});
 }
}
