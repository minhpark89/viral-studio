import { groupReadyPageIds, resolvePageToken } from './page-routing.js';
import { publishedVideo } from './post-lifecycle.js';
import { pageDailyMode, postingDay, postingTime } from '../shared/posting-calendar.js';

const minute = 60_000;
const active = group => pageDailyMode(group) && group.scheduleConfig.enabled && group.scheduleConfig.autoPublish !== false && group.scheduleConfig.times?.length && group.purpose !== 'review' && !group.id.startsWith('pgrp_hold_');
const queued = post => post.status === 'scheduled' && !post.archivedAt && !post.deletedAt && !post.automationRetryBlocked;
const externalPage = (state, pageId) => String(state.socialPages?.find(page => page.id === pageId)?.externalId || pageId || '');
const stamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const gaps = group => {
  const c = group?.scheduleConfig || {};
  return { group: Math.max(Number(c.staggerMinutes) || 0, Number(c.crossTokenMinutes) || 0) * minute, token: (Number(c.sameTokenMinutes) || 0) * minute, page: (Number(c.samePageMinutes) || 0) * minute, pool: (Number(c.crossTokenMinutes) || 0) * minute };
};

export function dailyPagePublished(store, post, nowValue = Date.now()) {
  const state = store.state, group = state.settings?.meta?.pageGroups?.find(g => g.id === post.pageGroupId);
  if (!pageDailyMode(group)) return false;
  const pageId = externalPage(state, post.pageId), timezone = group.scheduleConfig.timezone, day = postingDay(nowValue, timezone);
  return publicationRecords(state).some(record => record.postId !== post.id && record.pageId === pageId && postingDay(record.at, timezone) === day);
}

function publicationRecords(state) {
  const records = new Map();
  for (const record of state.settings?.meta?.publications || []) {
    if (!record.externalPostId || !stamp(record.publishedAt)) continue;
    records.set(record.postId || record.externalPostId, { postId: record.postId, pageId: externalPage(state, record.pageId), groupId: record.pageGroupId, poolId: record.tokenGroupId, at: stamp(record.publishedAt) });
  }
  for (const post of state.socialPosts || []) {
    if (!(post.publication?.externalPostId || post.status === 'published') || !stamp(post.publication?.publishedAt || post.publishedAt)) continue;
    records.set(post.id, { postId: post.id, pageId: externalPage(state, post.pageId), groupId: post.pageGroupId, poolId: post.tokenGroupId, at: stamp(post.publication?.publishedAt || post.publishedAt) });
  }
  return [...records.values()];
}

// Reallocation keeps the content and video available. This is distinct from a
// failed delivery returned to the warehouse for human review.
export function releaseDailyAllocation(post, nowValue, reason) {
  Object.assign(post, { status: 'draft', pageId: '', pageGroupId: '', tokenGroupId: '', scheduledAt: null,
    automationDay: null, automationStatus: null, automationNextAttemptAt: null, automationCadence: null,
    automationDailyReason: reason, revision: Number(post.revision || 1) + 1, updatedAt: new Date(nowValue).toISOString() });
}

