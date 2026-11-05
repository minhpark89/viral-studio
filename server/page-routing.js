import { createHash } from 'node:crypto';
import { managedPageUnavailable } from '../shared/management.js';
import { publishedVideo, returnPostToWarehouse } from './post-lifecycle.js';

export function verifiedPageBinding(meta, page, tokenId, { strict = false } = {}) {
  const token = meta?.tokens?.find(item => item.id === tokenId);
  const binding = page?.tokenBindings?.[tokenId];
  if (!token?.token || token.status !== 'ACTIVE' || !binding?.pageToken || binding.status !== 'VERIFIED') return false;
  if (String(binding.verifiedPageId || page.id) !== String(page.id)) return false;
  const fingerprint = createHash('sha256').update(token.token).digest('hex');
  return binding.credentialFingerprint === fingerprint || (!strict && !binding.credentialFingerprint);
}

// This read-only resolver is shared by scheduling and publishing. A selected
// pool is an explicit boundary: never fall back to a credential outside it.
export function resolvePageToken(meta, page, poolId = '', pinnedTokenId = '') {
  const pool = poolId ? meta?.tokenGroups?.find(item => item.id === poolId) : null;
  if (poolId && !pool) return null;
  const assigned = pool?.pageTokenBindings?.[page?.id];
  if (pool && (!assigned || !pool.tokenIds?.includes(assigned))) return null;
  const ids = pinnedTokenId ? [pinnedTokenId] : pool ? [assigned] : Object.keys(page?.tokenBindings || {});
  const available = ids.filter(id => (!pool || id === assigned) && verifiedPageBinding(meta, page, id));
  available.sort((a, b) => {
    const left = meta.tokens.find(t => t.id === a), right = meta.tokens.find(t => t.id === b);
    return String(left.lastUsed || '').localeCompare(String(right.lastUsed || '')) || a.localeCompare(b);
  });
  if (available.length) {
    const tokenId = available[0];
    return { tokenId, accessToken: page.tokenBindings[tokenId].pageToken };
  }
  // Older, single-credential workspaces have no token vault yet.
  if (!poolId && !pinnedTokenId && !meta?.tokens?.length && page?.accessToken && !Object.keys(page.tokenBindings || {}).length) {
    return { tokenId: `legacy:${page.id}`, accessToken: page.accessToken };
  }
  return null;
}

export function pageUnavailableReason(meta, page, local, poolId = '') {
  if (managedPageUnavailable(page, local)) return 'Page bị hạn chế, chờ xử lý, lưu trữ hoặc chưa công khai';
  if (page?.verification?.status === 'error') return 'Kiểm tra Page chưa đạt';
  if (!resolvePageToken(meta, page, poolId)) return poolId ? 'Chưa có phân công token hợp lệ trong pool' : 'Thiếu / lỗi token của Page';
  return '';
}

export function groupReadyPageIds(store, group, poolId = group.scheduleConfig?.tokenGroupId || '') {
  const meta = store.state.settings?.meta || {};
  return [...new Set(group.pageIds || [])].filter(id => {
    const page = meta.pages?.find(item => item.id === id);
    const local = store.state.socialPages?.find(item => item.externalId === id);
    // Keep offline planning available before connecting Meta.
    if (!meta.pages?.length && !meta.tokens?.length) return Boolean(local && !managedPageUnavailable(null, local));
    return !pageUnavailableReason(meta, page, local, poolId);
  });
}

export function reconcileGroupQueue(store, group) {
  const meta = store.state.settings?.meta || {};
  const changed = [];
  for (const post of store.state.socialPosts || []) {
    if (post.pageGroupId !== group.id || post.status !== 'scheduled' || post.automationStatus === 'publishing' || publishedVideo(store, post)) continue;
    const local = store.state.socialPages?.find(page => page.id === post.pageId);
    const page = meta.pages?.find(page => page.id === local?.externalId);
    const removed = !group.pageIds?.includes(local?.externalId);
    const unavailable = managedPageUnavailable(page, local) || page?.verification?.status === 'error'
      || (meta.pages?.length || meta.tokens?.length) && pageUnavailableReason(meta, page, local, post.tokenGroupId || group.scheduleConfig?.tokenGroupId || '');
    if (!removed && !unavailable) continue;
    post.automationError = removed ? 'Page đã được gỡ khỏi nhóm. Chọn Page khác để đăng nội dung này.' : 'Page cần xử lý. Nội dung được giữ trong kho.';
    returnPostToWarehouse(store, post, { automatic: true });
    changed.push(post.id);
  }
  if (changed.length) store.save();
  return changed;
}
