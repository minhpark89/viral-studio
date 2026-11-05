import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { productionRequestSchema } from '../shared/production-contracts.js';
import { newsPlanSchema } from '../server/news-plan.js';
import { newsImageTarget } from '../shared/news-format.js';
import { Store } from '../server/store.js';
import { alignNewsWords, groupNewsCaptions, whisperWords } from '../server/news-captions.js';
import { createNewsTypography } from '../server/news-typography.js';
import { v3PhotoGraph } from '../server/news-v3-motion.js';
import { newsV3Editorial, newsPhotoCaption } from '../server/news-v3-editorial.js';

test('new News requests default to V3 and reject an unsupported renderer',()=>{
 const base={requestId:randomUUID(),projectId:randomUUID(),contentType:'news',topic:'space research'};
 assert.equal(productionRequestSchema.parse(base).newsRenderStyle,'v3');
 for(const style of ['v3','v3-fast','classic'])assert.equal(productionRequestSchema.parse({...base,newsRenderStyle:style}).newsRenderStyle,style);
 assert.throws(()=>productionRequestSchema.parse({...base,newsRenderStyle:'unknown'}));
 assert.equal(newsPlanSchema.parse({headline:'A verified source headline',narration:'The city published a report. Read the full story through the link in the first comment.',imageMediaIds:[randomUUID()]}).newsRenderStyle,'v3');
 assert.deepEqual(['auto',15,20,30].map(duration=>newsImageTarget(duration)),[8,6,8,10]);
});

test('upgrading a saved workspace preserves old styles, IDs and presenter reuse',async t=>{
 const root=path.resolve('.verification','v3-migration-'+randomUUID());t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new Store(root),project=store.createProject('Upgrade test'),presenterId=randomUUID();
 const job=store.add('jobs',{projectId:project.id,type:'news',status:'failed',payload:{presenterMediaId:presenterId,newsPlan:{headline:'Saved headline'}}});
 const batch=store.add('productionBatches',{projectId:project.id,request:{contentType:'news'},items:[{newsPlan:{headline:'Saved headline'}},{newsPlan:{newsRenderStyle:'v3-fast'}}]});
 const reloaded=new Store(root),saved=reloaded.require('jobs',job.id);
 assert.equal(saved.payload.presenterMediaId,presenterId);assert.equal(saved.status,'failed');assert.equal(saved.payload.newsPlan.newsRenderStyle,'classic');
 assert.equal(reloaded.require('productionBatches',batch.id).request.newsRenderStyle,'classic');
 assert.equal(reloaded.require('productionBatches',batch.id).items[1].newsPlan.newsRenderStyle,'v3-fast');
 const second=new Store(root);assert.deepEqual(second.require('jobs',job.id),saved);
});

test('caption timing preserves reviewed words even when ASR mishears a name or number',()=>{
 const script='Donald Trump met officials in Port Huron with 20 guests.';
 const spoken='Donald Trump met officials in Fort Huron with twenty guests.'.split(' ').map((text,index)=>({text,start:index*.4,end:index*.4+.3}));
 const result=alignNewsWords(script,spoken,5);assert.equal(result.method,'aligned');assert.ok(result.coverage>.6);
 const cues=groupNewsCaptions(result.words,5);assert.equal(cues.map(c=>c.text).join(' '),script);
 assert.ok(cues.every((c,i)=>c.end>c.start&&c.start>=0&&c.end<=5&&(!i||c.start>=cues[i-1].end)));
 const fallback=alignNewsWords(script,[{text:'unrelated',start:0,end:1}],5);
 assert.equal(fallback.method,'estimated');assert.equal(fallback.words.map(w=>w.text).join(' '),script);
});

test('Whisper token normalization joins split words, drops control tokens and invalid offsets',()=>{
 const tokens=[{text:'[_BEG_]',offsets:{from:0,to:0}},{text:' Port',offsets:{from:100,to:250}},{text:' Hu',offsets:{from:260,to:360}},{text:'ron',offsets:{from:360,to:500}},{text:'.',offsets:{from:500,to:510}},{text:' invalid',offsets:{from:-1,to:3}}];
 assert.deepEqual(whisperWords({transcription:[{tokens}]},2).map(w=>w.text),['Port','Huron.']);
});

