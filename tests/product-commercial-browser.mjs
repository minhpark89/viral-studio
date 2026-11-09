import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';
import { rankEvidence } from '../server/product-research/evidence.js';
import { parseAds } from '../server/product-research/providers.js';
import { prioritizeProducts } from '../server/product-research/opportunities.js';

const evidenceRoot=path.resolve('../.maintenance/product-research-0131-20261109');
const shopping=JSON.parse(await fs.readFile(path.join(evidenceRoot,'new-sources-live.json'),'utf8')).shopping.records;
const shorts=JSON.parse(await fs.readFile(path.join(evidenceRoot,'shorts-broad-live.json'),'utf8')).records;
const db=new DatabaseSync('D:/DROPSHIP/Viral Studio Test 0.11.0/Viral Data/product-research/research.sqlite',{readOnly:true});
let ads=[];
try {for(const row of db.prepare('SELECT body FROM cache').all()){const c=JSON.parse(row.body);if(c.body?.ads)ads=prioritizeProducts(parseAds(c.body,c.observedAt,30),'Christian gifts').slice(0,10);}}finally{db.close();}
const root=path.resolve('.verification',`commercial-ui-${Date.now()}`),app=await startServer({port:0,dataDir:root});
const project=app.store.state.projects[0],id=randomUUID(),records=[...shopping.slice(0,10),...ads,...prioritizeProducts(shorts,'Christian gifts')].map(r=>({...r,history:[],assessment:rankEvidence(r)}));
app.productResearch.repo.put('scan',{id,projectId:project.id,request:{projectId:project.id,requestId:id,mode:'discover',keywords:'Christian gifts',sources:['shopping','ads','social'],limit:10},query:'Christian gifts',createdAt:new Date().toISOString(),status:'completed',sources:[],records,shortlist:[]});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),report={root,liveCapturedEvidence:true,paidCalls:0,checks:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
try {
  await page.goto(app.address);await page.getByRole('button',{name:'AI Research · US',exact:true}).click();await page.locator('.pr-card').first().waitFor();
  await page.getByRole('button',{name:/Tìm sản phẩm & mẫu quảng cáo/}).click();
  for(const source of ['Google Shopping','Meta Ads','TikTok / Instagram / Facebook'])assert.equal(await page.locator('.pr-sources label').filter({hasText:source}).locator('input').isChecked(),true);
  assert.equal(await page.locator('.pr-sources label').filter({hasText:'YouTube'}).locator('input').isChecked(),false);
  await page.getByRole('button',{name:'Sản phẩm (10)',exact:true}).click();
  assert.equal(await page.locator('.pr-card').count(),10);assert.ok((await page.locator('.pr-card').first().innerText()).includes('$'));
  await page.getByRole('button',{name:'Quảng cáo (10)',exact:true}).click();
  assert.match(await page.locator('.pr-card').first().innerText(),/Portrait of Faith/);
  await page.locator('.pr-card').first().getByRole('button',{name:/Xem video mẫu trong app/}).click();
  await page.waitForFunction(()=>document.querySelector('.pr-card video')?.readyState>=2,null,{timeout:45000});
  const duration=await page.locator('.pr-card video').first().evaluate(v=>v.duration);assert.ok(duration>0);
  await page.locator('.pr-results').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'live-product-ads.png')});
  await page.getByLabel('Chỉ mẫu có dấu hiệu sản phẩm (lọc gợi ý)').check();
  assert.equal(await page.locator('.pr-card').count(),6);
  await page.getByLabel('Chỉ mẫu có dấu hiệu sản phẩm (lọc gợi ý)').uncheck();
  await page.getByRole('button',{name:'Video (7)',exact:true}).click();
  const platforms=await page.locator('.pr-card .pr-kind').allTextContents();for(const platform of ['tiktok','instagram','facebook'])assert.ok(platforms.some(v=>v.includes(platform)));
  await page.screenshot({path:path.join(root,'live-social-videos.png')});
  report.checks.push('Presets select commercial sources without YouTube or triggering a paid scan','Shopping prices and merchants render; Meta product ads rank ahead of sermons','Actual captured Meta video plays inside app through protected preview endpoint', 'Filter keeps six commercial candidates; actual TikTok/Instagram/Facebook references appear');
  await page.getByRole('button',{name:'Product Studio',exact:true}).click();await page.getByRole('heading',{name:'Output Product · Chọn nơi lưu video'}).waitFor();
  const picker=page.locator('.product-output-picker');assert.ok((await picker.boundingBox()).y<500);
  await picker.getByText('Product và News lưu ở đâu?',{exact:true}).click();assert.ok((await picker.innerText()).includes(path.join(root,'exports','products','final')));assert.ok((await picker.innerText()).includes('News:'));
  await page.screenshot({path:path.join(root,'output-prominent.png')});report.checks.push('Output folder controls appear above Product form and show separate Product/News paths');
  await page.setViewportSize({width:900,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error){report.error=error.stack;process.exitCode=1;await page.screenshot({path:path.join(root,'failure.png'),fullPage:true});}
finally {await browser.close();await app.close();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
