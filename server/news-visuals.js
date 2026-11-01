import { isPublicImageUrl } from './image-search.js';

export function newsVisualQueries(research, narration = {}) {
  const text = [research.headline, research.script, ...(research.articles || []).map(article => article.title)].join(' ');
  const named = [
    [/\bbitcoin\b|\bBTC\b/i, 'Bitcoin coin'], [/\bsolana\b/i, 'Solana cryptocurrency'],
    [/\bethereum\b|\bETH\b/i, 'Ethereum cryptocurrency'], [/\bdogecoin\b/i, 'Dogecoin'],
    [/\bbinance\b/i, 'Binance'],
  ].filter(([pattern]) => pattern.test(text)).map(([, query]) => query);
  const short = [...(narration.imageQueries || []), ...(research.imageQueries || [])]
    .map(query => String(query).replace(/[^\p{L}\p{N} -]/gu, ' ').trim().split(/\s+/).slice(0, 3).join(' ')).filter(Boolean);
  return [...new Set([...named, ...short])].slice(0, 6);
}

function metaAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [name.toLowerCase(), value.replace(/&amp;/gi, '&')]));
}

export function articleImageFromHtml(html, article) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => metaAttributes(tag));
  const candidate = tags.find(tag => /^(og:image(?::secure_url)?|twitter:image(?::src)?)$/i.test(tag.property || tag.name || ''));
  if (!candidate?.content) return null;
  try {
    const url = new URL(candidate.content, article.url).toString();
    if (!isPublicImageUrl(url) || /(?:logo|favicon|default[-_]social|placeholder)\b/i.test(url)) return null;
    return { ...article, imageUrl: url };
  } catch { return null; }
}

export async function discoverArticleImages(articles, { fetchImpl = globalThis.fetch } = {}) {
  const found = [];
  const warnings = [];
  for (const article of (articles || []).filter(article => !article.imageUrl).slice(0, 3)) {
    if (!isPublicImageUrl(article.url)) continue;
    // Google RSS wrappers expose a Google News logo, not the publisher's photo.
    if (new URL(article.url).hostname === 'news.google.com') continue;
    try {
      const response = await fetchImpl(article.url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (response.url && !isPublicImageUrl(response.url)) throw new Error('Invalid source redirect');
      const length = Number(response.headers.get('content-length'));
      if (length > 2_000_000) { await response.body?.cancel(); throw new Error('Source page too large'); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error('Source page too large'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const image = articleImageFromHtml(Buffer.concat(chunks).toString('utf8'), article);
      if (image) found.push(image);
    } catch (error) { warnings.push(`Ảnh nguồn ${new URL(article.url).hostname}: ${error.message}`); }
  }
  return { articles: found, warnings };
}
