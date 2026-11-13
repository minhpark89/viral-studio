import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';
import { ProductionService } from '../server/production.js';
import { retryFailedSelection } from '../server/queue-retry.js';
import { newsVariantContext, selectNewsVariant, similarNarration } from '../server/news-variants.js';
import { loadNewsSource, googlePublisherFromRpc, parseNewsDocument } from '../server/news-source.js';
import { writeNewsNarration, rankNewsImages } from '../server/news-plan.js';
import { v3PhotoGraph } from '../server/news-v3-motion.js';
import { safeProviderMessage } from '../server/dreamface-diagnostics.js';
import { changePhase } from '../shared/job-timing.js';

async function fixture(t, options = {}) {
  const root = path.resolve('.verification', `news-quality-${randomUUID()}`), store = new Store(root), project = store.createProject('News quality');
  store.state.settings.queuePaused = true; store.state.settings.llm.enabled = true;
  const queue = new JobQueue(store, {}, { intervalMs:0 });
  const service = new ProductionService(store, queue, { sourceLoader:async research=>({articles:research.articles || [],warnings:[]}), imageSearch:async()=>({images:[],warnings:[]}), fetchImpl:async()=>{throw Error('No network in fixture')}, ...options });
  t.after(async()=>{await service.close();await queue.close();await fs.rm(root,{recursive:true,force:true})});
  return { root, store, project, queue, service };
}

test('bulk retry reuses an existing MC without confirmation and ignores a repeated request', async t => {
  const f = await fixture(t), file = path.join(f.root, 'mc.mp4'); await fs.writeFile(file, 'existing MC');
  const mc = f.store.add('media', {projectId:f.project.id,kind:'video',file});
  const job = f.store.add('jobs', {projectId:f.project.id,type:'news',name:'Failed render',status:'failed',submittedAt:new Date().toISOString(),payload:{presenterMediaId:mc.id,newsPlan:{},imageMediaIds:[]}});
  const request = {projectId:f.project.id,jobIds:[job.id,job.id]};
  const first = retryFailedSelection(f.store,f.queue,f.service,request);
  assert.equal(first.queued,1); assert.equal(first.results[0].action,'render');
  const child=f.store.require('jobs',first.results[0].jobId); assert.equal(child.payload.presenterMediaId,mc.id);
  assert.equal(retryFailedSelection(f.store,f.queue,f.service,request).queued,0);
  assert.equal(f.store.state.jobs.length,2);
});

test('bulk retry recovers confirmed requests, blocks ambiguity, scopes project, and skips superseded failures', async t => {
  const f=await fixture(t), other=f.store.createProject('Other');
  const add=(extra={})=>f.store.add('jobs',{projectId:f.project.id,type:'news',status:'failed',payload:{},...extra});
  const known=add({payload:{newsAvatarRequest:{id:'provider-task',profileId:'profile',submittedAt:new Date().toISOString()}}});
  const unknown=add({submittedAt:new Date().toISOString(),payload:{newsAvatarRequest:{submittedAt:new Date().toISOString()}}});
  const old=add(), child=add({retryOf:old.id,status:'completed'}), foreign=add({projectId:other.id});
  const fresh=add();
  const result=retryFailedSelection(f.store,f.queue,f.service,{projectId:f.project.id,jobIds:[known.id,unknown.id,old.id,child.id,foreign.id,fresh.id]});
  assert.equal(result.queued,2);assert.equal(result.review,1);assert.equal(result.skipped,3);
  assert.equal(known.status,'queued');assert.equal(known.payload.recoverSubmitted,true);assert.equal(unknown.status,'failed');
  assert.equal(f.store.state.jobs.filter(job=>job.retryOf===unknown.id).length,0);
});

test('bulk retry queues only explicitly selected preparation slots and respects paused queue', async t => {
  const f=await fixture(t); f.service.kick=()=>{};
  const batch=f.store.add('productionBatches',{projectId:f.project.id,request:{},items:[{index:0,status:'needs_assets'},{index:1,status:'failed'}]});
  const result=retryFailedSelection(f.store,f.queue,f.service,{projectId:f.project.id,preparations:[{batchId:batch.id,index:0}]});
  assert.equal(result.queued,1);assert.equal(batch.items[0].status,'pending');assert.equal(batch.items[1].status,'failed');assert.equal(f.store.state.settings.queuePaused,true);
});

