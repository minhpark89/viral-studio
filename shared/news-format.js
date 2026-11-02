import { z } from 'zod';

export const NEWS_MIN_SECONDS = 15;
export const NEWS_MAX_IMAGES = 10;
export const newsDurationSchema = z.union([z.literal('auto'), z.literal(15), z.literal(20), z.literal(30)]);
export const newsImageCountSchema = z.union([z.literal('auto'), z.literal(6), z.literal(8), z.literal(10)]);

export function newsScriptBudget(duration = 'auto') {
  const seconds = duration === 'auto' ? 24 : Number(duration);
  // Leave room for a complete first-comment CTA within DreamFace Free's limit.
  return { seconds, words: Math.round(seconds * 2.35), characters: Math.min(500, Math.round(seconds * 16)) };
}

export function newsImageTarget(duration = 'auto', count = 'auto') {
  return count === 'auto' ? Math.min(NEWS_MAX_IMAGES, Math.max(5, Math.round(newsScriptBudget(duration).seconds / 3))) : Number(count);
}
