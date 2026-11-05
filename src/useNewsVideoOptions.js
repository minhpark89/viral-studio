import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { newsVideoOptionsSchema, newsDurationSchema, newsImageCountSchema, newsRenderStyleSchema } from '../shared/news-format.js';

// Bridge the short delay before the app's debounced state event arrives.
// Switching projects immediately after a successful save must use its response.
const acknowledgedProjects = new Map();

function legacyOptions(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || typeof saved !== 'object') return null;
    return newsVideoOptionsSchema.parse({
      newsDuration: newsDurationSchema.catch('auto').parse(saved.newsDuration),
      newsImageCount: newsImageCountSchema.catch('auto').parse(saved.newsImageCount),
      newsRenderStyle: newsRenderStyleSchema.catch('v3').parse(saved.newsRenderStyle),
    });
  } catch { return null; }
}

// Project data is authoritative, so preferences survive a new desktop port,
// browser/profile, or restart. Local storage is only a one-time legacy source.
export function useNewsVideoOptions(project) {
  const key = `studio-news-format:${project.id}`;
  const [legacy] = useState(() => legacyOptions(key));
  const acknowledged = acknowledgedProjects.get(project.id);
  const current = acknowledged && Date.parse(acknowledged.updatedAt) > (Date.parse(project.updatedAt) || 0) ? acknowledged : project;
  const saved = newsVideoOptionsSchema.parse(current.newsVideoOptions || legacy || {});
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const chain = useRef(Promise.resolve()), revision = useRef(0);
  const value = draft || saved;
  const signature = JSON.stringify(saved), draftSignature = JSON.stringify(draft);
  useEffect(() => {
    if (draft && signature === draftSignature) setDraft(null);
  }, [signature, draftSignature]);

  const update = next => {
    const options = newsVideoOptionsSchema.parse(next), request = ++revision.current;
    setDraft(options); setSaving(true); setError('');
    // Serialize rapid edits: a slow old response must never overwrite the last choice.
    const pending = chain.current.catch(() => {}).then(() => api(`/projects/${project.id}`, { newsVideoOptions: options }, 'PATCH'));
    chain.current = pending;
    pending.then(response => {
      acknowledgedProjects.set(project.id, response);
      if (request === revision.current) { setSaving(false); setError(''); }
      try { localStorage.removeItem(key); } catch { /* Server persistence is sufficient. */ }
    }, failure => {
      if (request === revision.current) { setSaving(false); setError(failure.message); }
    });
  };
  useEffect(() => {
    if (!current.newsVideoOptions && legacy) update(legacy);
  }, []);
  return [value, update, { saving, error, retry: () => update(value) }];
}
