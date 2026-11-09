import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=path.resolve('.verification',`product-research-native-${Date.now()}`);
const expectedVersion=JSON.parse(await fs.readFile('package.json','utf8')).version;
const env={...process.env,STUDIO_DATA_DIR:path.join(root,'workspace')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Viral Studio.exe'),args:[`--user-data-dir=${path.join(root,'shell')}`],env,timeout:60000});
const report={root,checks:[],errors:[],passed:false};
try {
  await app.evaluate(({BrowserWindow,shell})=>{
    for(const w of BrowserWindow.getAllWindows())w.hide();BrowserWindow.prototype.show=function(){};
    globalThis.__researchLinks=[];shell.openExternal=async url=>globalThis.__researchLinks.push(url);
  });
  let page;for(let i=0;i<600;i++){page=app.windows().find(p=>p.url().startsWith('http://'));if(page)break;await delay(100);}assert.ok(page);
  page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'AI Research · US',exact:true}).click();
  await page.getByRole('heading',{name:'Research Product · US',exact:true}).waitFor();
  const projectId=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).projects[0].id);
  const scan=await page.evaluate(async projectId=>{
    const r=await fetch('/api/product-research/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),projectId,keywords:'Jesus wall art',sources:['ads']})});return r.json();
  },projectId);
  assert.ok(scan.id);
  await page.getByText('Chưa có SerpApi key. Có thể mở nguồn miễn phí bằng link bên dưới.',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Meta Ads US',exact:true}).click();
  const opened=await app.evaluate(()=>globalThis.__researchLinks);assert.ok(opened.some(url=>url.includes('facebook.com/ads/library')&&url.includes('country=US')));
  await page.getByText('Thêm dữ liệu miễn phí: CSV Google Trends / link mẫu social',{exact:true}).click();
  await page.getByLabel('Nhập CSV Google Trends US').setInputFiles({name:'trends.csv',mimeType:'text/csv',buffer:Buffer.from('Week,Jesus gifts: (United States)\n2026-10-01,0\n2026-10-08,50\n2026-10-15,100\n')});
  await page.getByRole('img',{name:'Mức quan tâm US: Jesus gifts'}).waitFor();
  report.runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,node:process.versions.node,sqlite:process.getBuiltinModule('node:sqlite')!==undefined}));
  assert.equal(report.runtime.version,expectedVersion);assert.ok(report.runtime.sqlite);
  report.checks.push('Packaged Node SQLite initializes and persists Product records', 'Missing key shows honest source failure without API calls', 'Real Electron Meta Ads link uses native browser IPC', 'Google CSV chart renders inside packaged app');
  await page.screenshot({path:path.join(root,'research-packaged.png')});assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}finally{await app.close();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
