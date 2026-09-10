import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('dist');let revision=1,browser,page;
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{try{const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const name=path.resolve(root,'.'+route);if(!name.startsWith(root+path.sep)&&name!==root)throw Error('invalid path');let body,ext=path.extname(name);try{body=await readFile(name);}catch{body=await readFile(path.join(root,'index.html'));ext='.html';}if(route==='/sw.js')body=Buffer.concat([body,Buffer.from(`\n// Isolated verification revision ${revision}\n`)]);res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(3104,'127.0.0.1',resolve));
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.GOVRP_CHROMIUM_PATH||'/opt/google/chrome/chrome',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();context.on('serviceworker',worker=>console.log('Worker:',worker.url()));page.on('pageerror',error=>console.error('Browser:',error.message));page.on('console',event=>{if(event.type()==='error')console.error('Console:',event.text());});
 await page.goto('http://127.0.0.1:3104');
 console.log('Página carregada; aguardando Service Worker');await page.waitForFunction(async()=>(await navigator.serviceWorker.getRegistration())?.active?.state==='activated',null,{timeout:30000,polling:100});console.log('Worker ativado');await page.goto('http://127.0.0.1:3104/?installed=1');console.log('Nova navegação',await page.evaluate(()=>({url:location.href,controller:navigator.serviceWorker.controller?.scriptURL})));await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:30000,polling:100});console.log('Service Worker inicial ativo');
 const before=await page.evaluate(()=>performance.timeOrigin);revision=2;
 await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
 const modal=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Atualização do GOVRP',exact:true})});
 await modal.waitFor({timeout:30000,polling:100});assert.equal(await modal.getByRole('button',{name:/depois|mais tarde|fechar/i}).count(),0);
 await page.keyboard.press('Escape');assert(await modal.isVisible());await page.mouse.click(2,2);assert(await modal.isVisible());
 for(const width of [320,360,375,390,412,430,768,1024,1440]){await page.setViewportSize({width,height:640});assert(await modal.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));}
 await modal.getByRole('button',{name:'Atualizar GOVRP',exact:true}).click();
 await page.waitForFunction(previous=>performance.timeOrigin!==previous,before,{timeout:30000,polling:100});await modal.waitFor({state:'hidden'});
 console.log('OK atualização real de Service Worker: modal obrigatório, Escape e clique externo bloqueados, nove larguras e nova versão ativada');
}catch(error){if(page){console.error('SW:',await page.evaluate(async()=>({url:location.href,controller:navigator.serviceWorker.controller?.scriptURL,secure:isSecureContext, registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,installing:r.installing?.state,waiting:r.waiting?.state,active:r.active?.state})),body:document.body.innerText.slice(0,400)})));await page.screenshot({path:'/tmp/govrp-pwa-error.png'});}console.error(error);throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
