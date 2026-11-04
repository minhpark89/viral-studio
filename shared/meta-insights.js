export const INSIGHT_KEYS = ['followers', 'views', 'engagement'];
export const INSIGHT_MESSAGES = {
  not_synced: 'Chưa đồng bộ Meta', missing_binding: 'Cần xác minh Token cho Page trong Channels & Tokens',
  permission: 'Token hết hạn hoặc thiếu quyền đọc Page / Insights', unsupported: 'Meta không cung cấp chỉ số này cho Page',
  rate_limited: 'Meta giới hạn lượt gọi; chờ trước khi cập nhật lại', no_data: 'Meta chưa trả dữ liệu',
  incomplete: 'Meta chưa trả đủ ngày trong khoảng đã chọn', network: 'Chưa kết nối được Meta',
  cancelled: 'Đã dừng đồng bộ', stale: 'Dữ liệu lần đồng bộ trước', error: 'Chưa đọc được dữ liệu Meta',
};
export const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const emptyMetric = status => ({ value: null, status, message: INSIGHT_MESSAGES[status] || INSIGHT_MESSAGES.error, series: [] });
const dateInMetaZone = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const addDays = (date, count) => new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export function insightPeriod(days = 7, now = Date.now()) {
  const until = dateInMetaZone(new Date(now)), since = addDays(until, -days);
  return { days, since, until, dates: Array.from({ length: days }, (_, index) => addDays(since, index)), timezone: 'America/Los_Angeles' };
}
export function dailyMetric(data, name, period) {
  const entry = data?.data?.find(row => row.name === name && row.period === 'day');
  if (!entry) return emptyMetric('no_data');
  const values = new Map();
  for (const row of entry.values || []) {
    const end = new Date(row.end_time);
    if (!Number.isFinite(end.getTime()) || !numeric(row.value)) continue;
    const date = addDays(dateInMetaZone(end), -1);
    if (period.dates.includes(date)) values.set(date, row.value);
  }
  if (!values.size) return emptyMetric('no_data');
  return { value: [...values.values()].reduce((sum, value) => sum + value, 0), status: values.size === period.days ? 'ok' : 'incomplete', message: values.size === period.days ? '' : INSIGHT_MESSAGES.incomplete, metric: name, coveredDays: values.size, expectedDays: period.days, series: period.dates.map(date => ({ date, value: values.get(date) ?? null })) };
}
export function insightTotals(rows, period) {
  return Object.fromEntries(INSIGHT_KEYS.map(key => {
    const available = rows.filter(row => numeric(row.metrics[key]?.value));
    const dates = key === 'followers' ? [...new Set(available.flatMap(row => row.metrics[key].series.map(point => point.date)))].sort().slice(-period.days) : period.dates;
    return [key, { value: available.length ? available.reduce((sum, row) => sum + row.metrics[key].value, 0) : null, coverage: available.length, total: rows.length,
      stale: available.filter(row => row.metrics[key].status === 'stale' || row.stale).length,
      incomplete: available.filter(row => row.metrics[key].status === 'incomplete').length,
      series: dates.map(date => { const values = available.map(row => row.metrics[key].series.find(point => point.date === date)?.value).filter(numeric); return { date, value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, coverage: values.length, total: rows.length }; }) }];
  }));
}
