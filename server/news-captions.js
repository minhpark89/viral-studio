import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { binary, runProcess } from './media.js';
import { cleanNewsText } from './news-render-common.js';

const normalized = text => text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function whisperWords(transcript, duration) {
  const words=[];
  for(const segment of transcript?.transcription || [])for(const token of segment.tokens || []){
    if(!token.text || token.text.startsWith('[_'))continue;
    const start=Number(token.offsets?.from)/1000,end=Number(token.offsets?.to)/1000;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start>=duration)continue;
    if(!/^\s/u.test(token.text)&&words.length){words.at(-1).text+=token.text;words.at(-1).end=Math.min(duration,Math.max(words.at(-1).end,end));}
    else words.push({text:token.text.trim(),start,end:Math.min(duration,end)});
  }
  return words.filter(w=>normalized(w.text));
}

// Keep the reviewed script verbatim. ASR supplies timing anchors only, so a
// recognition error can never change a person's name, number or quotation.
export function alignNewsWords(narration, recognized, duration) {
  const words=cleanNewsText(narration).split(' ').filter(Boolean),a=words.map(normalized),b=recognized.map(w=>normalized(w.text));
  const n=a.length,m=b.length;
  if(!n)return {words:[],method:'empty',coverage:0};
  const matrix=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=0;i<=n;i++)matrix[i][0]=i;for(let j=0;j<=m;j++)matrix[0][j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  const anchors=new Map();let i=n,j=m;
  while(i&&j){if(matrix[i][j]===matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1)){if(a[i-1]===b[j-1])anchors.set(i-1,recognized[j-1]);i--;j--;}else if(matrix[i][j]===matrix[i-1][j]+1)i--;else j--;}
  const coverage=anchors.size/n;
  if(coverage<.6){
    const weight=words.map(w=>Math.max(2,normalized(w).length)),total=weight.reduce((a,b)=>a+b,0),end=Math.max(.2,duration-.35);let cursor=0;
    return {method:'estimated',coverage,words:words.map((text,index)=>{const start=cursor;cursor+=end*weight[index]/total;return{text,start,end:cursor};})};
  }
  const aligned=words.map((text,index)=>anchors.has(index)?{text,start:anchors.get(index).start,end:anchors.get(index).end}:null);
  for(let first=0;first<n;){if(aligned[first]){first++;continue;}let last=first;while(last<n&&!aligned[last])last++;
    const start=first?aligned[first-1].end:0,end=last<n?aligned[last].start:Math.min(duration,(recognized.at(-1)?.end||duration));
    const step=Math.max(0,end-start)/(last-first);
    for(let index=first;index<last;index++)aligned[index]={text:words[index],start:start+step*(index-first),end:start+step*(index-first+1)};
    first=last;
  }
  let previous=0;
  for(const word of aligned){word.start=Math.min(duration-.01,Math.max(previous,word.start));word.end=Math.min(duration,Math.max(word.start+.01,word.end));previous=word.end;}
  return{words:aligned,method:'aligned',coverage};
}

export function groupNewsCaptions(words,duration){
  // Keep short consecutive proper-name tokens together across cue changes.
  const units=[];
  for(let i=0;i<words.length;i++){
    const unit={...words[i]};let count=1;
    while(count<4&&/^[A-Z][\p{L}'’.-]*$/u.test(words[i].text)&&!/[.!?]$/.test(words[i].text)&&i+1<words.length&&/^[A-Z][\p{L}'’.-]*[,!?]?$/u.test(words[i+1].text)){
      i++;count++;unit.text+=' '+words[i].text;unit.end=words[i].end;
    }
    units.push(unit);
  }
  const cues=[];let group=[];
  const flush=()=>{if(!group.length)return;cues.push({text:group.map(w=>w.text).join(' '),start:Math.max(0,group[0].start-.04),end:Math.min(duration,group.at(-1).end+.1)});group=[];};
  for(const word of units){if(group.length&&(group.reduce((n,w)=>n+w.text.split(' ').length,0)+word.text.split(' ').length>8||(group.map(w=>w.text).join(' ')+' '+word.text).length>66))flush();group.push(word);if(/[.!?]["'”)]?$/u.test(word.text))flush();}flush();
  for(let i=0;i<cues.length-1;i++)cues[i].end=Math.min(cues[i+1].start,Math.max(cues[i].end,cues[i+1].start-.05));
  return cues.filter(c=>c.end>c.start);
}

async function captionRuntime(){
 const roots=[process.resourcesPath&&path.join(process.resourcesPath,'news-captions'),path.resolve(import.meta.dirname,'../runtime/news-captions')].filter(Boolean);
 for(const directory of roots){const executable=path.join(directory,process.platform==='win32'?'whisper-cli.exe':'whisper-cli'),model=path.join(directory,'ggml-base.en.bin');if(await fs.stat(executable).catch(()=>null)&&await fs.stat(model).catch(()=>null))return{executable,model};}
 return null;
}

export async function createNewsCaptions(store,presenter,narration,duration,directory,signal,update=()=>{}){
 signal.throwIfAborted();
 const stat=await fs.stat(presenter.file),key=createHash('sha256').update(JSON.stringify([2,presenter.id,presenter.file,stat.size,stat.mtimeMs,narration,duration])).digest('hex');
 const existing=presenter.newsCaptionCache;
 if(existing?.key===key&&existing.method==='aligned')return{...existing,cached:true};
 const runtime=await captionRuntime();let transcript=null,reason='';
 if(runtime){
  update(4,'Đang căn phụ đề theo lời đọc');
  try{
   const wav=path.join(directory,'voice-16k.wav'),output=path.join(directory,'alignment');
   await runProcess(binary('ffmpeg',store.state.settings),['-hide_banner','-v','error','-y','-nostdin','-i',presenter.file,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{signal,timeout:60000});
   await runProcess(runtime.executable,['-m',runtime.model,'-f',wav,'-l','en','-ojf','-of',output,'-t',String(Math.max(1,Math.min(4,Number(store.state.settings.renderThreads)||2))),'-ng'],{signal,timeout:Math.max(60000,Math.ceil(duration*5000))});
   transcript=JSON.parse(await fs.readFile(output+'.json','utf8'));
  }catch(error){signal.throwIfAborted();reason='Không căn được lời đọc tự động; phụ đề dùng thời gian ước lượng.';}
 }else reason='Chưa có bộ căn lời đọc offline; phụ đề dùng thời gian ước lượng.';
 const aligned=alignNewsWords(narration,whisperWords(transcript,duration),duration);
 const result={key,cues:groupNewsCaptions(aligned.words,duration),words:aligned.words,method:aligned.method,coverage:aligned.coverage,warning:aligned.method==='aligned'?'':reason||'Lời đọc chưa khớp đủ với kịch bản; thời gian phụ đề được ước lượng.'};
 if(presenter.id&&store.state.media.some(m=>m.id===presenter.id))store.patch('media',presenter.id,{newsCaptionCache:result});
 return result;
}
