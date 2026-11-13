import { fetchProductResource, productText } from './product-sources.js';
import { articleImagesFromHtml } from './news-visuals.js';

const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, key, , value]) => [key.toLowerCase(), value.replace(/&amp;/g, '&')]));
const google = value => new URL(value).hostname === 'news.google.com';
const meta = (html, name) => (html.match(/<meta\b[^>]*>/gi) || []).map(attrs).find(a => (a.property || a.name) === name)?.content || '';

export function parseNewsDocument(html, article) {
  const plain = value => productText(value, 18000);
  let body = '';
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (/Article|Reportage/i.test(String(node['@type'])) && typeof node.articleBody === 'string' && node.articleBody.length > body.length) {
      const candidate = node.url || node.mainEntityOfPage?.['@id'];
      if (!candidate || new URL(candidate, article.url).pathname.replace(/\/$/, '') === new URL(article.url).pathname.replace(/\/$/, '')) body = node.articleBody;
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  for (const [, attributes, json] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/application\/ld\+json/i.test(attributes)) { try { visit(JSON.parse(json)); } catch { /* Ignore malformed metadata. */ } }
  }
  const segment = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  const semantic = segment.replace(/<(nav|aside|footer|form|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const text = plain(body || semantic);
  const description = plain(meta(html, 'og:description') || meta(html, 'description'));
  const { sourceImages:_images, text:_text, sourceRead:_read, ...imageArticle } = article;
  return { ...article, text, summary: text.length > 180 ? text.slice(0, 4000) : description || article.summary || '',
    sourceRead: { status: text.length > 180 ? 'full' : 'summary', characters: text.length, checkedAt: new Date().toISOString() },
    sourceImages: articleImagesFromHtml(html, imageArticle),
  };
}

export function googlePublisherFromRpc(text) {
  // batchexecute uses an XSSI prefix, optional byte lengths and JSON rows.
  for (const line of text.split('\n').filter(line => line.trim().startsWith('['))) {
    try {
      const visit = node => {
        if (!Array.isArray(node)) return null;
        if (node[0] === 'wrb.fr' && node[1] === 'Fbv4je' && typeof node[2] === 'string') {
          const payload = JSON.parse(node[2]);
          if (payload[0] === 'garturlres' && /^https?:\/\//.test(payload[1]) && !google(payload[1])) return payload[1];
        }
        for (const child of node) { const url = visit(child); if (url) return url; }
        return null;
      };
      const url = visit(JSON.parse(line)); if (url) return url;
    } catch { /* Not a complete RPC row. */ }
  }
  throw new Error('Google News chưa trả link bài báo gốc.');
}

export async function resolveNewsUrl(value, options = {}) {
  if (!google(value)) return value;
  const id = new URL(value).pathname.match(/\/(?:articles|read)\/([\w-]+)/)?.[1];
  if (!id) throw new Error('Link Google News không có mã bài viết.');
  const decoded = Buffer.from(id, 'base64url').toString('latin1');
  const legacy = decoded.match(/https?:\/\/[^\x00-\x20\x7f-\xff]+/)?.[0];
  if (legacy && !google(legacy)) return legacy;
  const resource = await fetchProductResource(`https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`, options);
  if (!google(resource.url)) return resource.url;
  const html = resource.bytes.toString('utf8');
  const signature = html.match(/data-n-a-sg=["']([^"']+)["']/)?.[1];
  const timestamp = html.match(/data-n-a-ts=["'](\d+)["']/)?.[1];
  if (!signature || !timestamp) throw new Error('Không đọc được địa chỉ bài gốc từ Google News.');
  // Public Google News link-resolution protocol. No account or cookies.
  const context = [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0];
  const request = ['garturlreq', context, id, Number(timestamp), signature];
  const body = new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', JSON.stringify(request), null, '0']]]) });
  const response = await (options.rpcFetch || options.fetchImpl || globalThis.fetch)('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, redirect: 'error',
    signal: options.signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 1000000) throw new Error('Phản hồi Google News quá lớn.'); chunks.push(chunk); }
  return googlePublisherFromRpc(Buffer.concat(chunks).toString('utf8'));
}

export async function loadNewsSource(article, options = {}) {
  const timeout = AbortSignal.timeout(25000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const settings = { ...options, signal, maxBytes: 2000000 };
    const url = await resolveNewsUrl(article.url, settings);
    const resource = await fetchProductResource(url, settings);
    if (resource.type && !/text\/html|application\/xhtml/i.test(resource.type)) throw new Error('Nguồn không trả trang bài viết.');
    const result = parseNewsDocument(resource.bytes.toString('utf8'), { ...article, rssUrl: article.rssUrl || article.url, url: resource.url });
    return result;
  } catch (error) {
    options.signal?.throwIfAborted();
    return { ...article, sourceImages: article.sourceImages || [], sourceRead: { status: 'unavailable', checkedAt: new Date().toISOString(), warning: `Chưa đọc được bài gốc trong lần này. ${String(error.message).slice(0, 160)}` } };
  }
}

export async function loadNewsSources(research, { cache = new Map(), force = false, ...options } = {}) {
  const articles = await Promise.all((research.articles || []).slice(0, 3).map(async article => {
    const key = article.rssUrl || article.url;
    if (force) cache.delete(key);
    if (!cache.has(key)) cache.set(key, loadNewsSource(article, options));
    return { ...await cache.get(key), id: article.id };
  }));
  while (cache.size > 100) cache.delete(cache.keys().next().value);
  return { articles:[...articles, ...(research.articles || []).slice(3)], warnings: articles.map(article => article.sourceRead?.warning).filter(Boolean) };
}
