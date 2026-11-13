export const NEWS_ANGLES = [
  'Lead with the confirmed development, then its most specific supported detail.',
  'Open with a different named subject or concrete detail from the source, then explain how it connects to the development. Use a different sentence structure and information order.',
  'Lead with a verified timeline or comparison explicitly in the article, then the current development. If neither exists, use a different supported detail.',
  'Open with what the named people or organizations actually said or did, with attribution, then the reported context.',
];

const normalize = value => String(value || '').replace(/Read the full story through the link in the first comment\./gi, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function narrationSimilarity(a, b) {
  const grams = text => { const words = normalize(text).split(' '); return new Set(words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(' '))); };
  const x = grams(a), y = grams(b), union = new Set([...x, ...y]);
  return union.size ? [...x].filter(word => y.has(word)).length / union.size : 1;
}

export function similarNarration(text, previous) {
  const opening = value => normalize(value).split(' ').slice(0, 7).join(' ');
  return previous.some(plan => opening(text) === opening(plan.narration) || narrationSimilarity(text, plan.narration) >= .55);
}

export function newsStoryKey(batch, item) {
  return item.researchId || batch.request.researchId || batch.request.researchIds?.[item.index]
    || batch.sources?.[item.index % (batch.sources.length || 1)]?.url || `item:${item.index}`;
}

export function newsVariantContext(batch, item) {
  const key = item.storyKey || newsStoryKey(batch, item);
  const siblings = batch.items.filter(other => (other.storyKey || newsStoryKey(batch, other)) === key);
  const variation = Math.max(1, siblings.indexOf(item) + 1);
  const previous = siblings.filter(other => other.index !== item.index).map(other => other.newsPlan || other.narrationDraft).filter(Boolean);
  return { variation, total: siblings.length || 1, previous, angle: NEWS_ANGLES[(variation - 1) % NEWS_ANGLES.length] };
}

export function selectNewsVariant(ids, variation = 1, { target = ids.length, previous = [] } = {}) {
  const source = [...new Set(ids.filter(Boolean))];
  if (source.length < 2) return source;
  const used = id => previous.filter(plan => plan.imageMediaIds?.includes(id)).length;
  const offset = ((variation - 1) * Math.max(1, Math.ceil(target / 2))) % source.length;
  const rotated = [...source.slice(offset), ...source.slice(0, offset)];
  const selected = rotated.sort((a, b) => used(a) - used(b)).slice(0, target);
  if (previous.some(plan => plan.imageMediaIds?.[0] === selected[0])) {
    const other = selected.findIndex(id => previous.every(plan => plan.imageMediaIds?.[0] !== id));
    if (other > 0) [selected[0], selected[other]] = [selected[other], selected[0]];
  }
  return selected;
}

export function imageOverlap(ids, previous) {
  return Math.max(0, ...previous.map(plan => ids.filter(id => plan.imageMediaIds?.includes(id)).length / Math.max(1, ids.length)));
}
