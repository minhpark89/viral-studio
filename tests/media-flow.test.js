import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { ProductionService } from '../server/production.js';
import { rankNewsImages } from '../server/news-plan.js';
import { mediaLibraryGroup, selectableMcImages, jobOutput } from '../shared/output-media.js';
import { researchSourceDates, matchesSourceAge, sourceDateLabel, outputContext } from '../shared/source-context.js';

test('library and MC picker separate Page avatars, hosts, raw presenters and final videos', () => {
  const media = [
    { id:'page',kind:'image',mediaType:'page-avatar',generated:true },
    { id:'legacy',kind:'image',name:'AI Page Avatar 2026.png',generated:true },
    { id:'mc',projectId:'p',kind:'image',mediaType:'news-mc' },
    { id:'editorial',projectId:'p',kind:'image',mediaType:'news-editorial' },
    { id:'upload',projectId:'p',kind:'image' },
    { id:'foreign',projectId:'other',kind:'image',mediaType:'news-mc' },
    { id:'raw',projectId:'p',kind:'video',generated:true,mediaType:'news-presenter',jobId:'j' },
    { id:'final',projectId:'p',kind:'video',generated:true,mediaType:'news-video',jobId:'j' },
  ];
  const data = { media, jobs:[{ id:'j',type:'news',mediaId:'final',payload:{ presenterMediaId:'raw' } }] };
  assert.deepEqual(media.map(m=>mediaLibraryGroup(m,data)), ['page-avatar','page-avatar','mc-image','assets','assets','mc-image','presenter','finished']);
  assert.deepEqual(new Set(selectableMcImages(data,'p').map(m=>m.id)), new Set(['mc','upload']));
  assert.equal(jobOutput(data.jobs[0],media,data.jobs).id,'final');
  assert.equal(jobOutput({id:'j',mediaId:'raw'},media,data.jobs).id,'final');
});

test('source age is based on publication dates, independently of a fresh render or saved record', () => {
  const now=Date.parse('2026-11-01T12:00:00Z');
  const old={ id:'r',createdAt:'2026-11-01T11:00:00Z',articles:[{publishedAt:'2026-10-27T12:00:00Z'},{publishedAt:null}] };
  assert.equal(matchesSourceAge(old,'24h',now),false);
  assert.equal(matchesSourceAge(old,'older',now),true);
  assert.match(sourceDateLabel(old,now),/5 ngày trước/);
  assert.match(sourceDateLabel(old,now),/chưa rõ ngày/);
  assert.equal(matchesSourceAge({articles:[{}]},'unknown',now),true);
  const mixed={articles:[{publishedAt:'2026-10-27T12:00:00Z'},{publishedAt:'2026-11-01T10:00:00Z'}]};
  assert.equal(matchesSourceAge(mixed,'24h',now),true);
  assert.equal(researchSourceDates(mixed).oldest,Date.parse('2026-10-27T12:00:00Z'));
  const context=outputContext({id:'m',jobId:'j',production:{researchId:'r'}},{ researchResults:[old],jobs:[{id:'j',finishedAt:'2026-11-01T12:00:00Z'}] });
  assert.equal(context.renderedAt,'2026-11-01T12:00:00Z');
  assert.equal(context.research,old);
});

test('image ranking checks article photos too and never appends rejected candidates', async () => {
  const candidates=[{id:'article:rally',title:'Rally today'},{id:'article:airport',title:'Airport disruption'},{id:'commons:halloween',title:'Halloween costume'}];
  let received;
  const chosen=await rankNewsImages({}, {headline:'Rally',script:'The rally took place today.',articles:[]}, candidates, {llm:async(_s,_prompt,input)=>{received=input;return {selectedImageIds:['article:rally','invented','article:rally']};}});
  assert.equal(received.candidates.length,3);
  assert.deepEqual(chosen,[candidates[0]]);
  assert.deepEqual(await rankNewsImages({}, {}, candidates, {llm:async()=>({selectedImageIds:[]})}),[]);
  await assert.rejects(()=>rankNewsImages({}, {}, candidates, {llm:async()=>({invalid:true})}),error=>error.code==='IMAGE_RANKING_FAILED');
});