export function scheduleDailyPages(store, { groups, candidates, validate, nowValue = Date.now() }) {
  const state = store.state, meta = state.settings.meta;
  const enabled = groups.filter(active), results = { scheduled: [], released: [], errors: [] };
  if (!enabled.length) return results;
  let changed = false;
  const allGroups = new Map((meta.pageGroups || []).map(group => [group.id, group]));
  const publications = publicationRecords(state);
  const routeCache = new Map();
  const route = (pageId, group, poolId = group?.scheduleConfig?.tokenGroupId || '') => {
    const key = `${poolId}:${pageId}`;
    if (!routeCache.has(key)) routeCache.set(key, resolvePageToken(meta, meta.pages?.find(page => page.id === pageId), poolId)?.tokenId || '');
    return routeCache.get(key);
  };
  const contexts = enabled.map(group => {
    const c = group.scheduleConfig, ready = groupReadyPageIds(store, group), timezone = c.timezone;
    const start = postingTime(nowValue, timezone, [...c.times].sort()[0]), end = postingTime(nowValue, timezone, '00:00', 1);
    const signature = JSON.stringify([c.perPageDaily, c.times, c.timezone, c.staggerMinutes, c.sameTokenMinutes, c.crossTokenMinutes, c.samePageMinutes, c.tokenGroupId]);
    return { group, ready, timezone, day: postingDay(nowValue, timezone), dayStart: postingTime(nowValue, timezone), start, end, signature, owned: [], blockedTime: new Set() };
  });
  // An explicit token pool wins over a broad, unscoped group. A shared Page
  // has only one daily owner; adding it to another group cannot double-post.
  for (const pageId of new Set(contexts.flatMap(c => c.ready))) {
    const owners = contexts.filter(c => c.ready.includes(pageId)).sort((a, b) => Number(Boolean(b.group.scheduleConfig.tokenGroupId)) - Number(Boolean(a.group.scheduleConfig.tokenGroupId)) || a.ready.length - b.ready.length || a.group.id.localeCompare(b.group.id));
    owners[0].owned.push(pageId);
  }
  const contextById = new Map(contexts.map(c => [c.group.id, c]));
  const occupied = new Set();
  const pending = (state.socialPosts || []).filter(queued).sort((a, b) => Number(a.automationSource === 'daily-automation') - Number(b.automationSource === 'daily-automation') || stamp(a.scheduledAt) - stamp(b.scheduledAt));
  for (const post of pending) {
    const context = contextById.get(post.pageGroupId), pageId = externalPage(state, post.pageId);
    if (!context || post.automationSource !== 'daily-automation' || publishedVideo(store, post)) continue;
    const intended = postingDay(Math.max(nowValue, stamp(post.scheduledAt)), context.timezone);
    const key = `${pageId}:${intended}`;
    const alreadyPublished = publications.some(record => record.pageId === pageId && postingDay(record.at, context.timezone) === intended);
    const duplicate = pending.some(other => other !== post && other.automationSource !== 'daily-automation' && externalPage(state, other.pageId) === pageId && postingDay(Math.max(nowValue, stamp(other.scheduledAt)), context.timezone) === intended) || occupied.has(key);
    const unattempted = !post.automationAttempts && post.automationStatus !== 'publishing';
    const changedSchedule = context.group.dailyScheduleSignature !== context.signature;
    const expired = postingDay(stamp(post.scheduledAt) || nowValue, context.timezone) < context.day;
    if (post.automationStatus !== 'publishing' && (alreadyPublished || duplicate || unattempted && (changedSchedule || expired))) {
      releaseDailyAllocation(post, nowValue, alreadyPublished || duplicate ? 'Page đã có bài trong ngày; nội dung được giữ trong kho.' : 'Xếp lại theo lịch mỗi Page một bài mỗi ngày.');
      results.released.push(post.id); changed = true;
    } else occupied.add(key);
  }
  const reservations = [];
  const reserve = (record, group) => reservations.push({ ...record, tokenId: record.tokenId || route(record.pageId, group, record.poolId), gaps: gaps(group) });
  for (const record of publications) if (record.at >= nowValue - 8 * 86_400_000) reserve(record, allGroups.get(record.groupId));
  for (const post of state.socialPosts || []) {
    if (!queued(post) || publishedVideo(store, post)) continue;
    const group = allGroups.get(post.pageGroupId), pageId = externalPage(state, post.pageId);
    reserve({ postId: post.id, pageId, groupId: post.pageGroupId, poolId: post.tokenGroupId || group?.scheduleConfig?.tokenGroupId || '', at: Math.max(stamp(post.scheduledAt), stamp(post.automationNextAttemptAt), nowValue), queued: true }, group);
  }
  const covered = (context, pageId) => reservations.some(record => record.pageId === pageId && record.at >= context.dayStart && record.at < context.end);
  const plannedAt = (context, pageId) => {
    const group = context.group, poolId = group.scheduleConfig.tokenGroupId || '', tokenId = route(pageId, group), interval = gaps(group), ledger = meta.publishCadence || {};
    let at = Math.max(context.start, nowValue + 1_000,
      ledger.tokenNext?.[tokenId] || 0, ledger.pageNext?.[pageId] || 0, poolId ? ledger.poolNext?.[poolId] || 0 : 0,
      ledger.tokens?.[tokenId] === undefined ? 0 : ledger.tokens[tokenId] + interval.token,
      ledger.groups?.[group.id] === undefined ? 0 : ledger.groups[group.id] + interval.group,
      ledger.pages?.[pageId] === undefined ? 0 : ledger.pages[pageId] + interval.page,
      !poolId || ledger.pools?.[poolId] === undefined ? 0 : ledger.pools[poolId] + interval.pool);
    for (let pass = 0; pass <= reservations.length; pass++) {
      let moved = false;
      for (const r of reservations) {
        const gap = Math.max(r.groupId === group.id ? Math.max(interval.group, r.gaps.group) : 0,
          tokenId && r.tokenId === tokenId ? Math.max(interval.token, r.gaps.token) : 0,
          r.pageId === pageId ? Math.max(interval.page, r.gaps.page) : 0,
          poolId && r.poolId === poolId ? Math.max(interval.pool, r.gaps.pool) : 0);
        if (gap && Math.abs(at - r.at) < gap) { at = r.at + gap; moved = true; }
      }
      if (!moved) break;
    }
    return at < context.end ? { at, tokenId, poolId } : null;
  };
  // The caller recomputes candidates after releasing outdated reservations.
  const stock = candidates();
  while (stock.length) {
    const options = [];
    for (const context of contexts) {
      for (const pageId of context.owned) {
        if (covered(context, pageId)) continue;
        const slot = plannedAt(context, pageId);
        if (!slot) { context.blockedTime.add(pageId); continue; }
        options.push({ context, pageId, ...slot });
      }
    }
    options.sort((a, b) => a.at - b.at || a.context.group.id.localeCompare(b.context.group.id));
    if (!options.length) break;
    const { context, pageId, at, poolId, tokenId } = options[0], group = context.group;
    const page = state.socialPages.find(p => String(p.externalId) === pageId && !p.archived), post = stock.shift();
    const changes = { pageId: page?.id || '', pageGroupId: group.id, tokenGroupId: poolId, status: 'scheduled', scheduledAt: new Date(at).toISOString(),
      automationSource: 'daily-automation', automationDay: context.day, automationStatus: null, automationError: null, automationAttempts: 0,
      automationNextAttemptAt: null, automationRetryBlocked: false, automationBlockedReason: null, automationErrorDetails: null, automationDailyReason: null };
    try { validate(post, changes); }
    catch (error) {
      post.automationStatus = 'schedule_error'; post.automationError = String(error.message || error);
      results.errors.push({ postId: post.id, groupId: group.id, message: post.automationError }); changed = true; continue;
    }
    Object.assign(post, changes, { revision: Number(post.revision || 1) + 1, updatedAt: new Date(nowValue).toISOString() });
    group.lastScheduledPageId = pageId;
    reserve({ postId: post.id, pageId, groupId: group.id, poolId, tokenId, at, queued: true }, group);
    results.scheduled.push(post); changed = true;
  }
  for (const context of contexts) {
    const group = context.group, done = new Set(publications.filter(r => r.at >= context.dayStart && r.at < context.end).map(r => r.pageId));
    if (group.dailyScheduleError) { group.dailyScheduleError = null; changed = true; }
    const published = context.owned.filter(id => done.has(id)).length;
    const scheduled = context.owned.filter(id => !done.has(id) && covered(context, id)).length;
    const missing = context.owned.filter(id => !covered(context, id));
    const waitingTime = missing.filter(id => !plannedAt(context, id)).length;
    const summary = { day: context.day, target: context.owned.length, published, scheduled, waitingContent: missing.length - waitingTime, waitingTime,
      unavailable: group.pageIds.length - context.ready.length, shared: context.ready.length - context.owned.length };
    if (JSON.stringify(group.dailyAutomation) !== JSON.stringify(summary) || group.dailyScheduleSignature !== context.signature) {
      group.dailyAutomation = summary; group.dailyScheduleSignature = context.signature; changed = true;
    }
  }
  if (changed) store.save();
  return results;
}
