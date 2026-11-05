import { autoScheduleWarehousePosts } from "./social.js";
import { automaticPostRetry } from "./meta-errors.js";
import { publishedVideo, returnPostToWarehouse } from './post-lifecycle.js';
import { resolvePageToken, reconcileGroupQueue } from './page-routing.js';
import { managedPageUnavailable } from '../shared/management.js';

export class SocialScheduler {
  constructor(store, publishReel, { intervalMs = 15_000, now = Date.now } = {}) {
    this.store = store;
    this.publishReel = publishReel;
    this.now = now;
    this.running = new Set();
    this.pending = new Set();
    this.closed = false;
    this.timer = intervalMs > 0 ? setInterval(() => this.tick(), intervalMs) : null;
    this.timer?.unref();
    this.tick();
  }

  duePosts() {
    const current = this.now();
    return (this.store.state.socialPosts || []).filter((post) => {
      if (post.status !== "scheduled" || !post.scheduledAt || this.running.has(post.id) || post.automationRetryBlocked || post.deletedAt || post.archivedAt) return false;
      const group = this.store.state.settings?.meta?.pageGroups?.find(group => group.id === post.pageGroupId);
      if (group?.purpose === 'review' || group?.id?.startsWith('pgrp_hold_')) return false;
      if (post.automationSource === 'daily-automation' && (!group?.scheduleConfig?.enabled || group.scheduleConfig.autoPublish === false)) return false;
      const local = this.store.state.socialPages?.find(page => page.id === post.pageId);
      const page = this.store.state.settings?.meta?.pages?.find(page => page.id === local?.externalId);
      if (managedPageUnavailable(page, local)) return false;
      // Upgrade old queued errors without sending another request to Meta.
      if (post.automationError) {
        const error = { message: post.automationError, metaError: post.automationErrorDetails };
        const decision = automaticPostRetry(error, Number(post.automationAttempts || 0), current);
        if (decision.blocked) {
          this.recordFailure(post, error, false);
          return false;
        }
      }
      if (post.automationNextAttemptAt && Date.parse(post.automationNextAttemptAt) > current) return false;
      return Date.parse(post.scheduledAt) <= current;
    });
  }

  process(post) {
    if (this.closed || this.running.has(post.id) || post.automationRetryBlocked || post.deletedAt || post.archivedAt) return null;
    if (!this.reserveCadence(post)) return null;
    this.running.add(post.id);
    const task = this.processPost(post);
    this.pending.add(task);
    task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }

