import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { autoScheduleDailyPageGroups, normalizeScheduleConfig } from '../server/social.js';
import { SocialScheduler } from '../server/social-scheduler.js';
import { postingDay, postingTime } from '../shared/posting-calendar.js';

const at = value => Date.parse(`2026-11-16T${value}+07:00`);
function fixture(groupCount = 6, pagesPerGroup = 30, initialStock = 230) {
  const projectId = randomUUID(), state = { projects: [{ id: projectId }], socialPages: [], socialPosts: [], jobs: [], media: [], researchResults: [], settings: { meta: { pages: [], tokens: [], pageGroups: [], tokenGroups: [], publications: [] } } };
  const meta = state.settings.meta;
  const store = { state, saves: 0, require: Store.prototype.require, save() { this.saves++; }, add(collection, data) { const row = { ...data, id: randomUUID() }; state[collection].push(row); return row; } };
  for (let g = 0; g < groupCount; g++) {
    const group = { id: `g${g}`, name: `Group ${g}`, pageIds: [], scheduleConfig: normalizeScheduleConfig({ enabled: true, autoPublish: true, perPageDaily: true, times: [['16:00','16:10','16:20','16:30','16:35','16:40'][g % 6]], timezone: 'Asia/Ho_Chi_Minh', tokenGroupId: `pool${g}`, dailyLimit: 0, staggerMinutes: 15, sameTokenMinutes: 10, crossTokenMinutes: 1, samePageMinutes: 60 }) };
    const pool = { id: `pool${g}`, tokenIds: [], pageTokenBindings: {} };
    for (let i = 0; i < pagesPerGroup; i++) {
      const pageId = String(100000 + g * pagesPerGroup + i), tokenId = `token${g}-${Math.floor(i / 3)}`;
      if (!pool.tokenIds.includes(tokenId)) { pool.tokenIds.push(tokenId); meta.tokens.push({ id: tokenId, token: `synthetic-${tokenId}`, status: 'ACTIVE' }); }
      meta.pages.push({ id: pageId, name: pageId, tokenBindings: { [tokenId]: { status: 'VERIFIED', pageToken: `synthetic-page-${pageId}` } } });
      state.socialPages.push({ id: randomUUID(), externalId: pageId, name: pageId, archived: false });
      group.pageIds.push(pageId); pool.pageTokenBindings[pageId] = tokenId;
    }
    meta.pageGroups.push(group); meta.tokenGroups.push(pool);
  }
  const stock = count => Array.from({ length: count }, () => {
    const mediaId = randomUUID(), post = { id: randomUUID(), projectId, title: 'Daily video', contentType: 'news', status: 'draft', pageId: '', pageGroupId: '', mediaIds: [mediaId], caption: 'Caption', firstComment: 'Read https://example.invalid/news', articleBody: 'Article', revision: 1, createdAt: new Date(state.socialPosts.length * 1000).toISOString() };
    state.media.push({ id: mediaId, projectId, kind: 'video', generated: true, mediaType: 'news-video' }); state.socialPosts.push(post); return post;
  });
  stock(initialStock);
  const plan = (now = at('15:00:00')) => autoScheduleDailyPageGroups(store, { nowValue: now });
  const external = post => state.socialPages.find(p => p.id === post.pageId)?.externalId;
  const publish = (post, now = Date.parse(post.scheduledAt)) => {
    meta.publications.push({ postId: post.id, pageId: external(post), pageGroupId: post.pageGroupId, tokenGroupId: post.tokenGroupId, externalPostId: `published-${post.id}`, publishedAt: new Date(now).toISOString() });
    state.socialPosts = state.socialPosts.filter(p => p !== post);
  };
  return { state, store, meta, stock, plan, external, publish };
}

