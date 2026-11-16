import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StudioError } from './store.js';
import { pageUnavailableReason } from './page-routing.js';
import { normalizeScheduleConfig } from './social.js';

const ids = z.array(z.string().min(1).max(250)).max(5000).transform(values => [...new Set(values)]);
const sourceSchema = z.object({ tokenIds: ids.default([]), poolId: z.string().max(250).default('') });
const scheduleSchema = z.object({
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(200).default([]),
  timezone: z.string().min(1).max(100).default('Asia/Ho_Chi_Minh'),
  enabled: z.boolean().default(false), autoPublish: z.boolean().optional(),
  staggerMinutes: z.number().min(0).max(1440).default(15),
  sameTokenMinutes: z.number().min(0).max(1440).default(10),
  crossTokenMinutes: z.number().min(0).max(1440).default(1),
  samePageMinutes: z.number().min(0).max(10080).default(60),
  dailyLimit: z.number().int().min(0).max(200).default(0),
  perPageDaily: z.boolean().default(true),
});
const setupSchema = sourceSchema.extend({
  requestId: z.string().uuid(), name: z.string().trim().min(1).max(120),
  pageIds: ids.refine(values => values.length > 0, 'Chọn ít nhất một Page.'),
  scheduleConfig: scheduleSchema.default({}),
});
const failure = (message, code = 'GROUP_SETUP_INVALID') => new StudioError(message, code, 409);

// The preview and commit use the same routing checks. Draft pools are never
// inserted into live state: cancelling a dialog cannot leave an orphan pool.
export function mountGroupSetupRoutes(app, store, { tokenGroupDraft, autoAssignTokenGroup, publicTokenGroup, publicPageGroup }) {
  const plan = input => {
    const meta = store.state.settings.meta;
    const source = sourceSchema.parse(input);
    if (source.poolId && source.tokenIds.length) throw failure('Chọn pool có sẵn hoặc danh sách token.');
    const existing = source.poolId ? meta.tokenGroups.find(pool => pool.id === source.poolId) : null;
    if (source.poolId && !existing) throw failure('Pool không còn tồn tại. Làm mới danh sách.', 'META_TOKEN_GROUP_NOT_FOUND');
    if (!existing && !source.tokenIds.length) throw failure('Chọn ít nhất một token.');
    if (!existing && source.tokenIds.some(id => !meta.tokens.some(token => token.id === id && token.status === 'ACTIVE' && token.token))) {
      throw failure('Có token đã bị xóa hoặc không còn hoạt động. Chọn lại danh sách token.', 'META_TOKEN_UNAVAILABLE');
    }
    const pool = existing || tokenGroupDraft(meta, { name: 'Pool nhóm Page mới', tokenIds: source.tokenIds, pageScope: 'all', strategy: 'round_robin', maxPagesPerToken: 0, autoAssign: true });
    if (!existing) autoAssignTokenGroup(meta, pool);
    const scope = new Set(pool.pageIds || []);
    const draftMeta = existing ? meta : { ...meta, tokenGroups: [...meta.tokenGroups, pool] };
    const localById = new Map(store.state.socialPages.map(page => [page.externalId, page]));
    const pages = meta.pages.filter(page => scope.has(page.id)).map(page => ({
      id: page.id, name: page.name || page.id,
      reason: pageUnavailableReason(draftMeta, page, localById.get(page.id), pool.id),
    }));
    const readyPageIds = pages.filter(page => !page.reason).map(page => page.id);
    return { pool, existing: Boolean(existing), pages, readyPageIds, blocked: pages.filter(page => page.reason) };
  };

  app.post('/api/meta/group-setup/preview', (req, res) => {
    const preview = plan(req.body);
    res.json({ pages: preview.pages, readyPageIds: preview.readyPageIds, blocked: preview.blocked, pool: publicTokenGroup(preview.pool) });
  });

  app.post('/api/meta/group-setup', (req, res) => {
    const input = setupSchema.parse(req.body);
    try { new Intl.DateTimeFormat('vi', { timeZone: input.scheduleConfig.timezone }).format(); }
    catch { throw failure('Múi giờ không hợp lệ.'); }
    const schedule = normalizeScheduleConfig(input.scheduleConfig);
    if (schedule.enabled && !schedule.times.length) throw failure('Đặt ít nhất một khung giờ trước khi bật Auto Post.');
    const meta = store.state.settings.meta;
    const signature = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = meta.pageGroups.find(group => group.setupRequestId === input.requestId);
    if (previous) {
      if (previous.setupSignature !== signature) throw failure('Yêu cầu này đã được lưu với nội dung khác. Mở lại nhóm để sửa.');
      return res.json({ group: publicPageGroup(previous, meta), pool: publicTokenGroup(meta.tokenGroups.find(pool => pool.id === previous.scheduleConfig.tokenGroupId) || {}), reused: true });
    }
    const preview = plan(input);
    const ready = new Set(preview.readyPageIds);
    const invalid = input.pageIds.find(id => !ready.has(id));
    if (invalid) throw failure(`${meta.pages.find(page => page.id === invalid)?.name || invalid}: Page không còn sẵn sàng trong nguồn token đã chọn. Quay lại bước chọn token để tải lại.`, 'GROUP_SETUP_PAGE_UNAVAILABLE');
    const now = new Date().toISOString();
    const group = { id: `pgrp_${randomUUID().replaceAll('-', '').slice(0, 12)}`, name: input.name, pageIds: input.pageIds, purpose: 'active', folderBinding: '', createdAt: now, updatedAt: now, scheduleConfig: { ...schedule, tokenGroupId: preview.pool.id }, setupRequestId: input.requestId, setupSignature: signature };
    const pool = preview.pool;
    if (!preview.existing) {
      // A group-scoped pool follows later membership edits without absorbing
      // unrelated Pages discovered by the same token in the future.
      Object.assign(pool, { name: input.name, pageScope: 'group', pageGroupId: group.id });
      autoAssignTokenGroup({ ...meta, pageGroups: [...meta.pageGroups, group] }, pool);
      if (pool.assignmentBlockedCount) throw failure('Phân công token đã thay đổi. Xem lại danh sách Page.');
    }
    const oldGroups = meta.pageGroups, oldPools = meta.tokenGroups;
    const selected = new Set(group.pageIds);
    const changedPages = meta.pages.filter(page => selected.has(page.id));
    const before = changedPages.map(page => ({ page, groupIds: page.groupIds, management: page.management }));
    try {
      meta.pageGroups = [...oldGroups, group];
      if (!preview.existing) meta.tokenGroups = [...oldPools, pool];
      for (const page of changedPages) {
        page.groupIds = meta.pageGroups.filter(item => item.pageIds.includes(page.id)).map(item => item.id);
        page.management = { ...page.management, revision: Number(page.management?.revision || 0) + 1 };
      }
      store.save();
    } catch (error) {
      meta.pageGroups = oldGroups; meta.tokenGroups = oldPools;
      for (const item of before) {
        if (item.groupIds === undefined) delete item.page.groupIds; else item.page.groupIds = item.groupIds;
        if (item.management === undefined) delete item.page.management; else item.page.management = item.management;
      }
      throw error;
    }
    // The regular scheduler picks up enabled groups on its next tick. Saving
    // a disabled group does not allocate or change any warehouse posts.
    res.status(201).json({ group: publicPageGroup(group, meta), pool: publicTokenGroup(pool), reused: false });
  });
}