  reserveCadence(post) {
    // A first-comment retry does not publish another video or consume its slot.
    if (publishedVideo(this.store, post)) return true;
    const meta = this.store.state.settings?.meta;
    const group = meta?.pageGroups?.find(group => group.id === post.pageGroupId);
    const same = Math.max(0, Number(group?.scheduleConfig?.sameTokenMinutes) || 0) * 60_000;
    const cross = Math.max(0, Number(group?.scheduleConfig?.crossTokenMinutes) || 0) * 60_000;
    const stagger = Math.max(0, Number(group?.scheduleConfig?.staggerMinutes) || 0) * 60_000;
    const samePage = Math.max(0, Number(group?.scheduleConfig?.samePageMinutes) || 0) * 60_000;
    if (!group) return true;
    const page = this.store.state.socialPages?.find(page => page.id === post.pageId);
    const managedPage = meta.pages?.find(managedPage => managedPage.id === page?.externalId);
    const poolId = post.tokenGroupId || group?.scheduleConfig?.tokenGroupId || '';
    const route = resolvePageToken(meta, managedPage, poolId);
    const tokenId = route?.tokenId;
    if (!tokenId) {
      this.recordFailure(post, { message: 'Thiếu phân công token cố định cho lịch giãn cách. Kiểm tra nhóm token và Page trước khi xếp lịch lại.', code: 'META_PAGE_NOT_BOUND' });
      return false;
    }
    const ledger = meta.publishCadence ||= { tokens: {}, groups: {} };
    ledger.tokens ||= {}; ledger.groups ||= {}; ledger.pages ||= {}; ledger.pools ||= {};
    ledger.tokenNext ||= {}; ledger.pageNext ||= {}; ledger.poolNext ||= {};
    const current = this.now();
    const afterToken = ledger.tokens[tokenId] === undefined ? 0 : Number(ledger.tokens[tokenId]) + same;
    const afterGroup = ledger.groups[group.id] === undefined ? 0 : Number(ledger.groups[group.id]) + Math.max(cross, stagger);
    const afterPage = ledger.pages[page.externalId] === undefined ? 0 : Number(ledger.pages[page.externalId]) + samePage;
    const afterPool = !poolId || ledger.pools[poolId] === undefined ? 0 : Number(ledger.pools[poolId]) + cross;
    const earliest = Math.max(afterToken, afterGroup, afterPage, afterPool, ledger.tokenNext[tokenId] || 0, ledger.pageNext[page.externalId] || 0, poolId ? ledger.poolNext[poolId] || 0 : 0);
    if (earliest > current) {
      const nextAt = new Date(earliest).toISOString();
      if (post.automationNextAttemptAt !== nextAt) {
        post.automationNextAttemptAt = nextAt;
        post.automationCadence = { ...post.automationCadence, tokenId, nextAt };
        this.store.save();
      }
      return false;
    }
    // Reserve synchronously and persist before sending to Meta. A restart or
    // overdue queue therefore cannot collapse the user's posting intervals.
    ledger.tokens[tokenId] = current;
    ledger.groups[group.id] = current;
    ledger.pages[page.externalId] = current;
    if (poolId) ledger.pools[poolId] = current;
    ledger.tokenNext[tokenId] = current + same;
    ledger.pageNext[page.externalId] = current + samePage;
    if (poolId) ledger.poolNext[poolId] = current + cross;
    post.automationCadence = { tokenId, attemptedAt: new Date(current).toISOString(), nextAt: null };
    post.automationNextAttemptAt = null;
    this.store.save();
    return true;
  }

  async processPost(post) {
    const key = `schedule:${post.id}:${post.revision}`;
    try {
      if (this.store.state.socialPosts.some((item) => item.id === post.id)) {
        Object.assign(post, { automationStatus: "publishing", automationError: null, updatedAt: new Date().toISOString() });
        this.store.save();
      }
      const result = await this.publishReel({ postId: post.id, idempotencyKey: key });
      const current = this.store.state.socialPosts.find((item) => item.id === post.id);
      if (!current) return;
      if (result?.status === "published_comment_error") {
        this.recordFailure(current, { message: result.firstCommentError || "First comment failed.", metaError: result.firstCommentErrorDetails }, true, false);
      }
    } catch (error) {
      const current = this.store.state.socialPosts.find((item) => item.id === post.id);
      if (current) {
        this.recordFailure(current, error);
      }
    } finally {
      this.running.delete(post.id);
    }
  }

  recordFailure(post, error, increment = true, allowWarehouseReturn = true) {
    const attempts = Number(post.automationAttempts || 0) + (increment ? 1 : 0);
    const decision = automaticPostRetry(error, attempts, this.now());
    Object.assign(post, {
      automationStatus: "meta_error",
      automationError: String(error?.message || error),
      automationErrorDetails: decision.details,
      automationAttempts: attempts,
      automationRetryBlocked: decision.blocked,
      automationBlockedReason: decision.reason,
      automationNextAttemptAt: decision.nextAttemptAt,
      updatedAt: new Date(this.now()).toISOString(),
    });
    if (decision.blocked && allowWarehouseReturn && !publishedVideo(this.store, post)) returnPostToWarehouse(this.store, post, { automatic:true, at:new Date(this.now()).toISOString() });
    this.store.save();
  }

  async tick() {
    if (this.closed) return;
    for (const group of this.store.state.settings?.meta?.pageGroups || []) {
      try {
        reconcileGroupQueue(this.store, group);
        autoScheduleWarehousePosts(this.store, group.id, {
          tokenGroupId: group.scheduleConfig?.tokenGroupId || "",
          nowValue: this.now(),
        });
      } catch {
        // A group with incomplete Page/token mapping remains visible in the
        // workspace and can be fixed there; it must not stop other groups.
      }
    }
    await Promise.all(this.duePosts().sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)).map((post) => this.process(post)));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.pending]);
  }
}
