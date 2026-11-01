import { z } from 'zod';
import { StudioError } from './store.js';
import { researchProgress } from '../shared/research-status.js';

const deleteRequest = z.object({ projectId: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(1000) });

export function deleteResearchResults(store, input) {
  const { projectId, ids } = deleteRequest.parse(input);
  store.require('projects', projectId);
  const unique = [...new Set(ids)];
  const records = new Map(store.state.researchResults.map(result => [result.id, result]));
  // Validate the entire selection before changing anything.
  for (const id of unique) {
    if (records.has(id) && records.get(id).projectId !== projectId)
      throw new StudioError('Tin được chọn thuộc dự án khác. Hãy tải lại danh sách.', 'RESEARCH_PROJECT_MISMATCH', 409);
  }
  const progress = researchProgress(store.state, projectId);
  const deletedIds = [], skipped = [], missingIds = [];
  for (const id of unique) {
    if (!records.has(id)) missingIds.push(id);
    else if (progress.get(id)?.active > 0) skipped.push({ id, code: 'RESEARCH_BUSY', reason: 'Tin đang chuẩn bị hoặc render. Hãy chờ hoàn tất trước khi xóa.' });
    else deletedIds.push(id);
  }
  if (deletedIds.length) {
    const removing = new Set(deletedIds);
    store.state.researchResults = store.state.researchResults.filter(result => !removing.has(result.id));
    store.save();
  }
  return { deletedIds, skipped, missingIds };
}
