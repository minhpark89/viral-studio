import { researchBatchRequestSchema } from '../shared/research-contracts.js';
import { StudioError } from './store.js';

export class ResearchBatchService {
  constructor(store, research) {
    this.store = store;
    this.research = research;
    this.closed = false;
    this.worker = null;
    for (const batch of store.state.researchBatches) {
      if (!['pending', 'running', 'interrupted'].includes(batch.status)) continue;
      for (const item of batch.items) {
        const saved = store.state.researchResults.find(result => result.batchId === batch.id && result.batchItemIndex === item.index);
        if (saved) Object.assign(item, { status: 'completed', resultId: saved.id, error: null });
        else if (['preparing', 'interrupted'].includes(item.status)) item.status = 'pending';
      }
      batch.status = 'pending';
    }
    if (store.state.researchBatches.some(batch => batch.status === 'pending')) this.kick();
  }

  create(input) {
    const request = researchBatchRequestSchema.parse(input);
    this.store.require('projects', request.projectId);
    const existing = this.store.state.researchBatches.find(batch => batch.request.requestId === request.requestId);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) throw new StudioError('Lượt research này đã dùng cấu hình khác.', 'REQUEST_CONFLICT', 409);
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
          const excludeArticles = this.store.state.researchResults.filter(result => result.projectId === batch.projectId).flatMap(result => result.articles || []);
          const found = await this.research.discover({ ...batch.request, excludeArticles, signal });
          signal.throwIfAborted();
          batch.items = found.articles.slice(0, batch.request.count).map((article, index) => ({ index, article, status: 'pending', resultId: null, error: null }));
          batch.discovered = true;
          batch.warnings = [...found.warnings];
          if (batch.items.length < batch.request.count) batch.warnings.push(`Tìm được ${batch.items.length}/${batch.request.count} tin mới trong ngày Mỹ. Đã bỏ nguồn trùng hoặc đã research; hãy mở rộng chủ đề hoặc thêm RSS để lấy thêm tin.`);
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
        batch.status = batch.items.some(item => item.status === 'failed') ? 'partial' : 'completed';
      } catch (error) {
        if (batch.status !== 'cancelled') batch.status = this.closed ? 'interrupted' : 'failed';
        batch.error = signal.aborted ? null : error.code === 'NO_CURRENT_NEWS'
          ? 'Chưa tìm thấy tin mới khớp chủ đề trong ngày Mỹ, hoặc các tin này đã research. Thử chủ đề rộng hơn hay thêm nguồn RSS.' : error.message;
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