test('six groups fill all 180 Pages once today, retain 50 in stock, and persist without allocating duplicates on restart', () => {
  const f = fixture(), result = f.plan();
  assert.equal(result.scheduled.length, 180); assert.deepEqual(result.errors, []);
  assert.equal(new Set(result.scheduled.map(f.external)).size, 180);
  assert.equal(f.state.socialPosts.filter(p => p.status === 'draft').length, 50);
  for (const group of f.meta.pageGroups) {
    const posts = result.scheduled.filter(p => p.pageGroupId === group.id).sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt));
    assert.equal(posts.length, 30);
    assert.equal(postingDay(Date.parse(posts.at(-1).scheduledAt), group.scheduleConfig.timezone), '2026-11-16');
    for (let i = 1; i < posts.length; i++) assert.equal(Date.parse(posts[i].scheduledAt)-Date.parse(posts[i-1].scheduledAt), 15*60000);
    assert.deepEqual(group.dailyAutomation, { day: '2026-11-16', target: 30, published: 0, scheduled: 30, waitingContent: 0, waitingTime: 0, unavailable: 0, shared: 0 });
  }
  assert.equal(result.scheduled.map(p=>p.scheduledAt).sort().at(-1), '2026-11-16T16:55:00.000Z');
  assert.equal(f.store.saves, 1);
  const restored = { state: structuredClone(f.state), saves: 0, require: Store.prototype.require, save() { this.saves++; } };
  assert.equal(autoScheduleDailyPageGroups(restored, { nowValue: at('15:01:00') }).scheduled.length, 0); assert.equal(restored.saves, 0);
});

test('limited stock goes by posting time across groups; new Content fills only missing Pages in the same day', () => {
  const f = fixture(6, 30, 12), first = f.plan();
  assert.equal(first.scheduled.length, 12);
  assert.equal(new Set(first.scheduled.map(p=>p.pageGroupId)).size, 6);
  const original = first.scheduled.map(p=>[p.id,p.pageId,p.scheduledAt]);
  f.stock(218); const second = f.plan(at('15:30:00'));
  assert.equal(second.scheduled.length, 168);
  assert.deepEqual(first.scheduled.map(p=>[p.id,p.pageId,p.scheduledAt]), original);
  assert.equal(new Set(f.state.socialPosts.filter(p=>p.status==='scheduled').map(f.external)).size, 180);
  assert.equal(f.state.socialPosts.filter(p=>p.status==='draft').length, 50);
});

test('daily quota resets in the group timezone without reserving tomorrow before all Pages today', () => {
  const f = fixture(1, 3, 9), first = f.plan(); first.scheduled.forEach(p=>f.publish(p));
  assert.equal(f.plan(at('20:00:00')).scheduled.length, 0);
  assert.equal(f.meta.pageGroups[0].dailyAutomation.published, 3);
  const next = f.plan(Date.parse('2026-11-17T00:00:01+07:00'));
  assert.equal(next.scheduled.length, 3); assert.equal(new Set(next.scheduled.map(f.external)).size, 3);
  assert.ok(next.scheduled.every(p=>p.automationDay==='2026-11-17' && p.scheduledAt.startsWith('2026-11-17')));
});

test('a broad overlapping group cannot take the scoped groups Pages or post twice to one Page', () => {
  const f = fixture(); f.meta.pageGroups[0].pageIds = f.meta.pages.slice(1).map(p=>p.id).concat(f.meta.pages[0].id);
  f.meta.pageGroups[0].scheduleConfig.tokenGroupId = '';
  const result = f.plan();
  assert.equal(result.scheduled.length, 180); assert.equal(new Set(result.scheduled.map(f.external)).size, 180);
  assert.equal(f.meta.pageGroups[0].dailyAutomation.target, 30); assert.equal(f.meta.pageGroups[0].dailyAutomation.shared, 150);
  for (let i=1;i<6;i++) assert.equal(result.scheduled.filter(p=>p.pageGroupId===`g${i}`).length,30);
});

