import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isConfirmedPublication } from './published-media.js';

const DAYS=30,validId=id=>/^[0-9a-f-]{36}$/i.test(id);
const references=(value,id)=>value===id||Boolean(value&&typeof value==='object'&&Object.values(value).some(child=>references(child,id)));
const sha=value=>createHash('sha256').update(value).digest('hex');
function location(store,id,create=false) {
  if(!validId(id))throw new Error('Invalid archive ID');
  const root=fs.realpathSync(store.root);let directory=root;
  for(const part of ['history','research']){
    directory=path.join(directory,part);
    if(create&&!fs.existsSync(directory))fs.mkdirSync(directory);
    if(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())throw new Error('Unsafe archive directory');
  }
  const file=path.join(directory,id+'.json.gz');
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('Unsafe archive file');
  return file;
}
export function archiveCandidates(store,now=Date.now()) {
  const state=store.state,cutoff=now-DAYS*86400000;
  return state.researchResults.filter(row=>{
    if(row.archive)return false;
    const jobs=state.jobs.filter(job=>references(job.production,row.id)||references(job.payload,row.id)),ids=new Set(jobs.map(job=>job.id));
    const outputs=new Set(jobs.map(job=>job.mediaId).filter(Boolean));
    const pubs=(state.settings.meta?.publications||[]).filter(p=>p.researchId===row.id||(p.mediaIds||[]).some(id=>outputs.has(id))||(p.mediaCleanup?.lineage?.jobIds||[]).some(id=>ids.has(id)));
    if(!pubs.length||pubs.some(p=>!isConfirmedPublication(p)))return false;
    const times=[row.updatedAt||row.createdAt,...pubs.map(p=>p.publishedAt)].map(Date.parse);
    if(times.some(time=>!Number.isFinite(time)||time>cutoff))return false;
    if(jobs.some(job=>job.status!=='completed'))return false;
    if(state.socialPosts.some(post=>references(post,row.id)))return false;
    if(state.productionBatches.some(batch=>!['completed','cancelled'].includes(batch.status)&&references(batch,row.id)))return false;
    if(state.media.some(media=>ids.has(media.jobId)||outputs.has(media.id)||references(media.production,row.id)||(row.imageMediaIds||[]).includes(media.id)))return false;
    return true;
  });
}
export function historyStatus(store) {
  return {enabled:store.state.settings.historyArchiveEnabled!==false,days:DAYS,eligibleCount:archiveCandidates(store).length,archivedCount:store.state.researchResults.filter(row=>row.archive).length};
}
export function archiveResearch(store) {
  let archivedCount=0,savedBytes=0;
  for(const row of archiveCandidates(store).slice(0,100)) {
    const bytes=Buffer.from(JSON.stringify(row)),file=location(store,row.id,true),compressed=gzipSync(bytes);
    // Durable archive precedes the metadata switch. A crash leaves either the
    // original record or a complete, checksummed archive; never a dangling stub.
    const temporary=file+'.tmp';
    if(fs.existsSync(temporary)&&fs.lstatSync(temporary).isSymbolicLink())throw new Error('Unsafe archive temporary file');
    const fd=fs.openSync(temporary,'w',0o600);
    try{fs.writeFileSync(fd,compressed);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temporary,file);
    const summary=Object.fromEntries(['id','projectId','headline','topic','niche','createdAt','updatedAt','batchId','batchItemIndex','language','contentSource'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
    summary.articles=(row.articles||[]).map(article=>Object.fromEntries(['id','url','title','source','publishedAt','fingerprint','contentHash'].filter(key=>article[key]!==undefined).map(key=>[key,article[key]])));
    summary.imageMediaIds=[];summary.archive={version:1,at:new Date().toISOString(),sha256:sha(bytes),originalBytes:bytes.length,compressedBytes:compressed.length};
    const index=store.state.researchResults.indexOf(row);store.state.researchResults[index]=summary;
    try{store.save();}catch(error){store.state.researchResults[index]=row;throw error;}
    archivedCount++;savedBytes+=Math.max(0,bytes.length-Buffer.byteLength(JSON.stringify(summary)));
  }
  return {...historyStatus(store),archivedCountThisRun:archivedCount,activeMetadataBytesSaved:savedBytes};
}
export function restoreResearch(store,id) {
  const index=store.state.researchResults.findIndex(row=>row.id===id),summary=store.state.researchResults[index];
  if(!summary)throw Object.assign(new Error('Không tìm thấy tin.'),{status:404});
  if(!summary.archive)return summary;
  const bytes=gunzipSync(fs.readFileSync(location(store,id)),{maxOutputLength:64*1024*1024});
  if(sha(bytes)!==summary.archive.sha256)throw new Error('Archive checksum mismatch');
  const record=JSON.parse(bytes);
  if(record.id!==id||record.projectId!==summary.projectId)throw new Error('Archive identity mismatch');
  record.updatedAt=new Date().toISOString();store.state.researchResults[index]=record;
  try{store.save();}catch(error){store.state.researchResults[index]=summary;throw error;}
  // Keep the compressed copy for recovery; a later archive replaces this same
  // ID, so repeated restore/archive does not create unbounded copies.
  return record;
}

export class HistoryArchive {
  constructor(store){this.store=store;this.timer=setInterval(()=>this.run(),24*60*60*1000);this.timer.unref?.();}
  run(){if(this.store.state.settings.historyArchiveEnabled===false)return;try{archiveResearch(this.store);}catch{/* The original record or its durable archive remains available. */}}
  close(){clearInterval(this.timer);}
}
