import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve('.verification',`news-studio-desktop-${Date.now()}`);await fs.mkdir(root,{recursive:true});
const env={...process.env,STUDIO_DATA_DIR:path.join(root,'workspace')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Viral Studio.exe'),args:[`--user-data-dir=${path.join(root,'shell')}`],env,timeout:60000});
const report={checks:[],errors:[],root};let page;
try{
 await app.evaluate(({BrowserWindow,dialog,shell})=>{for(const w of BrowserWindow.getAllWindows())w.hide();BrowserWindow.prototype.show=function(){};globalThis.__folder=null;globalThis.__opened=[];dialog.showOpenDialog=async()=>globalThis.__folder?{canceled:false,filePaths:[globalThis.__folder]}:{canceled:true,filePaths:[]};shell.openPath=async folder=>{globalThis.__opened.push(folder);return '';};});
 for(let i=0;i<400;i++){page=app.windows().find(p=>p.url().startsWith('http://'));if(page)break;await delay(100);}assert.ok(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('heading',{name:'News Studio',exact:true}).waitFor();
 report.runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged}));assert.equal(report.runtime.version,'0.15.0');assert.equal(report.runtime.packaged,true);
 await page.getByRole('tab',{name:'Cài đặt News',exact:true}).click();const settings=page.getByRole('tabpanel',{name:'Cài đặt News'});
 const folder=path.join(root,'News Output');await app.evaluate((_,dir)=>{globalThis.__folder=dir;},folder);
 await settings.getByRole('button',{name:'Chọn thư mục…',exact:true}).click();assert.equal(await settings.getByLabel('Đường dẫn thư mục News').inputValue(),folder);
 await settings.getByRole('button',{name:'Đặt làm mặc định News',exact:true}).click();await settings.getByRole('button',{name:'Mở thư mục Output',exact:true}).click();
 assert.ok((await app.evaluate(()=>globalThis.__opened)).includes(folder));await settings.getByLabel('Style render tin tức',{exact:true}).selectOption('v3-fast');
 await page.getByRole('tab',{name:'Tạo video tự động',exact:true}).click();assert.equal(await page.getByRole('tabpanel',{name:'Tạo video tự động'}).getByLabel('Style render tin tức',{exact:true}).inputValue(),'v3-fast');
 await page.locator('aside nav').getByRole('button',{name:'Dựng video',exact:true}).click();await page.getByRole('heading',{name:'Dựng video thủ công',exact:true}).waitFor();assert.equal(await page.locator('.production-panel').count(),0);
 await page.locator('aside nav').getByRole('button',{name:'Product Studio',exact:true}).click();await page.getByRole('heading',{name:'Product Studio',exact:true}).waitFor();
 const product=await page.evaluate(async()=>(await fetch('/api/product-output/settings')).json());assert.notEqual(product.defaultDirectory,folder);
 await page.locator('aside nav').getByRole('button',{name:'News Studio',exact:true}).click();await page.getByRole('tab',{name:'Cài đặt News',exact:true}).click();
 await settings.getByRole('heading',{name:'Output News · Chọn nơi lưu video'}).scrollIntoViewIfNeeded();
 // Native capture also works when the test hides the Electron window.
 const capture=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://'));return (await w.webContents.capturePage()).toPNG().toString('base64');});await fs.writeFile(path.join(root,'news-settings.png'),Buffer.from(capture,'base64'));
 assert.deepEqual(report.errors,[]);report.checks.push('Packaged 0.15.0 opens News Studio; native folder choose/save/open works; style persists into automatic News; manual editor and Product remain independent');report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}finally{await app.close();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
