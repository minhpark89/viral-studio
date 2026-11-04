import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { usableTokenBinding } from './meta.js';
import { INSIGHT_KEYS, INSIGHT_MESSAGES, numeric, emptyMetric, insightPeriod, dailyMetric, insightTotals } from '../shared/meta-insights.js';

export const INSIGHTS_TTL = 15 * 60 * 1000;
const MIN_REFRESH = 60 * 1000, COOLDOWN = 15 * 60 * 1000;
const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const scopeSchema = z.object({ days: z.coerce.number().refine(value => [7,28].includes(value)).default(7), pageId: z.string().max(40).default(''), groupId: z.string().max(100).default(''), query: z.string().max(120).default(''), status: z.enum(['all','ready','attention','not_synced']).default('all'), sort: z.enum(['views','followers','engagement','name']).default('views'), page: z.coerce.number().int().min(1).max(100000).default(1) });
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function errorStatus(http, error) {
  if (http === 429 || [4,17,32,613,80001].includes(error?.code)) return 'rate_limited';
  if ([10,190,200].includes(error?.code) || http === 401 || http === 403) return 'permission';
  if (error?.code === 100 && /valid insights metric|not supported|nonexisting field/i.test(String(error.message || ''))) return 'unsupported';
  return 'error';
}
function usagePercent(headers) {
  let maximum = 0;
  const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (['call_count','total_cputime','total_time'].includes(key) && numeric(child)) maximum = Math.max(maximum, child); else walk(child); } };
  for (const name of ['x-app-usage','x-page-usage','x-business-use-case-usage']) try { walk(JSON.parse(headers.get(name) || '{}')); } catch {}
  return maximum;
}

