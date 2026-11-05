import { researchBatchRequestSchema } from '../shared/research-contracts.js';
import { StudioError } from './store.js';
import { researchTitleKey, researchUrlKey } from './research-discovery.js';

export class ResearchBatchService {
  constructor(store, research) {
    this.store = store;
    this.research = research;
    this.closed = false;
    this.worker = null;
    let migrated = false;
    for (const batch of store.state.researchBatches) {
      // Older versions called a short batch "completed" and offered no retry.
      // Expose the missing count without starting new work on an upgrade.
      if (batch.status === 'completed' && batch.items.length < batch.request.count) {
        batch.status = 'partial'; migrated = true;
        batch.warnings = (batch.warnings || []).filter(warning => !warning.includes('hãy mở rộng chủ đề'));
        batch.warnings.push(`Lượt cũ có ${batch.items.length}/${batch.request.count} tin. Bấm “Tìm tiếp phần thiếu” để tự mở rộng cùng chủ đề và giữ nguyên các tin đã lưu.`);
      }
      if (!['pending', 'running', 'interrupted'].includes(batch.status)) continue;
      for (const item of batch.items) {
        const saved = store.state.researchResults.find(result => result.batchId === batch.id && result.batchItemIndex === item.index);
        if (saved) Object.assign(item, { status: 'completed', resultId: saved.id, error: null });
        else if (['preparing', 'interrupted'].includes(item.status)) item.status = 'pending';
      }
      batch.status = 'pending';
    }
    if (migrated) store.save();
    if (store.state.researchBatches.some(batch => batch.status === 'pending')) this.kick();
  }

  create(input) {
    const request = researchBatchRequestSchema.parse(input);
    this.store.require('projects', request.projectId);
    const existing = this.store.state.researchBatches.find(batch => batch.request.requestId === request.requestId);
    if (existing) {
      if (JSON.stringify(researchBatchRequestSchema.parse(existing.request)) !== JSON.stringify(request)) throw new StudioError('Lượt research này đã dùng cấu hình khác.', 'REQUEST_CONFLICT', 409);
      return existing;
    }
    if (this.store.state.researchBatches.some(batch => batch.projectId === request.projectId && ['pending', 'running'].includes(batch.status)))
      throw new StudioError('Dự án đang research. Theo dõi tiến độ hoặc dừng lượt hiện tại trước.', 'RESEARCH_BUSY', 409);
    const batch = this.store.add('researchBatches', { projectId: request.projectId, request, status: 'pending', discovered: false, items: [], warnings: [], error: null });
    this.kick();
    return batch;
  }

  retry(id) {
    const batch = this.store.require('researchBatches', id);
    if (['pending', 'running'].includes(batch.status)) return batch;
    if (this.store.state.researchBatches.some(other => other.id !== id && other.projectId === batch.projectId && ['pending', 'running'].includes(other.status)))
      throw new StudioError('Hãy đợi lượt research hiện tại hoàn tất.', 'RESEARCH_BUSY', 409);
    for (const item of batch.items) if (!item.resultId) Object.assign(item, { status: 'pending', error: null });
    Object.assign(batch, { status: 'pending', error: null });
    if (batch.items.length < batch.request.count) batch.discovered = false;
    this.store.save();
    this.kick();
    return batch;
  }

  cancel(id) {
    const batch = this.store.require('researchBatches', id);
    if (!['pending', 'running'].includes(batch.status)) return batch;
    batch.status = 'cancelled';
    if (this.activeId === id) this.controller?.abort();
    this.store.save();
    return batch;
  }

  kick() {
    if (this.worker || this.closed) return;
    this.worker = Promise.resolve().then(() => this.drain()).finally(() => {
      this.worker = null;
      if (this.store.state.researchBatches.some(batch => batch.status === 'pending')) this.kick();
    });
  }

  async drain() {
    while (!this.closed) {
      const batch = this.store.state.researchBatches.find(batch => batch.status === 'pending');
      if (!batch) return;
      this.activeId = batch.id;
      this.controller = new AbortController();
      const { signal } = this.controller;
      batch.status = 'running';
      this.store.save();
      try {
        if (!batch.discovered) {
          const existingCount = batch.items.length;
          const excludeArticles = [...this.store.state.researchResults.filter(result => result.projectId === batch.projectId).flatMap(result => result.articles || []), ...batch.items.map(item => item.article)];
          const urls = new Set(excludeArticles.map(article => researchUrlKey(article.url)));
          const titles = new Set(excludeArticles.map(researchTitleKey));
          const append = articles => {
            for (const article of articles) {
              const url = researchUrlKey(article.url), title = researchTitleKey(article);
              if (batch.items.length >= batch.request.count || urls.has(url) || titles.has(title)) continue;
              urls.add(url); titles.add(title);
              const index = batch.items.reduce((max, item) => Math.max(max, item.index), -1) + 1;
              batch.items.push({ index, article, status: 'pending', resultId: null, error: null });
            }
          };
          const found = existingCount >= batch.request.count ? { articles: [], warnings: [] } : await this.research.discover({ ...batch.request, count: batch.request.count - existingCount, excludeArticles, signal,
            onProgress: async (discovery, articles) => {
              append(articles);
              batch.discovery = { ...discovery, found: batch.items.length, target: batch.request.count };
              this.store.save();
            },
          });
          signal.throwIfAborted();
          append(found.articles);
          batch.discovered = true;
          batch.warnings = [...found.warnings];
          if (found.discovery) batch.discovery = { ...found.discovery, found: batch.items.length, target: batch.request.count };
          if (batch.items.length < batch.request.count) batch.warnings.push(`Tìm được ${batch.items.length}/${batch.request.count} tin sau khi tự mở rộng trong ${batch.request.windowHours || 24} giờ qua. Chưa có thêm nguồn mới phù hợp; bấm “Tìm tiếp phần thiếu” để cập nhật nguồn, hoặc tạo lượt mới với khoảng thời gian rộng hơn.`);
          this.store.save();
        }
        for (const item of batch.items) {
          signal.throwIfAborted();
          if (item.status !== 'pending') continue;
          item.status = 'preparing';
          this.store.save();
          try {
            const result = await this.research.research({ ...batch.request, topic: item.article.title.slice(0, 200), maxArticles: 1 }, this.store,
              { articles: [item.article], batchId: batch.id, batchItemIndex: item.index, signal });
            Object.assign(item, { resultId: result.id, status: 'completed', error: null });
          } catch (error) {
            item.status = signal.aborted ? 'interrupted' : 'failed';
            item.error = signal.aborted ? null : error.message;
            if (signal.aborted) throw error;
          }
          this.store.save();
        }
        const completed = batch.items.filter(item => item.status === 'completed').length;
        batch.status = completed === batch.request.count ? 'completed' : batch.items.length ? 'partial' : 'failed';
        if (!batch.items.length) batch.error = 'Chưa tìm thấy tin mới phù hợp sau khi tự mở rộng từ khóa. Có thể tìm tiếp khi nguồn cập nhật hoặc chọn 3–7 ngày cho lượt mới.';
      } catch (error) {
        if (batch.status !== 'cancelled') batch.status = this.closed ? 'interrupted' : 'failed';
        batch.error = signal.aborted ? null : error.code === 'NO_CURRENT_NEWS'
          ? 'Chưa tìm thấy tin mới phù hợp. Có thể tìm tiếp phần thiếu khi nguồn cập nhật.' : error.message;
      }
      batch.updatedAt = new Date().toISOString();
      this.store.save();
      this.activeId = null;
    }
  }

  async close() {
    this.closed = true;
    this.controller?.abort();
    await this.worker;
  }
}
