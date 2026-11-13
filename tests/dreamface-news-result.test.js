import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { submitNewsAvatar, waitForNewsAvatar, matchingNewsWork, newsNarrationHash } from '../server/dreamface-news-result.js';
import { DreamFaceProvider } from '../server/providers/dreamface.js';
import { randomUUID } from 'node:crypto';
let browser;
before(async()=>{const executablePath=[process.env.CHROME_PATH,'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));browser=await chromium.launch({headless:true,executablePath});});
after(async()=>browser?.close());
const narration='A confirmed development. Read the full story in the first comment.';
const receipt={id:'new-task',profileId:'profile',promptHash:newsNarrationHash(narration),submittedAt:new Date().toISOString()};
const old={id:'old-work',animate_id:'old-task',file_type:'VIDEO',work_type:'ADVANCED_AVATAR',work_name:'A confirmed',web_work_status:200,work_webp_path:'https://fixture.test/old.jpg'};
const fresh={...old,id:'new-work',animate_id:'new-task',work_webp_path:'https://fixture.test/new.jpg'};

test('a matching title and an old video URL cannot substitute for the receipt ID',()=>{
 assert.equal(matchingNewsWork([old],receipt),null);
 assert.equal(matchingNewsWork([old,fresh],receipt),fresh);
 assert.equal(matchingNewsWork([{...fresh,file_type:'IMAGE'}],receipt),null);
 assert.equal(matchingNewsWork([fresh],null),null);
});

test('a changed submit URL is correlated by narration; an incomplete success is never permission to resubmit',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let saved,diagnostic;
 await page.route('https://fixture.test/**',route=>route.request().url().endsWith('/avatar/v9/generate')?route.fulfill({json:{status_code:'THS12140000000',data:{}}}):route.fulfill({contentType:'text/html',body:`<button onclick='fetch("/avatar/v9/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:${JSON.stringify(narration)}})})'>Generate</button>`}));
 await page.goto('https://fixture.test/avatar');
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:value=>saved=value,timeoutMs:200,onFailure:(_error,signals)=>{diagnostic=signals}}),{code:'PROVIDER_SUBMISSION_UNCONFIRMED'});
 assert.equal(saved.id,null);assert.equal(saved.scriptMismatch,false);assert.notEqual(saved.rejected,true);
 assert.deepEqual(diagnostic,{requestObserved:true,receiptConfirmed:false,rejected:false});
});

test('submission is acknowledged exactly once and the receipt survives the UI changing routes',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let submits=0;const saved=[];
 await page.route('https://fixture.test/**',route=>route.request().url().endsWith('/task/v2/submit')?(submits++,route.fulfill({json:{status_code:'THS12140000000',data:{animate_image_id:'new-task'}}})):route.fulfill({contentType:'text/html',body:`<button onclick='fetch("/task/v2/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media:{text:${JSON.stringify(narration)}}})})'>Generate</button>`}));
 await page.goto('https://fixture.test/avatar');
 const result=await submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.getByRole('button',{name:'Generate'}).click(),saveReceipt:value=>saved.push({...value}),timeoutMs:1500});
 assert.equal(submits,1);assert.equal(result.id,'new-task');assert.equal(saved[0].id,null);assert.equal(saved.at(-1).promptHash,newsNarrationHash(narration));
 assert.equal(result.scriptMismatch,false);
});

test('a server acknowledgement with the wrong submitted text keeps its receipt but rejects the result',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let receipt;
 await page.route('https://fixture.test/**',route=>route.request().url().endsWith('/task/v2/submit')?route.fulfill({json:{data:{animate_image_id:'wrong-script-task'}}}):route.fulfill({contentType:'text/html',body:'<button onclick="fetch(\'/task/v2/submit\',{method:\'POST\',body:JSON.stringify({text:\'Old narration\'})})">Generate</button>'}));
 await page.goto('https://fixture.test/avatar');
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:value=>receipt=value,timeoutMs:1000}),error=>error.code==='PROVIDER_SCRIPT_MISMATCH');
 assert.equal(receipt.id,'wrong-script-task');assert.equal(receipt.scriptMismatch,true);
});

