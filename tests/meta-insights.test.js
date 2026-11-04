import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { MetaInsightsService, mountMetaInsightsRoutes } from '../server/meta-insights.js';
import { insightPeriod, dailyMetric, insightTotals, emptyMetric } from '../shared/meta-insights.js';

const time = Date.parse('2026-11-04T15:00:00Z');
const sha = value => createHash('sha256').update(value).digest('hex');
function daily(name, period, value = 2) { return { name, period: 'day', values: period.dates.map(date => ({ end_time: new Date(Date.parse(date + 'T08:00:00Z') + 86400000).toISOString(), value })) }; }
function fixture(t, { pages = 3, tokenCount = pages, fetchImpl, now = () => time } = {}) {
  const base = path.resolve('.verification'), root = path.join(base, 'insights-' + randomUUID()); fs.mkdirSync(root, { recursive: true });
  const tokens = Array.from({ length: tokenCount }, (_,i) => ({ id: 'token-' + i, token: 'private-token-' + i, status: 'ACTIVE' }));
  const state = { settings: { meta: { enabled: true, graphVersion: 'v26.0', tokens, pageGroups: [{ id: 'g1', name: 'First group', pageIds: ['1000'] }], pages: Array.from({ length: pages }, (_,i) => ({ id: String(1000+i), name: 'Page ' + i, tokenBindings: { [tokens[i % tokenCount].id]: { status: 'VERIFIED', pageToken: 'private-page-' + i, verifiedPageId: String(1000+i), credentialFingerprint: sha(tokens[i % tokenCount].token) } } })) } } };
  const calls = [];
  const fetcher = fetchImpl || (async (url, options) => { calls.push({ url: String(url), authorization: options.headers.Authorization }); const u = new URL(url); return Response.json(u.pathname.endsWith('/insights') ? { data: u.searchParams.get('metric').split(',').map(name => daily(name, insightPeriod(Number(u.searchParams.get('since')) < (time/1000 - 20*86400) ? 28 : 7, now()))) } : { id: u.pathname.split('/').at(-1), followers_count: 0 }); });
  const service = new MetaInsightsService({ root, state }, { now, fetchImpl: fetcher });
  t.after(async () => { await service.close(); assert(root.startsWith(base + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, store: { root, state }, state, calls, root };
}

test('Meta day boundaries follow Pacific and missing days are not fabricated zeros', () => {
  const beforeMidnight = insightPeriod(7, Date.parse('2026-11-04T07:30:00Z'));
  assert.equal(beforeMidnight.until, '2026-11-03');
  const period = insightPeriod(7, time), entry = daily('page_media_view',period,0);
  const full = dailyMetric({ data:[entry] },'page_media_view',period); assert.equal(full.value,0); assert.equal(full.status,'ok');
  entry.values.pop(); const partial = dailyMetric({data:[entry]},'page_media_view',period);
  assert.equal(partial.status,'incomplete'); assert.equal(partial.coveredDays,6); assert.equal(partial.series.at(-1).value,null);
  assert.equal(dailyMetric({ data:[] },'page_media_view',period).value,null);
});

test('real zero remains zero, cached snapshots make no Meta calls, filtering and restart preserve data without secrets', async t => {
  const f=fixture(t); const started=f.service.refresh({}); assert(started.started); assert.equal(f.service.refresh({}).started,false); await f.service.pending;
  const view=f.service.snapshot({}); assert.equal(view.metrics.followers.value,0); assert.equal(view.metrics.views.value,42); assert.equal(view.metrics.views.coverage,3); assert.equal(f.calls.length,6);
  assert(f.calls.every(call=>!call.url.includes('access_token')&&call.authorization.startsWith('Bearer ')));
  assert.equal(f.service.refresh({}).started,false); f.service.snapshot({ groupId:'g1' }); assert.equal(f.calls.length,6);
  assert.equal(f.service.snapshot({groupId:'g1'}).filteredPages,1);
  const text=fs.readFileSync(f.service.file,'utf8');assert(!text.includes('private-token-'));assert(!text.includes('private-page-'));assert(!JSON.stringify(view).includes('binding'));
  const restarted=new MetaInsightsService(f.store,{now:()=>time,fetchImpl:async()=>{throw new Error('Must use cache');}});t.after(()=>restarted.close());assert.equal(restarted.snapshot({}).metrics.views.value,42);
  f.state.settings.meta.tokens[0].token='changed-token';assert.equal(restarted.snapshot({pageId:'1000'}).metrics.followers.value,null);
});

test('workers cap concurrency and serialize Page reads that share a token', async t => {
  let active=0, maximum=0;const byToken=new Map(),maxByToken=new Map();
  const f=fixture(t,{pages:8,tokenCount:2,fetchImpl:async(url,options)=>{
    const id=Number(new URL(url).pathname.split('/')[2]),token=(id-1000)%2;active++;maximum=Math.max(maximum,active);byToken.set(token,(byToken.get(token)||0)+1);maxByToken.set(token,Math.max(maxByToken.get(token)||0,byToken.get(token)));
    await new Promise(r=>setTimeout(r,8));active--;byToken.set(token,byToken.get(token)-1);
    return Response.json(String(url).includes('/insights')?{data:['page_media_view','page_post_engagements'].map(name=>daily(name,insightPeriod(7,time)))}:{id:String(id),followers_count:5});
  }});
  f.service.refresh({});await f.service.pending;assert(maximum<=3);assert(maximum>=2);assert([...maxByToken.values()].every(value=>value===1));assert.equal(f.service.snapshot({}).metrics.followers.value,40);
});

test('rate limits stop further requests for the affected credential without writing publisher state', async t => {
  let calls=0;const f=fixture(t,{pages:4,tokenCount:1,fetchImpl:async()=>{calls++;return Response.json({error:{code:4,message:'private remote text'}},{status:429});}});
  const before=JSON.stringify(f.state);f.service.refresh({});await f.service.pending;
  assert.equal(calls,1);assert.equal(JSON.stringify(f.state),before);const snapshot=f.service.snapshot({});assert.equal(snapshot.metrics.views.value,null);assert(!JSON.stringify(snapshot).includes('private remote text'));assert.equal(snapshot.rows[0].metrics.views.status,'rate_limited');
});

test('an unsupported metric falls back independently and does not hide usable views or other Pages', async t => {
  const f=fixture(t,{pages:2,fetchImpl:async url=>{const u=new URL(url),id=u.pathname.split('/')[2],metric=u.searchParams.get('metric');if(!metric)return Response.json({id,followers_count:9});if(id==='1000'&&metric.includes('page_post_engagements'))return Response.json({error:{code:100,message:'The value must be a valid insights metric'}},{status:400});return Response.json({data:metric.split(',').map(name=>daily(name,insightPeriod(7,time),1))});}});
  f.service.refresh({});await f.service.pending;const result=f.service.snapshot({});assert.equal(result.metrics.views.value,14);assert.equal(result.metrics.engagement.coverage,1);assert.equal(result.rows.find(row=>row.id==='1000').metrics.engagement.value,null);
});

test('failed refresh retains same-period last-good values as stale and never reuses another period', async t => {
  let now=time;const f=fixture(t,{pages:1,now:()=>now});f.service.refresh({});await f.service.pending;
  now+=61000;f.service.fetch=async()=>Response.json({error:{code:190,message:'token secret'}},{status:400});f.service.refresh({});await f.service.pending;
  const result=f.service.snapshot({});assert.equal(result.metrics.views.value,14);assert.equal(result.metrics.views.stale,1);assert.equal(result.rows[0].metrics.views.status,'stale');assert.equal(f.service.snapshot({days:28}).metrics.views.value,null);
});

test('cancel stops background work and missing credentials become explicit attention without external calls', async t => {
  const f=fixture(t,{pages:3,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
  f.service.refresh({});f.service.cancel();await f.service.pending;assert.equal(f.service.progress.running,false);assert.equal(f.service.progress.cancelled,true);
  for(const token of f.state.settings.meta.tokens)token.status='ERROR';f.service.refresh({});await f.service.pending;const result=f.service.snapshot({});assert.equal(result.rows[0].status,'attention');assert.equal(result.rows[0].metrics.followers.status,'missing_binding');
});

test('HTTP overview routes expose only cached safe data and use a background refresh', async t => {
  const f=fixture(t,{pages:1});const app=express();app.use(express.json());const service=mountMetaInsightsRoutes(app,f.store,{now:()=>time,fetchImpl:f.service.fetch});t.after(()=>service.close());
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/meta/overview').then(r=>r.json())).metrics.followers.value,null);
  const response=await fetch(base+'/api/meta/overview/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,202);await service.pending;
  const snapshot=await fetch(base+'/api/meta/overview').then(r=>r.json());assert.equal(snapshot.metrics.followers.value,0);assert.equal(snapshot.rows.length,1);assert(!JSON.stringify(snapshot).includes('private-token-'));
});

test('publishing restrictions and review do not hide Pages from read-only analytics', async t => {
  const f=fixture(t,{pages:4});const pages=f.state.settings.meta.pages;
  pages[0].publishingHealth={blocked:true};pages[1].management={status:'review'};pages[2].isPublished=false;pages[3].management={status:'deleted'};
  assert.equal(f.service.snapshot({}).totalPages,3);f.service.refresh({});await f.service.pending;assert.equal(f.service.snapshot({}).metrics.views.coverage,3);assert.equal(f.calls.length,6);
});
