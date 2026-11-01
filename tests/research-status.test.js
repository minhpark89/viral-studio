import test from 'node:test';
import assert from 'node:assert/strict';
import { researchProgress, matchesResearchView } from '../shared/research-status.js';

const date = n => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;
const job = (id, status, extra = {}) => ({ id, projectId: 'p', status, type: 'news', createdAt: date(20), production: { researchId: 'r' }, ...extra });
const batch = (id, status, at, extra = {}) => ({ id, projectId: 'p', createdAt: at, updatedAt: at, request: { researchId: 'r' }, items: [{ index: 0, status, researchId: 'r' }], ...extra });
const video = extra => ({ id: 'm', projectId: 'p', kind: 'video', generated: true, createdAt: date(21), production: { researchId: 'r' }, ...extra });
const state = extra => ({ researchResults: [{ id: 'r', projectId: 'p' }], jobs: [], productionBatches: [], media: [], ...extra });
const progress = data => researchProgress(data, 'p').get('r');

test('new stories and preparation without a job remain actionable', () => {
  assert.equal(progress(state()).state, 'new');
  const preparing = progress(state({ productionBatches: [batch('b', 'preparing', date(20))] }));
  assert.equal(preparing.active, 1);
  assert.equal(preparing.state, 'running');
  const failed = progress(state({ productionBatches: [batch('b', 'failed', date(20))] }));
  assert.equal(failed.failed, 1);
  assert.equal(failed.state, 'failed');
});

test('final video, job and batch are one completion; a presenter is not an output', () => {
  const production = { researchId: 'r', batchId: 'b', itemIndex: 0 };
  const data = state({ jobs: [job('j', 'completed', { mediaId: 'm', production, payload: { presenterMediaId: 'mc' } })],
    productionBatches: [batch('b', 'completed', date(21))],
    media: [video({ jobId: 'j', production }), video({ id: 'mc', mediaType: 'news-presenter' })] });
  const actual = progress(data);
  assert.equal(actual.completed, 1);
  assert.equal(actual.available, 1);
  assert.deepEqual(actual.mediaIds, ['m']);
  assert.equal(actual.state, 'rendered');
  assert.equal(progress(state({ jobs: [job('j', 'completed', { mediaId: 'mc' })], media: [video({ id: 'mc', mediaType: 'news-presenter' })] })).completed, 0);
});

test('deleted media still has render and publication history', () => {
  const actual = progress(state({ jobs: [job('j', 'completed', { mediaId: 'gone' })],
    settings: { meta: { publications: [{ projectId: 'p', mediaIds: ['gone'], status: 'published' }] } } }));
  assert.equal(actual.completed, 1);
  assert.equal(actual.available, 0);
  assert.equal(actual.posted, true);
  assert.equal(matchesResearchView(actual, 'work'), false);
  assert.equal(matchesResearchView(actual, 'posted'), true);
});

test('ready, draft and scheduled posts are not reported as published', () => {
  for (const status of ['draft', 'ready', 'scheduled', 'failed']) {
    assert.equal(progress(state({ media: [video({})], socialPosts: [{ status, mediaIds: ['m'] }] })).posted, false, status);
  }
  assert.equal(progress(state({ media: [video({})], socialPosts: [{ status: 'published_comment_error', mediaIds: ['m'] }] })).posted, true);
});

test('latest retry replaces old failure and stale batch state', () => {
  const production = { researchId: 'r', batchId: 'b', itemIndex: 0 };
  const jobs = [job('first', 'failed', { production }), job('retry', 'rendering', { retryOf: 'first', production, createdAt: date(21) })];
  const data = state({ jobs: jobs.reverse(), productionBatches: [batch('b', 'failed', date(20))] });
  assert.equal(progress(data).active, 1);
  assert.equal(progress(data).failed, 0);
  data.jobs[0].status = 'completed';
  assert.equal(progress(data).state, 'rendered');
  assert.equal(progress(data).completed, 1);
  const standalone = progress(state({ jobs: [job('old', 'failed'), job('new', 'completed', { retryOf: 'old', production: undefined, createdAt: date(22) })] }));
  assert.equal(standalone.failed, 0);
  assert.equal(standalone.completed, 1);
});

test('an old failed batch does not override a later successful render', () => {
  const data = state({ productionBatches: [batch('old', 'failed', date(20)), batch('new', 'completed', date(21))] });
  assert.equal(progress(data).failed, 0);
  assert.equal(progress(data).state, 'rendered');
  const standalone = state({ productionBatches: [batch('old', 'failed', date(20))], jobs: [job('new', 'completed', { finishedAt: date(22) })] });
  assert.equal(progress(standalone).failed, 0);
  assert.equal(progress(standalone).state, 'rendered');
});

test('partial batches and a failed new attempt remain visible after success', () => {
  const partial = progress(state({ productionBatches: [batch('b', 'completed', date(21), { items: [
    { index: 0, researchId: 'r', status: 'completed' }, { index: 1, researchId: 'r', status: 'failed', error: 'Retry me' },
  ] })] }));
  assert.equal(partial.completed, 1);
  assert.equal(partial.failed, 1);
  assert.equal(partial.error, 'Retry me');
  assert.equal(matchesResearchView(partial, 'work'), true);
  assert.equal(matchesResearchView(partial, 'rendered'), true);
  const later = progress(state({ jobs: [job('ok', 'completed', { finishedAt: date(20) }), job('bad', 'failed', { createdAt: date(22), error: 'New attempt failed' })] }));
  assert.equal(later.state, 'failed');
  assert.equal(later.error, 'New attempt failed');
});

test('completed batch and media are deduplicated when old jobs were removed', () => {
  const actual = progress(state({ productionBatches: [batch('b', 'completed', date(21))], media: [video({ production: { researchId: 'r', batchId: 'b', itemIndex: 0 } })] }));
  assert.equal(actual.completed, 1);
  assert.equal(actual.available, 1);
});

test('project isolation, image exclusion and nonmutation', () => {
  const data = state({ jobs: [job('x', 'completed', { projectId: 'other' }), job('image', 'completed', { payload: { kind: 'image' } })],
    media: [video({ projectId: 'other' })], socialPosts: [{ projectId: 'other', researchId: 'r', status: 'published' }],
    productionBatches: [batch('b', 'completed', date(21), { projectId: 'other' })] });
  const copy = structuredClone(data);
  const actual = progress(data);
  assert.equal(actual.completed, 0);
  assert.equal(actual.posted, false);
  assert.equal(actual.state, 'new');
  assert.deepEqual(data, copy);
});
