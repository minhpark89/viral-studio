import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startServer } from '../server/index.js';

const root=path.resolve('.verification','storage-ui-'+randomUUID()),studio=await startServer({port:0,dataDir:root}),store=studio.store,project=store.state.projects[0];
const old=new Date(Date.now()-45*86400000).toISOString();
const row=store.add('researchResults',{projectId:project.id,headline:'Archive and restore verified story',script:'Preserve every reviewed word. '.repeat(2000),articles:[{id:randomUUID(),url:'https://example.com/verified',title:'Verified source'}],contentSource:'llm'});row.createdAt=row.updatedAt=old;
const job=store.add('jobs',{projectId:project.id,type:'news',status:'completed',mediaId:randomUUID(),production:{researchId:row.id}});
store.state.settings.meta.publications.push({postId:randomUUID(),mediaIds:[job.mediaId],status:'published',firstCommentStatus:'published',externalPostId:'offline-fixture',publishedAt:old});store.save();
const browser=await chromium.launch({headless:true,executablePath:process.env.STUDIO_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const nav=name=>page.locator('nav').getByRole('button',{name,exact:true});
try{
  await page.goto(studio.address);await nav('Cài đặt').click();
  await page.getByRole('heading',{name:'Ổ dữ liệu & tin đã dùng',exact:true}).waitFor();
  await page.getByRole('button',{name:'Lưu trữ tin đủ điều kiện',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('1 tin đã lưu trữ'));
  assert.ok(store.state.researchResults[0].archive);assert.equal(store.state.researchResults[0].script,undefined);
  // The controlled switch commits after its asynchronous Settings PATCH.
  await page.getByLabel('Tự lưu trữ tin đã đăng sau 30 ngày',{exact:false}).click();
  await page.waitForFunction(async()=>(await(await fetch('/api/state')).json()).settings.historyArchiveEnabled===false);
  await nav('Research & News').click();await page.getByRole('button',{name:/^Đã lưu trữ/}).click();
  await page.getByRole('button',{name:'Khôi phục tin',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-research-id]'));
  assert.equal(store.state.researchResults[0].script,row.script);
  await page.getByRole('button',{name:/^Tất cả \/ lịch sử/}).click();
  await page.locator(`[data-research-id="${row.id}"]`).waitFor();
  await page.reload();await nav('Cài đặt').click();
  await page.getByRole('heading',{name:'Ổ dữ liệu & tin đã dùng',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Tự lưu trữ tin đã đăng sau 30 ngày',{exact:false}).isChecked(),false);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'storage-settings.png'),fullPage:true});
  const report={passed:true,errors,checks:['archive through Settings UI','SSE removes archived body from active state','Research archived view restores exact text','reconnect retains data and preference','actual data volume visible']};
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,root}));
}finally{await browser.close();await studio.close();}