test('migration reallocates old one-slot reservations including overlapping Pages without losing Content', () => {
  const f = fixture();
  f.meta.pageGroups[0].pageIds=f.meta.pages.map(p=>p.id);f.meta.pageGroups[0].scheduleConfig.tokenGroupId='';
  for (let g=0;g<6;g++) Object.assign(f.state.socialPosts[g], { status:'scheduled',pageId:f.state.socialPages[g===0?30:g*30].id,pageGroupId:`g${g}`,tokenGroupId:g===0?'':`pool${g}`,scheduledAt:new Date(at('16:00:00')+g*10*60000).toISOString(),automationSource:'daily-automation' });
  const ids = f.state.socialPosts.map(p=>p.id).sort(), result = f.plan();
  assert.equal(result.scheduled.length,180); assert.equal(new Set(result.scheduled.map(f.external)).size,180);
  assert.deepEqual(f.state.socialPosts.map(p=>p.id).sort(),ids);
  assert.ok(f.state.socialPosts.every(p=>!p.automationHold));
});

test('a manual reservation and a published video awaiting its comment each consume one Page quota', () => {
  const f=fixture(1,3,6), [manual,comment]=f.state.socialPosts;
  Object.assign(manual,{status:'scheduled',pageId:f.state.socialPages[0].id,pageGroupId:'g0',scheduledAt:new Date(at('19:00:00')).toISOString(),automationSource:'manual-now'});
  Object.assign(comment,{status:'scheduled',pageId:f.state.socialPages[1].id,pageGroupId:'g0',scheduledAt:new Date(at('14:00:00')).toISOString(),publication:{externalPostId:'already-live',publishedAt:new Date(at('14:00:00')).toISOString()},automationSource:'daily-automation'});
  f.meta.publications.push({postId:comment.id,pageId:f.external(comment),pageGroupId:'g0',externalPostId:'already-live',status:'published_comment_error',publishedAt:new Date(at('14:00:00')).toISOString()});
  const result=f.plan();assert.equal(result.scheduled.length,1);assert.equal(f.external(result.scheduled[0]),f.state.socialPages[2].externalId);
  assert.equal(comment.publication.externalPostId,'already-live');assert.equal(manual.scheduledAt,new Date(at('19:00:00')).toISOString());
  assert.equal(f.meta.pageGroups[0].dailyAutomation.published,1);assert.equal(f.meta.pageGroups[0].dailyAutomation.scheduled,2);
});

test('late Content catches up today, respects token/pool spacing, and reports an exhausted daily window', () => {
  const f=fixture(1,6,6), group=f.meta.pageGroups[0];group.scheduleConfig.staggerMinutes=0;
  const result=f.plan(at('18:00:00'));
  assert.equal(result.scheduled.length,6);assert.equal(Date.parse(result.scheduled[0].scheduledAt),at('18:00:01'));
  const byToken=new Map();
  for(const post of result.scheduled){const token=f.meta.tokenGroups[0].pageTokenBindings[f.external(post)];const previous=byToken.get(token);if(previous)assert.ok(Date.parse(post.scheduledAt)-previous>=10*60000);byToken.set(token,Date.parse(post.scheduledAt));}
  for(let i=1;i<6;i++)assert.ok(Date.parse(result.scheduled[i].scheduledAt)-Date.parse(result.scheduled[i-1].scheduledAt)>=60000);
  const late=fixture(1,3,5);late.meta.pageGroups[0].scheduleConfig.staggerMinutes=5;
  assert.equal(late.plan(at('23:58:00')).scheduled.length,1);assert.equal(late.meta.pageGroups[0].dailyAutomation.waitingTime,2);
  const next=late.plan(Date.parse('2026-11-17T00:01:00+07:00'));assert.equal(next.scheduled.length,3);assert.equal(new Set(next.scheduled.map(late.external)).size,3);
});

