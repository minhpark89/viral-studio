import { isPublicImageUrl } from './image-search.js';

export function newsVisualQueries(research, narration = {}) {
  const text = [research.headline, research.script, ...(research.articles || []).map(article => article.title)].join(' ');
  const named = [
    [/\bbitcoin\b|\bBTC\b/i, 'Bitcoin coin'], [/\bsolana\b/i, 'Solana cryptocurrency'],
    [/\bethereum\b|\bETH\b/i, 'Ethereum cryptocurrency'], [/\bdogecoin\b/i, 'Dogecoin'],
    [/\bbinance\b/i, 'Binance'],
  ].filter(([pattern]) => pattern.test(text)).map(([, query]) => query);
  // Commons searches AND the words. "city view" needlessly excludes most
  // photos of a correctly named city; retain the full city/state instead.
  const context = (narration.contextImageQueries || []).map(query => String(query).replace(/\s+(?:city|town)\s+view\s*$/i, ''));
  const short = [...context, ...(narration.imageQueries || []), ...(research.imageQueries || [])]
    .map(query => String(query).replace(/[^\p{L}\p{N} -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean);
  return [...new Set([...named, ...short])].slice(0, 6);
}

function metaAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [name.toLowerCase(), value.replace(/&amp;/gi, '&')]));
}

export function articleImagesFromHtml(html, article) {
  const images = new Map();
  const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 500);
  const add = (value, caption = '') => {
    try {
      const url = new URL(value, article.url).toString();
      if (!value || !isPublicImageUrl(url) || /(?:logo|favicon|default[-_]social|placeholder|avatar)\b/i.test(url)) return;
      const existing = images.get(url);
      images.set(url, { ...article, imageUrl: url, imageDescription: plain(caption) || existing?.imageDescription || '' });
    } catch { /* Invalid source metadata is ignored. */ }
  };
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => metaAttributes(tag));
  const alt = tags.find(tag => /^(og:image:alt|twitter:image:alt)$/i.test(tag.property || tag.name || ''))?.content || '';
  for (const tag of tags.filter(tag => /^(og:image(?::secure_url)?|twitter:image(?::src)?)$/i.test(tag.property || tag.name || ''))) add(tag.content, alt);
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (/Article|NewsArticle|ReportageNewsArticle/i.test(String(node['@type'] || ''))) {
      for (const image of [node.image || []].flat()) add(typeof image === 'string' ? image : image?.contentUrl || image?.url, image?.caption || image?.description);
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attributes)) continue;
    try { visit(JSON.parse(body)); } catch { /* A malformed JSON-LD block is not an article image. */ }
  }
  // Only captioned figures inside the article body, never arbitrary sidebar,
  // recommendation, author or advertising images from the rest of the page.
  const body = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || '';
  for (const [, figure] of body.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const tag = /<img\b[^>]*>/i.exec(figure)?.[0];
    if (!tag || /related|recommended|advertisement/i.test(figure)) continue;
    const attributes = metaAttributes(tag);
    const caption = plain(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figure)?.[1] || attributes.alt);
    if (!caption || (attributes.width && Number(attributes.width) < 500) || (attributes.height && Number(attributes.height) < 300)) continue;
    const largest = (attributes.srcset || attributes['data-srcset'] || '').split(',').map(item => item.trim().split(/\s+/)).sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))[0]?.[0];
    add(largest || attributes['data-src'] || attributes.src, caption);
  }
  return [...images.values()].slice(0, 10);
}

export function articleImageFromHtml(html, article) {
  return articleImagesFromHtml(html, article)[0] || null;
}

export async function discoverArticleImages(articles, { fetchImpl = globalThis.fetch } = {}) {
  const found = [];
  const warnings = [];
  for (const article of (articles || []).slice(0, 3)) {
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
      found.push(...articleImagesFromHtml(Buffer.concat(chunks).toString('utf8'), article));
    } catch (error) { warnings.push(`Ảnh nguồn ${new URL(article.url).hostname}: ${error.message}`); }
  }
  return { articles: found, warnings };
}
