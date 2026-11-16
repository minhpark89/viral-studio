import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { rankNewsImages, writeNewsNarration } from '../server/news-plan.js';
import { Store } from '../server/store.js';
import { ProductionService } from '../server/production.js';
import { preparationPhase } from '../shared/job-timing.js';
import { requestJsonContent } from '../server/llm.js';

const images = count => Array.from({length:count},(_,i)=>({id:`image-${i}`,title:`Norfolk Airport view ${i}`,imageUrl:`https://images.test/${i}.jpg`}));

test('image reviews overlap two small groups, preserve source order and stop downloading at the target',async()=>{
  let active=0,maximum=0,calls=0; const downloaded=[];
  const result=await rankNewsImages({}, {headline:'Norfolk Airport'}, images(48), {
    maxImages:14,
    llm:async(_store,_prompt,input)=>{
      calls++;active++;maximum=Math.max(maximum,active);
      await delay(input.candidates[0].id==='image-0'?30:5);active--;
      return {selectedImageIds:['foreign',...input.candidates.map(image=>image.id)]};
    },
    onBatch:async candidates=>{ downloaded.push(...candidates.slice(0,8));return downloaded.length>=8; },
  });
  assert.equal(maximum,2);assert.equal(calls,2);
  assert.deepEqual(downloaded.map(image=>image.id),images(8).map(image=>image.id));
  assert.equal(result.length,12);assert.ok(!result.some(image=>image.id==='foreign'));
});

test('expired image review does not split-retry or start more model calls',async()=>{
  const controller=new AbortController();let calls=0;
  const pending=rankNewsImages({}, {headline:'Norfolk Airport'}, images(48), {
    signal:controller.signal,
    llm:async(_store,_prompt,_input,{signal})=>{calls++;await delay(1000,null,{signal});return {selectedImageIds:[]};},
  });
  await delay(10);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,2);
});

test('a preparation deadline retains verified files, reports the limit and never approves unchecked images',async t=>{
  const root=path.resolve('.verification','preparation-speed-'+randomUUID());
  const store=new Store(root),project=store.createProject('Preparation speed');
  const service=new ProductionService(store,{}, {
    imageBudgetMs:70,
    imageSearch:async()=>({images:[],warnings:[]}),
    downloadImage:async({image})=>store.add('media',{kind:'image',projectId:project.id,name:image.title,sourceImageUrl:image.imageUrl}),
    fetchImpl:async()=>{throw Error('Unexpected network request');},
  });
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  const research=store.add('researchResults',{projectId:project.id,headline:'Norfolk Airport',articles:[{sourceRead:{}}],imageSearchResults:images(24)});
  const batch=store.add('productionBatches',{request:{},items:[],warnings:[]});let calls=0;const progress=[];
  const result=await service.prepareNewsMedia(batch,{projectId:project.id},research,{narration:'Norfolk Airport update'},async(_s,_p,input,{signal})=>{
    calls++;
    if(calls>2)await delay(1000,null,{signal});
    return {selectedImageIds:input.candidates.slice(0,1).map(image=>image.id)};
  },(message)=>progress.push(message));
  assert.equal(result.imageMediaIds.length,2);
  assert.equal(result.diagnostics.budgetExceeded,true);
  assert.equal(result.diagnostics.status,'partial');assert.equal(calls,4);
  assert.deepEqual(store.require('researchResults',research.id).imageMediaIds,result.imageMediaIds);
  assert.ok(progress.some(message=>message.includes('2/8')));
  assert.ok(result.diagnostics.elapsedMs<1000,'deadline prevents serial multi-minute retries');
});

test('batch remains preparing when another slot needs images or has failed',async t=>{
  const root=path.resolve('.verification','preparation-status-'+randomUUID());
  const store=new Store(root),service=new ProductionService(store,{});
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  const batch=store.add('productionBatches',{status:'partial',items:[{index:0,status:'needs_assets'},{index:1,status:'preparing'},{index:2,status:'pending'}]});
  service.syncLinkedJobs();assert.equal(batch.status,'preparing');
  batch.items[1].status='needs_assets';batch.items[2].status='failed';service.syncLinkedJobs();
  assert.equal(batch.status,'failed');
});

test('cached context photos are reviewed once and auto stops at its photo minimum',async t=>{
  const root=path.resolve('.verification','preparation-cache-'+randomUUID());
  const store=new Store(root),project=store.createProject('Cached context');let calls=0,searches=0;
  const service=new ProductionService(store,{}, {
    imageSearch:async()=>{searches++;return {images:[],warnings:[]};},
    downloadImage:async({image})=>store.add('media',{kind:'image',projectId:project.id,name:image.title,sourceImageUrl:image.imageUrl}),
  });
  t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
  const research=store.add('researchResults',{projectId:project.id,headline:'Norfolk Airport',articles:[{sourceRead:{}}],imageSearchResults:images(24)});
  const run=async newsImageCount=>service.prepareNewsMedia(store.add('productionBatches',{request:{},items:[],warnings:[]}),{projectId:project.id,newsImageCount},research,{narration:'Norfolk Airport update'},async(_s,prompt,input)=>{
    calls++;assert.ok(prompt.includes('Context images of the exact'));
    return {selectedImageIds:input.candidates.slice(0,3).map(image=>image.id)};
  });
  const automatic=await run('auto');assert.equal(automatic.imageMediaIds.length,6);assert.equal(calls,2);assert.equal(searches,0);
  calls=0;const explicit=await run(8);assert.equal(explicit.imageMediaIds.length,8);assert.equal(calls,2,'the first wave reuses verified reviews; the explicit target adds a second wave');
  assert.equal(preparationPhase('Đang tìm thêm góc ảnh đúng chủ thể trong nguồn tin'),'images');
  assert.equal(preparationPhase('Đang đọc bài báo gốc và ảnh trong bài'),'source');
});

test('fast News requests disable DeepSeek thinking without changing other models or ordinary calls',async()=>{
  for(const [model,fast,expected] of [['ocg/deepseek-v4.1-flash',true,'disabled'],['deepseek-v4-flash',true,'disabled'],['deepseek-flash',true,'disabled'],['ocg/deepseek-v4.1-flash',false,undefined],['other-model',true,undefined]]){
    let body;const store={state:{settings:{llm:{enabled:true,model,endpoint:'https://llm.test/v1',timeoutSeconds:90}}}};
    await requestJsonContent(store,'Select verified images',{}, {fast,fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return Response.json({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]});}});
    assert.equal(body.thinking?.type,expected);assert.equal(body.model,model);
  }
});

test('narration uses original excerpts rather than treating generated research advice as source evidence',async()=>{
  await writeNewsNarration({}, {headline:'Norfolk Airport delays',script:'Travelers were advised to check airlines.',articles:[{title:'Norfolk Airport delays',summary:'<a href="https://news.test">Delays continue at Norfolk Airport.</a>&nbsp;<font>News</font>',source:'News',url:'https://news.test'}]}, {
    llm:async(_s,_p,input)=>{
      assert.equal(input.script,undefined);assert.equal(input.articles[0].summary,'Delays continue at Norfolk Airport. News');
      return {headline:'Norfolk Airport delays',summary:'Delays continue at Norfolk Airport, according to News.',imageQueries:[]};
    },
  });
});