test('unavailable Pages and disabled groups consume no Content, and a repaired Page is filled automatically', () => {
  const f=fixture(2,3,10);f.meta.pageGroups[1].scheduleConfig.enabled=false;f.meta.pages[0].publishingHealth={blocked:true};
  assert.equal(f.plan().scheduled.length,2);assert.equal(f.meta.pageGroups[0].dailyAutomation.unavailable,1);
  f.meta.pages[0].publishingHealth.blocked=false;assert.equal(f.plan(at('15:10:00')).scheduled.length,1);
  assert.equal(f.state.socialPosts.filter(p=>p.status==='scheduled').length,3);
});

test('one invalid or incomplete Content does not block subsequent complete videos', () => {
  const f=fixture(1,3,6);f.state.socialPosts[0].researchId=randomUUID();f.state.socialPosts[1].firstComment='';
  const result=f.plan();assert.equal(result.scheduled.length,3);assert.equal(result.errors.length,1);
  assert.equal(f.state.socialPosts[0].automationStatus,'schedule_error');assert.equal(f.state.socialPosts[1].status,'draft');
});

test('website work remains outside the queue until the verified URL and first comment are complete', () => {
  const f=fixture(1,3,3), [login,sending,mismatch]=f.state.socialPosts;
  f.store.websitePublishing=new Set([login.id]);sending.website={status:'sending',url:'https://example.invalid/verified-page'};mismatch.website={status:'published',url:'https://example.invalid/verified-page'};
  assert.equal(f.plan().scheduled.length,0);
  f.store.websitePublishing.clear();sending.website.status='published';
  for(const p of f.state.socialPosts){p.website={status:'published',url:'https://example.invalid/verified-page'};p.firstComment='Read https://example.invalid/verified-page';}
  assert.equal(f.plan().scheduled.length,3);
});

test('editing the start time reflows unattempted reservations; restart keeps that plan', () => {
  const f=fixture(1,3,6);f.plan();f.meta.pageGroups[0].scheduleConfig.times=['18:00'];
  const second=f.plan();assert.equal(second.scheduled.length,3);assert.equal(second.scheduled[0].scheduledAt,new Date(at('18:00:00')).toISOString());
  assert.equal(f.plan().scheduled.length,0);assert.equal(f.state.socialPosts.filter(p=>p.status==='scheduled').length,3);
});

test('publication guard rechecks the actual day and allows only comment retries for an existing video', async () => {
  const f=fixture(1,1,2);const post=f.plan().scheduled[0];let calls=0;
  f.meta.pageGroups[0].scheduleConfig.enabled=false;
  f.meta.publications.push({postId:'manual-publication',pageId:f.external(post),externalPostId:'manual-video',publishedAt:new Date(at('16:00:00')).toISOString()});
  const scheduler=new SocialScheduler(f.store,async()=>{calls++;return{status:'published'};},{intervalMs:0,now:()=>at('17:00:00')});
  scheduler.process(post);assert.equal(calls,0);assert.equal(post.status,'draft');
  Object.assign(post,{status:'scheduled',pageId:f.state.socialPages[0].id,pageGroupId:'g0',publication:{externalPostId:'comment-retry-video'}});
  await scheduler.process(post);assert.equal(calls,1);await scheduler.close();
});

test('daily mode survives unrelated edits and calendar boundaries use local days including DST',()=>{
  const c=normalizeScheduleConfig({perPageDaily:true,times:['16:00']});assert.equal(normalizeScheduleConfig({staggerMinutes:3},c).perPageDaily,true);assert.equal(normalizeScheduleConfig({perPageDaily:false},c).perPageDaily,false);
  const current=Date.parse('2026-03-08T12:00:00Z');assert.equal(postingTime(current,'America/New_York','16:00'),Date.parse('2026-03-08T20:00:00Z'));assert.equal(postingTime(current,'America/New_York','00:00',1)-postingTime(current,'America/New_York'),23*3600000);
});
