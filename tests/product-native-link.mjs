import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve('.verification',`product-native-link-${Date.now()}`);await fs.mkdir(root,{recursive:true});const env={...process.env,STUDIO_DATA_DIR:path.join(root,'workspace')};delete env.ELECTRON_RUN_AS_NODE;
const application=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.',`--user-data-dir=${path.join(root,'shell')}`],env,timeout:60000});const report={root,url:'https://www.youtube.com/watch?v=23o20G7GgB0',passed:false};
try{await application.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.hide();BrowserWindow.prototype.show=function(){};});let page;const end=Date.now()+60000;while(Date.now()<end){page=application.windows().find(p=>p.url().startsWith('http://'));if(page)break;await delay(100);}if(!page)throw new Error('No app page');report.result=await page.evaluate(async url=>window.studioDesktop.openExternal(url),report.url);report.passed=report.result.opened===true;await delay(2000);}catch(e){report.error=e.stack;process.exitCode=1;}finally{await application.close();await fs.writeFile(path.resolve('.verification/product-native-link.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
