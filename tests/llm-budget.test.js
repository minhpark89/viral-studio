import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJsonContent } from '../server/llm.js';

const store = {state:{settings:{llm:{enabled:true,endpoint:'https://gateway.test/v1',model:'reasoning-model',timeoutSeconds:30}}}};
const completion = (content, finish = 'stop') => Response.json({choices:[{finish_reason:finish,message:{content}}]});

test('Product image analysis retains image inputs, Vietnamese instructions and its larger budget during recovery', async () => {
  const calls=[];
  const images=['https://product.test/front.png','https://product.test/detail.png'];
  const result=await requestJsonContent(store,'Analyze product',{title:'Original product'}, {images,language:'vi',maxTokens:6000,fetchImpl:async(_url,request)=>{
    calls.push(JSON.parse(request.body));
    return calls.length===1 ? completion('', 'length') : completion('{"description":"Mô tả sản phẩm"}');
  }});
  assert.equal(result.description,'Mô tả sản phẩm');
  assert.deepEqual(calls.map(call=>call.max_tokens),[6000,8192]);
  assert.deepEqual(calls[0].messages,calls[1].messages);
  assert.match(calls[0].messages[0].content,/Vietnamese/);
  assert.deepEqual(calls[1].messages[1].content.slice(1).map(part=>part.image_url.url),images);
});

test('a clipped image selection is retried once and only the complete replacement is accepted', async () => {
  const calls=[];
  const fetchImpl=async (_url,request) => {
    calls.push({...request,body:JSON.parse(request.body)});
    return calls.length===1 ? completion('{"selectedImageIds":["unverified"]}', 'length') : completion('{"selectedImageIds":["verified"]}');
  };
  const result=await requestJsonContent(store,'Rank images',{candidates:[1,2]}, {fetchImpl,maxTokens:800});
  assert.deepEqual(result,{selectedImageIds:['verified']});
  assert.deepEqual(calls.map(call=>call.body.max_tokens),[800,3200]);
  assert.deepEqual(calls[0].body.messages,calls[1].body.messages);
  assert.equal(calls[0].signal,calls[1].signal,'both attempts share the overall deadline');
});

test('a truncated SSE gateway response also gets the bounded recovery', async () => {
  let calls=0;
  const result=await requestJsonContent(store,'Rank',{}, {maxTokens:700,fetchImpl:async()=>{
    calls++;
    return calls===1 ? new Response('data: {"choices":[{"delta":{"content":"{\\\"ok\\\":"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n') : completion('{"ok":true}');
  }});
  assert.deepEqual(result,{ok:true});
  assert.equal(calls,2);
});

test('a second clipped completion fails without accepting partial JSON or looping', async () => {
  const budgets=[];
  await assert.rejects(()=>requestJsonContent(store,'Narrate',{}, {fetchImpl:async(_url,request)=>{
    budgets.push(JSON.parse(request.body).max_tokens);
    return completion('{"summary":"partial"}','length');
  }}),error=>error.code==='LLM_INVALID_RESPONSE' && /truncated/.test(error.message));
  assert.deepEqual(budgets,[2400,8192]);
});

test('HTTP failures and malformed JSON are not retried as output-budget failures',async()=>{
  for (const response of [()=>new Response('unauthorized',{status:401}),()=>completion('not json')]) {
    let calls=0;
    await assert.rejects(()=>requestJsonContent(store,'Rank',{}, {fetchImpl:async()=>{calls++;return response();}}));
    assert.equal(calls,1);
  }
});

test('cancelling after a clipped response prevents another gateway request',async()=>{
  const controller=new AbortController();
  const reason=new Error('User cancelled preparation');
  let calls=0;
  await assert.rejects(()=>requestJsonContent(store,'Rank',{}, {signal:controller.signal,fetchImpl:async()=>{
    calls++;
    controller.abort(reason);
    return completion('{"ok":true}','length');
  }}),error=>error===reason);
  assert.equal(calls,1);
});

test('a complete response keeps the original small output budget and makes one call',async()=>{
  const budgets=[];
  const result=await requestJsonContent(store,'Rank',{}, {maxTokens:800,fetchImpl:async(_url,request)=>{
    budgets.push(JSON.parse(request.body).max_tokens);
    return completion('{"selectedImageIds":[]}');
  }});
  assert.deepEqual(result,{selectedImageIds:[]});
  assert.deepEqual(budgets,[800]);
});
