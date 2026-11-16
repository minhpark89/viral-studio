// Read only explicitly marked article containers. Older publishers often use
// div/li classes instead of article/main; never fall back to the whole page.
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)]
  .map(([, key, , value]) => [key.toLowerCase(), value.replace(/&amp;/gi, '&')]));
const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

export function newsArticleIdentity(value, base) {
  try {
    const url = new URL(value, base);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    // IDs in query strings distinguish stories on older PHP publishers.
    // Only remove known tracking parameters, never every query parameter.
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

export function newsArticleMarkup(html) {
  const cleaned = String(html || '').replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const stack = [], candidates = [];
  let output = '';
  for (const token of cleaned.match(/<[^>]+>|[^<]+/g) || []) {
    const match = /^<(\/)?([\w-]+)\b/.exec(token);
    if (!match) { if (!stack.at(-1)?.excluded) output += token; continue; }
    const [, closing, rawTag] = match, tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.findLastIndex(frame => frame.tag === tag);
      if (index < 0) continue;
      // Finalize nested candidates before appending their parent's close tag.
      for (let i = stack.length - 1; i >= index; i--) {
        const frame = stack[i];
        if (frame.priority) candidates.push({priority:frame.priority,markup:output.slice(frame.start)});
      }
      if (!stack[index].excluded) output += token;
      stack.length = index;
      continue;
    }
    const attrs = attributes(token), parent = stack.at(-1);
    const names = [attrs.class,attrs.id,attrs['data-testid'],attrs['data-component']].filter(Boolean).join(' ').replace(/_/g, '-');
    const excluded = parent?.excluded || ['aside','nav','footer','form','header','iframe'].includes(tag)
      || /(?:^|[\s-])(?:ads?|adsbygoogle|advert\w*|related|recommend\w*|share\w*|social|comments?|newsletter|byline|author)(?:$|[\s-])/i.test(names);
    let priority = 0;
    if (!excluded) {
      if (/\barticleBody\b/i.test(attrs.itemprop || '')) priority = 5;
      else if (/(?:^|\s)(?:article-body|article-content|story-body|story-content|entry-content|post-content|f-news)(?:$|\s)/i.test(names)) priority = 4;
      else if (tag === 'article') priority = 3;
      else if (/(?:^|\s)full-news(?:$|\s)/i.test(names)) priority = 2;
      else if (tag === 'main' || attrs.role === 'main') priority = 1;
      output += token;
    }
    if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push({tag,excluded,priority,start:output.length});
  }
  // An unclosed container is not reliable enough to establish article scope.
  return candidates.sort((a,b) => b.priority-a.priority || b.markup.length-a.markup.length)[0]?.markup || '';
}
