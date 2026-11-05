import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),destination=path.join(root,'runtime/news-captions');
const spec=JSON.parse(await fs.readFile(path.join(root,'shared/news-caption-assets.json'),'utf8'));
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function check(){
 const manifest=JSON.parse(await fs.readFile(path.join(destination,'manifest.json'),'utf8'));
 if(manifest.modelSha256!==spec.modelSha256||await hash(path.join(destination,'ggml-base.en.bin'))!==spec.modelSha256)throw Error('Caption model checksum mismatch');
 for(const name of [...spec.files,...Object.keys(spec.licenses)])if(!manifest.files[name]||await hash(path.join(destination,name))!==manifest.files[name])throw Error('Caption asset checksum mismatch: '+name);
 console.log('Offline captions: verified pinned base.en model, native runtime and licenses.');
}
if(process.argv.includes('--check'))await check();
else{
 if(process.platform!=='win32')throw Error('Caption runtime setup currently targets Windows x64.');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viral-captions-setup-'));
 const local=process.argv.find(a=>a.startsWith('--from='))?.slice(7);
 try{
  await fs.mkdir(destination,{recursive:true});
  const fetchFile=async(url,file)=>{const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Download failed '+response.status);await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));};
  const archive=path.join(temporary,'runtime.zip');
  if(local)await fs.copyFile(path.join(local,'whisper-bin-x64-v1.7.6.zip'),archive);else await fetchFile(spec.archiveUrl,archive);
  if(await hash(archive)!==spec.archiveSha256)throw Error('Native runtime archive checksum mismatch');
  const extract=path.join(temporary,'extract.ps1'),unpacked=path.join(temporary,'unpacked');
  await fs.writeFile(extract,'param([string]$Archive,[string]$Destination)\n$ErrorActionPreference = "Stop"\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n');
  await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',extract,'-Archive',archive,'-Destination',unpacked],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Runtime extraction failed '+code)));});
  async function locate(dir,name){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isFile()&&entry.name===name)return file;if(entry.isDirectory()){const found=await locate(file,name);if(found)return found;}}}
  for(const name of spec.files){const source=await locate(unpacked,name);if(!source)throw Error('Missing native file '+name);await fs.copyFile(source,path.join(destination,name));}
  const model=path.join(destination,'ggml-base.en.bin');
  if(local)await fs.copyFile(path.join(local,'ggml-base.en.bin'),model);else await fetchFile(spec.modelUrl,model);
  if(await hash(model)!==spec.modelSha256)throw Error('Model checksum mismatch');
  for(const [name,url]of Object.entries(spec.licenses)){await fetchFile(url,path.join(destination,name));if(!(await fs.readFile(path.join(destination,name),'utf8')).includes('MIT License'))throw Error('Unexpected license document');}
  const files={};for(const name of [...spec.files,...Object.keys(spec.licenses)])files[name]=await hash(path.join(destination,name));
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({...spec,files},null,2));await check();
 }finally{if(path.dirname(path.resolve(temporary))===path.resolve(os.tmpdir())&&path.basename(temporary).startsWith('viral-captions-setup-'))await fs.rm(temporary,{recursive:true,force:true});}
}
