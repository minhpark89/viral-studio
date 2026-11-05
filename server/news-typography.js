import fs from 'node:fs/promises';
import path from 'node:path';
import { create as createFont } from 'fontkit';
import { newsFontPaths, cleanNewsText } from './news-render-common.js';
import { StudioError } from './store.js';

// Measure the bundled font directly. Rendering must not depend on Chrome or
// a browser profile on another PC. FFmpeg uses the same copied TTF files.
export async function createNewsTypography(directory, style = 'news') {
  const paths = newsFontPaths(style);
  if (!paths) throw new StudioError('Thiếu font tin tức trong bộ cài.', 'NEWS_FONT_MISSING', 500);
  const fonts = {}, audit = [], measurements = new Map();
  for (const [name, file] of Object.entries(paths)) {
    const bytes = await fs.readFile(file); fonts[name] = createFont(bytes);
    await fs.writeFile(path.join(directory, name + '.ttf'), bytes);
  }
  const widthOf = (text, font, size) => {
    const key = font + ':' + text;
    if (!measurements.has(key)) {
      const face = fonts[font];
      measurements.set(key, face.layout(text).positions.reduce((sum, p) => sum + p.xAdvance, 0) / face.unitsPerEm);
    }
    return measurements.get(key) * size;
  };
  function wrap(text, font, size, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
        const next = line ? line + ' ' + word : word;
        if (line && widthOf(next, font, size) > width - 4) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  async function fit(id, value, { font = 'label', size = 48, min = size, width = 880, lines = 2 } = {}) {
    if (!/^[a-z0-9_-]+$/i.test(id) || !fonts[font]) throw new Error('Invalid text layer');
    const text = String(value || '').split('\n').map(cleanNewsText).join('\n').trim();
    for (let n = size; n >= min; n--) {
      const wrapped = wrap(text, font, n, width), widths = wrapped.map(line => widthOf(line, font, n));
      if (wrapped.length <= lines && widths.every(w => w <= width - 4)) {
        const result = { file: id + '.txt', text: wrapped.join('\n'), size: n, font, widths };
        await fs.writeFile(path.join(directory, result.file), result.text, 'utf8');
        audit.push({ id, original: text, ...result, maxWidth: width, maxLines: lines });
        return result;
      }
    }
    throw new StudioError(`Chữ quá dài cho bố cục V3 (${id}). Hãy rút gọn tiêu đề hoặc chọn font News chuẩn.`, 'NEWS_TEXT_TOO_LONG', 422);
  }
  return { fit, audit, widthOf, wrap };
}
