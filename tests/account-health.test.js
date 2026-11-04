import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.js';
import {AccountHealthService} from '../server/account-health.js';
import {accountQuotaBlocked,accountDisplayStatus,quotaFailureState,ACCOUNT_QUOTA_RECHECK_MS} from '../shared/account-health.js';
import {classifyDreamFaceQuota} from '../server/dreamface-quota.js';
import {JobQueue} from '../server/queue.js';
import {checkAccountSelection,accountCheckSummary} from '../src/account-checks.js';
import {startServer} from '../server/index.js';

async function fixture(t,{status='error',quota={state:'exhausted',kind:'credits',balance:0,cost:4},check}={}) {
 const root=path.resolve('.verification','account-health-'+randomUUID()),store=new Store(root);
 const account=store.add('accounts',{name:'Quota profile',provider:'dreamface',status,message:status==='error'?'Profile đã hết lượt MC miễn phí hoặc không đủ credits.':'',profileId:randomUUID()});
 let now=Date.parse('2026-11-03T23:50:00Z'),checks=0,reads=0;
 const provider={sessions:new Map(),check:async()=>{checks++;return check?check():{status:'ready',renderReady:true,gmailStatus:'ready'};},checkQuota:async()=>{reads++;return quota;},close:async()=>{}};
 const service=new AccountHealthService(store,{dreamface:provider,browsers:{},now:()=>now,intervalMs:0});
 t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});
 return {store,account,service,provider,counts:()=>({checks,reads}),advance:ms=>{now+=ms;},now:()=>now};
}

test('Generate prefix is a cost; free daily, paid credits and unknown evidence remain separate',()=>{
 const scope={effect:'Avatar 3.0 Fast',resolution:'720p'};
 assert.equal(classifyDreamFaceQuota({...scope,label:'4 Generate',credits:{paid_count:0,free_count:0}}).state,'exhausted');
 assert.equal(classifyDreamFaceQuota({...scope,label:'4 Generate',credits:{paid_count:3,free_count:1}}).state,'available');
 assert.equal(classifyDreamFaceQuota({...scope,label:'2 Free Daily',credits:{paid_count:0,free_count:0}}).remaining,2);
 assert.equal(classifyDreamFaceQuota({...scope,label:'0 Free Daily'}).state,'exhausted');
 assert.equal(classifyDreamFaceQuota({...scope,label:'Generate'}).state,'unknown');
 assert.equal(classifyDreamFaceQuota({...scope,label:'4 Generate',credits:{freeAnimateNum:5}}).state,'unknown');
 assert.equal(classifyDreamFaceQuota({...scope,effect:'Avatar 2.0',label:'2 Free Daily'}).state,'unknown');
});

test('legacy quota errors become recoverable without treating login/verification errors as quota',async t=>{
 const f=await fixture(t);assert.equal(f.account.errorCode,'PROVIDER_QUOTA');assert.equal(f.account.renderReady,false);assert.equal(accountDisplayStatus(f.account),'quota');
 assert.equal(accountQuotaBlocked({status:'error',message:'Proxy connection failed'}),false);
 assert.equal(accountQuotaBlocked({...f.account,status:'verification'}),false);
 assert.equal(accountQuotaBlocked({...f.account,status:'needs_login'}),false);
 await f.service.tick();assert.equal(f.counts().checks,1);assert.equal(f.account.status,'error');
 assert.equal(Date.parse(f.account.quota.nextCheckAt),f.now()+ACCOUNT_QUOTA_RECHECK_MS);
});

test('a new day alone never restores a profile; an available provider quota restores it automatically',async t=>{
 const quota={state:'exhausted',kind:'daily',remaining:0},f=await fixture(t,{quota});
 await f.service.tick();f.advance(15*60*1000);await f.service.tick();assert.equal(f.counts().checks,1);assert.equal(f.account.status,'error');
 f.advance(16*60*1000);quota.state='available';quota.remaining=2;await f.service.tick();
 assert.equal(f.counts().checks,2);assert.equal(f.account.status,'ready');assert.equal(f.account.errorCode,null);assert.equal(f.account.quota.blocked,false);assert.equal(f.account.quota.nextCheckAt,null);
});

