import { phaseLabels } from '../shared/job-timing.js';

const duration = value => { const seconds = Math.round(value / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; };
export function JobTimings({ record }) {
  const phases = { ...(record.preparationTimings || {}), ...(record.phaseTimings || {}) };
  if (record.phase && record.phaseStartedAt) phases[record.phase] = (phases[record.phase] || 0) + Math.max(0, Date.now() - Date.parse(record.phaseStartedAt));
  if (record.queueWaitMs != null) phases.queue = record.queueWaitMs;
  return Object.keys(phases).length > 0 ? <p className="muted small job-timings">{Object.entries(phases).map(([key, value]) => `${phaseLabels[key] || key}: ${duration(value)}`).join(' · ')}</p> : null;
}
