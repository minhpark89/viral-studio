import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Store } from '../server/store.js';
import { createDreamFaceSlots, getDreamFaceCredentials } from '../server/dreamface-accounts.js';
import { StateEvents } from '../server/state-events.js';
import { snapshotDelta, applyStateEvent } from '../shared/state-events.js';
import { ProfileStorage } from '../server/profile-storage.js';
import { archiveResearch, archiveCandidates, restoreResearch } from '../server/history-archive.js';
import { createNewsTypography } from '../server/news-typography.js';
import { binary, runProcess } from '../server/media.js';

function fixture(t){
  const base=path.resolve('.verification'),root=path.join(base,'storage-v0102-'+randomUUID()),store=new Store(root);
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(base));await fs.rm(root,{recursive:true,force:true});});
  return store;
}
test('bulk creation commits once, persists every secret and rejects all proxies before changing state',t=>{
  const store=fixture(t);store.state.padding='x'.repeat(5*1024*1024);let saves=0;store.on('change',()=>saves++);
  const rows=createDreamFaceSlots(store,{count:50,namePrefix:'Bulk QA'});
  assert.equal(saves,1);assert.equal(new Set(rows.map(x=>x.id)).size,50);
  const reopened=new Store(store.root);assert.equal(reopened.state.accounts.length,50);
  for(const row of rows)assert.equal(getDreamFaceCredentials(reopened,row).email,row.email);
  assert.throws(()=>createDreamFaceSlots(store,{count:2,namePrefix:'Invalid',proxies:['host:8080','invalid']}));
  assert.equal(store.state.accounts.length,50);assert.equal(saves,1);
});
test('failed bulk metadata commit rolls back memory and staged credentials',async t=>{
  const store=fixture(t);store.save=()=>{throw new Error('fixture full disk');};
  assert.throws(()=>createDreamFaceSlots(store,{count:3,namePrefix:'Failure'}),/full disk/);
  assert.deepEqual(store.state.accounts,[]);assert.deepEqual(await fs.readdir(path.join(store.root,'.private')),['key']);
});
test('state delta round trips edits, order, deletions and preserves unaffected references',()=>{
  const before={accounts:[{id:'a',status:'ready'},{id:'b',status:'error'}],researchResults:[{id:'r',body:'x'.repeat(100000)}],settings:{x:1}};
  const after=structuredClone(before);after.accounts=[{id:'b',status:'ready'},{id:'c',status:'ready'}];
  const event={type:'delta',base:1,revision:2,patch:snapshotDelta(before,after)};
  const applied=applyStateEvent({type:'snapshot',revision:1,data:before},event);
  assert.deepEqual(applied.data,after);assert.equal(applied.data.researchResults,before.researchResults);
  assert.ok(JSON.stringify(event).length<1000);assert.throws(()=>applyStateEvent(null,event));assert.throws(()=>applyStateEvent(applied,event));
});
test('SSE supports legacy clients, masks secrets, reconnects with full state and skips unchanged saves',t=>{
  const store=fixture(t);store.state.settings.llm.apiKey='private-llm-test-key';
  const hub=new StateEvents(store);t.after(()=>hub.close());
  function client(delta){const req=new EventEmitter();req.query={delta:delta?'1':'0'};const messages=[];const res={writableLength:0,writeHead(){},write(value){if(value.startsWith('data:'))messages.push(JSON.parse(value.slice(6)));return true;},end(){req.emit('close');}};hub.subscribe(req,res);return {messages,res,req};}
  const a=client(true),legacy=client(false),initial=a.messages[0];assert.equal(initial.type,'snapshot');
  const account=store.add('accounts',{provider:'dreamface',status:'ready'});hub.flush();
  assert.equal(a.messages.at(-1).type,'delta');assert.equal(applyStateEvent(initial,a.messages.at(-1)).data.accounts[0].id,account.id);
  assert.equal(legacy.messages.at(-1).accounts[0].id,account.id);
  assert.doesNotMatch(JSON.stringify([...a.messages,...legacy.messages]),/private-llm-test-key/);
  const count=a.messages.length;store.save();hub.flush();assert.equal(a.messages.length,count);
  const reconnect=client(true);assert.equal(reconnect.messages[0].type,'snapshot');assert.equal(reconnect.messages[0].data.accounts.length,1);
  reconnect.res.writableLength=9*1024*1024;store.patch('accounts',account.id,{status:'error'});hub.flush();assert.equal(hub.clients.has(reconnect.res),false);
  hub.close();const late=client(true);assert.deepEqual(late.messages,[]);assert.equal(hub.clients.size,0,'Renderer reconnect during shutdown must not keep HTTP server alive');
});
test('one-pass profile measurement excludes junctions, caches bytes but always refreshes busy state',async t=>{
  const store=fixture(t),id=randomUUID(),directory=path.join(store.root,'profiles',id);
  await fs.mkdir(path.join(directory,'Default/Cache'),{recursive:true});await fs.writeFile(path.join(directory,'Default/Cache/data'),'12345');
  await fs.mkdir(path.join(directory,'Default/Local Storage'),{recursive:true});await fs.writeFile(path.join(directory,'Default/Local Storage/token'),'keep');
  await fs.symlink(path.join(directory,'Default/Local Storage'),path.join(directory,'Default/Cache/link'),'junction');
  const account=store.add('accounts',{profileId:id,status:'ready'});let checks=0;
  const storage=new ProfileStorage(store,{runningPaths:async()=>{checks++;return [];}});
  const a=storage.inspect(),b=storage.inspect();assert.equal(a,b);const result=await a;
  assert.equal(result.totalBytes,9);assert.equal(result.cacheBytes,0);assert.equal(checks,1);
  await fs.writeFile(path.join(directory,'extra'),'123');account.status='busy';
  const cached=await storage.inspect();assert.equal(cached.totalBytes,9);assert.equal(cached.activeCount,1);
  assert.equal((await storage.inspect({refresh:true})).totalBytes,12);
});
function archivedStory(store){
  const project=store.createProject('History'),old=new Date(Date.now()-45*86400000).toISOString();
  const row=store.add('researchResults',{projectId:project.id,headline:'Published old story',script:'full words '.repeat(3000),articles:[{id:'source',url:'https://example.com/story',title:'Source',summary:'source context '.repeat(3000)}]});row.createdAt=row.updatedAt=old;
  const job=store.add('jobs',{projectId:project.id,status:'completed',production:{researchId:row.id},mediaId:randomUUID()});
  const publication={postId:randomUUID(),mediaIds:[job.mediaId],status:'published',firstCommentStatus:'published',externalPostId:'verified-fixture',publishedAt:old};store.state.settings.meta.publications.push(publication);store.save();
  return {row,job,publication};
}
test('archive keeps IDs/source dedupe and restores complete content after restart and a drive-path move',async t=>{
  const store=fixture(t),{row}=archivedStory(store),original=structuredClone(row);
  const result=archiveResearch(store);assert.equal(result.archivedCountThisRun,1);assert.ok(result.activeMetadataBytesSaved>50000);
  const summary=store.state.researchResults[0];assert.equal(summary.id,row.id);assert.equal(summary.articles[0].url,original.articles[0].url);assert.equal(summary.script,undefined);
  const moved=path.join(store.root,'moved-workspace');await fs.mkdir(moved);
  await fs.copyFile(store.file,path.join(moved,'studio.json'));await fs.cp(path.join(store.root,'history'),path.join(moved,'history'),{recursive:true});
  const reopened=new Store(moved);assert.throws(()=>reopened.require('researchResults',row.id),error=>error.code==='RESEARCH_ARCHIVED');
  const restored=restoreResearch(reopened,row.id);assert.equal(restored.script,original.script);assert.deepEqual(restored.articles,original.articles);
  assert.equal(archiveCandidates(reopened).length,0,'Recently restored content stays active');
});
test('archive protects drafts, retry jobs, retained media, recent publications and first-comment failures',t=>{
  const store=fixture(t),{row,job,publication}=archivedStory(store);
  for(const status of ['failed','queued','cancelled']){job.status=status;assert.equal(archiveCandidates(store).length,0);}job.status='completed';
  publication.firstCommentStatus='error';assert.equal(archiveCandidates(store).length,0);publication.firstCommentStatus='published';
  const old=publication.publishedAt;publication.publishedAt=new Date().toISOString();assert.equal(archiveCandidates(store).length,0);publication.publishedAt=old;
  store.state.socialPosts.push({researchId:row.id});assert.equal(archiveCandidates(store).length,0);store.state.socialPosts=[];
  store.state.media.push({id:job.mediaId,jobId:job.id});assert.equal(archiveCandidates(store).length,0);store.state.media=[];
  assert.equal(archiveCandidates(store).length,1);
});
test('corrupt or redirected archive never replaces the active summary',async t=>{
  const store=fixture(t),{row}=archivedStory(store);archiveResearch(store);
  const summary=structuredClone(store.state.researchResults[0]);
  await fs.writeFile(path.join(store.root,'history/research',row.id+'.json.gz'),'corrupt');
  assert.throws(()=>restoreResearch(store,row.id));assert.deepEqual(store.state.researchResults[0],summary);
});
test('four-line headline fits above captions with real FFmpeg pixels for all bundled fonts',async t=>{
  const store=fixture(t),directory=path.join(store.root,'temp');
  const headline='TRUMP RALLIES MICHIGAN REPUBLICANS IN PORT HURON AHEAD OF MIDTERM ELECTIONS';
  for(const style of ['news','viral','minimal']){
    const typography=await createNewsTypography(directory,style);
    const fitted=await typography.fit('headline',headline,{font:'headline',size:64,min:36,width:606,lines:4,height:268,lineSpacing:8});
    assert.equal(fitted.text.replaceAll('\n',' '),headline);assert.ok(fitted.measuredHeight<=268);
    await runProcess(binary('ffmpeg'),['-y','-v','error','-f','lavfi','-i','color=black:s=1080x1920','-vf',`drawtext=fontfile=headline.ttf:textfile=headline.txt:expansion=none:fontcolor=white:fontsize=${fitted.size}:line_spacing=8:x=338:y=1124`,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','headline.gray'],{cwd:directory,timeout:30000});
    const pixels=await fs.readFile(path.join(directory,'headline.gray'));let last=-1;
    for(let y=1124;y<1920;y++)for(let x=338;x<945;x++)if(pixels[y*1080+x]>100){last=y;break;}
    assert.ok(last>1124);assert.ok(last<1392,`${style}: ink ends at ${last}, must stay above caption panel with 16px clearance`);
  }
});
