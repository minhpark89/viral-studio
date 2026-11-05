import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer} from '../server/index.js';
const root=path.resolve('.verification','news-style-browser-'+Date.now());
const studio=await startServer({port:0,dataDir:root}),store=studio.store,project=store.state.projects[0];
Object.assign(store.state.settings,{queuePaused:true});store.state.settings.llm.enabled=true;store.save();
const executablePath=process.env.STUDIO_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({headless:true,...(await fs.stat(executablePath).catch(()=>null)?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
const report={root,checks:[],passed:false};
try{
 await page.route('**/api/production/batches',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const request=route.request().postDataJSON();requests.push(request);
  const batch=store.add('productionBatches',{projectId:project.id,request,status:'queued',warnings:[],items:[{index:0,status:'queued',jobId:null}]});
  await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify(batch)});
 });
 await page.goto(studio.address);await page.locator('nav').getByRole('button',{name:'Dựng video',exact:true}).click();
 const selector=page.getByLabel('Style render tin tức',{exact:true});await selector.waitFor();
 assert.equal(await selector.inputValue(),'v3');assert.deepEqual(await selector.locator('option').evaluateAll(options=>options.map(o=>o.value)),['v3','v3-fast','classic']);
 report.checks.push('Fresh project defaults to V3, with standard/fast/classic choices');
 for(const style of ['v3','v3-fast','classic']){
  await selector.selectOption(style);await page.getByLabel('News niche',{exact:true}).fill('Space research test');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/production/batches')&&r.request().method()==='POST'),page.getByRole('button',{name:'Create 1 video',exact:true}).click()]);
  assert.equal(requests.at(-1).newsRenderStyle,style);assert.equal(requests.at(-1).projectId,project.id);
  await page.reload();await page.locator('nav').getByRole('button',{name:'Dựng video',exact:true}).click();assert.equal(await selector.inputValue(),style);
 }
 report.checks.push('All three selections reach the submitted request and survive reload');
 const legacyProject=store.createProject('Legacy preferences');
 await page.evaluate(({id})=>{localStorage.setItem(`studio-news-format:${id}`,JSON.stringify({newsDuration:20,newsImageCount:8}));localStorage.setItem('studio-project',id);},{id:legacyProject.id});
 await page.reload();await page.locator('nav').getByRole('button',{name:'Dựng video',exact:true}).click();
 assert.equal(await selector.inputValue(),'v3');assert.equal(await page.getByLabel('Độ dài clip tóm tắt',{exact:true}).inputValue(),'20');
 await page.waitForFunction(()=>!document.querySelector('.news-options-save-state')?.textContent.includes('Đang lưu'));
 assert.equal(store.require('projects',legacyProject.id).newsVideoOptions.newsImageCount,8);
 report.checks.push('Old saved preferences acquire V3 without resetting duration/image count');
 await page.screenshot({path:root+'/desktop.png',fullPage:true});
 await page.getByRole('button',{name:/Render video sản phẩm/}).click();assert.equal(await selector.count(),0);
 report.checks.push('Product rendering does not receive a news style control');
 await page.getByRole('button',{name:/Render video tin tức/}).click();await page.setViewportSize({width:390,height:844});
 const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);await page.screenshot({path:root+'/mobile.png',fullPage:true});
 assert.equal(mobileOverflow,false);assert.deepEqual(errors,[]);
 report.passed=true;Object.assign(report,{requests:requests.map(r=>({newsRenderStyle:r.newsRenderStyle,contentType:r.contentType})),mobileOverflow,errors});
}finally{await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2));await browser.close();await studio.close();}
console.log(JSON.stringify(report,null,2));