test('restart resumes an overdue quota check, while authentication failures stop quota polling',async t=>{
 const f=await fixture(t,{check:()=>({status:'needs_login',message:'Session expired'})});
 f.account.quota.nextCheckAt=new Date(f.now()-1000).toISOString();await f.service.tick();assert.equal(f.account.status,'needs_login');assert.equal(f.counts().reads,0);
 f.advance(2*86400000);await f.service.tick();assert.equal(f.counts().checks,1);
 await f.service.close();
 f.account.status='error';f.account.quota.nextCheckAt=new Date(f.now()-1000).toISOString();
 const resumed=new AccountHealthService(f.store,{dreamface:{...f.provider,check:async()=>({status:'ready'}),checkQuota:async()=>({state:'available',kind:'daily',remaining:1})},browsers:{},now:f.now,intervalMs:0});
 try{await resumed.tick();assert.equal(f.account.status,'ready');}finally{await resumed.close();}
});

test('unknown quota and transient errors retain a bounded retry instead of falsely restoring readiness',async t=>{
 const f=await fixture(t,{quota:{state:'unknown'}});await f.service.check(f.account.id);assert.equal(f.account.status,'error');assert.equal(f.account.quota.state,'unknown');
 f.provider.check=async()=>{throw Error('Network unavailable');};await assert.rejects(()=>f.service.check(f.account.id),/Network unavailable/);
 assert.equal(accountQuotaBlocked(f.account),true);assert.equal(f.account.renderReady,false);assert.equal(Date.parse(f.account.quota.nextCheckAt),f.now()+ACCOUNT_QUOTA_RECHECK_MS);
});

test('checks coalesce and do not touch busy/shared/visible profiles or submit a provider task',async t=>{
 const f=await fixture(t);let release;f.provider.check=()=>new Promise(resolve=>{release=resolve;});
 const a=f.service.check(f.account.id),b=f.service.check(f.account.id);assert.equal(f.account.status,'checking');release({status:'ready'});await Promise.all([a,b]);assert.equal(f.counts().reads,1);
 f.account.status='busy';await assert.rejects(()=>f.service.check(f.account.id),{code:'PROFILE_BUSY'});
 f.account.status='error';f.account.quota.nextCheckAt=null;f.provider.sessions.set(f.account.profileId,{visible:true});await f.service.tick();assert.equal(f.counts().reads,1);
 f.provider.sessions.clear();f.store.add('accounts',{provider:'dreamface',name:'Shared busy',profileId:f.account.profileId,status:'busy'});await assert.rejects(()=>f.service.check(f.account.id),{code:'PROFILE_BUSY'});
});

test('a stale ready badge with blocked quota cannot be selected for queued generation',async t=>{
 const f=await fixture(t),project=f.store.createProject('Quota guard');f.account.status='ready';let submitted=0;
 const queue=new JobQueue(f.store,{}, {intervalMs:0,generate:async()=>{submitted++;return {};}});t.after(()=>queue.close());
 queue.enqueueGeneration({projectId:project.id,provider:'dreamface',accountId:f.account.id,model:'DreamFace video',duration:5,ratio:'9:16',prompts:['One new scene']});queue.tick();assert.equal(submitted,0);
 const failure=quotaFailureState({message:'Daily limit'},f.now());assert.equal(failure.errorCode,'PROVIDER_QUOTA');assert.equal(failure.renderReady,false);
});

