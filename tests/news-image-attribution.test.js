import test from 'node:test';
import assert from 'node:assert/strict';
import {rankNewsImages} from '../server/news-plan.js';

test('source attribution cannot select unrelated BBC or CBS buildings even when the model selects every candidate',async()=>{
  const research={headline:'US strikes Qeshm Island',script:'According to CBS, as reported by BBC News.',articles:[{title:'US strikes Iranian island',source:'BBC News'}]};
  const candidates=[{id:'bbc',title:'BBC News - The Box.jpg'},{id:'cbs',title:'CBS News Building, Kennedy Space Center'},{id:'nasa',title:'Qeshm Island NASA satellite view'},{id:'article',title:'US strikes Iranian island',description:'Photo supplied by BBC News'}];
  let received;
  const selected=await rankNewsImages({},research,candidates,{allowIllustrations:true,llm:async(_store,_prompt,input)=>{received=input.candidates;return {selectedImageIds:input.candidates.map(c=>c.id)};}});
  assert.deepEqual(received.map(c=>c.id),['nasa','article']);
  assert.deepEqual(selected.map(c=>c.id),['nasa','article']);
});

test('a story about a publisher keeps that publisher as a valid visual subject',async()=>{
  const research={headline:'BBC announces newsroom changes',script:'The BBC announced changes.',articles:[{title:'BBC announces newsroom changes',source:'Reuters'}]};
  const selected=await rankNewsImages({},research,[{id:'bbc',title:'BBC newsroom building'},{id:'reuters',title:'Reuters offices'}],{llm:async(_store,_prompt,input)=>({selectedImageIds:input.candidates.map(c=>c.id)})});
  assert.deepEqual(selected.map(c=>c.id),['bbc']);
});

test('publisher-only results return no images so production can use its source-card fallback',async()=>{
  let calls=0;
  const selected=await rankNewsImages({},{headline:'British workers report lower engagement',script:'BBC News reports the findings.',articles:[{source:'BBC News'}]},[{id:'bbc',title:'BBC Liverpool'}],{llm:async()=>{calls++;throw Error('Must not rank rejected candidates');}});
  assert.deepEqual(selected,[]);assert.equal(calls,0);
});
