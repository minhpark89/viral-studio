import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.js';
import {JobQueue} from '../server/queue.js';
import {ProductionService} from '../server/production.js';
import {newsImageKey,newsImageCandidates} from '../server/image-search.js';
import {articleImagesFromHtml} from '../server/news-visuals.js';
import {rankNewsImages,additionalNewsImageQueries} from '../server/news-plan.js';
import {requestJsonContent} from '../server/llm.js';
import {newsImageFingerprint,sameNewsImage} from '../server/news-image-fingerprint.js';
import {binary,runProcess} from '../server/media.js';

test('resized and cross-format versions deduplicate without merging different image IDs',()=>{
  assert.equal(newsImageKey({imageUrl:'https://ichef.bbci.co.uk/ace/standard/240/photo.jpg'}),newsImageKey({imageUrl:'https://ichef.bbci.co.uk/ace/standard/1280/photo.jpg'}));
  assert.equal(newsImageKey({imageUrl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Qeshm_ESA201025.tiff/lossy-page1-1920px.jpg?utm_source=a'}),newsImageKey({imageUrl:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Qeshm_ESA201025.jpg'}));
  assert.equal(newsImageKey({imageUrl:'https://images.test/photo?id=1&w=400&utm_source=rss'}),newsImageKey({imageUrl:'https://images.test/photo?w=1200&id=1'}));
  assert.notEqual(newsImageKey({imageUrl:'https://images.test/photo?id=1'}),newsImageKey({imageUrl:'https://images.test/photo?id=2'}));
  const candidates=newsImageCandidates([{id:'story',title:'Reported event',imageDescription:'The actual island coastline',imageUrl:'https://images.test/1.jpg'}]);
  assert.equal(candidates[0].title,'The actual island coastline'); assert.equal(candidates[0].articleTitle,'Reported event');
});

test('main/picture source gallery excludes nested recommendations and preserves captions',()=>{
  const html=`<main><figure><picture><source srcset="/beach.jpg?w=400 400w, /beach.jpg?w=1600 1600w"><img width="400" src="/placeholder.jpg" alt="Qeshm beach"></picture><figcaption>Qeshm Island coast</figcaption></figure><div class="related-stories"><div><figure><img src="/other.jpg" alt="Other event"></figure></div><picture><img src="/bad.jpg" alt="Unrelated"></picture></div><aside><figure><img src="/ad.jpg" alt="Ad"></figure></aside><picture><source data-srcset="/harbor.jpg 1200w"><img src="/small.jpg" alt="Qeshm harbor"></picture></main><picture><img src="/footer.jpg" alt="Footer"></picture><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","url":"https://news.test/other-story","image":"/wrong.jpg"},{"@type":"NewsArticle","url":"https://news.test/story","hasPart":[{"@type":"ImageObject","contentUrl":"/map.jpg","caption":"The island from orbit"}]}]}</script>`;
  const images=articleImagesFromHtml(html,{id:'story',url:'https://news.test/story',title:'Island report'});
  assert.deepEqual(images.map(image=>image.imageUrl),['https://news.test/map.jpg','https://news.test/beach.jpg?w=1600','https://news.test/harbor.jpg']);
  assert.equal(images[1].imageDescription,'Qeshm Island coast');
});

test('slow ranking groups split once and carry already-selected subjects into the retry',async()=>{
  const candidates=Array.from({length:6},(_,i)=>({id:String(i),title:'Named island view '+i}));
  const calls=[],reviewed=[];
  const result=await rankNewsImages({}, {headline:'Island report'}, candidates,{alreadySelected:[{title:'Earlier island image'}],onReviewed:ids=>reviewed.push(...ids),llm:async(_store,_prompt,input,options)=>{
    calls.push(input.candidates.length); assert.equal(options.maxTokens,800); assert.ok(input.alreadySelected.some(image=>image.title==='Earlier island image'));
    if(input.candidates.length===6)throw Error('Gateway timeout');
    return {selectedImageIds:input.candidates.map(image=>image.id)};
  }});
  assert.deepEqual(calls,[6,3,3]); assert.equal(result.length,6); assert.equal(reviewed.length,6);
  let failures=0;
  await assert.rejects(()=>rankNewsImages({}, {}, candidates,{llm:async()=>{failures++;throw Error('offline');}}),{code:'IMAGE_RANKING_FAILED'});
  assert.equal(failures,3,'Failed verification never approves a candidate and retries stay bounded');
});

test('additional searches require literal source subjects and reject attribution and partial person names',async()=>{
  const research={headline:'Island update',articles:[{title:'Island update',summary:'Officials discussed Qeshm Island. BBC cited Justin Cooper.',source:'BBC News'}]};
  const queries=await additionalNewsImageQueries({},research,{narration:'Qeshm Island update'},['Qeshm Island attack scene'],{llm:async()=>({subjects:[{name:'Qeshm Island',kind:'place'},{name:'BBC',kind:'organization'},{name:'Justin',kind:'person'},{name:'Tehran',kind:'place'}]})});
  assert.deepEqual(queries,['Qeshm Island']);
});

