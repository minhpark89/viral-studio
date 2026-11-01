import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { deleteResearchResults } from '../server/research-management.js';

function fixture(t) {
  const root = path.resolve('.verification', 'research-delete-' + randomUUID());
  const store = new Store(root); const project = store.createProject('Selection QA');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const story = headline => store.add('researchResults', { projectId: project.id, headline, topic: headline });
  return { store, project, story };
}

test('bulk deletion removes only selected idle stories in one save, preserving videos and publication history', t => {
  const { store, project, story } = fixture(t);
  const first = story('Selected'), completed = story('Completed'), keep = story('Unselected');
  store.add('jobs', { projectId: project.id, type: 'news', status: 'completed', production: { researchId: completed.id } });
  store.add('media', { projectId: project.id, kind: 'video', generated: true, production: { researchId: completed.id } });
  store.add('socialPosts', { projectId: project.id, researchId: completed.id, status: 'published' });
  const preserved = structuredClone({ jobs: store.state.jobs, media: store.state.media, posts: store.state.socialPosts });
  let saves = 0; const save = store.save.bind(store); store.save = () => { saves++; save(); };
  const result = deleteResearchResults(store, { projectId: project.id, ids: [first.id, completed.id, first.id] });
  assert.deepEqual(result.deletedIds, [first.id, completed.id]); assert.equal(saves, 1);
  assert.deepEqual(store.state.researchResults.map(result => result.id), [keep.id]);
  assert.deepEqual({ jobs: store.state.jobs, media: store.state.media, posts: store.state.socialPosts }, preserved);
});

test('mixed selection skips pending preparation and active retry jobs while removing idle stories', t => {
  const { store, project, story } = fixture(t);
  const pending = story('Pending'), preparing = story('Preparing'), retry = story('Active retry'), idle = story('Idle');
  store.add('productionBatches', { projectId: project.id, status: 'preparing', request: { researchId: pending.id }, items: [{ index: 0, status: 'pending' }, { index: 1, status: 'preparing', researchId: preparing.id }] });
  const previous = store.add('jobs', { projectId: project.id, status: 'failed', type: 'news', production: { researchId: retry.id } });
  store.add('jobs', { projectId: project.id, status: 'queued', type: 'news', retryOf: previous.id, payload: {} });
  const result = deleteResearchResults(store, { projectId: project.id, ids: [pending.id, preparing.id, retry.id, idle.id] });
  assert.deepEqual(result.deletedIds, [idle.id]);
  assert.deepEqual(result.skipped.map(item => item.id), [pending.id, preparing.id, retry.id]);
  assert.ok(result.skipped.every(item => item.code === 'RESEARCH_BUSY'));
});

test('foreign project in a selection is rejected before any deletion and malformed/empty lists are rejected', t => {
  const { store, project, story } = fixture(t); const local = story('Local');
  const other = store.createProject('Other');
  const foreign = store.add('researchResults', { projectId: other.id, headline: 'Foreign' });
  assert.throws(() => deleteResearchResults(store, { projectId: project.id, ids: [local.id, foreign.id] }), error => error.code === 'RESEARCH_PROJECT_MISMATCH');
  assert.equal(store.state.researchResults.length, 2);
  assert.throws(() => deleteResearchResults(store, { projectId: project.id, ids: [] }));
  assert.throws(() => deleteResearchResults(store, { projectId: project.id, ids: ['invalid'] }));
});

test('repeated deletion is idempotent and reports missing items without deleting any other story', t => {
  const { store, project, story } = fixture(t); const remove = story('Remove'), keep = story('Keep');
  deleteResearchResults(store, { projectId: project.id, ids: [remove.id] });
  const repeated = deleteResearchResults(store, { projectId: project.id, ids: [remove.id] });
  assert.deepEqual(repeated.deletedIds, []); assert.deepEqual(repeated.missingIds, [remove.id]);
  assert.deepEqual(store.state.researchResults.map(item => item.id), [keep.id]);
});
