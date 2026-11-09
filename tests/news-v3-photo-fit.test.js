import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { v3PhotoFit } from '../server/news-v3-photo-fit.js';
import { v3PhotoGraph, v3PhotoFilter } from '../server/news-v3-motion.js';
import { binary, runProcess } from '../server/media.js';

test('landscape fill is bounded; portraits, panoramas and unknown dimensions retain the whole image', () => {
  for (const [width,height] of [[1920,1080],[1600,1200],[1080,720]]) {
    const fit=v3PhotoFit({width,height}); assert.equal(fit.fit,'cover'); assert.ok(fit.cropPercent<=18);
  }
  for (const image of [{width:600,height:900},{width:900,height:900},{width:2400,height:700},{},{width:NaN,height:100}]) {
    const fit=v3PhotoFit(image); assert.equal(fit.fit,'contain'); assert.equal(fit.cropPercent,0); assert.equal(fit.background,'same-image-blur');
  }
});

test('known documents and source cards remain complete and static even in landscape orientation', () => {
  for (const image of [{name:'Sample ballot.jpg'},{imageDescription:'A screenshot with a chart'},{visualRole:'source-card'},{preserveComposition:true},{newsPhotoFit:'contain'}]) {
    const graph=v3PhotoGraph([{file:'image.png',width:1920,height:1080,...image}],15);
    assert.equal(graph.shots[0].fitReason,'protected-composition'); assert.equal(graph.shots[0].fit,'contain'); assert.equal(graph.shots[0].motion,'static'); assert.equal(graph.shots[0].zoomPercent,0);
  }
  assert.equal(v3PhotoGraph([{file:'card.png',width:1920,height:1080}],15,{visualMode:'source-card'}).shots[0].fit,'contain');
});

test('adaptive photo fitting keeps exact duration, credit boundaries and restrained motion', () => {
  const graph=v3PhotoGraph([{file:'wide.jpg',width:1600,height:900},{file:'tall.jpg',width:600,height:900},{file:'wide2.jpg',width:1600,height:1200}],15);
  assert.equal(graph.totalFrames,450); assert.equal(graph.shots.at(-1).labelEnd,15);
  assert.deepEqual(graph.shots.map(s=>s.fit),['cover','contain','cover']);
  assert.ok(graph.shots.every((s,i)=>!i||s.labelStart===graph.shots[i-1].labelEnd));
  assert.ok(graph.shots.every(s=>s.zoomPercent<=1.8));
  assert.ok(v3PhotoGraph([{file:'wide.jpg',width:1600,height:900}],15,{style:'v3-fast'}).shots.every(s=>s.motion==='static'));
});

test('actual FFmpeg frames fill landscape corners and retain portrait borders above the blurred background', async t => {
  const root=path.resolve('.verification','photo-fit-'+randomUUID()); await fs.mkdir(root,{recursive:true}); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ffmpeg=binary('ffmpeg'),signal=AbortSignal.timeout(60000),width=324,height=216;
  const pixel=(data,x,y)=>[...data.subarray((y*width+x)*3,(y*width+x)*3+3)];
  for (const fixture of [{fit:'contain',w:120,h:200},{fit:'cover',w:320,h:180}]) {
    const input=path.join(root,fixture.fit+'.png'),output=path.join(root,fixture.fit+'.rgb');
    await runProcess(ffmpeg,['-v','error','-y','-f','lavfi','-i',`color=c=red:s=${fixture.w}x${fixture.h},drawbox=x=0:y=0:w=iw:h=ih:color=lime:t=8`,'-frames:v','1','-threads','1',input],{signal});
    await runProcess(ffmpeg,['-v','error','-y','-framerate','30','-i',input,'-filter_complex',v3PhotoFilter(0,'out',{frames:2,motion:'static',fit:fixture.fit,width,height}),'-map','[out]','-frames:v','2','-threads','1','-pix_fmt','rgb24','-f','rawvideo',output],{signal});
    const data=await fs.readFile(output); assert.equal(data.length,width*height*3*2);
    for (const frame of [data.subarray(0,width*height*3),data.subarray(width*height*3)]) {
      const center=pixel(frame,162,108); assert.ok(center[0]>220&&center[1]<30,'foreground colors must remain unchanged');
      if(fixture.fit==='contain') {
        const top=pixel(frame,162,3),bottom=pixel(frame,162,212); assert.ok(top[1]>200&&bottom[1]>200,'both original borders must remain visible');
        const side=pixel(frame,10,108); assert.ok(side[0]>side[2]+60,'side space must come from the red photo, not navy padding'); assert.ok(side[0]<center[0]-20,'background must be restrained');
      } else {
        const corner=pixel(frame,4,4); assert.ok(corner[0]>120||corner[1]>120,'photo must reach panel corner');
      }
    }
  }
});
