import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../store.js';

export function previewFiles(root) {
  const directory = path.resolve(root, 'product-research', 'previews');
  if (!fs.existsSync(directory)) return [];
  if (fs.lstatSync(directory).isSymbolicLink()) throw new StudioError('Thư mục cache không được là liên kết.');
  const actual = fs.realpathSync(directory), expected = path.resolve(fs.realpathSync(root), 'product-research', 'previews');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new StudioError('Cache phải nằm trong thư mục dữ liệu Research của app.');
  return fs.readdirSync(directory)
    .filter(name => /^[a-f0-9]{64}\.(?:mp4|image)(?:\.json)?$/.test(name))
    .map(name => { const file = path.resolve(directory, name); return {file, stat: fs.lstatSync(file)}; })
    .filter(item => item.stat.isFile() && !item.stat.isSymbolicLink());
}
export function researchStorage(service, projectId) {
  service.store.require('projects', projectId);
  const directory = path.resolve(service.store.root, 'product-research');
  const dbBytes = ['research.sqlite','research.sqlite-wal','research.sqlite-shm'].reduce((sum,name) => {
    try { return sum + fs.statSync(path.join(directory,name)).size; } catch { return sum; }
  }, 0);
  const files = previewFiles(service.store.root);
  const count = service.repo.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE kind='scan' AND project_id=?").get(projectId).n;
  return { directory, databaseBytes: dbBytes, previewBytes: files.reduce((sum,item)=>sum+item.stat.size,0),
    previewLimitBytes: 512*1024*1024, scans: count, scope: 'workspace', historyLimitShown: 40 };
}
export function clearResearchCache(service, projectId) {
  service.store.require('projects', projectId);
  if (service.running.size || service.previews.pending.size)
    throw new StudioError('Chờ lần quét / tải xem trước hoàn tất rồi dọn cache.', 'RESEARCH_BUSY', 409);
  let removedBytes = 0;
  for (const item of previewFiles(service.store.root)) {
    try { fs.unlinkSync(item.file); removedBytes += item.stat.size; } catch { /* Windows may still be playing this file. */ }
  }
  service.repo.db.exec('DELETE FROM cache; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  return { ...researchStorage(service,projectId), removedBytes };
}