test('one batch isolates simultaneous stories while same-story variations share verified images', async t => {
  const root=path.resolve('.verification',`media-scope-${randomUUID()}`);
  const store=new Store(root);
  const project=store.createProject('Media scope');
  const queue=new JobQueue(store,{}, {intervalMs:0});
  const service=new ProductionService(store,queue,{imageSearch:async()=>{throw new Error('No external search');}});
  t.after(async()=>{await service.close();await queue.close();await fs.rm(root,{recursive:true,force:true});});
  const make=(name)=>{
    const images=Array.from({length:5},(_,i)=>store.add('media',{projectId:project.id,kind:'image',name:`${name} image ${i}`,file:`${name}-${i}.png`}));
    const research=store.add('researchResults',{projectId:project.id,headline:name,topic:name,articles:[],imageMediaIds:images.map(m=>m.id)});
    return {images,research};
  };
  const a=make('Space'),b=make('Economy');
  const avatar=store.add('media',{projectId:project.id,kind:'image',mediaType:'news-mc',name:'MC'});
  const pageAvatar=store.add('media',{kind:'image',mediaType:'page-avatar',name:'Page'});
  b.research.imageMediaIds.push(avatar.id,pageAvatar.id);
  const batch=store.add('productionBatches',{projectId:project.id,status:'failed',request:{},items:[],newsImageMediaIds:a.images.map(m=>m.id)});
  const request={projectId:project.id,avatarMediaId:avatar.id};
  const rankings=[];
  const llm=async(_s,_prompt,input)=>{rankings.push({headline:input.headline,ids:input.candidates.map(c=>c.id)});await delay(25);return {selectedImageIds:input.candidates.map(c=>c.id)};};
  const plan=name=>({headline:name,narration:`Verified ${name} report`,imageQueries:[]});
  const [a1,b1,a2]=await Promise.all([
    service.prepareNewsMedia(batch,request,a.research,plan('Space'),llm),
    service.prepareNewsMedia(batch,request,b.research,plan('Economy'),llm),
    service.prepareNewsMedia(batch,request,a.research,plan('Space'),llm),
  ]);
  // Ranking may split a story into bounded groups. Every candidate must still
  // be reviewed exactly once per story, even with simultaneous same-story calls.
  assert.deepEqual([...new Set(rankings.map(call=>call.headline))].sort(),['Economy','Space']);
  for(const [headline,story] of [['Space',a],['Economy',b]]) {
    assert.deepEqual(rankings.filter(call=>call.headline===headline).flatMap(call=>call.ids).sort(),story.images.map(m=>'media:'+m.id).sort());
  }
  assert.deepEqual(a1.imageMediaIds,a.images.map(m=>m.id));
  assert.deepEqual(b1.imageMediaIds,b.images.map(m=>m.id));
  assert.deepEqual(a1,a2);
  assert.equal(a1.imageMediaIds.some(id=>b1.imageMediaIds.includes(id)),false);
  assert.equal(service.newsMediaPromises.size,0);
  const callsBeforeCache=rankings.length;
  await service.prepareNewsMedia(batch,request,b.research,plan('Economy'),llm);
  assert.equal(rankings.length,callsBeforeCache,'Verified same-story cache should be reused');
  assert.throws(()=>queue.enqueueNews({projectId:project.id,plan:{avatarMediaId:avatar.id},imageMediaIds:[avatar.id]}),error=>error.code==='INVALID_EDITORIAL_IMAGE');
  assert.throws(()=>queue.enqueueNews({projectId:project.id,plan:{},imageMediaIds:[pageAvatar.id]}),error=>error.code==='INVALID_EDITORIAL_IMAGE');
});