test('a click without a server request fails instead of reporting a submitted job',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<button>Generate</button>');let receipts=0;
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:()=>receipts++,timeoutMs:100}),error=>error.code==='PROVIDER_SUBMISSION_UNCONFIRMED');
 assert.equal(receipts,0);
});

test('an insufficient-credit drawer reports quota without saving a submission or accepting an old video',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());await page.setContent('<button>6 Generate</button><div>Current Credits\n0\nHistory of Credits\nGet More Credits\nPurchase</div>');let receipts=0;
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:()=>receipts++,timeoutMs:1000}),error=>error.code==='PROVIDER_QUOTA');
 assert.equal(receipts,0);
});

test('only the exact completed work is downloaded, ignoring a prior matching-title result',async t=>{
 const page=await browser.newPage({acceptDownloads:true});t.after(()=>page.close());let oldDownloads=0,newDownloads=0;
 await page.route('https://fixture.test/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.includes('get_recent_creation_list'))return route.fulfill({json:{data:{list:[old,fresh]}}});
   if(url.pathname.endsWith('.jpg'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=','base64')});
   if(url.pathname.endsWith('.mp4')){url.pathname.includes('old')?oldDownloads++:newDownloads++;return route.fulfill({headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="presenter.mp4"'},body:'fixture'});}
   return route.fulfill({contentType:'text/html',body:`<div><img src="/old.jpg"><button onclick="location.href='/old.mp4'">Download</button></div><div><img src="/new.jpg"><button onclick="location.href='/new.mp4'">Download</button></div><script>fetch('/work/v2/get_recent_creation_list')</script>`});
 });
 const result=await waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:new AbortController().signal,creationUrl:'https://fixture.test/creation',timeoutMs:3000,pollMs:100,download:async received=>{assert.ok(received.url().endsWith('/new.mp4'));await received.cancel();return{hasAudio:true,id:'correct'};}});
 assert.equal(result.id,'correct');assert.equal(oldDownloads,0);assert.equal(newDownloads,1);
});

test('a changed narration or different profile is rejected before any download',async()=>{
 for(const options of [{narration:'Different script',profileId:'profile'},{narration,profileId:'other'}])await assert.rejects(waitForNewsAvatar({page:null,...options,receipt,signal:new AbortController().signal}),error=>error.code==='PROVIDER_RECEIPT_MISMATCH');
});

test('hidden Avatar sessions close on success and failure before local rendering can start',async()=>{
 for(const fail of [false,true]){
  const account={id:randomUUID()};let closed=0;const provider=new DreamFaceProvider({store:{root:'fixture'}});
  provider.sessions.set(account.id,{visible:false,context:{close:async()=>closed++}});
  provider.generateNewsAvatarOnce=async()=>{if(fail)throw new Error('Provider quota');return{id:'presenter'};};
  if(fail)await assert.rejects(provider.generateNewsAvatar({}, {}, account, new AbortController().signal,()=>{}));
  else assert.equal((await provider.generateNewsAvatar({}, {}, account, new AbortController().signal,()=>{})).id,'presenter');
  assert.equal(closed,1);assert.equal(provider.sessions.size,0);
 }
});

test('Avatar cleanup preserves a visible session opened by the user',async()=>{
 const account={id:randomUUID()};let closed=0;const provider=new DreamFaceProvider({store:{root:'fixture'}});
 provider.sessions.set(account.id,{visible:true,context:{close:async()=>closed++}});
 provider.generateNewsAvatarOnce=async()=>({id:'presenter'});
 await provider.generateNewsAvatar({}, {}, account, new AbortController().signal,()=>{});
 assert.equal(closed,0);assert.equal(provider.sessions.size,1);
});
