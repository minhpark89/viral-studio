import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.js';
import {JobQueue} from '../server/queue.js';
import {ProductionService} from '../server/production.js';
import {checkNewsOutput, newsOutputSettings} from '../server/news-output.js';
import {productOutputSettings} from '../server/product-output.js';
import {binary,runProcess,importMedia} from '../server/media.js';
import {renderTimeline} from '../server/render.js';
import {aiVideoPlan,aiSearchQuery} from '../server/product-research/ai-video.js';
import {ResearchProviders} from '../server/product-research/providers.js';
import {ProductResearch} from '../server/product-research/service.js';
import {ResearchRepository} from '../server/product-research/repository.js';
import {evidence} from '../server/product-research/evidence.js';
import {researchStorage,clearResearchCache} from '../server/product-research/storage.js';
import {productStudioRequest,productCreativeDirection} from '../shared/product-contracts.js';
import {composeProductStudy} from '../server/product-intelligence.js';

function fixture(){const store=new Store(path.resolve('.verification',`news-ai-${randomUUID()}`));store.state.settings.queuePaused=true;return {store,project:store.createProject('News and AI QA')};}
const record=()=>evidence({provider:'serpapi_social',platform:'instagram',kind:'video',externalId:'example',url:'https://www.instagram.com/reel/example/',title:'Jesus wall art CGI product showcase',description:'Framed art product animation',observedAt:new Date().toISOString(),metrics:{},measurement:'search_index'});

test('News output validates early, freezes per batch and does not alter Product default',async t=>{
 const {store,project}=fixture(),queue=new JobQueue(store,{}, {intervalMs:0});store.state.settings.llm.enabled=true;
 const service=new ProductionService(store,queue);service.drain=async()=>{};
 t.after(async()=>{await service.close();await queue.close();});
 const initial=productOutputSettings(store).defaultDirectory;
 assert.equal(newsOutputSettings(store).defaultDirectory,path.join(store.root,'exports'));
 assert.throws(()=>checkNewsOutput(store,'relative'),/đường dẫn/);
 const invalid=path.join(store.root,'temp','file.txt');fs.writeFileSync(invalid,'keep');
 const request={requestId:randomUUID(),projectId:project.id,contentType:'news',topic:'Science news',newsOutputDirectory:invalid};
 assert.throws(()=>service.create(request),/Không ghi/);assert.equal(store.state.productionBatches.length,0);
 const first=path.join(store.root,'news-a'),second=path.join(store.root,'news-b');store.state.settings.newsOutputDirectory=first;
 request.newsOutputDirectory='';const batch=service.create(request);
 store.state.settings.newsOutputDirectory=second;
 assert.equal(service.create(request).id,batch.id);assert.equal(batch.outputDirectory,first);
 const manual=service.create({...request,requestId:randomUUID(),newsOutputDirectory:path.join(store.root,'manual-news')});
 assert.equal(manual.outputDirectory,path.join(store.root,'manual-news'));
 assert.equal(productOutputSettings(store).defaultDirectory,initial);assert.equal(productOutputSettings(store).newsDirectory,second);
});

test('Real News MP4 export lands in its frozen folder; raw clips and Product remain separate',async t=>{
 const {store,project}=fixture(),queue=new JobQueue(store,{}, {intervalMs:0});t.after(()=>queue.close());
 const file=path.join(store.root,'temp','clip.mp4');await runProcess(binary('ffmpeg',store.state.settings),['-y','-f','lavfi','-i','testsrc2=size=120x160:rate=12','-t','1','-c:v','libx264','-threads','1',file]);
 const input=await importMedia(store,file,{projectId:project.id});
 const timeline={...project.timeline,resolution:480,quality:'draft',clips:[{id:randomUUID(),mediaId:input.id,inSec:0,outSec:1}],texts:[],images:[],music:null};
 const directory=path.join(store.root,'Chosen News');store.state.settings.newsOutputDirectory=directory;
 const job=queue.enqueueRender({projectId:project.id,timeline},{production:{contentType:'news',autoCreateContent:false}});
 store.state.settings.newsOutputDirectory=path.join(store.root,'Later');
 const result=await renderTimeline(store,job,new AbortController().signal,()=>{});
 assert.equal(path.dirname(result.file),directory);assert.equal(result.mediaType,'news-video');assert.ok(result.duration>=.95);
 const broadcast=await importMedia(store,file,{projectId:project.id,generated:true,mediaType:'news-video',newsOutputDirectory:directory});
 assert.equal(path.dirname(broadcast.file),directory);assert.notEqual(broadcast.file,result.file);
 const product=await importMedia(store,file,{projectId:project.id,generated:true,mediaType:'product-video'});
 assert.equal(path.dirname(product.file),path.join(store.root,'exports','products','final'));
});

test('AI feasibility never labels provenance or virality as verified; filmed testimonials remain unconfirmed',()=>{
 const r=record(),ai=aiVideoPlan(r);assert.equal(ai.suitable,true);assert.equal(ai.evidence,'source_mentions_ai');assert.match(ai.label,/chưa xác minh/);assert.equal(ai.style,'ai-room');
 assert.equal(aiVideoPlan({...r,title:'Mug mockup product showcase',description:''}).evidence,'style_candidate');
 const filmed=aiVideoPlan({...r,title:'Unboxing: real customer testimonial',description:''});assert.equal(filmed.suitable,false);assert.match(filmed.limitation,/không dựng lời chứng thực/);
 assert.equal(aiVideoPlan({...r,kind:'product'}),null);
});

