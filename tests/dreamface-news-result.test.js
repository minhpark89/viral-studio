import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { submitNewsAvatar, waitForNewsAvatar, matchingNewsWork, newsNarrationHash } from '../server/dreamface-news-result.js';
import { DreamFaceProvider, findGenerateButton } from '../server/providers/dreamface.js';
import { randomUUID } from 'node:crypto';
let browser;
before(async()=>{const executablePath=[process.env.CHROME_PATH,'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));browser=await chromium.launch({headless:true,executablePath});});
after(async()=>browser?.close());
const narration='A confirmed development. Read the full story in the first comment.';
const receipt={id:'new-task',profileId:'profile',promptHash:newsNarrationHash(narration),submittedAt:new Date().toISOString()};
const old={id:'old-work',animate_id:'old-task',file_type:'VIDEO',work_type:'ADVANCED_AVATAR',work_name:'A confirmed',web_work_status:200,work_webp_path:'https://fixture.test/old.jpg'};
const fresh={...old,id:'new-work',animate_id:'new-task',work_webp_path:'https://fixture.test/new.jpg'};

test('Avatar submit locator survives paid/free label hydration with exactly one click',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  for(const [before,after]of [['2 Generate','1 Free Daily'],['1 Free Daily','2 Generate']]){
    await page.setContent(`<button onclick="window.clicks=(window.clicks||0)+1">${before}</button>`);
    const button=await findGenerateButton(page);assert.ok(button);
    await page.locator('button').evaluate((element,label)=>{window.clicks=0;element.textContent=label;},after);
    await button.click({timeout:1500});
    assert.equal(await page.evaluate(()=>window.clicks),1);
  }
});

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

test('language detection and text checks containing the narration are not MC submissions',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let submits=0;const saved=[];
 await page.route('https://fixture.test/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/language/identify')return route.fulfill({json:{status_code:'THS12140000000',data:['en']}});
  if(pathname==='/batch_task/v1/batch_check_text')return route.fulfill({json:{status_code:'THS12140000000',data:[true]}});
  if(pathname==='/task/v2/submit'){submits++;return route.fulfill({json:{status_code:'THS12140000000',data:{animate_image_id:'actual-task'}}});}
  return route.fulfill({contentType:'text/html',body:`<button onclick='(async()=>{for(const path of ["/language/identify","/batch_task/v1/batch_check_text","/task/v2/submit"])await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:${JSON.stringify(narration)}})})})()'>Generate</button>`});
 });
 await page.goto('https://fixture.test/avatar');
 const result=await submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:value=>saved.push({...value}),timeoutMs:1000});
 assert.equal(result.id,'actual-task');assert.equal(submits,1);assert.equal(saved.length,2);
});

test('a credit drawer after a text preflight reports quota without a false receipt',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let receipts=0;
 await page.route('https://fixture.test/**',route=>route.request().url().endsWith('/language/identify')
  ?route.fulfill({json:{status_code:'THS12140000000',data:['en']}})
  :route.fulfill({contentType:'text/html',body:`<button onclick='fetch("/language/identify",{method:"POST",body:JSON.stringify({text:${JSON.stringify(narration)}})}).then(()=>{document.querySelector("div").innerText="Current Credits 0 Get More Credits Purchase 6 Generate"})'>Generate</button><div></div>`}));
 await page.goto('https://fixture.test/avatar');
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:()=>receipts++,timeoutMs:1000}),{code:'PROVIDER_QUOTA'});
 assert.equal(receipts,0);
});

