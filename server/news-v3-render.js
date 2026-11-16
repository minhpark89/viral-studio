import fs from 'node:fs/promises';
import path from 'node:path';
import { binary, probe, runProcess, importMedia } from './media.js';
import { StudioError, safeName } from './store.js';
import { selectRenderEncoder, videoEncodingArgs, recordRenderDevice } from './render-hardware.js';
import { presenterFilter } from './news-render-common.js';
import { createNewsTypography } from './news-typography.js';
import { createNewsCaptions } from './news-captions.js';
import { newsV3Editorial, newsPhotoCaption } from './news-v3-editorial.js';
import { v3PhotoGraph, NEWS_FPS as FPS } from './news-v3-motion.js';
import { newsV3Layout } from './news-v3-layout.js';
import { NEWS_MIN_SECONDS, NEWS_MAX_IMAGES, DEFAULT_NEWS_RENDER_STYLE } from '../shared/news-format.js';

export async function renderNewsV3(store,job,presenter,plan,images,signal,update=()=>{}){
 const started=performance.now(),style=plan.newsRenderStyle||DEFAULT_NEWS_RENDER_STYLE,layout=newsV3Layout(style==='v4'?'v4':plan.newsLayoutPreset),HERO=layout.hero;
 const styleLabel=style==='v4'?'V4 bản tin':style==='v3-fast'?'V3 nhanh':'V3 chuẩn';signal.throwIfAborted();
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
  const editorial=newsV3Editorial(plan,captions,duration),photo=v3PhotoGraph(usable,duration,{style,visualMode:plan.visualMode,visualVariant:plan.visualVariant||plan.variation||1,hero:HERO});
  const credits=usable.map(image=>newsPhotoCaption(image,plan.visualMode));
  const filters=[...photo.filters],rectangles=[],inputs=[...photo.inputs,'-i',presenter.file],presenterInput=usable.length;
  let chain='base',serial=0;
  const add=filter=>{const out='layer'+serial++;filters.push(`[${chain}]${filter}[${out}]`);chain=out;};
  const when=(a,b)=>`gte(t,${a.toFixed(6)})*lt(t,${b.toFixed(6)})`;
  const box=(id,x,y,w,h,color)=>{rectangles.push({id,x,y,w,h,color});add(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`);};
  const panel=(id,rect,color)=>box(id,rect.x,rect.y,rect.w,rect.h,color);
  async function text(id,value,x,y,{font='label',size=42,min=size,width=880,lines=1,height=Infinity,color='white',start=0,end=duration,fade=false,lineSpacing=8}={}){
   if(!String(value||'').trim())return;
   const t=await typography.fit(id,value,{font,size,min,width,lines,height,lineSpacing});Object.assign(typography.audit.at(-1),{x,y,start,end,color,lineSpacing});
   const alpha=fade?`:alpha='min(1,max(0,(t-${start.toFixed(6)})/0.12))'`:'';
   add(`drawtext=fontfile=${font}.ttf:textfile=${t.file}:expansion=none:fontcolor=${color}:fontsize=${t.size}:line_spacing=${lineSpacing}:x=${x}:y=${y}${alpha}:enable='${when(start,end)}'`);
  }
  const label=(id,value,position,options={})=>{const {x,y,...style}=position;return text(id,value,x,y,{...style,...options});};
  filters.push(`color=c=#101f34:s=1080x1920:r=${FPS}:d=${duration}[background]`);
  filters.push(`[background][${photo.output}]overlay=x=${HERO.x}:y=${HERO.y}:eof_action=repeat[base]`);
  const mc=layout.presenter;
  filters.push(`[${presenterInput}:v]${presenterFilter(mc.w,mc.h)},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(6)},setpts=PTS-STARTPTS[mc]`);
  filters.push(`[${chain}][mc]overlay=x=${mc.x}:y=${mc.y}:eof_action=repeat[presenter]`);chain='presenter';rectangles.push({id:'presenter',...mc});
  panel('brand-rule',layout.brandRule,'#de2946');
  await label('brand',editorial.brand,layout.brand);
  panel('edition-tab',layout.editionTab,'#b91e37');
  await label('edition',editorial.edition,layout.edition);
  panel('brand-divider',layout.brandDivider,'#3a4c62');
  await label('dateline',editorial.dateline,layout.dateline,{color:'#c6d3e4'});
  for(const shot of photo.shots){
   const credit=credits[shot.index],timing={start:shot.labelStart,end:shot.labelEnd};
   await label('photo-label'+shot.index,credit.label,layout.photoLabel,{color:'#b6c5d8',...timing});
   await label('photo-credit'+shot.index,credit.credit,layout.photoCredit,{color:'#b6c5d8',...timing});
  }
  panel('photo-rule',layout.photoRule,'#314257');
  panel('mc-nameplate',layout.nameplate,'#091423');
  await label('ai','AI PRESENTER',layout.presenterLabel);
  for(const [i,beat]of editorial.beats.entries()){
   const timing={start:beat.start,end:beat.end,fade:true};
   await label('section'+i,beat.title,layout.section,{color:'#ff687b',...timing});
   await label('headline'+i,beat.headline,layout.headline,timing);
  }
  panel('caption-panel',layout.captionPanel,'#091423');
  for(const [i,cue]of captions.cues.entries())await label('caption'+i,cue.text,layout.caption,{start:cue.start,end:cue.end});
  await label('source',editorial.source,layout.source,{color:'#b6c5d8'});
  await label('date',editorial.date,layout.date,{color:'#b6c5d8'});
  panel('bottom-rule',layout.bottomRule,'#34455c');
  filters.push(`[${presenterInput}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=${padDuration.toFixed(6)},atrim=duration=${duration},asetpts=PTS-STARTPTS[voice]`);
  add('format=yuv420p');
  const output=path.join(directory,'output.mp4');
  await fs.writeFile(path.join(directory,'filter.ffgraph'),filters.join(';'));
  const creditText=credits.map((c,i)=>`${i+1}. ${c.name}\n${c.label}\n${c.fullCredit}\n${c.url}\n${c.licenseUrl}\nDisplay: ${photo.shots[i].fit==='cover'?'center crop to fill; gentle zoom on selected frames':'full composition over a blurred, darkened copy of the same image'}.`).join('\n\n');
  const args=['-hide_banner','-v','error','-y','-nostdin','-progress','pipe:1',...inputs,'-filter_complex_threads',String(threads),'-filter_complex_script','filter.ffgraph','-map',`[${chain}]`,'-map','[voice]','-t',String(duration),'-r',String(FPS),...videoEncodingArgs(device.encoder,{quality:18,threads}),'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-metadata','comment='+creditText,'-movflags','+faststart',output];
  update(20,'Đang dựng '+styleLabel);
  const encodeStarted=performance.now();
  await runProcess(ffmpeg,args,{cwd:directory,signal,timeout:Math.max(120000,Number(store.state.settings.maxWaitMinutes||30)*60000),onLine:line=>{const match=/^out_time_us=(\d+)/.exec(line);if(match)update(Math.min(96,20+Number(match[1])/1e6/duration*76),'Đang ghép ảnh, MC và phụ đề '+styleLabel);}});
  const encodeSeconds=(performance.now()-encodeStarted)/1000;signal.throwIfAborted();
  const metadata=await probe(output,store.state.settings);
  if(metadata.width!==1080||metadata.height!==1920||metadata.fps!==FPS||!metadata.hasAudio||Math.abs(metadata.duration-duration)>.1)throw new StudioError('Video '+styleLabel+' không đạt kiểm tra đầu ra.','NEWS_OUTPUT_VALIDATION_FAILED',500);
  update(98,'Đang kiểm tra video '+styleLabel);
  const media=await importMedia(store,output,{projectId:job.projectId,name:safeName(job.name||'News broadcast')+'.mp4',generated:true,move:true,jobId:job.id,mediaType:'news-video',newsOutputDirectory:job.production?.newsOutputDirectory||null});
  const result=store.patch('media',media.id,{newsPresenterMediaId:presenter.id,newsVisualCount:usable.length,newsPhotoCount:usable.filter(image=>image.visualRole!=='source-card').length,newsSourceCardCount:usable.filter(image=>image.visualRole==='source-card').length,newsImageMediaIds:usable.map(i=>i.id),newsTargetDuration:plan.newsDuration||'auto',newsRenderStyle:style,renderDevice:device,renderPipeline:style==='v4'?'v4-single-pass':'v3-single-pass',newsCaptionTiming:captions.method,newsCaptionWarning:captions.warning,newsCaptionCues:captions.cues,newsPhotoCredits:credits,newsRenderMetrics:{seconds:(performance.now()-started)/1000,encodeSeconds,captionCacheHit:Boolean(captions.cached),frames:photo.totalFrames},newsLayout:{preset:layout.id,hero:HERO,rectangles,text:typography.audit,shots:photo.shots,transitions:photo.transitions}});
  if(store.state.jobs.some(j=>j.id===job.id))store.patch('jobs',job.id,{newsRenderStyle:style,newsCaptionTiming:captions.method,newsCaptionWarning:captions.warning});
  return result;
 }finally{
  const resolved=path.resolve(directory);if(resolved.startsWith(tempRoot+path.sep))await fs.rm(resolved,{recursive:true,force:true}).catch(()=>{});
 }
}