test('AI search changes only short video query, keeps keyword relevance and uses one API call without silent retries',async()=>{
 const calls=[],provider=new ResearchProviders({now:Date.now},()=>({}));
 provider.serp=async params=>{calls.push(params);return {body:{short_video_results:[{title:'Jesus wall art CGI',link:'https://www.instagram.com/reel/example/'}]},observedAt:new Date().toISOString(),cached:false};};
 const request={keywords:'Jesus wall art',videoGoal:'no-filming',limit:10};
 const result=await provider.scan('social',request,new AbortController().signal);
 assert.equal(calls.length,1);assert.equal(calls[0].q,aiSearchQuery(request.keywords));assert.equal(result.records.length,1);assert.equal(result.records[0].metrics.views ?? null,null);
 await provider.scan('ads',request,new AbortController().signal);assert.equal(calls[1].q,'Jesus wall art');
 await provider.scan('social',{...request,aiVideoKeywords:'product animation CGI'},new AbortController().signal);assert.equal(calls[2].q,'product animation CGI');
});

test('AI research transfers image-only production intent and recipes; history survives restart and cache clear',async t=>{
 const {store,project}=fixture(),providers={scan:async()=>({records:[record()]})};let service=new ProductResearch(store,{providers,schedule:false});
 t.after(()=>service.close());
 const scan=service.start({requestId:randomUUID(),projectId:project.id,keywords:'Jesus wall art',videoGoal:'no-filming',sources:['social']});
 await service.running.get(scan.id);const result=service.scan(scan.id,project.id),draft=service.prepare(scan.id,project.id,[result.records[0].id]);
 assert.equal(draft.noFilming,true);assert.equal(draft.style,'ai-room');assert.match(draft.styleNotes,/Ảnh tranh/);
 assert.throws(()=>productStudioRequest.parse({...draft,requestId:randomUUID(),projectId:project.id}));
 const request=productStudioRequest.parse({...draft,productUrl:'https://example.com/products/jesus-art',requestId:randomUUID(),projectId:project.id});assert.equal(request.noFilming,true);
 for(let i=0;i<8;i++)assert.ok(['ai-showcase','ai-room','minimal','cinematic'].includes(productCreativeDirection('auto',i,true).id));
 service.repo.cache('temporary',{large:'response'},3600000);const ticket=service.repo.reserve('serpapi',{dailyLimit:10,monthlyLimit:20});service.repo.finishRequest(ticket,'completed',1);
 const dir=path.join(store.root,'product-research','previews');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'a'.repeat(64)+'.mp4'),Buffer.alloc(100));fs.writeFileSync(path.join(dir,'keep.txt'),'keep');
 const exportFile=path.join(store.root,'exports','keep.mp4');fs.writeFileSync(exportFile,'keep-render');
 assert.equal(researchStorage(service,project.id).previewBytes,100);
 assert.throws(()=>clearResearchCache(service,randomUUID()),/not found|không/i);
 const storage=clearResearchCache(service,project.id);assert.equal(storage.previewBytes,0);assert.equal(storage.scans,1);assert.equal(service.repo.cached('temporary'),null);
 assert.equal(service.repo.usage('serpapi').daily,1);assert.equal(fs.readFileSync(exportFile,'utf8'),'keep-render');assert.equal(fs.readFileSync(path.join(dir,'keep.txt'),'utf8'),'keep');
 await service.close();service=new ProductResearch(store,{providers,schedule:false});
 assert.equal(service.scan(scan.id,project.id).shortlist.length,1);assert.equal(service.scan(scan.id,project.id).records[0].aiVideo.suitable,true);
});

test('An empty short-video search is cached as empty, while quota failures remain errors',async t=>{
 const {store}=fixture(),repo=new ResearchRepository(store.root);t.after(()=>repo.close());let calls=0;
 const provider=new ResearchProviders(repo,()=>({key:'test-only-key',dailyLimit:5,monthlyLimit:5}),{fetchResource:async()=>{calls++;return {bytes:Buffer.from(JSON.stringify({error:calls===1 ? "Google hasn't returned any results for this query." : 'Your account has run out of searches',search_metadata:{status:'Error'}})),type:'application/json'};}});
 const request={keywords:'niche without results',limit:10,videoGoal:'no-filming'},signal=new AbortController().signal;
 const first=await provider.scan('social',request,signal);assert.equal(first.records.length,0);
 const again=await provider.scan('social',request,signal);assert.equal(again.cached,true);assert.equal(calls,1);
 await assert.rejects(()=>provider.scan('social',{...request,keywords:'different query'},signal),/SerpApi/);assert.equal(calls,2);
});

test('Product planner receives explicit no-filming constraints even when a filmed reference style is selected',async()=>{
 const {store}=fixture();let received;
 const result=await composeProductStudy(store,{requestId:randomUUID(),duration:5,billingMode:'free',style:'ugc',noFilming:true},{product:{name:'Art'},source:{},analysis:{references:[]},videoResearch:{videos:[]}},
 {productImage:'fixture',llm:async(system,input)=>{received={system,input};return {summary:'Original image animation',concept:'A calm room reveal',scenes:[{purpose:'Show art',prompt:'Slow frontal push toward the unchanged supplied art in a softly lit room.',caption:'A gift of faith'}],cta:'Explore the artwork'};}});
 assert.match(received.system,/NO PHYSICAL PRODUCT TO FILM/);assert.equal(received.input.noFilming,true);assert.equal(result.analysis.scenes.length,1);
});
