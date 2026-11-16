import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { Store } from '../server/store.js';
import { startServer } from '../server/index.js';

const root=path.resolve('.verification',`page-check-results-${Date.now()}`);
const seed=new Store(path.join(root,'data'));seed.createProject('Kiểm tra Page');seed.state.settings.queuePaused=true;
const token='synthetic-page-check-token',hash=createHash('sha256').update(token).digest('hex');
Object.assign(seed.state.settings.meta,{enabled:true,accessToken:token,activeTokenId:'fixture',tokens:[{id:'fixture',name:'QA',token,status:'ACTIVE'}],pages:[{id:'1353321161194666',name:'Page kiểm tra',accessToken:'page-check-secret',tokenBindings:{fixture:{status:'VERIFIED',pageToken:'page-check-secret',credentialFingerprint:hash}}}]});seed.save();
const originalFetch=globalThis.fetch;let mode='unpublished',externalWrites=0;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(['localhost','127.0.0.1'].includes(url.hostname))return originalFetch(input,init);
 if(url.hostname==='graph.facebook.com'&&(!init.method||init.method==='GET')){
  if(mode==='token')return Response.json({error:{message:'Token expired',code:190,error_subcode:463}},{status:400});
  return Response.json({id:'1353321161194666',name:'Page kiểm tra',...(mode==='unpublished'?{is_published:false}:{})});
 }
 externalWrites++;throw Error('Unexpected external write');
};
let studio,browser,page;const errors=[];
const until=async(fn)=>{for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for check');};
try {
 studio=await startServer({port:0,dataDir:seed.root});browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(studio.address);await page.getByRole('button',{name:'Channels & Tokens',exact:true}).click();
 const manager=page.getByRole('region',{name:'Quản lý Page'});
 await manager.getByRole('button',{name:'Page kiểm tra',exact:true}).click();
 const dialog=page.getByRole('dialog');
 const check=async()=>{const before=studio.store.state.settings.meta.managementChecks.length;await dialog.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();await until(()=>studio.store.state.settings.meta.managementChecks.length>before&&studio.store.state.settings.meta.managementChecks.at(-1).status==='completed');};
 await check();await dialog.getByText(/Facebook trả is_published=false/).waitFor();
 assert.equal(await dialog.getByText(/API không cho biết nguyên nhân chi tiết/).count(),1);
 assert.equal(await dialog.getByText(/Mã:.*—/).count(),0);
 await page.screenshot({path:path.join(root,'unpublished-desktop.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Đóng',exact:true}).click();
 await manager.locator('.mg-check-results').getByText(/Facebook trả is_published=false/).waitFor();
 await manager.locator('tbody').getByRole('button',{name:'Page kiểm tra',exact:true}).click();
 mode='unknown';await check();await dialog.getByText(/Meta không trả trường is_published/).waitFor();
 mode='token';await check();await dialog.getByText(/Meta 190/).waitFor();await dialog.getByText(/Kết nối lại token/).waitFor();
 await page.screenshot({path:path.join(root,'token-error-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'token-error-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);assert.equal(externalWrites,0);
 const report={passed:true,root,checks:['Unpublished is connected with explicit Facebook action','Per-Page check result visible outside modal','Unknown field is not unpublished','Expired token displays Meta code and remedy','Mobile fits','No publishing requests'],errors};
 await fs.writeFile('.verification/page-check-results-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) { await page?.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});throw error; }
finally {await browser?.close();await studio?.close();globalThis.fetch=originalFetch;}
