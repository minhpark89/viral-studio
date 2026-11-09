import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StudioError } from './store.js';

export function newsOutputSettings(store) {
  const systemDefaultDirectory = path.join(store.root, 'exports');
  const customDefaultDirectory = store.state.settings.newsOutputDirectory || '';
  return { systemDefaultDirectory, customDefaultDirectory,
    defaultDirectory: customDefaultDirectory || systemDefaultDirectory,
    productDirectory: store.state.settings.productOutputDirectory || path.join(store.root, 'exports', 'products', 'final') };
}
export function checkNewsOutput(store, requested = '') {
  const value = z.string().trim().max(2048).parse(requested);
  const directory = value || newsOutputSettings(store).defaultDirectory;
  if (!path.isAbsolute(directory) || directory.includes('\0'))
    throw new StudioError('Nhập đường dẫn thư mục News đầy đủ, ví dụ D:\\Video News.', 'NEWS_OUTPUT_INVALID');
  const resolved = path.resolve(directory);
  let probe;
  try {
    fs.mkdirSync(resolved, { recursive: true });
    probe = path.join(resolved, `.viral-news-write-${randomUUID()}.tmp`);
    fs.closeSync(fs.openSync(probe, 'wx'));
    return resolved;
  } catch {
    throw new StudioError(`Không ghi được thư mục News: ${resolved}. Kiểm tra đường dẫn và quyền ghi.`, 'NEWS_OUTPUT_UNAVAILABLE', 422);
  } finally { if (probe) try { fs.unlinkSync(probe); } catch {} }
}
export function mountNewsOutput(app, store) {
  app.get('/api/news-output/settings', (req, res) => res.json(newsOutputSettings(store)));
  app.patch('/api/news-output/settings', (req, res) => {
    const { directory } = z.object({ directory: z.string().trim().max(2048) }).parse(req.body);
    store.state.settings.newsOutputDirectory = directory ? checkNewsOutput(store, directory) : '';
    store.save();
    res.json(newsOutputSettings(store));
  });
  app.post('/api/news-output/resolve', (req, res) => {
    const { directory } = z.object({ directory: z.string().trim().max(2048).default('') }).parse(req.body || {});
    res.json({ directory: checkNewsOutput(store, directory) });
  });
}
