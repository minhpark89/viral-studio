import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {binary,runProcess} from './media.js';

// Compare decoded, normalized pixels as well as edges: JPEG/TIFF re-encodes
// have different bytes/URLs, while unrelated flat images can share an edge hash.
export async function newsImageFingerprint(store,media,signal) {
  if (!media.file || !await fs.access(media.file).then(()=>true,()=>false)) return null;
  const temporary=path.join(store.root,'temp',randomUUID()+'.rgb');
  try {
    await runProcess(binary('ffmpeg',store.state.settings),['-y','-v','error','-i',media.file,'-frames:v','1','-vf','scale=17:16:flags=area,format=rgb24','-threads','1','-f','rawvideo',temporary],{signal,timeout:15000});
    const pixels=await fs.readFile(temporary);
    if(pixels.length!==17*16*3)throw Error('Invalid normalized image');
    let edges=0n;
    const luminance=index=>pixels[index]*0.299+pixels[index+1]*0.587+pixels[index+2]*0.114;
    for(let row=0;row<16;row++)for(let col=0;col<16;col++){
      const index=(row*17+col)*3; edges=(edges<<1n)|(luminance(index)>luminance(index+3)?1n:0n);
    }
    return {revision:1,edges:edges.toString(16).padStart(64,'0'),pixels:pixels.toString('base64'),aspect:Number(media.width)/Number(media.height)||0};
  } finally {await fs.rm(temporary,{force:true}).catch(()=>{});}
}

export function sameNewsImage(left,right) {
  if(!left||!right||left.revision!==1||right.revision!==1)return false;
  if(left.aspect&&right.aspect&&Math.abs(left.aspect/right.aspect-1)>0.04)return false;
  let bits=BigInt('0x'+left.edges)^BigInt('0x'+right.edges),distance=0;
  while(bits){bits&=bits-1n;if(++distance>12)return false;}
  const a=Buffer.from(left.pixels,'base64'),b=Buffer.from(right.pixels,'base64');
  if(a.length!==816||b.length!==a.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]-b[i]);
  return difference/a.length<=10;
}
