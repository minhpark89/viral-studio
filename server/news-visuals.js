import { isPublicImageUrl, newsImageKey } from './image-search.js';

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
  const words = value => ' ' + String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() + ' ';
  const titles = words([research.headline,...(research.articles||[]).map(article=>article.title)].join(' '));
  const publishers = ['BBC','CBS','CNN','Reuters','Associated Press',...(research.articles||[]).map(article=>article.source).filter(Boolean)].map(words);
  return [...new Set([...named, ...short])].filter(query=>!publishers.some(publisher=>words(query).includes(publisher)&&!titles.includes(publisher))).slice(0, 6);
}

function metaAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [name.toLowerCase(), value.replace(/&amp;/gi, '&')]));
}

// Follow semantic article/main containers while ignoring whole recommendation,
// navigation, ad and author subtrees (including nested divs).
function editorialFigures(html) {
  const stack = []; const figures = []; let active;
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const cleaned = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  for (const token of cleaned.match(/<[^>]+>|[^<]+/g) || []) {
    const match = /^<(\/)?([\w-]+)\b/.exec(token);
    if (!match) { if (active) active.html += token; continue; }
    const [, closing, rawTag] = match; const tag = rawTag.toLowerCase();
    if (closing) {
      if (active) active.html += token;
      const index = stack.findLastIndex(frame => frame.tag === tag);
      if (index >= 0) {
        if (active && index <= active.depth) { figures.push(active.html); active = null; }
        stack.length = index;
      }
      continue;
    }
    const attrs = metaAttributes(token); const parent = stack.at(-1);
    const excluded = parent?.excluded || ['aside','nav','footer'].includes(tag) || /(?:^|[\s_-])(?:related|recommend\w*|advert\w*|author|byline|social|share)(?:$|[\s_-])/i.test([attrs.class,attrs.id,attrs['data-component'],attrs['data-testid'],attrs.role].filter(Boolean).join(' '));
    const body = parent?.body || tag === 'article' || tag === 'main' || attrs.role === 'main';
    if (!active && body && !excluded && ['figure','picture'].includes(tag)) active = {depth:stack.length,html:''};
    if (active && !excluded) active.html += token;
    if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push({tag,body,excluded});
  }
  return figures;
}

export function articleImagesFromHtml(html, article) {
  const images = new Map();
  const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 500);
  const add = (value, caption = '') => {
    try {
      const url = new URL(value, article.url).toString();
      if (!value || !isPublicImageUrl(url) || /(?:logo|favicon|default[-_]social|placeholder|avatar)\b/i.test(url)) return;
      const key = newsImageKey({imageUrl:url}); const existing = images.get(key);
      images.set(key, { ...article, imageUrl: url, imageDescription: plain(caption) || existing?.imageDescription || '' });
    } catch { /* Invalid source metadata is ignored. */ }
  };
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => metaAttributes(tag));
  const alt = tags.find(tag => /^(og:image:alt|twitter:image:alt)$/i.test(tag.property || tag.name || ''))?.content || '';
  for (const tag of tags.filter(tag => /^(og:image(?::secure_url)?|twitter:image(?::src)?)$/i.test(tag.property || tag.name || ''))) add(tag.content, alt);
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const canonical = value => { try { const url=new URL(value,article.url);return url.origin+url.pathname.replace(/\/$/,''); } catch { return ''; } };
    const nodeUrl = node.url || node.mainEntityOfPage?.['@id'] || (typeof node.mainEntityOfPage==='string' ? node.mainEntityOfPage : '');
    if (/Article|NewsArticle|ReportageNewsArticle/i.test(String(node['@type'] || '')) && (!nodeUrl || canonical(nodeUrl) === canonical(article.url))) {
      for (const image of [node.image || []].flat()) add(typeof image === 'string' ? image : image?.contentUrl || image?.url, image?.caption || image?.description);
      for (const part of [node.hasPart || []].flat()) if (/ImageObject/i.test(String(part?.['@type']||''))) add(part.contentUrl || part.url,part.caption || part.description);
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attributes)) continue;
    try { visit(JSON.parse(body)); } catch { /* A malformed JSON-LD block is not an article image. */ }
  }
  for (const figure of editorialFigures(html)) {
    const tag = /<img\b[^>]*>/i.exec(figure)?.[0];
    if (!tag) continue;
    const attributes = metaAttributes(tag);
    const caption = plain(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figure)?.[1] || attributes.alt);
    const sets = [attributes.srcset,attributes['data-srcset'],...[...figure.matchAll(/<source\b[^>]*>/gi)].map(([source]) => {const attrs=metaAttributes(source);return attrs.srcset || attrs['data-srcset'];})].filter(Boolean);
    const largest = sets.flatMap(set => set.split(',').map(item => item.trim().split(/\s+/))).sort((a,b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))[0]?.[0];
    if (!caption || (!largest && ((attributes.width && Number(attributes.width) < 500) || (attributes.height && Number(attributes.height) < 300)))) continue;
    add(largest || attributes['data-src'] || attributes.src, caption);
  }
  return [...images.values()].slice(0, 16);
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