test('missing MC file and ambiguous receipt cannot trigger another paid generation',async t=>{
 const f=await fixture(t),mc=f.store.add('media',{projectId:f.project.id,kind:'video',file:path.join(f.root,'missing.mp4')});
 const missing=f.store.add('jobs',{projectId:f.project.id,type:'news',status:'failed',payload:{presenterMediaId:mc.id}});
 const ambiguous=f.store.add('jobs',{projectId:f.project.id,type:'news',status:'failed',payload:{newsAvatarRequest:{submittedAt:new Date().toISOString()}}});
 const result=retryFailedSelection(f.store,f.queue,f.service,{projectId:f.project.id,jobIds:[missing.id,ambiguous.id]});
 assert.equal(result.queued,0);assert.equal(result.review,2);assert.equal(f.store.state.jobs.length,2);
 assert.throws(()=>f.queue.retry(ambiguous.id,false),{code:'CONFIRM_RESUBMIT'});
});

test('phase totals close once and provider notices redact account details',()=>{
 const record={};changePhase(record,'mc',1000);changePhase(record,'mc',2000);changePhase(record,'download',4000);changePhase(record,null,5000);
 assert.deepEqual(record.phaseTimings,{mc:3000,download:1000});assert.equal(record.phaseStartedAt,null);
 const notice=safeProviderMessage('Quota for user@example.com Bearer secret123 https://provider.test/?token=secret sk-abcdefghijk');
 assert.doesNotMatch(notice,/user@|secret|provider.test|abcdefghijk/);
});

test('Google RSS resolves through public response and extracts article text and gallery', async () => {
  const requests=[], publisher='https://publisher.example/story';
  const options={lookup:async()=>[{address:'93.184.215.14',family:4}],fetchImpl:async(url,init)=>{
    requests.push({url,method:init.method || 'GET'});
    if(url.includes('batchexecute'))return new Response(")]}'\n\n"+JSON.stringify([['wrb.fr','Fbv4je',JSON.stringify(['garturlres',publisher]),null,null,null,'0']]));
    if(url.includes('news.google.com'))return new Response('<div data-n-a-sg="signature" data-n-a-ts="1700000000"></div>',{headers:{'content-type':'text/html'}});
    return new Response('<meta property="og:image" content="/wide.jpg"><article><p>'+('Confirmed reporting about Alice Nguyen and the named town. '.repeat(10))+'</p><figure><img src="/town.jpg" alt="The named town"></figure></article>',{headers:{'content-type':'text/html'}});
  }};
  const source=await loadNewsSource({url:'https://news.google.com/rss/articles/CBMiQVVub3BhcXVl',title:'Named town update'},options);
  assert.equal(source.url,publisher);assert.equal(source.sourceRead.status,'full');assert.equal(source.sourceImages.length,2);assert.equal(requests.length,3);
  assert.throws(()=>googlePublisherFromRpc('[]'));
});

test('publisher redirects cannot fetch a private address; failed source stays explicit', async()=>{
  let calls=0;
  const source=await loadNewsSource({url:'https://publisher.example/story',title:'RSS title',summary:'RSS only'}, {lookup:async()=>[{address:'93.184.215.14'}],fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}});
  assert.equal(calls,1);assert.equal(source.sourceRead.status,'unavailable');assert.equal(source.summary,'RSS only');assert.equal(source.sourceImages.length,0);
});

test('source parser ignores scripts and uses the matching article body',()=>{
  const doc=parseNewsDocument('<script type="application/ld+json">{"@type":"NewsArticle","url":"https://p.test/other","articleBody":"wrong"}</script><article><p>Confirmed source.</p><aside>Unrelated sidebar</aside><script>injected</script></article>',{url:'https://p.test/story'});
  assert.equal(doc.text,'Confirmed source.');
});