test('a rejected text preflight fails promptly without inventing a video submission',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let receipts=0,diagnostic;
 await page.route('https://fixture.test/**',route=>route.request().url().endsWith('/batch_task/v1/batch_check_text')
  ?route.fulfill({json:{status_code:'THS12140000000',data:[true,false]}})
  :route.fulfill({contentType:'text/html',body:`<button onclick='fetch("/batch_task/v1/batch_check_text",{method:"POST",body:JSON.stringify({texts:["Other text",${JSON.stringify(narration)}]})})'>Generate</button>`}));
 await page.goto('https://fixture.test/avatar');
 const start=Date.now();
 await assert.rejects(submitNewsAvatar({page,narration,profileId:'profile',signal:new AbortController().signal,click:()=>page.locator('button').click(),saveReceipt:()=>receipts++,timeoutMs:5000,onFailure:(_error,signals)=>{diagnostic=signals;}}),{code:'PROVIDER_CONTENT_REJECTED'});
 assert.equal(receipts,0);assert.ok(Date.now()-start<2500);
 assert.equal(diagnostic.requestObserved,false);assert.deepEqual(diagnostic.textCheck,{path:'/batch_task/v1/batch_check_text',matchedIndex:1,accepted:false,httpStatus:200,providerCode:'THS12140000000'});
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

for (const moving of [false, true]) test(`only the exact completed work is downloaded, ignoring a prior matching-title result${moving ? ' while cards keep moving' : ''}`,async t=>{
 const page=await browser.newPage({acceptDownloads:true});t.after(()=>page.close());let oldDownloads=0,newDownloads=0;
 await page.route('https://fixture.test/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.includes('get_recent_creation_list'))return route.fulfill({json:{data:{list:[old,fresh]}}});
   if(url.pathname.endsWith('.jpg'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=','base64')});
   if(url.pathname.endsWith('.mp4')){url.pathname.includes('old')?oldDownloads++:newDownloads++;return route.fulfill({headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="presenter.mp4"'},body:'fixture'});}
   return route.fulfill({contentType:'text/html',body:`${moving ? '<style>@keyframes move{to{transform:translateX(60px)}}div{animation:move .2s infinite alternate linear}</style>' : ''}<div><img src="/old.jpg"><button onclick="location.href='/old.mp4'">Download</button></div><div><img src="/new.jpg"><button onclick="location.href='/new.mp4'">Download</button></div><script>fetch('/work/v2/get_recent_creation_list')</script>`});
 });
 const stages=[];
 const result=await waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:new AbortController().signal,creationUrl:'https://fixture.test/creation',timeoutMs:moving ? 8000 : 3000,pollMs:100,update:value=>stages.push(value.stage),download:async received=>{assert.ok(received.url().endsWith('/new.mp4'));await received.cancel();return{hasAudio:true,id:'correct'};}});
 assert.equal(result.id,'correct');assert.equal(oldDownloads,0);assert.equal(newDownloads,1);
 assert.ok(stages.includes('DreamFace đang tạo video MC'));assert.ok(stages.includes('Đang tải video MC đã xác minh'));
});

test('a changed narration or different profile is rejected before any download',async()=>{
 for(const options of [{narration:'Different script',profileId:'profile'},{narration,profileId:'other'}])await assert.rejects(waitForNewsAvatar({page:null,...options,receipt,signal:new AbortController().signal}),error=>error.code==='PROVIDER_RECEIPT_MISMATCH');
});

for (const interrupted of ['goto', 'reload']) test(`Creations recovers an aborted ${interrupted} and downloads the same receipt without submitting`, async t => {
 const page = await browser.newPage({acceptDownloads:true}); t.after(()=>page.close());
 const originalReceipt = structuredClone(receipt); let navigations=0, posts=0, downloads=0; const updates=[];
 await page.route('https://fixture.test/**', async route => {
  const request=route.request(), pathname=new URL(request.url()).pathname;
  if(request.method()==='POST')posts++;
  if(pathname==='/creation'){
   navigations++;
   if(navigations===(interrupted==='goto'?1:2))return route.abort('aborted');
   return route.fulfill({contentType:'text/html',body:'<div><img src="/new.jpg"><button onclick="location.href=\'/new.mp4\'">Download</button></div><script>fetch("/work/v2/get_recent_creation_list")</script>'});
  }
  if(pathname.includes('get_recent_creation_list'))return route.fulfill({json:{data:{list:[old,{...fresh,web_work_status:interrupted==='reload'&&navigations===1?100:200}]}}});
  if(pathname.endsWith('.jpg'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=','base64')});
  if(pathname.endsWith('.mp4')){downloads++;return route.fulfill({headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="presenter.mp4"'},body:'fixture'});}
  return route.abort();
 });
 const result=await waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:new AbortController().signal,creationUrl:'https://fixture.test/creation',timeoutMs:5000,pollMs:100,navigationRetryMs:10,update:value=>updates.push(value),download:async received=>{assert.ok(received.url().endsWith('/new.mp4'));await received.cancel();return{hasAudio:true,id:'correct'};}});
 assert.equal(result.id,'correct'); assert.equal(posts,0); assert.equal(downloads,1);
 assert.equal(navigations,interrupted==='goto'?2:3);
 assert.equal(updates.filter(value=>value.navigationRetry).length,1);
 assert.deepEqual(receipt,originalReceipt);
});

test('persistent Creations network loss stops after three retries and keeps the receipt recoverable', async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let navigations=0;
 await page.route('https://fixture.test/**',route=>{navigations++;return route.abort('connectionreset');});
 const originalReceipt=structuredClone(receipt);
 await assert.rejects(waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:new AbortController().signal,creationUrl:'https://fixture.test/creation',timeoutMs:5000,navigationRetryMs:10}),{code:'PROVIDER_CONNECTION_LOST'});
 assert.equal(navigations,4);assert.deepEqual(receipt,originalReceipt);
});

test('cancelling Creations reconnection prevents another navigation', async t=>{
 const page=await browser.newPage();t.after(()=>page.close());let navigations=0;const controller=new AbortController();
 await page.route('https://fixture.test/**',route=>{navigations++;return route.abort('aborted');});
 await assert.rejects(waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:controller.signal,creationUrl:'https://fixture.test/creation',timeoutMs:5000,navigationRetryMs:100,update:value=>{if(value.navigationRetry)controller.abort();}}),{name:'AbortError'});
 assert.equal(navigations,1);
});

test('Creations does not retry certificate failures or a closed browser as transient networking',async()=>{
 for(const message of ['page.goto: net::ERR_CERT_AUTHORITY_INVALID','page.goto: Target page, context or browser has been closed']){
  let navigations=0;const error=new Error(message),page={on(){},off(){},async goto(){navigations++;throw error;}};
  await assert.rejects(waitForNewsAvatar({page,narration,profileId:'profile',receipt,signal:new AbortController().signal,timeoutMs:1000,navigationRetryMs:1}),value=>value===error);
  assert.equal(navigations,1);
 }
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

for (const mode of ['network', 'login', 'quota', 'different-script']) test(`text preflight ${mode} is not a content refusal or an MC receipt`, async t => {
 const page = await browser.newPage(); t.after(() => page.close()); let receipts = 0, submits = 0;
 await page.route('https://fixture.test/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.includes('/task/')) submits++;
  if (pathname.endsWith('/batch_check_text')) {
   if (mode === 'network') return route.abort('connectionreset');
   return route.fulfill({ status: mode === 'login' ? 401 : mode === 'quota' ? 429 : 200, json: { status_code: mode === 'different-script' ? 'THS12140000000' : 'ERROR', data: [false], status_msg: mode === 'login' ? 'Session expired' : mode === 'quota' ? 'Rate limit' : '' } });
  }
  return route.fulfill({ contentType: 'text/html', body: `<button onclick='fetch("/batch_task/v1/batch_check_text",{method:"POST",body:JSON.stringify({texts:[${JSON.stringify(mode === 'different-script' ? 'Unrelated text' : narration)}]})}).catch(()=>{})'>Generate</button>` });
 });
 await page.goto('https://fixture.test/avatar');
 const expected = { network: 'PROVIDER_PREFLIGHT_NETWORK', login: 'NEEDS_LOGIN', quota: 'PROVIDER_QUOTA', 'different-script': 'PROVIDER_SUBMISSION_UNCONFIRMED' }[mode];
 await assert.rejects(submitNewsAvatar({ page, narration, profileId: 'profile', signal: new AbortController().signal, click: () => page.locator('button').click(), saveReceipt: () => receipts++, timeoutMs: 450 }), { code: expected });
 assert.equal(receipts, 0); assert.equal(submits, 0);
});

for (const mode of ['transient', 'persistent', 'no-audio']) test(`verified MC download handles ${mode} without another generation`, async t => {
 const page = await browser.newPage({ acceptDownloads: true }); t.after(() => page.close()); let attempts = 0, posts = 0;
 await page.route('https://fixture.test/**', route => {
  const request = route.request(), pathname = new URL(request.url()).pathname;
  if (request.method() === 'POST') posts++;
  if (pathname.includes('get_recent_creation_list')) return route.fulfill({ json: { data: { list: [fresh] } } });
  if (pathname.endsWith('.jpg')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=', 'base64') });
  if (pathname.endsWith('.mp4')) return route.fulfill({ headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="presenter.mp4"' }, body: 'fixture' });
  return route.fulfill({ contentType: 'text/html', body: '<div><img src="/new.jpg"><button onclick="location.href=\'/new.mp4\'">Download</button></div><script>fetch("/work/v2/get_recent_creation_list")</script>' });
 });
 const action = waitForNewsAvatar({ page, narration, profileId: 'profile', receipt, signal: new AbortController().signal, creationUrl: 'https://fixture.test/creation', timeoutMs: 6000, pollMs: 100, download: async received => {
  attempts++; await received.cancel();
  if (mode === 'no-audio') return { id: 'invalid', hasAudio: false };
  if (mode === 'persistent' || attempts === 1) throw new Error('Connection reset while downloading');
  return { id: 'correct', hasAudio: true };
 } });
 if (mode === 'transient') assert.equal((await action).id, 'correct');
 else await assert.rejects(action, { code: mode === 'no-audio' ? 'NEWS_PRESENTER_AUDIO_REQUIRED' : 'PROVIDER_DOWNLOAD_FAILED' });
 assert.equal(attempts, mode === 'transient' ? 2 : mode === 'no-audio' ? 1 : 3); assert.equal(posts, 0);
});

test('a pre-submit network failure is retried once; content and certificate failures are not', async () => {
 for (const code of ['PROVIDER_PREFLIGHT_NETWORK', 'PROVIDER_CONTENT_REJECTED', 'certificate']) {
  const provider = new DreamFaceProvider({ store: { root: 'fixture' } }); let attempts = 0;
  provider.generateNewsAvatarOnce = async () => { attempts++; if (attempts === 2) return { id: 'mc' }; throw Object.assign(new Error(code === 'certificate' ? 'page.goto: net::ERR_CERT_AUTHORITY_INVALID' : code), { code }); };
  const action = provider.generateNewsAvatar({ log() {} }, { payload: {} }, { id: randomUUID() }, new AbortController().signal, () => {});
  if (code === 'PROVIDER_PREFLIGHT_NETWORK') { assert.equal((await action).id, 'mc'); assert.equal(attempts, 2); }
  else { await assert.rejects(action, { code }); assert.equal(attempts, 1); }
 }
});

test('Avatar navigation timeouts retry once, while click timeouts never trigger another click',async()=>{
  for(const mode of ['goto','reload','persistent','click']){
    const provider=new DreamFaceProvider({store:{root:'fixture'}});let attempts=0;
    const message=`${mode==='click'?'locator.click':'page.'+(mode==='reload'?'reload':'goto')}: Timeout 45000ms exceeded.`;
    provider.generateNewsAvatarOnce=async()=>{
      attempts++;
      if(attempts===2&&!['persistent','click'].includes(mode))return{id:'mc'};
      throw new Error(message);
    };
    const action=provider.generateNewsAvatar({log(){}},{payload:{}},{id:randomUUID()},new AbortController().signal,()=>{});
    if(['goto','reload'].includes(mode))assert.equal((await action).id,'mc');
    else await assert.rejects(action,error=>error.message===message);
    assert.equal(attempts,mode==='click'?1:2);
  }
});
