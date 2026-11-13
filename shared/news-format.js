import { z } from 'zod';

export const NEWS_MIN_SECONDS = 15;
export const NEWS_MAX_IMAGES = 10;
export const DEFAULT_NEWS_RENDER_STYLE = 'v3';
export const newsRenderStyleSchema = z.enum(['v3', 'v3-fast', 'classic']);
export const NEWS_RENDER_STYLES = [
  { id: 'v3', label: 'V3 chuẩn · mặc định', description: 'Ảnh rõ, MC riêng, chữ đỏ/trắng; zoom nhẹ xen ảnh tĩnh và hòa cảnh mềm.' },
  { id: 'v3-fast', label: 'V3 nhanh', description: 'Cùng bố cục V3; ảnh tĩnh và hòa cảnh, ưu tiên tốc độ render.' },
  { id: 'classic', label: 'Kiểu cũ', description: 'Bố cục tin tức trước V3, giữ để dùng lại khi cần.' },
];
export const newsRenderStyleLabel = style => NEWS_RENDER_STYLES.find(item => item.id === style)?.label || NEWS_RENDER_STYLES[0].label;
export const newsDurationSchema = z.union([z.literal('auto'), z.literal(15), z.literal(20), z.literal(30)]);
export const newsImageCountSchema = z.union([z.literal('auto'), z.literal(6), z.literal(8), z.literal(10)]);
export const newsVisualPolicySchema = z.enum(['require-photos', 'allow-fewer', 'allow-source-card']);
export const newsVideoOptionsSchema = z.object({
  newsRenderStyle: newsRenderStyleSchema.default(DEFAULT_NEWS_RENDER_STYLE),
  newsDuration: newsDurationSchema.default('auto'),
  newsImageCount: newsImageCountSchema.default('auto'),
  newsVisualPolicy: newsVisualPolicySchema.default('require-photos'),
  fontStyle: z.enum(['news', 'viral', 'minimal']).default('news'),
});

export const NEWS_FONTS = [
  { id: 'news', label: 'News chuẩn · Barlow Condensed' },
  { id: 'viral', label: 'Viral mạnh · Anton + Barlow' },
  { id: 'minimal', label: 'Viral sạch · Be Vietnam Pro' },
];

export function newsScriptBudget(duration = 'auto') {
  const seconds = duration === 'auto' ? 24 : Number(duration);
  // Leave room for a complete first-comment CTA within DreamFace Free's limit.
  return { seconds, words: Math.round(seconds * 2.35), characters: Math.min(500, Math.round(seconds * 16)) };
}

export function newsImageTarget(duration = 'auto', count = 'auto') {
  return count === 'auto' ? (duration === 'auto' ? 8 : Math.min(NEWS_MAX_IMAGES, Math.max(6, Math.round(newsScriptBudget(duration).seconds / 2.5)))) : Number(count);
}

export function newsMinimumPhotos(policy = 'require-photos', target = 8) {
  return policy === 'allow-source-card' ? 0 : policy === 'allow-fewer' ? 1 : Math.min(6, target);
}