test('two variants use different openings and at least half different photos when the pool permits',()=>{
  const pool=Array.from({length:12},(_,i)=>String(i));
  const a=selectNewsVariant(pool,1,{target:8}),b=selectNewsVariant(pool,2,{target:8,previous:[{imageMediaIds:a}]});
  assert.notEqual(a[0],b[0]);assert.equal(b.filter(id=>!a.includes(id)).length,4);
  assert.notDeepEqual(selectNewsVariant(['a','b'],1),selectNewsVariant(['a','b'],2));
  const batch={request:{},items:[{index:0,researchId:'a'},{index:1,researchId:'a'},{index:2,researchId:'b'},{index:3,researchId:'b'}]};
  assert.equal(newsVariantContext(batch,batch.items[3]).variation,2);assert.equal(newsVariantContext(batch,batch.items[3]).total,2);
  const photos=[{file:'a',width:1500,height:1000},{file:'b',width:1500,height:1000}];
  assert.notDeepEqual(v3PhotoGraph(photos,20,{visualVariant:1}).filters,v3PhotoGraph(photos,20,{visualVariant:2}).filters);
});

test('narration comparison excludes CTA and retries a repeated opening with previous versions',async()=>{
  const previous=[{narration:'Alice Nguyen announced the library opening today. The building has new reading rooms.'}];
  let calls=0;
  const narration=await writeNewsNarration({}, {headline:'Library opens',articles:[{title:'Library opens',summary:'Alice Nguyen opened the library with new reading rooms.'}]},{previous,variation:2,total:2,llm:async(_s,_prompt,input)=>{
    assert.equal(input.previousVersions.length,1);calls++;
    return {headline:'Library opens',summary:calls===1?'Alice Nguyen announced the library opening today. The rooms are now open.':'New reading rooms are now available at the library. Alice Nguyen announced its opening today.',imageQueries:['Alice Nguyen']};
  }});
  assert.equal(calls,2);assert.equal(similarNarration(narration.narration,previous),false);
});

test('review cache never turns a timeout into approval and retains explicit decisions',async()=>{
  const cache=new Map(),decisions=[], candidates=[{id:'a',title:'Alice Nguyen portrait'}];let calls=0;
  const options={reviewCache:cache,onDecision:d=>decisions.push(d),llm:async()=>{calls++;return {selectedImageIds:['a']}}};
  await rankNewsImages({}, {headline:'Alice Nguyen',articles:[]},candidates,options);
  await rankNewsImages({}, {headline:'Alice Nguyen',articles:[]},candidates,options);
  assert.equal(calls,1);assert.ok(decisions.some(d=>d.cached));
  await assert.rejects(rankNewsImages({}, {headline:'Other report'},candidates,{reviewCache:cache,llm:async()=>{throw Error('timeout')}}),{code:'IMAGE_RANKING_FAILED'});
  assert.equal(cache.size,1);
});

test('missing photos hold preparation before MC; explicit source-card opt-in can resume',async t=>{
  let cards=0,narrations=0;
  const f=await fixture(t,{llm:async(_p,input)=>{if(input.previousQueries)return {subjects:[]};narrations++;return {headline:'Library opened today',summary:'Alice Nguyen opened the public library today. Residents can use its new reading rooms.',imageQueries:[]}},sourceCard:async(store,research)=>{cards++;return store.add('media',{projectId:research.projectId,kind:'image',file:'source-card.png',visualRole:'source-card'})}});
  const research=f.store.add('researchResults',{projectId:f.project.id,headline:'Library',articles:[],warnings:[]});
  const batch=f.service.create({requestId:randomUUID(),projectId:f.project.id,contentType:'news',topic:'Library opening',researchId:research.id,count:1});
  await f.service.worker;
  assert.equal(batch.items[0].status,'needs_assets');assert.equal(f.store.state.jobs.length,0);assert.equal(cards,0);
  f.service.retry(batch.id,{indexes:[0],visualPolicy:'allow-source-card'});await f.service.worker;
  assert.equal(cards,1);assert.equal(batch.items[0].status,'queued');
  assert.equal(narrations,1);assert.ok(f.store.state.jobs[0].preparationTimings);
  const plan=f.store.state.jobs[0].payload.newsPlan;assert.equal(plan.photoCount,0);assert.equal(plan.sourceCardCount,1);
});

