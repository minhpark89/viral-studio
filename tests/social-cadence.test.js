import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialScheduler } from '../server/social-scheduler.js';
import { normalizeScheduleConfig } from '../server/social.js';

function fixture() {
  const at = Date.parse('2026-11-03T17:00:00Z');
  const posts = ['A1','B1','A2','B2'].map((id,index) => ({id,revision:1,pageId:id,pageGroupId:'campaign',tokenGroupId:'pool',status:'scheduled',scheduledAt:new Date(at-10_000+index).toISOString()}));
  const state = {socialPosts:posts,socialPages:posts.map(p=>({id:p.id,externalId:p.id})),settings:{meta:{publications:[],tokens:[{id:'A',status:'ACTIVE',token:'fixture-A'},{id:'B',status:'ACTIVE',token:'fixture-B'}],pages:posts.map(p=>({id:p.id,tokenBindings:{[p.id[0]]:{pageToken:'test-fixture',status:'VERIFIED'}}})),pageGroups:[{id:'campaign',pageIds:posts.map(p=>p.id),scheduleConfig:{enabled:false,sameTokenMinutes:10,crossTokenMinutes:1,tokenGroupId:'pool'}}],tokenGroups:[{id:'pool',tokenIds:['A','B'],pageTokenBindings:Object.fromEntries(posts.map(p=>[p.id,p.id[0]]))}]}}};
  return {at,store:{state,save(){}}};
}

test('overdue posts keep ten minutes per token and one minute between tokens',async()=>{
  const {store,at}=fixture();let now=at;const calls=[];
  const publish=async({postId})=>{calls.push({id:postId,at:now});store.state.socialPosts=store.state.socialPosts.filter(p=>p.id!==postId);return {status:'published'};};
  const scheduler=new SocialScheduler(store,publish,{intervalMs:0,now:()=>now});
  await Promise.all([...scheduler.pending]);assert.deepEqual(calls,[{id:'A1',at}]);
  now=at+59_999;await scheduler.tick();assert.equal(calls.length,1);
  now=at+60_000;await scheduler.tick();assert.equal(calls[1].id,'B1');
  now=at+599_999;await scheduler.tick();assert.equal(calls.length,2);
  now=at+600_000;await scheduler.tick();assert.equal(calls[2].id,'A2');
  now=at+660_000;await scheduler.tick();assert.equal(calls[3].id,'B2');
  await scheduler.close();assert.equal(store.state.socialPosts.length,0);
});

test('restart and overlapping ticks preserve the durable reservation',async()=>{
  const f=fixture();let now=f.at,calls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const scheduler=new SocialScheduler(f.store,async()=>{calls++;await pending;return {status:'published'};},{intervalMs:0,now:()=>now});
  await scheduler.tick();assert.equal(calls,1);
  const restored={state:structuredClone(f.store.state),save(){}};
  release();await scheduler.close();
  now+=30_000;
  const restarted=new SocialScheduler(restored,async()=>{calls++;return {status:'published'};},{intervalMs:0,now:()=>now});
  await restarted.close();assert.equal(calls,1);assert.equal(restored.state.settings.meta.publishCadence.tokens.A,f.at);
});

test('temporary publication failures cannot retry inside the token interval',async()=>{
  const {store,at}=fixture();store.state.socialPosts=store.state.socialPosts.filter(p=>p.id==='A1');let now=at,calls=0;
  const scheduler=new SocialScheduler(store,async()=>{calls++;throw Error('Network unavailable');},{intervalMs:0,now:()=>now});
  await Promise.all([...scheduler.pending]);assert.equal(calls,1);
  now=at+60_000;await scheduler.tick();assert.equal(calls,1);assert.equal(Date.parse(store.state.socialPosts[0].automationNextAttemptAt),at+600_000);
  now=at+600_000;await scheduler.tick();assert.equal(calls,2);await scheduler.close();
});

test('missing fixed mapping is held without selecting a different credential',async()=>{
  const {store,at}=fixture();store.state.settings.meta.tokenGroups[0].pageTokenBindings={};let calls=0;
  const scheduler=new SocialScheduler(store,async()=>{calls++;},{intervalMs:0,now:()=>at});
  await scheduler.close();assert.equal(calls,0);assert.ok(store.state.socialPosts.every(p=>p.automationRetryBlocked));
});

test('cadence configuration survives unrelated group edits and allows explicit disabling',()=>{
  const original=normalizeScheduleConfig({sameTokenMinutes:10,crossTokenMinutes:1});
  const edited=normalizeScheduleConfig({times:['04:00']},original);
  assert.equal(edited.sameTokenMinutes,10);assert.equal(edited.crossTokenMinutes,1);
  const disabled=normalizeScheduleConfig({sameTokenMinutes:0,crossTokenMinutes:0},edited);
  assert.equal(disabled.sameTokenMinutes,0);assert.equal(disabled.crossTokenMinutes,0);
});

test('comment-only retries keep the video slot available for the next Page',async()=>{
  const {store,at}=fixture();store.state.socialPosts=store.state.socialPosts.filter(p=>p.id==='A1');
  store.state.socialPosts[0].publication={externalPostId:'existing-video'};
  store.state.settings.meta.publishCadence={tokens:{A:at},groups:{campaign:at}};let calls=0;
  const scheduler=new SocialScheduler(store,async()=>{calls++;return {status:'published'};},{intervalMs:0,now:()=>at+60_000});
  await scheduler.close();assert.equal(calls,1);assert.equal(store.state.settings.meta.publishCadence.tokens.A,at);
});
