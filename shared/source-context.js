const day = 86400000;

export function researchSourceDates(research) {
  const dates = (research?.articles || []).map(article => Date.parse(article.publishedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return { oldest: dates[0] || null, newest: dates.at(-1) || null, count: dates.length, total: research?.articles?.length || 0 };
}

export function matchesSourceAge(research, filter, now = Date.now()) {
  if (filter === 'all') return true;
  const { newest } = researchSourceDates(research);
  if (filter === 'unknown') return !newest;
  if (!newest) return false;
  const age = now - newest;
  if (filter === '24h') return age >= 0 && age <= day;
  if (filter === '7d') return age >= 0 && age <= 7 * day;
  if (filter === 'older') return age > day;
  return true;
}

export function formatDateTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Chưa rõ ngày';
}

export function sourceDateLabel(research, now = Date.now()) {
  const { newest, oldest, count, total } = researchSourceDates(research);
  if (!newest) return 'Ngày nguồn: chưa xác định';
  const days = Math.floor(Math.max(0, now - newest) / day);
  const age = newest > now ? 'ngày nguồn ở tương lai' : days === 0 ? 'trong 24 giờ' : `${days} ngày trước`;
  const range = oldest !== newest ? `${formatDateTime(oldest)} → ${formatDateTime(newest)}` : formatDateTime(newest);
  return `Nguồn: ${range} · Mới nhất ${age}${count < total ? ' · Một số nguồn chưa rõ ngày' : ''}`;
}

export function outputContext(media, data, suppliedJob = null) {
  const job = suppliedJob || (data.jobs || []).find(item => item.id === media?.jobId || media?.id && item.mediaId === media.id);
  const production = media?.production || job?.production || {};
  const research = (data.researchResults || []).find(item => item.id === production.researchId);
  return { job, research, production, renderedAt: job?.finishedAt || media?.createdAt, variant: production.variation || (production.itemIndex === undefined ? null : production.itemIndex + 1),
    avatar: (data.media || []).find(item => item.id === (job?.payload?.avatarMediaId || job?.payload?.newsPlan?.avatarMediaId)) };
}
