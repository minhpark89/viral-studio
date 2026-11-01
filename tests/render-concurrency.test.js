import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';
import { JobQueue } from '../server/queue.js';

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'queue transition timed out'); await delay(10); }
}
function fixture(t, options = {}) {
  const store = new Store(path.resolve('.verification', `render-pool-${randomUUID()}`));
  const project = store.createProject('Render pool');
  const presenter = store.add('media', { projectId: project.id, kind: 'video', hasAudio: true, file: 'fixture.mp4', duration: 12 });
  const active = new Map(), started = [];
  const render = (job, signal, update) => new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); active.delete(job.id); resolve({ id: randomUUID() }); };
    const abort = () => { active.delete(job.id); reject(new Error('cancelled')); };
    active.set(job.id, finish); started.push(job.id); update(25, 'Rendering fixture');
    signal.addEventListener('abort', abort, { once: true });
  });
  const queue = new JobQueue(store, null, {
    intervalMs: 0,
    render: (_store, job, signal, update) => render(job, signal, update),
    renderNews: (_store, job, _presenter, _plan, _images, signal, update) => render(job, signal, update),
    ...options,
  });
  const news = (cached = true) => store.add('jobs', { type: 'news', projectId: project.id, status: 'queued', payload: { provider: 'dreamface', accountId: 'auto', presenterMediaId: cached ? presenter.id : null, imageMediaIds: [], newsPlan: {} } });
  const timeline = () => store.add('jobs', { type: 'render', projectId: project.id, status: 'queued', payload: {} });
  t.after(async () => { await queue.close(); await fs.rm(store.root, { recursive: true, force: true }); });
  return { store, project, queue, presenter, news, timeline, active, started };
}

test('News and timeline share the selected render limit, including increases and reductions', async t => {
  const { store, queue, news, timeline, active, started } = fixture(t);
  store.state.settings.renderConcurrency = 1;
  const jobs = [news(), timeline(), news(), timeline(), news(), timeline()];
  queue.tick();
  assert.equal(active.size, 1);
  assert.equal(jobs[0].status, 'rendering');
  assert.equal(jobs[0].progress, 25);
  // Cached presenters do not need any ready DreamFace account.
  assert.equal(store.state.accounts.length, 0);
  store.state.settings.renderConcurrency = 3; queue.tick();
  assert.equal(active.size, 3);
  store.state.settings.renderConcurrency = 1; queue.tick();
  active.get(jobs[0].id)(); await until(() => !queue.running.has(jobs[0].id));
  assert.equal(started.length, 3);
  active.get(jobs[1].id)(); await until(() => !queue.running.has(jobs[1].id));
  assert.equal(started.length, 3);
  active.get(jobs[2].id)(); await until(() => active.has(jobs[3].id));
  assert.equal(active.size, 1);
  for (const job of jobs.slice(3)) { await until(() => active.has(job.id)); active.get(job.id)(); await until(() => job.status === 'completed'); }
  assert.ok(jobs.every(j => j.status === 'completed'));
});

test('News releases its profile while waiting for FFmpeg and cancellation does not release a new owner', async t => {
  let nextProvider;
  const { store, project, queue, presenter, news, timeline, active } = fixture(t, {
    generateDreamFace: async (_store, job, _account, signal) => {
      if (job.type === 'news') return presenter;
      return new Promise((resolve, reject) => {
        nextProvider = () => resolve({ id: randomUUID() });
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
  });
  store.state.settings.concurrency = 1;
  store.state.settings.renderConcurrency = 1;
  const account = store.add('accounts', { provider: 'dreamface', status: 'ready' });
  const first = timeline();
  const waiting = news(false);
  const [next] = queue.enqueueGeneration({ projectId: project.id, provider: 'dreamface', model: 'DreamFace video', duration: 5, ratio: '9:16', prompts: ['Next provider task'] });
  queue.tick();
  await until(() => queue.running.get(waiting.id)?.type === 'render-wait' && nextProvider);
  assert.equal(waiting.payload.presenterMediaId, presenter.id);
  assert.equal(account.status, 'busy');
  assert.equal(queue.running.get(next.id).accountId, account.id);
  queue.cancel(waiting.id);
  await until(() => waiting.status === 'cancelled');
  assert.equal(account.status, 'busy', 'cancelled previous owner must not unlock the current owner');
  active.get(first.id)(); nextProvider();
  await until(() => queue.running.size === 0);
  assert.equal(account.status, 'ready');
});

test('paused render waiters resume and close cancels waiters without a deadlock', async t => {
  const f = fixture(t, { generateDreamFace: async () => { f.store.state.settings.queuePaused = true; return f.presenter; } });
  const { store, queue, news, active } = f;
  store.add('accounts', { provider: 'dreamface', status: 'ready' });
  const job = news(false); queue.tick();
  await until(() => queue.running.get(job.id)?.type === 'render-wait');
  assert.equal(active.size, 0);
  store.state.settings.queuePaused = false; queue.tick();
  await until(() => active.has(job.id));
  await queue.close();
  assert.equal(job.status, 'cancelled');
  assert.equal(queue.running.size, 0);
});
