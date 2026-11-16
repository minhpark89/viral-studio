import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const root=path.resolve('.verification','news-preparation-ui-'+Date.now());
const studio=await startServer({port:0,dataDir:root}),store=studio.store,project=store.state.projects[0];
store.state.settings.queuePaused=true;
const research=store.add('researchResults',{projectId:project.id,topic:'Preparation progress',headline:'Verified airport update',contentSource:'llm',articles:[],warnings:[],imageQueries:[]});
const batch=store.add('productionBatches',{projectId:project.id,status:'preparing',request:{projectId:project.id,researchId:research.id,contentType:'news',count:3,topic:research.headline},warnings:[],items:[{index:0,researchId:research.id,status:'needs_assets',error:'Chọn được 2/8 ảnh thật; cần ít nhất 6.'},{index:1,researchId:research.id,status:'preparing',stage:'Đang chọn ảnh: 4/8 ảnh đạt yêu cầu · đã kiểm tra 12/24 ảnh'},{index:2,researchId:research.id,status:'pending'}]});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const report={passed:false,root,errors:[],checks:[]};page.on('pageerror',error=>report.errors.push(error.message));
try{
 await page.goto(studio.address);await page.locator('aside nav').getByRole('button',{name:'News Studio',exact:true}).click();
 const card=page.locator(`[data-production-batch-id="${batch.id}"]`);
 await card.getByText(/2 video đang xử lý · 1 video cần xử lý/).waitFor();
 await card.getByText(/Video 2: Đang chọn ảnh: 4\/8/).waitFor();
 await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'desktop.png')});
 report.checks.push('Active slots and errors are shown together; each preparing video has its current photo progress');
 batch.items[1].stage='Đang chọn ảnh: 6/8 ảnh đạt yêu cầu · đã kiểm tra 24/24 ảnh';store.save();
 await card.getByText(/Video 2: Đang chọn ảnh: 6\/8/).waitFor();
 await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(root,'mobile.png')});
 assert.deepEqual(report.errors,[]);report.checks.push('Live progress updates without a reload; mobile fits the viewport');report.passed=true;
}finally{
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await browser.close();await studio.close();
}
console.log(JSON.stringify(report));
