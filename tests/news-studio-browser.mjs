import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer} from '../server/index.js';

const root=path.resolve('.verification',`news-studio-${Date.now()}`),app=await startServer({port:0,dataDir:root}),store=app.store,project=store.state.projects[0];
store.state.settings.queuePaused=true;store.state.settings.llm.enabled=true;store.save();
const result=store.add('researchResults',{projectId:project.id,topic:'Verified science story',headline:'Verified science story',niche:'Science',language:'en',contentSource:'llm',script:'A verified source for the interface test.',articles:[{title:'Science source',source:'Example',url:'https://example.com/news',publishedAt:new Date().toISOString()}],imageQueries:[],imageMediaIds:[],warnings:[]});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),report={root,checks:[],errors:[],paidCalls:0};page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
const nav=name=>page.locator('aside nav').getByRole('button',{name,exact:true}).click();
const tab=name=>page.getByRole('tab',{name,exact:true}).click();
try{
 await page.route('**/api/production/batches',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const request=route.request().postDataJSON();
   const batch=store.add('productionBatches',{projectId:project.id,request,outputDirectory:request.newsOutputDirectory || store.state.settings.newsOutputDirectory,status:'queued',warnings:[],items:[{index:0,status:'queued',jobId:null,researchId:request.researchId}]});
   await route.fulfill({status:202,json:batch});
 });
 await page.goto(app.address);await page.getByRole('heading',{name:'News Studio',exact:true}).waitFor();
 const labels=await page.locator('aside nav button').allTextContents();assert.ok(labels.indexOf('News Studio')<labels.indexOf('Product Studio'));assert.ok(labels.indexOf('Kịch bản')>labels.indexOf('Product Studio'));assert.equal(labels.includes('Research & News'),false);
 assert.equal(await page.locator('.editor-page').count(),0);assert.equal(await page.getByRole('button',{name:'Xuất video',exact:true}).count(),0);
 const search=page.getByLabel('Tìm tin Research',{exact:true});await search.fill('Verified');
 await tab('Cài đặt News');const settings=page.getByRole('tabpanel',{name:'Cài đặt News'});
 await settings.getByLabel('Style render tin tức',{exact:true}).selectOption('v3-fast');
 await settings.getByLabel('Độ dài clip tóm tắt',{exact:true}).selectOption('20');
 await settings.getByLabel('Ảnh minh họa',{exact:true}).selectOption('10');
 await settings.getByLabel('Font chữ',{exact:true}).selectOption('viral');
 await settings.getByLabel('Nơi lưu video News',{exact:true}).selectOption('custom');const directory=path.join(root,'Chosen News');
 await settings.getByLabel('Đường dẫn thư mục News',{exact:true}).fill(directory);
 await settings.getByRole('button',{name:'Đặt làm mặc định News',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await(await fetch('/api/state')).json();return s.projects[0].newsVideoOptions?.fontStyle==='viral';});
 await tab('Research & chọn tin');assert.equal(await search.inputValue(),'Verified');assert.equal(await page.getByLabel('Style render tin tức',{exact:true}).filter({visible:true}).inputValue(),'v3-fast');
 await page.locator('.research-result-card').getByRole('button',{name:'Render 1 video',exact:true}).click();
 await page.getByRole('region',{name:'Lượt render từ Research',exact:true}).waitFor();
 const first=store.state.productionBatches[0];assert.equal(first.request.researchId,result.id);assert.equal(first.request.newsRenderStyle,'v3-fast');assert.equal(first.request.newsDuration,20);assert.equal(first.request.fontStyle,'viral');assert.equal(first.outputDirectory,directory);
 report.checks.push('News Studio opens by default; automatic workflows stay out of manual editor; settings persist and Research selection survives internal tabs');
 await tab('Tạo video tự động');const automatic=page.getByRole('tabpanel',{name:'Tạo video tự động'});
 assert.equal(await automatic.getByLabel('Style render tin tức',{exact:true}).inputValue(),'v3-fast');await automatic.getByLabel('News niche',{exact:true}).fill('New science topic');
 await automatic.getByRole('button',{name:'Create 1 video',exact:true}).click();await page.locator('[data-testid="render-record"]').waitFor();
 assert.equal(store.state.productionBatches.at(-1).outputDirectory,directory);assert.equal(await page.getByRole('tab',{name:'Tạo video tự động',exact:true}).getAttribute('aria-selected'),'true');
 report.checks.push('Automatic topic/link batch stays in News Studio with a focused progress record and selected output');
 await nav('Dựng video');await page.getByRole('heading',{name:'Dựng video thủ công',exact:true}).waitFor();assert.equal(await page.locator('.production-panel').count(),0);assert.equal(await page.locator('.product-studio-v2').count(),0);assert.equal(await page.locator('.research-page').count(),0);
 await page.getByLabel('Loại video xuất từ timeline').selectOption('product');assert.equal(await page.getByRole('button',{name:'Xuất video',exact:true}).count(),1);
 await nav('Kịch bản');assert.equal(await page.locator('.production-panel').count(),0);await nav('Product Studio');await page.getByRole('heading',{name:'Product Studio',exact:true}).waitFor();
 await nav('News Studio');await tab('Cài đặt News');const llm=page.getByRole('tabpanel',{name:'Cài đặt News'});let tested;
 await page.route('**/api/settings/llm/test',route=>{tested=route.request().postDataJSON();return route.fulfill({json:{model:tested.model,latencyMs:2}});});
 await llm.getByLabel('Endpoint LLM',{exact:true}).fill('https://example.com/v1');await llm.getByLabel('Model LLM',{exact:true}).fill('fixture-model');await llm.getByLabel('API key LLM',{exact:true}).fill('fixture-unsaved-key');
 await llm.getByRole('button',{name:'Kiểm tra & lưu LLM',exact:true}).click();await page.getByRole('status').filter({hasText:'LLM phản hồi'}).waitFor();assert.equal(tested.apiKey,'fixture-unsaved-key');assert.equal(tested.model,'fixture-model');
 await page.screenshot({path:path.join(root,'news-settings.png')});
 await tab('Research & chọn tin');await page.screenshot({path:path.join(root,'news-studio.png')});
 for(const width of [900,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
 report.checks.push('Manual timeline and storyboard contain no batch automation; Product Studio remains reachable; inline LLM test uses current form values; responsive layouts fit');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}
finally{await browser.close();await app.close();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
