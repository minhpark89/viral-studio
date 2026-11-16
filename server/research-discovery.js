// Discover progressively: exact topic, related angles observed in current
// reports, then source partitions. A full batch always consists of real,
// distinct articles; search exhaustion is a resumable outcome.
const HOUR = 3_600_000;
const STOP = new Set('a an the and or of to in on at for from with by as is are was were be been it its this that these those about into over under after before how what why when where who which news latest breaking update updates report reports says said new today live general current factual attributed only source facts donald'.split(' '));
const FAMILIES = [
  ['war', 'wars', 'conflict', 'military', 'ceasefire', 'peace', 'defense', 'defence', 'missile', 'troops', 'strike', 'strikes', 'nuclear', 'diplomacy', 'sanctions', 'invasion', 'negotiations'],
  ['crypto', 'cryptocurrency', 'bitcoin', 'btc', 'ethereum', 'blockchain', 'binance', 'token', 'exchange', 'stablecoin'],
  ['ai', 'artificial intelligence', 'machine learning', 'openai', 'chatgpt', 'anthropic', 'robotics', 'model'],
  ['tariff', 'tariffs', 'trade', 'economy', 'economic', 'inflation', 'market', 'markets', 'stocks', 'rates', 'jobs'],
  ['election', 'elections', 'vote', 'voting', 'ballot', 'campaign', 'congress', 'senate', 'polls'],
  ['weather', 'storm', 'hurricane', 'flood', 'flooding', 'tornado', 'wildfire', 'climate'],
];
const PUBLISHERS = ['reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'cbsnews.com', 'nbcnews.com', 'abcnews.go.com', 'theguardian.com', 'aljazeera.com', 'politico.com', 'bloomberg.com', 'cnbc.com'];
const words = value => String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const normalize = value => words(value).join(' ');
const queryText = value => String(value || '').replace(/["():<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
const includesTerm = (text, term) => ` ${normalize(text)} `.includes(` ${normalize(term)} `);

export function researchTitleKey(article) {
  let title = String(article.title || '');
  const source = String(article.source || '').trim();
  if (source && title.toLocaleLowerCase().endsWith(` - ${source.toLocaleLowerCase()}`)) title = title.slice(0, -source.length - 3);
  return normalize(title);
}

export function researchUrlKey(value) {
  try {
    const url = new URL(value); url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '');
  } catch { return String(value || '').trim(); }
}

function topicPlan(topic, niche) {
  const corrected = queryText(topic).replace(/\bdonal\s+trump\b/gi, 'Donald Trump');
  const tokens = words(corrected).filter(word => !STOP.has(word));
  const families = FAMILIES.filter(family => family.some(term => includesTerm(corrected, term)));
  const related = [...new Set(families.flat())];
  // Keep named subjects (Binance, OpenAI, etc.) even if they also name a field.
  const named = new Set(['bitcoin', 'ethereum', 'binance', 'openai', 'chatgpt', 'anthropic']);
  const anchors = tokens.filter(word => !related.includes(word) || named.has(word));
  const core = anchors.join(' ') || corrected || queryText(niche) || 'news';
  const matches = article => {
    const title = article.title || '', text = `${title} ${article.summary || ''}`;
    const anchorHits = anchors.filter(term => includesTerm(text, term)).length;
    const relatedHit = related.some(term => includesTerm(text, term));
    if (anchors.length && !anchorHits) return 0;
    if (related.length && !relatedHit) return 0;
    if (!anchors.length && !related.length && tokens.length && !tokens.some(term => includesTerm(text, term))) return 0;
    const titleHit = tokens.some(term => includesTerm(title, term));
    return Math.min(1, 0.35 + (anchors.length ? anchorHits / anchors.length * 0.4 : 0.25) + (titleHit ? 0.25 : 0));
  };
  return { corrected, tokens, anchors, related, core, matches };
}

function googleFeed(query, hours) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${hours}h`)}&hl=en-US&gl=US&ceid=US:en`;
}

function nearDuplicate(left, right) {
  const a = new Set(words(left)), b = new Set(words(right));
  if (a.size < 7 || b.size < 7) return false;
  // Different numbers often distinguish follow-up reports; do not merge them.
  if ([...a].filter(w => /^\d+$/.test(w)).sort().join() !== [...b].filter(w => /^\d+$/.test(w)).sort().join()) return false;
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / (a.size + b.size - shared) >= 0.9;
}

function keywordSuggestions(observed, plan) {
  const signals = new Map();
  for (const article of observed.values()) {
    const title = researchTitleKey(article);
    for (const word of new Set(words(title))) {
      if (word.length < 4 || STOP.has(word) || plan.tokens.includes(word) || /^\d+$/.test(word)) continue;
      let signal = signals.get(word);
      if (!signal) signals.set(word, signal = { mentions: 0, sources: new Set() });
      signal.mentions++; signal.sources.add(article.source || new URL(article.url).hostname);
    }
  }
  return [...signals.entries()].sort((a, b) => b[1].sources.size - a[1].sources.size || b[1].mentions - a[1].mentions)
    .slice(0, 16).map(([word, signal]) => ({ query: queryText(`${plan.core} ${word}`), mentions: signal.mentions, sourceCount: signal.sources.size, basis: 'current_reports' }));
}

export async function discoverResearch({ topic, niche = '', feeds = [], count = 12, windowHours = 24, excludeArticles = [], previousDiscovery, signal, onProgress }, { readFeeds, now = () => new Date().toISOString() }) {
  // A list of subjects is a union of searches, not one impossible AND query.
  const subjects = [...new Set(String(topic || '').split(/[,;\n]+/).map(value => value.trim()).filter(Boolean))];
  const plans = (subjects.length ? subjects : [topic]).map(subject => topicPlan(subject, niche));
  const cutoff = Date.parse(now());
  const hours = [24, 72, 168].includes(Number(windowHours)) ? Number(windowHours) : 24;
  const searchKey = JSON.stringify([subjects, niche, feeds, hours]);
  const prior = previousDiscovery?.continuation;
  const resume = prior?.key === searchKey && previousDiscovery.stopReason !== 'sources_exhausted';
  const visited = new Set(resume ? prior.visited : []);
  const warnings = [], articles = [], observed = new Map(), queries = [], queued = new Set();
  const seenUrls = new Set(excludeArticles.map(article => researchUrlKey(article.url)));
  const seenTitles = new Set(excludeArticles.map(researchTitleKey));
  const titleList = [...seenTitles];
  const budget = Math.min(160, Math.max(24, Math.ceil(count / 8) + 12));
  let searched = 0, round = 0, suggestions = [];
  const attempt = (Number(previousDiscovery?.attempt) || (previousDiscovery ? 1 : 0)) + 1;
  const pending = [], deferred = [], observedTasks = [];
  const enqueue = (query, stage = 'related', destination = pending, url) => {
    const actualUrl = url || googleFeed(query, hours);
    if (queued.has(actualUrl) || visited.has(actualUrl)) return;
    queued.add(actualUrl); destination.push({ query, url: actualUrl, stage });
  };
  for (const url of feeds) enqueue(new URL(url).hostname, 'rss', pending, url);
  for (const [index, plan] of plans.entries()) {
    const subject = subjects[index] || topic;
    enqueue(queryText(subject), 'topic');
    if (normalize(plan.corrected) !== normalize(subject)) enqueue(plan.corrected, 'corrected');
    const relatedTerms = plan.related.filter(term => !plan.tokens.includes(term));
    if (relatedTerms.length) enqueue(`${plan.core} (${relatedTerms.slice(0, 8).join(' OR ')})`);
    if (normalize(plan.core) !== normalize(plan.corrected)) enqueue(plan.core);
    if (niche && !/^(general news|tin tức tổng hợp)$/i.test(niche)) enqueue(queryText(`${plan.core} ${niche}`), 'niche', deferred);
  }
  // Source/date partitions overcome the per-query RSS result ceiling without
  // weakening topic, date, or duplicate checks. Interleave subjects and query
  // families so repeated reports cannot starve untouched sources.
  for (let index = 0; index < Math.max(14, PUBLISHERS.length); index++) {
    for (const plan of plans) {
      if (PUBLISHERS[index]) enqueue(`${plan.core} site:${PUBLISHERS[index]}`, 'source', deferred);
      const term = plan.related.filter(term => !plan.tokens.includes(term))[index];
      if (term) enqueue(queryText(`${plan.core} ${term}`), 'related', deferred);
    }
  }
  for (let day = 0; day <= Math.ceil(hours / 24); day++) {
    const start = new Date(cutoff - day * 24 * HOUR).toISOString().slice(0, 10);
    const end = new Date(cutoff + (1 - day) * 24 * HOUR).toISOString().slice(0, 10);
    for (const plan of plans) enqueue(`${plan.core} after:${start} before:${end}`, 'date', deferred);
  }
  const relevant = entry => Math.max(...plans.map(plan => plan.matches(entry)));
  // Existing results still contain useful search signals when every refreshed
  // headline is a duplicate. Keep only signals in the selected time window.
  for (const entry of excludeArticles) {
    const time = Date.parse(entry.publishedAt);
    if (time >= cutoff - hours * HOUR && time <= cutoff && relevant(entry)) observed.set(researchTitleKey(entry), entry);
  }
  const updateSuggestions = () => {
    const groups = plans.map(plan => keywordSuggestions(new Map([...observed].filter(([, entry]) => plan.matches(entry))), plan));
    suggestions = [];
    for (let i = 0; i < 16; i++) for (const group of groups) if (group[i]) suggestions.push(group[i]);
    suggestions = [...new Map(suggestions.map(item => [item.query, item])).values()].slice(0, 48);
    for (const suggestion of suggestions) enqueue(suggestion.query, 'observed', observedTasks);
  };
  const snapshot = (phase, currentQueries = [], stopReason = null) => ({
    phase, target: count, found: articles.length, windowHours: hours, round, searches: searched, budget, attempt,
    expanded: queries.some(query => !['rss', 'topic'].includes(query.stage)), queries: [...queries], currentQueries,
    suggestions, exhausted: phase === 'exhausted', stopReason,
    continuation: { key: searchKey, visited: [...visited] },
  });
  const publish = async (phase, currentQueries = [], stopReason) => {
    updateSuggestions();
    await onProgress?.(snapshot(phase, currentQueries, stopReason), articles);
  };
  const addEntries = entries => {
    let added = 0;
    for (const entry of entries) {
      const time = Date.parse(entry.publishedAt), relevance = relevant(entry);
      if (!Number.isFinite(time) || time < cutoff - hours * HOUR || time > cutoff + 5 * 60_000 || !relevance) continue;
      const url = researchUrlKey(entry.url), title = researchTitleKey(entry);
      if (!url || !title) continue;
      if (!observed.has(title)) observed.set(title, entry);
      if (articles.length >= count || seenUrls.has(url) || seenTitles.has(title) || titleList.some(previous => nearDuplicate(previous, title))) continue;
      seenUrls.add(url); seenTitles.add(title); titleList.push(title);
      articles.push({ ...entry, relevance }); added++;
    }
    return added;
  };
  while (articles.length < count && searched < budget) {
    signal?.throwIfAborted();
    if (!pending.length) {
      updateSuggestions();
      pending.push(...deferred.splice(0, 2), ...observedTasks.splice(0, 1));
      if (!pending.length) pending.push(...deferred.splice(0, 3), ...observedTasks.splice(0, 3));
    }
    if (!pending.length) break;
    // First query stands alone: a sufficient narrow result avoids expansion.
    const tasks = pending.splice(0, Math.min(round === 0 ? Math.max(1, feeds.length) : 3, budget - searched));
    round++;
    await publish(round === 1 ? 'searching' : 'expanding', tasks.map(task => task.query));
    const results = await Promise.all(tasks.map(async task => {
      const localWarnings = [];
      const entries = await readFeeds([task.url], localWarnings, signal);
      return { task, entries, localWarnings };
    }));
    for (const { task, entries, localWarnings } of results) {
      const fresh = addEntries(entries); searched++;
      // Failed network requests remain eligible next time.
      if (!localWarnings.length) visited.add(task.url);
      warnings.push(...localWarnings);
      queries.push({ ...task, scanned: entries.length, added: fresh });
    }
    await publish(articles.length >= count ? 'ready' : 'expanding');
  }
  signal?.throwIfAborted();
  const exhausted = articles.length < count;
  const stopReason = !exhausted ? 'target_reached' : pending.length + deferred.length + observedTasks.length ? 'budget' : 'sources_exhausted';
  const phase = exhausted ? 'exhausted' : 'ready';
  await publish(phase, [], stopReason);
  return { articles, warnings: [...new Set(warnings)].slice(0, 12), discovery: snapshot(phase, [], stopReason) };
}
