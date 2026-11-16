import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newsV3Layout } from '../server/news-v3-layout.js';
import { v3PhotoGraph } from '../server/news-v3-motion.js';
import { createNewsTypography } from '../server/news-typography.js';

test('the review layout computes cropping against its taller image panel and keeps existing V3 framing', () => {
  const landscape={file:'landscape.jpg',width:1600,height:1200};
  const portrait={file:'portrait.jpg',width:1920,height:2432};
  const old=newsV3Layout(),preview=newsV3Layout('v4');
  assert.deepEqual(preview,newsV3Layout('broadcast-preview'),'V4 must reproduce the approved preview');
  const baseline=v3PhotoGraph([landscape,portrait],15);
  const changed=v3PhotoGraph([landscape,portrait],15,{hero:preview.hero});
  assert.equal(baseline.shots[0].fit,'cover');
  assert.equal(changed.shots[0].fit,'contain','A taller panel must not crop more than the existing 18% limit');
  assert.equal(changed.shots[1].cropPercent,0,'The full portrait remains visible');
  assert.match(changed.filters[0],/scale=1080:1040/);
  assert.match(baseline.filters[0],/scale=1080:720/);
  assert.equal(changed.totalFrames,baseline.totalFrames);
  assert.deepEqual(changed.transitions,baseline.transitions);
  assert.ok(preview.hero.h/old.hero.h>1.4);
  assert.ok(1920-preview.bottomRule.y-preview.bottomRule.h<100);
});

test('review typography fits the supplied long headline and two-line captions above the footer', async t => {
  const root=await fs.mkdtemp(path.resolve('.verification/v3-broadcast-fonts-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const layout=newsV3Layout('v4');
  const title='WHITE HOUSE: TRUMP, XI, PUTIN SCHEDULED TO MEET AT APEC IN CHINA';
  const caption='Free Press Kashmir reports that the White House';
  for(const style of ['news','viral','minimal']){
    const typography=await createNewsTypography(root,style);
    const headline=await typography.fit('headline',title,layout.headline);
    const cue=await typography.fit('caption',caption,layout.caption);
    assert.equal(headline.text.replaceAll('\n',' '),title);
    assert.equal(cue.text.replaceAll('\n',' '),caption);
    assert.ok(layout.headline.y+headline.measuredHeight<layout.captionPanel.y);
    assert.ok(layout.caption.y+cue.measuredHeight<=layout.captionPanel.y+layout.captionPanel.h);
  }
});