export class MetaInsightsService {
  constructor(store, { fetchImpl = globalThis.fetch, now = () => Date.now(), concurrency = 3 } = {}) {
    this.store = store; this.fetch = fetchImpl; this.now = now; this.concurrency = Math.max(1, Math.min(3, concurrency));
    this.file = path.join(store.root, 'meta-insights.json');
    const saved = readJson(this.file);
    this.cache = saved?.version === 1 && saved.periods && saved.followers ? saved : { version: 1, periods: {}, followers: {}, cooldowns: {}, unsupported: {} };
    this.cache.cooldowns ||= {}; this.cache.unsupported ||= {};
    this.progress = { running: false, completed: 0, total: 0, errors: 0, calls: 0, skipped: 0 };
    this.pending = null; this.controller = null; this.saveTimer = null; this.closed = false;
  }
  meta() { return this.store.state.settings.meta || {}; }
  pages() { return (this.meta().pages || []).filter(page => /^\d{1,40}$/.test(String(page.id)) && page.management?.status !== 'deleted'); }
  binding(page) {
    const meta = this.meta();
    if (meta.enabled === false) return null;
    const entries = Object.keys(page.tokenBindings || {}).filter(id => usableTokenBinding(meta, page, id)).map(id => ({ id, token: meta.tokens.find(token => token.id === id), pageToken: page.tokenBindings[id].pageToken }));
    entries.sort((a,b) => Number(this.limited(a.id, a.token)) - Number(this.limited(b.id, b.token)) || Number(a.token.appUsagePct || 0) - Number(b.token.appUsagePct || 0));
    if (!entries.length) return null;
    const chosen = entries[0]; return { ...chosen, fingerprint: fingerprint(chosen.pageToken) };
  }
  limited(id, token) { return (this.cache.cooldowns[id] || 0) > this.now() || token?.rateStatus === 'COOLDOWN_80' || Number(token?.appUsagePct || 0) >= 80; }
  periodKey(period) { return period.days + ':' + period.until; }
  record(page, period) {
    const binding = this.binding(page), saved = this.cache.periods[this.periodKey(period)]?.pages?.[page.id];
    const valid = Boolean(binding ? saved?.binding === binding.fingerprint : saved && saved.binding === '');
    const metrics = Object.fromEntries(INSIGHT_KEYS.map(key => {
      const metric = valid ? saved.metrics?.[key] : null;
      return [key, metric && (metric.value === null || numeric(metric.value)) ? { ...metric, series: Array.isArray(metric.series) ? metric.series.filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && (point.value === null || numeric(point.value))) : [] } : emptyMetric(binding ? 'not_synced' : 'missing_binding')];
    }));
    const checkedAt = valid ? saved.checkedAt : null;
    const groupIds = [...new Set([...(page.groupIds || []), ...(this.meta().pageGroups || []).filter(group => group.pageIds?.includes(page.id)).map(group => group.id)])];
    const status = !checkedAt ? 'not_synced' : INSIGHT_KEYS.every(key => metrics[key].status === 'ok') ? 'ready' : 'attention';
    return { id: page.id, name: page.name || page.id, url: 'https://www.facebook.com/' + encodeURIComponent(page.id), groupIds, checkedAt, lastSuccessAt: valid ? saved.lastSuccessAt : null, stale: Boolean(checkedAt && this.now() - checkedAt > INSIGHTS_TTL), status, metrics };
  }
  matching(scope, period) {
    const query = scope.query.trim().toLocaleLowerCase();
    return this.pages().map(page => this.record(page, period)).filter(row => (!scope.pageId || row.id === scope.pageId) && (!scope.groupId || row.groupIds.includes(scope.groupId)) && (!query || (row.name + ' ' + row.id).toLocaleLowerCase().includes(query)) && (scope.status === 'all' || row.status === scope.status));
  }
  snapshot(input = {}) {
    const scope = scopeSchema.parse(input), period = insightPeriod(scope.days, this.now());
    const rows = this.matching(scope, period);
    rows.sort((a,b) => scope.sort === 'name' ? a.name.localeCompare(b.name) : (b.metrics[scope.sort].value ?? -1) - (a.metrics[scope.sort].value ?? -1) || a.name.localeCompare(b.name));
    const pages = Math.max(1, Math.ceil(rows.length / 25)), page = Math.min(scope.page, pages);
    return { scope: { ...scope, page }, period, metrics: insightTotals(rows, period), totalPages: this.pages().length, filteredPages: rows.length,
      groups: (this.meta().pageGroups || []).map(group => ({ id: group.id, name: group.name })), pageOptions: this.pages().map(page => ({ id: page.id, name: page.name || page.id })),
      rows: rows.slice((page - 1) * 25, page * 25).map(row => ({ ...row, metrics: Object.fromEntries(INSIGHT_KEYS.map(key => [key, { ...row.metrics[key], series: undefined }])) })),
      pagination: { page, pages, pageSize: 25 }, progress: { ...this.progress }, cacheSeconds: INSIGHTS_TTL / 1000,
      needsRefresh: rows.some(row => !row.checkedAt || row.stale), freshPages: rows.filter(row => row.checkedAt && !row.stale).length,
      cacheWarning: this.cacheWarning || '', reportingNote: 'Dữ liệu trực tiếp từ Meta. Lượt xem và tương tác cộng theo ngày báo cáo Pacific của Meta; người theo dõi là số hiện tại, cộng riêng từng Page. Reach cũ không khả dụng với kết nối đã kiểm tra nên không được thay bằng lượt xem.' };
  }
  save() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    // Keep only four recent period/range snapshots and a bounded daily history.
    const keys = Object.keys(this.cache.periods).sort((a,b) => b.split(':')[1].localeCompare(a.split(':')[1]));
    for (const key of keys.slice(4)) delete this.cache.periods[key];
    const allowed = new Set(this.pages().map(page => page.id));
    for (const period of Object.values(this.cache.periods)) for (const id of Object.keys(period.pages)) if (!allowed.has(id)) delete period.pages[id];
    for (const id of Object.keys(this.cache.followers)) if (!allowed.has(id)) delete this.cache.followers[id];
    for (const [key, expires] of Object.entries(this.cache.unsupported)) if (expires < this.now()) delete this.cache.unsupported[key];
    const temporary = this.file + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(this.cache)); fs.renameSync(temporary, this.file); this.cacheWarning = ''; }
    catch { this.cacheWarning = 'Chưa lưu được cache Meta; dữ liệu đang có vẫn hiển thị trong phiên này.'; }
  }
  scheduleSave() { if (!this.saveTimer) { this.saveTimer = setTimeout(() => this.save(), 1000); this.saveTimer.unref?.(); } }
  async request(page, binding, params, signal, insights = false) {
    if (signal.aborted) return { error: 'cancelled' };
    if (this.limited(binding.id, binding.token)) return { error: 'rate_limited' };
    const version = /^v\d+\.\d+$/.test(this.meta().graphVersion) ? this.meta().graphVersion : 'v26.0';
    const url = new URL(`https://graph.facebook.com/${version}/${page.id}${insights ? '/insights' : ''}`);
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key, String(value));
    this.progress.calls++;
    try {
      const response = await this.fetch(url, { headers: { Authorization: 'Bearer ' + binding.pageToken, accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      const body = await response.json();
      if (usagePercent(response.headers) >= 80) this.cache.cooldowns[binding.id] = this.now() + COOLDOWN;
      if (!response.ok || body?.error) { const error = errorStatus(response.status, body?.error); if (error === 'rate_limited') this.cache.cooldowns[binding.id] = this.now() + COOLDOWN; return { error }; }
      return { data: body };
    } catch { return { error: signal.aborted ? 'cancelled' : 'network' }; }
  }
  async collect(page, binding, period, signal) {
    const previous = this.cache.periods[this.periodKey(period)]?.pages?.[page.id];
    const metrics = Object.fromEntries(INSIGHT_KEYS.map(key => [key, emptyMetric('no_data')]));
    const fields = await this.request(page, binding, { fields: 'id,followers_count' }, signal);
    if (fields.error) metrics.followers = emptyMetric(fields.error);
    else if (String(fields.data.id) === String(page.id) && numeric(fields.data.followers_count)) {
      const today = period.until, history = this.cache.followers[page.id];
      const series = (history?.binding === binding.fingerprint ? history.series : []).filter(point => point.date !== today && numeric(point.value));
      series.push({ date: today, value: fields.data.followers_count }); series.sort((a,b) => a.date.localeCompare(b.date));
      this.cache.followers[page.id] = { binding: binding.fingerprint, series: series.slice(-90) };
      metrics.followers = { value: fields.data.followers_count, status: 'ok', message: '', metric: 'followers_count', series: series.slice(-period.days) };
    }
    const names = [['views','page_media_view'], ['engagement','page_post_engagements']];
    const params = { period: 'day', since: Math.floor(Date.parse(period.since + 'T00:00:00Z') / 1000) - 86400, until: Math.floor(Date.parse(period.until + 'T00:00:00Z') / 1000) + 86400 };
    const active = names.filter(([key, name]) => { const blocked = this.cache.unsupported[binding.fingerprint + ':' + name] > this.now(); if (blocked) metrics[key] = emptyMetric('unsupported'); return !blocked; });
    if (active.length) {
      const response = fields.error === 'permission' ? { error: 'permission' } : await this.request(page, binding, { ...params, metric: active.map(item => item[1]).join(',') }, signal, true);
      for (const [key, name] of active) {
        const single = response.error === 'unsupported' && active.length > 1 ? await this.request(page, binding, { ...params, metric: name }, signal, true) : response;
        metrics[key] = single.error ? emptyMetric(single.error) : dailyMetric(single.data, name, period);
        if (single.error === 'unsupported') this.cache.unsupported[binding.fingerprint + ':' + name] = this.now() + 7 * 86400000;
      }
    }
    if (signal.aborted) return null;
    for (const key of INSIGHT_KEYS) if (!numeric(metrics[key].value) && previous?.binding === binding.fingerprint && numeric(previous.metrics?.[key]?.value)) metrics[key] = { ...previous.metrics[key], status: 'stale', message: metrics[key].message, error: metrics[key].status };
    return { binding: binding.fingerprint, checkedAt: this.now(), lastSuccessAt: INSIGHT_KEYS.some(key => metrics[key].status === 'ok') ? this.now() : previous?.lastSuccessAt || null, metrics };
  }
  refresh(input = {}) {
    const scope = scopeSchema.parse(input);
    if (this.closed) return { started: false, message: 'Ứng dụng đang đóng.' };
    if (this.pending) return { started: false, message: 'Đang đồng bộ Meta; dữ liệu đã đọc tiếp tục cập nhật.', progress: { ...this.progress } };
    const period = insightPeriod(scope.days, this.now()), rows = this.matching(scope, period), ids = new Set(rows.filter(row => !row.checkedAt || this.now() - row.checkedAt >= MIN_REFRESH).map(row => row.id));
    const queue = this.pages().filter(page => ids.has(page.id));
    if (!queue.length) return { started: false, message: 'Dữ liệu vừa cập nhật; có thể đọc lại sau một phút.' };
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.progress = { running: true, completed: 0, total: queue.length, errors: 0, calls: 0, skipped: rows.length - queue.length, days: scope.days, startedAt: this.now(), message: '' };
    const periodCache = this.cache.periods[this.periodKey(period)] ||= { period, pages: {} }, leased = new Set();
    const worker = async () => {
      while (queue.length && !signal.aborted) {
        let index = queue.findIndex(page => { const binding = this.binding(page); return !binding || !leased.has(binding.id); });
        if (index < 0) { await new Promise(resolve => setTimeout(resolve, 30)); continue; }
        const page = queue.splice(index,1)[0], binding = this.binding(page);
        if (binding) leased.add(binding.id);
        try {
          if (!binding) periodCache.pages[page.id] = { checkedAt: this.now(), binding: '', metrics: Object.fromEntries(INSIGHT_KEYS.map(key => [key, emptyMetric('missing_binding')])) };
          else { const record = await this.collect(page, binding, period, signal); if (record && this.binding(page)?.fingerprint === binding.fingerprint) periodCache.pages[page.id] = record; }
          if (!signal.aborted) { this.progress.completed++; if (!INSIGHT_KEYS.every(key => periodCache.pages[page.id]?.metrics?.[key]?.status === 'ok')) this.progress.errors++; this.scheduleSave(); }
        } finally { if (binding) leased.delete(binding.id); }
      }
    };
    this.pending = Promise.all(Array.from({ length: this.concurrency }, worker)).catch(() => { this.progress.message = 'Đồng bộ bị gián đoạn; dữ liệu đã đọc được giữ.'; }).finally(() => { this.progress.running = false; this.progress.finishedAt = this.now(); this.progress.cancelled = signal.aborted; this.save(); this.pending = null; });
    return { started: true, progress: { ...this.progress } };
  }
  cancel() { this.controller?.abort(); return { stopping: Boolean(this.pending) }; }
  async close() { this.closed = true; this.cancel(); await this.pending; clearTimeout(this.saveTimer); }
}

export function mountMetaInsightsRoutes(app, store, options = {}) {
  const service = new MetaInsightsService(store, options);
  app.get('/api/meta/overview', (req,res) => res.json(service.snapshot(req.query)));
  app.post('/api/meta/overview/refresh', (req,res) => res.status(202).json(service.refresh(req.body || {})));
  app.post('/api/meta/overview/cancel', (req,res) => res.json(service.cancel()));
  return service;
}
