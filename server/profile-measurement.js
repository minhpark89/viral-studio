import fs from 'node:fs/promises';
import path from 'node:path';

// One pass, bounded filesystem work, no symlink traversal. Measurement is never
// used to authorize deletion; profile-storage revalidates paths and processes.
export async function measureProfile(directory, caches) {
  const queue=[{file:directory,relative:''}], groups=new Map(caches.map(([name])=>[name,{bytes:0,unsafe:false}]));
  let bytes=0,files=0;
  const groupFor=relative=>[...groups.keys()].find(name=>relative===name||relative.startsWith(name+'/'));
  while(queue.length) {
    const batch=queue.splice(0,16);
    await Promise.all(batch.map(async({file,relative})=>{
      const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!stat)return;
      const group=groups.get(groupFor(relative));
      if(stat.isSymbolicLink()) {if(group)group.unsafe=true;return;}
      if(stat.isFile()){bytes+=stat.size;files++;if(group)group.bytes+=stat.size;return;}
      if(!stat.isDirectory()){if(group)group.unsafe=true;return;}
      const entries=await fs.readdir(file).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      for(const name of entries)queue.push({file:path.join(file,name),relative:relative?relative+'/'+name:name});
    }));
  }
  return {bytes,files,cacheBytes:[...groups.values()].filter(item=>!item.unsafe).reduce((sum,item)=>sum+item.bytes,0)};
}

export async function mapLimited(items,limit,action) {
  const results=new Array(items.length);let index=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(index<items.length){const current=index++;results[current]=await action(items[current]);}
  }));
  return results;
}