test('names stay in one caption and a missing full stop does not start the CTA early',()=>{
 const script='President Donald Trump rallied Michigan Republicans in Port Huron. The initial report does not detail his remarks Read the full story through the link in the first comment.';
 const recognized=script.split(' ').map((text,i)=>({text,start:i*.5,end:i*.5+.4}));
 const aligned=alignNewsWords(script,recognized,20),cues=groupNewsCaptions(aligned.words,20);
 assert.ok(cues.some(c=>c.text.includes('Port Huron')));assert.ok(!cues.some(c=>/Port$/.test(c.text)));
 const editorial=newsV3Editorial({headline:'Michigan rally',narration:script},aligned,20);
 const expected=recognized.find(w=>w.text==='Read').start;
 assert.equal(editorial.beats.at(-1).start,expected);assert.ok(editorial.beats.at(-1).start>editorial.beats[1].start);
});

test('V3 preserves total frame count with 1, 8 and 10 photos and a fixed 300ms dissolve',()=>{
 for(const [count,duration]of [[1,15],[8,18.5],[10,30]])for(const style of ['v3','v3-fast']){
  const graph=v3PhotoGraph(Array.from({length:count},(_,i)=>({file:`photo-${i}.jpg`})),duration,{style});
  assert.equal(graph.totalFrames,Math.round(duration*30));assert.equal(graph.transitions.length,count-1);
  assert.ok(graph.transitions.every(t=>t.endFrame-t.startFrame===9));
  assert.equal(graph.shots[0].labelStart,0);assert.equal(graph.shots.at(-1).labelEnd,duration);
  assert.ok(graph.shots.every((s,i)=>!i||s.labelStart===graph.shots[i-1].labelEnd));
  assert.ok(graph.shots.every(s=>s.zoomPercent<=1.8));
  if(style==='v3-fast')assert.ok(graph.shots.every(s=>s.motion==='static'));
 }
 const graph=v3PhotoGraph([{file:'source-card.png',visualRole:'source-card'}],15);
 assert.equal(graph.shots[0].motion,'static');
 assert.throws(()=>v3PhotoGraph(Array.from({length:10},()=>({file:'x.jpg'})),15));
});

test('editorial labels use the current story and do not invent dates, live status or CTA claims',()=>{
 const plan={headline:'The city released a transport report',narration:'The city released its full report. Read the full story through the link in the first comment.',source:'City News'};
 const captions=alignNewsWords(plan.narration,[],15),result=newsV3Editorial(plan,captions,15);
 assert.equal(result.date,'');assert.equal(result.edition,'U.S. NEWS');assert.equal(result.dateline,'NEWS BRIEF');
 assert.equal(result.beats[0].title,'TOP STORY');assert.equal(result.beats.at(-1).title,'FULL REPORT');
 assert.doesNotMatch(JSON.stringify(result),/TRUMP|MICHIGAN|DESIGN REVIEW|BREAKING|LIVE/);
 assert.match(newsPhotoCaption({capturedAt:'2019-08-23',attribution:'Author',license:'CC BY 4.0'},'photo').label,/FILE.*2019/);
 assert.equal(newsPhotoCaption({newsContextOnly:false},'photo').label,'SOURCE IMAGE');
 assert.match(newsPhotoCaption({visualRole:'source-card'},'source-card').label,/NO EVENT PHOTO/);
});

test('bundled font measurement fits long headlines and preserves Unicode/punctuation without clipping',async t=>{
 const root=path.resolve('.verification','v3-fonts-'+randomUUID());await fs.mkdir(root,{recursive:true});t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const fontStyle of ['news','viral','minimal']){
  const typography=await createNewsTypography(root,fontStyle);
  const original='A COMPLETE HEADLINE: OFFICIALS ANNOUNCE A NEW TRANSPORT PLAN';
  const fit=await typography.fit('headline',original,{font:'headline',size:64,min:36,width:606,lines:4});
  assert.equal(fit.text.replaceAll('\n',' '),original);assert.ok(fit.widths.every(w=>w<606));
  const caption='20% — “Reviewed words” in Port Huron: $100.';
  const text=await typography.fit('caption',caption,{size:47,min:34,width:826,lines:2});
  assert.equal(text.text.replaceAll('\n',' '),caption);
 }
});