test('automatic quota recovery resumes queued work but never retries a failed job',async t=>{
 const quota={state:'exhausted',kind:'daily',remaining:0},f=await fixture(t,{quota}),project=f.store.createProject('Resume');let submitted=0;
 const generate=async()=>{submitted++;return {id:randomUUID()};};
 const queue=new JobQueue(f.store,{}, {intervalMs:0,generate,generateDreamFace:generate});t.after(()=>queue.close());
 const failed=f.store.add('jobs',{projectId:project.id,type:'generate',status:'failed',errorCode:'PROVIDER_QUOTA',payload:{provider:'dreamface'},logs:[]});
 const [queued]=queue.enqueueGeneration({projectId:project.id,provider:'dreamface',accountId:f.account.id,model:'DreamFace video',duration:5,ratio:'9:16',prompts:['A new queued scene'],autoAssemble:false});
 await f.service.tick();queue.tick();assert.equal(submitted,0);
 quota.state='available';quota.remaining=1;f.advance(ACCOUNT_QUOTA_RECHECK_MS+1);await f.service.tick();queue.tick();await Promise.all([...queue.running.values()].map(entry=>entry.promise));
 assert.equal(submitted,1);assert.equal(queued.status,'completed');assert.equal(failed.status,'failed');
});

test('shutdown closes a hidden check promptly and preserves its pending quota state',async t=>{
 const f=await fixture(t);let reject;f.provider.sessions.set(f.account.profileId,{visible:false});f.provider.check=()=>new Promise((_resolve,fail)=>{reject=fail;});
 f.provider.close=async()=>{reject?.(Error('Page closed'));f.provider.sessions.clear();};
 const pending=f.service.check(f.account.id);const rejected=assert.rejects(pending,/Page closed/);await f.service.close();await rejected;
 assert.equal(f.account.status,'error');assert.equal(accountQuotaBlocked(f.account),true);assert.equal(f.provider.sessions.size,0);
});

test('bulk check actually POSTs all four selections and separates completed checks from readiness',async t=>{
 const previous=globalThis.fetch,calls=[];t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({status:calls.length===1?'ready':calls.length===2?'verification':'error'});};
 const progress=[];const result=await checkAccountSelection(Array.from({length:4},(_,i)=>({id:String(i),name:'Profile '+i,status:'error'})),{onProgress:p=>progress.push(p)});
 assert.equal(calls.length,4);assert(calls.every(call=>call.options.method==='POST'&&call.options.body==='{}'));assert.equal(result.completed,4);assert.equal(result.checked,4);assert.equal(result.ready,1);assert.equal(result.attention,3);assert.equal(result.failed,0);assert.match(accountCheckSummary(result),/4\/4/);assert(progress.some(item=>item.completed===2&&item.activeName));
});

test('bulk failure/skip reporting finishes honestly and still checks later selections',async()=>{
 let calls=0;const result=await checkAccountSelection([{id:'a',name:'Busy',status:'busy'},{id:'b',name:'Offline',status:'error'},{id:'c',name:'Good',status:'ready'}],{request:async()=>{if(++calls===1)throw Error('Network failed');return {status:'ready'};}});
 assert.equal(result.completed,3);assert.equal(result.checked,1);assert.equal(result.failed,1);assert.equal(result.skipped,1);assert.equal(result.results[1].error,'Network failed');
});

test('the real HTTP check route rejects GET and persists all four POST results',async t=>{
 const root=path.resolve('.verification','account-route-'+randomUUID()),studio=await startServer({port:0,dataDir:root});
 t.after(async()=>{await studio.close();await fs.rm(root,{recursive:true,force:true});});clearInterval(studio.accountHealth.timer);
 studio.accountHealth.dreamface.check=async()=>({status:'ready',gmailStatus:'ready'});studio.accountHealth.dreamface.checkQuota=async()=>({state:'exhausted',kind:'credits',balance:0,cost:4});
 const accounts=Array.from({length:4},(_,i)=>studio.store.add('accounts',{name:'Route '+i,provider:'dreamface',status:'error',message:'Not enough credits'}));
 const get=await fetch(studio.address+'/api/accounts/'+accounts[0].id+'/check');assert.equal(get.status,404);
 for(const account of accounts){const response=await fetch(studio.address+'/api/accounts/'+account.id+'/check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,'error');assert.equal(body.quota.state,'exhausted');assert(account.checkedAt);}
 assert.equal(studio.store.state.jobs.length,0);
});
