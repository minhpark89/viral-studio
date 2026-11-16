export function postingTimezone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value || 'Asia/Ho_Chi_Minh' }).format(); return value || 'Asia/Ho_Chi_Minh'; }
  catch { return 'Asia/Ho_Chi_Minh'; }
}

function parts(timestamp, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: postingTimezone(timezone), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function postingDay(timestamp, timezone) {
  const p = parts(timestamp, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function postingTime(timestamp, timezone, clock = '00:00', offsetDays = 0) {
  const p = parts(timestamp, timezone), [hour, minute] = clock.split(':').map(Number);
  const wall = Date.UTC(p.year, p.month - 1, p.day + offsetDays, hour, minute);
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const q = parts(utc, timezone);
    const delta = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - utc;
    const next = wall - delta;
    if (next === utc) break;
    utc = next;
  }
  return utc;
}

export const pageDailyMode = group => group?.scheduleConfig?.perPageDaily === true;