test('a named island does not justify an unnamed airport, jet or hospital in an attack report',async()=>{
  const candidates=[{id:'airport',title:'Qeshm International Airport'},{id:'jet',title:'Qeshm Air Avro RJ100'},{id:'hospital',title:'Qeshm hospital'},{id:'coast',title:'Qeshm Island coastline'}];
  const result=await rankNewsImages({}, {headline:'US strikes Qeshm Island',script:'The report does not identify the targets.'},candidates,{llm:async(_store,_prompt,input)=>({selectedImageIds:input.candidates.map(image=>image.id)})});
  assert.deepEqual(result.map(image=>image.id),['coast']);
});

test('decoded fingerprints detect resized JPEG copies without merging a different scene',async t=>{
  const root=path.resolve('.verification','image-fingerprint-'+randomUUID()),store=new Store(root);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const original=path.join(root,'original.png'),copy=path.join(root,'copy.jpg'),different=path.join(root,'different.png');
  const ffmpeg=binary('ffmpeg',store.state.settings);
  await runProcess(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x480','-frames:v','1',original]);
  await runProcess(ffmpeg,['-y','-v','error','-i',original,'-vf','scale=1280:960','-q:v','4','-frames:v','1',copy]);
  await runProcess(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=blue:size=640x480','-frames:v','1',different]);
  const a=await newsImageFingerprint(store,{file:original,width:640,height:480}),b=await newsImageFingerprint(store,{file:copy,width:1280,height:960}),c=await newsImageFingerprint(store,{file:different,width:640,height:480});
  assert.equal(sameNewsImage(a,b),true);assert.equal(sameNewsImage(a,c),false);assert.equal(sameNewsImage(null,b),false);
});

async function fixture(t,options={}) {
  const root=path.resolve('.verification','image-variety-'+randomUUID()),store=new Store(root),project=store.createProject('Visual checks');
  const queue=new JobQueue(store,{}, {intervalMs:0});
  const service=new ProductionService(store,queue,{...options,downloadImage:options.downloadImage ? image=>options.downloadImage(image,store,project) : async({image})=>store.add('media',{projectId:project.id,kind:'image',file:image.imageUrl,sourceImageUrl:image.imageUrl,contentHash:image.id})});
  t.after(async()=>{await service.close();await queue.close();await fs.rm(root,{recursive:true,force:true});});
  const research=store.add('researchResults',{projectId:project.id,headline:'Qeshm Island update',articles:[],imageSearchResults:[]});
  const batch=store.add('productionBatches',{projectId:project.id,request:{},items:[],warnings:[]});
  return {store,project,service,research,batch};
}

test('download failures beyond the reserve backfill from approved overflow without revisiting rejected images',async t=>{
  let downloads=0;
  const f=await fixture(t,{imageSearch:async()=>{throw Error('No search should be necessary');},downloadImage:async({image},store,project)=>{
    downloads++; if(Number(image.id)<10)throw Error('HTTP 404');
    return store.add('media',{projectId:project.id,kind:'image',file:image.imageUrl,contentHash:image.id});
  }});
  f.research.imageSearchResults=Array.from({length:20},(_,i)=>({id:String(i),title:'Island view '+i,imageUrl:`https://images.test/${i}.jpg`}));
  const result=await f.service.prepareNewsMedia(f.batch,{projectId:f.project.id},f.research,{headline:f.research.headline,narration:'Qeshm Island update'},async(_store,_prompt,input)=>({selectedImageIds:input.candidates.map(image=>image.id)}));
  assert.equal(result.imageMediaIds.length,8); assert.equal(result.diagnostics.downloadErrors.length,10);assert.equal(downloads,18);assert.equal(result.diagnostics.searches.length,0);
});

test('a short grounded fallback query fills sparse event results with labeled context',async t=>{
  const queries=[];
  const f=await fixture(t,{imageSearch:async names=>{queries.push(names);return {images:names.includes('Qeshm Island')?Array.from({length:8},(_,i)=>({id:String(i),title:'Qeshm Island view '+i,imageUrl:`https://images.test/${i}.jpg`})):[],warnings:[]};}});
  const result=await f.service.prepareNewsMedia(f.batch,{projectId:f.project.id},f.research,{headline:f.research.headline,narration:'Qeshm Island update',imageQueries:['Qeshm Island attacks scene']},async(_store,_prompt,input)=>input.candidates?{selectedImageIds:input.candidates.map(image=>image.id)}:{subjects:[{name:'Qeshm Island',kind:'place'}]});
  assert.deepEqual(queries,[['Qeshm Island attacks scene'],['Qeshm Island']]);assert.equal(result.imageMediaIds.length,8);assert.equal(result.visualMode,'illustration');assert.equal(f.batch.newsMediaByResearch[f.research.id].revision,5);
});

test('LLM output budget is bounded and does not change the default for narration',async()=>{
  const store={state:{settings:{llm:{enabled:true,endpoint:'https://gateway.test/v1',model:'test',timeoutSeconds:30}}}};
  const budgets=[];const fetchImpl=async(_url,options)=>{budgets.push(JSON.parse(options.body).max_tokens);return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};
  await requestJsonContent(store,'Rank',{}, {fetchImpl,maxTokens:800});await requestJsonContent(store,'Narrate',{}, {fetchImpl});
  assert.deepEqual(budgets,[800,2400]);
});
