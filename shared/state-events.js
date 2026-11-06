// Delta transport changes only the wire format. The authoritative workspace,
// secret masking and all existing REST response shapes remain unchanged.
const keyed = value => Array.isArray(value) && value.every(row => row && typeof row.id === 'string') && new Set(value.map(row => row.id)).size === value.length;
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function snapshotDelta(before, after) {
  const set = {}, collections = {}, removed = Object.keys(before).filter(key => !(key in after));
  for (const [key,value] of Object.entries(after)) {
    const previous = before[key];
    if (equal(previous,value)) continue;
    if (keyed(previous) && keyed(value)) {
      const old = new Map(previous.map(row => [row.id,row])), ids = new Set(value.map(row => row.id));
      collections[key] = { upsert:value.filter(row => !equal(old.get(row.id),row)), remove:previous.filter(row => !ids.has(row.id)).map(row=>row.id) };
      if (!equal(previous.map(row=>row.id),value.map(row=>row.id))) collections[key].order=value.map(row=>row.id);
    } else set[key]=value;
  }
  return {set,collections,removed};
}

export function applyStateEvent(current, event) {
  if (event.type === 'snapshot' && Number.isInteger(event.revision) && event.data && typeof event.data === 'object') return event;
  if (event.type !== 'delta' || !current || event.base !== current.revision || event.revision !== current.revision+1) throw new Error('State stream needs a fresh snapshot');
  const data={...current.data,...event.patch.set};
  for(const key of event.patch.removed || []) delete data[key];
  for(const [key,change] of Object.entries(event.patch.collections)) {
    const removed=new Set(change.remove), rows=new Map((data[key]||[]).filter(row=>!removed.has(row.id)).map(row=>[row.id,row]));
    for(const row of change.upsert) rows.set(row.id,row);
    data[key]=change.order ? change.order.map(id=>{if(!rows.has(id))throw new Error('Missing state row');return rows.get(id);}) : [...rows.values()];
  }
  return {type:'snapshot',revision:event.revision,data};
}