test('refreshing photos for an exported video preserves narration and MC and replaces actual image inputs',async t=>{
  const f=await fixture(t,{llm:async(_prompt,input)=>input.candidates?{selectedImageIds:input.candidates.map(i=>i.id)}:{subjects:[]}});
  const media=Array.from({length:8},(_,i)=>f.store.add('media',{projectId:f.project.id,kind:'image',file:`photo-${i}.jpg`,name:`Library view ${i}`}));
  const research=f.store.add('researchResults',{projectId:f.project.id,topic:'Library',headline:'Library opened today',articles:[],imageMediaIds:media.map(m=>m.id),warnings:[]});
  const mc=f.store.add('media',{projectId:f.project.id,kind:'video',file:'existing.mp4',hasAudio:true});
  const original=f.store.add('jobs',{projectId:f.project.id,type:'news',name:'Original',status:'completed',production:{researchId:research.id,autoCreateContent:true},payload:{presenterMediaId:mc.id,imageMediaIds:[media[0].id],newsPlan:{headline:'Library opened today',narration:'Alice Nguyen opened the public library today. Read the full story through the link in the first comment.',source:'City News',imageMediaIds:[media[0].id],variation:2,visualVariant:2,visualMode:'photo'}}});
  const repair=f.service.refreshJobImages(original.id);assert.equal(f.service.refreshJobImages(original.id).id,repair.id);
  await f.service.worker;
  assert.equal(repair.items[0].status,'queued',repair.items[0].error);
  const job=f.store.require('jobs',repair.items[0].jobId);
  assert.equal(job.payload.presenterMediaId,mc.id);assert.equal(job.payload.newsPlan.narration,original.payload.newsPlan.narration);assert.equal(job.payload.imageMediaIds.length,8);assert.equal(job.payload.newsPlan.visualVariant,2);assert.equal(job.production.autoCreateContent,false);assert.equal(original.status,'completed');
});

test('a batch gives each story its own variant numbers while overlapping preparation of independent stories',async t=>{
  let active=0,maxActive=0;
  const openings=['Alice Nguyen opened the library today. Residents now have more reading rooms.','New reading rooms welcomed residents as the library opened. Alice Nguyen attended the opening.'];
  const f=await fixture(t,{llm:async(_prompt,input)=>{
    if(input.candidates)return {selectedImageIds:input.candidates.map(i=>i.id)};
    if(input.previousQueries)return {subjects:[]};
    active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,20));active--;
    return {headline:'Library opened today',summary:openings[input.variation-1],imageQueries:[]};
  }});
  const research=Array.from({length:2},(_,i)=>f.store.add('researchResults',{projectId:f.project.id,topic:'Library',headline:`Library ${i}`,articles:[],imageMediaIds:Array.from({length:12},(_,j)=>f.store.add('media',{projectId:f.project.id,kind:'image',file:`${i}-${j}.jpg`,name:`Library ${i} view ${j}`}).id),warnings:[]}));
  const batch=f.service.create({requestId:randomUUID(),projectId:f.project.id,contentType:'news',topic:'Libraries',count:4,researchIds:[research[0].id,research[0].id,research[1].id,research[1].id]});
  await f.service.worker;
  assert.equal(batch.items.filter(i=>i.status==='queued').length,4,JSON.stringify(batch.items.map(i=>i.error)));
  assert.equal(maxActive,2);assert.deepEqual(batch.items.map(i=>i.newsPlan.variation),[1,2,1,2]);
  for(const offset of [0,2]){const a=batch.items[offset].newsPlan.imageMediaIds,b=batch.items[offset+1].newsPlan.imageMediaIds;assert.equal(b.filter(id=>!a.includes(id)).length,4)}
});
