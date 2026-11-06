import assert from 'node:assert/strict';
import process from 'node:process';
import { chromium } from 'playwright';

export async function runExpansionBrowser(fixtures, changeFromAnotherSession) {
 const browser=await chromium.launch({headless:true}), errors=[];
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('console',message=>{if(message.type()==='error')console.error('Console QA:',message.text().slice(0,500));});
 page.on('requestfailed',request=>console.error('Requisição QA recusada:',new URL(request.url()).pathname,request.failure()?.errorText));
 page.on('pageerror',error=>{errors.push(error.message);console.error('Erro do navegador:',error.message);});
 await page.route('https://*.supabase.co/**',route=>route.abort('blockedbyclient'));
 await page.addInitScript(({session,id})=>{localStorage.setItem('sb-127-auth-token',JSON.stringify(session));localStorage.setItem('theme','dark');sessionStorage.setItem(`govrp:tutorial:${id}`,'closed');},{session:fixtures.people[0].session,id:fixtures.people[0].id});
 const widths=[320,360,375,390,412,430,768,1024,1440];
 const checkWidth=async()=>{
  // Recharts uses ResizeObserver; check the settled layout after viewport changes.
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,{},{timeout:3000});
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`Página excedeu ${dimensions.width}px: ${dimensions.scroll}px`);
 };
 const dismiss=async()=>{
   for(let n=0;n<5;n++){
    for(const name of ['Continuar minha jornada','Lembrar mais tarde','Somente essenciais']){
     const button=page.getByRole('button',{name,exact:true});if(await button.isVisible() && await button.isEnabled())await button.click({timeout:3000}).catch(()=>{});
    }
    await page.keyboard.press('Escape');await page.waitForTimeout(100);
   }
 };
 try {
  await page.goto(`http://127.0.0.1:3206/services/companies/${fixtures.business}?view=management`);
  await page.locator('h3').filter({hasText:'Retirar do caixa'}).waitFor({timeout:60000});await dismiss();
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();}
  await page.getByLabel('Valor (R$)',{exact:true}).fill('5000');
  await page.getByLabel('Conta de destino').click();await page.getByRole('option',{name:'Conta do proprietário',exact:true}).click();
  await page.getByLabel('Justificativa',{exact:true}).fill('Retirada confirmada pelo navegador com dados reais de QA.');
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  if(changeFromAnotherSession){
   const draft=await page.getByLabel('Justificativa',{exact:true}).inputValue(), previousUrl=page.url(),previousScroll=await page.evaluate(()=>scrollY),count=navigations;
   const refresh=page.waitForResponse(response=>response.url().includes('/rpc/get_company_management')&&response.request().method()==='POST');
   await changeFromAnotherSession();await refresh;
   assert.equal(await page.getByLabel('Justificativa',{exact:true}).inputValue(),draft);assert.equal(page.url(),previousUrl);assert.equal(navigations,count);assert.ok(Math.abs((await page.evaluate(()=>scrollY))-previousScroll)<=1);
   console.log('Realtime preservou formulário, aba, scroll e contexto sem reload.');
  }
  await page.getByRole('button',{name:'Revisar transferência',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Confirmar transferência'});await dialog.waitFor();
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();assert.ok(await dialog.getByRole('button',{name:'Confirmar',exact:true}).isEnabled());}
  const receipt=page.waitForResponse(r=>r.url().includes('/rpc/withdraw_company_cash')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();assert.equal((await receipt).status(),200);await dialog.waitFor({state:'hidden'});console.log('Retirada confirmada pelo navegador.');
  await page.goto('http://127.0.0.1:3206/services/justice');await page.locator('button').filter({hasText:'STF, sabatinas e mandatos'}).waitFor({timeout:60000});await dismiss();
  await page.getByRole('button',{name:'STF, sabatinas e mandatos',exact:true}).click();await page.getByText('STF · vaga 5',{exact:true}).waitFor();
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();}
  console.log('STF validado em nove larguras.');const occurrence=page.locator('form').filter({has:page.locator('#occurrence-title')});await occurrence.getByText('Arquivos da ocorrência',{exact:true}).waitFor();
  await occurrence.getByRole('combobox',{name:'Adicionar envolvido'}).click();
  await page.getByPlaceholder('Nome ou username',{exact:true}).fill('QA Destinatário');await page.getByRole('option').filter({hasText:'QA Destinatário'}).first().click();console.log('Seleção estruturada de cidadão validada.');
  await page.keyboard.press('Escape');
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();}
  await page.keyboard.press('Escape');
  await page.goto('http://127.0.0.1:3206/country-info');await page.getByRole('tab',{name:'Economia',exact:true}).click();await page.getByText('PIB nominal em dólares',{exact:true}).waitFor({timeout:60000});await dismiss();
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();}
  await page.goto(`http://127.0.0.1:3206/services/political-parties/${fixtures.party}`);await page.getByText('Transferir do caixa partidário',{exact:true}).waitFor({timeout:60000});await dismiss();
  for(const width of widths){await page.setViewportSize({width,height:900});await checkWidth();}
  assert.deepEqual(errors,[],'Erro JavaScript no navegador');
  console.log('PASS: navegador com Auth e API reais, retirada confirmada, STF, BO/diretório, economia e partido em nove larguras de 320 a 1440px.');
 } catch(error){if(process.env.GOVRP_QA_ARTIFACTS){await page.screenshot({path:`${process.env.GOVRP_QA_ARTIFACTS}/expansion-browser-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(0,3000));}throw error;}
 finally{await browser.close();}
}
