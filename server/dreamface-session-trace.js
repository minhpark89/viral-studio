import fs from 'node:fs/promises';
import path from 'node:path';

const reasons = new Set(['session', 'manual-open', 'manual-login', 'background-login', 'check-session', 'quota', 'cookie-import', 'authenticated-action', 'news-generate', 'news-recover', 'video-generate']);
const uuid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value || '')) ? value : null;

// Only allowlisted metadata belongs here; browser command lines, proxy
// credentials, account names and provider responses must never enter this log.
export async function traceDreamFaceSession(store, { event, profileId, visible, reason, jobId }) {
  try {
    if (!['launch', 'reuse', 'launch-failed', 'close'].includes(event)) return;
    const dir = path.join(store.root, 'logs', 'provider');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'sessions.jsonl');
    const entry = { at: new Date().toISOString(), event, profileId: uuid(profileId), visible: Boolean(visible), headless: !visible, reason: reasons.has(reason) ? reason : 'session', jobId: uuid(jobId) };
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* Optional tracing must never fail a render or sign-in. */ }
}
