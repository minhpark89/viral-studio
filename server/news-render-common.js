import fs from 'node:fs';
import path from 'node:path';

export function newsFontPaths(style = 'news') {
  const roots = [path.resolve(import.meta.dirname, '../dist/fonts/news'), path.resolve(import.meta.dirname, '../public/fonts/news')];
  const find = name => roots.map(root => path.join(root, name)).find(file => fs.existsSync(file));
  const families = {
    news: { headline: 'BarlowCondensed-ExtraBold.ttf', label: 'BarlowCondensed-Bold.ttf', body: 'BarlowCondensed-Regular.ttf' },
    viral: { headline: 'Anton-Regular.ttf', label: 'Anton-Regular.ttf', body: 'BarlowCondensed-Bold.ttf' },
    minimal: { headline: 'BeVietnamPro-ExtraBold.ttf', label: 'BeVietnamPro-ExtraBold.ttf', body: 'BarlowCondensed-Regular.ttf' },
  };
  const family = families[style] || families.news;
  const headline = find(family.headline) || find(families.news.headline);
  const label = find(family.label) || headline, body = find(family.body) || label;
  return headline && label && body ? { headline, label, body } : null;
}

export function presenterFilter(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1,crop=${width}:${height}`;
}

export const cleanNewsText = value => String(value || '').normalize('NFC').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim();
