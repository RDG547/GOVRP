import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { local, actor, service, request, rpc, waitFor, cleanup } from './lib/world-test.mjs';
const playwright = await import(process.env.GOVRP_PLAYWRIGHT_PATH ? pathToFileURL(process.env.GOVRP_PLAYWRIGHT_PATH).href : 'playwright');
const origin = 'http://127.0.0.1:3100';
const widths = [320,360,375,390,412,430,768,1024,1440];
async function responsive(page, label) {
  for (const width of widths) {
    await page.setViewportSize({width,height:950});
    assert(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1), `${label} sem rolagem horizontal ${width}`);
    const dialog=page.getByRole('dialog').last();
    if(await dialog.count()) assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1), `${label} conteúdo acessível ${width}`);
  }
  console.log(`✓ ${label} responsivo nas nove larguras`);
}
const output = createWriteStream('/tmp/govrp-world-vite.log');
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], { env: { ...process.env, VITE_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SECRET_KEY || local.SERVICE_ROLE_KEY, VITE_HCAPTCHA_SITE_KEY: '', VITE_HCAPTCHA_SITEKEY: '' }, stdio: ['ignore','pipe','pipe'] });
dev.stdout.pipe(output); dev.stderr.pipe(output);
let browser, page;
const testSources = [];
try {
  await waitFor(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'servidor Vite local', 30000);
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.GOVRP_CHROMIUM_PATH ? { executablePath: process.env.GOVRP_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const a = await actor('browserautor'), b = await actor('browserleitor');
  const login = async person => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await context.newPage(); page = p;
    p.on('pageerror', error => console.error('Browser:', error.message));
    p.on('console', message => {if(message.type()==='error' && message.text().includes('parlamento')) console.error('Painel:',message.text());});
    await p.goto(`${origin}/login`);
    await p.getByLabel('E-mail da conta', { exact: true }).fill(person.email);
    await p.getByLabel('Senha', { exact: true }).fill(person.password);
    await p.getByRole('button', { name: 'Somente essenciais', exact: true }).click();
    await p.getByRole('main').getByRole('button', { name: 'Entrar', exact: true }).click();
    await p.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    return p;
  };
  const pa = await login(a), pb = await login(b);
  await pa.goto(`${origin}/services/x`); await pb.goto(`${origin}/services/x/profile/${a.handle}`);
  await pa.getByRole('button', { name: 'Adicionar Story', exact: true }).waitFor({ timeout: 30000 });
  await pb.getByRole('heading', {name:new RegExp('Teste browserautor')}).first().waitFor({timeout:30000});
  const loadsA=await pa.evaluate(()=>performance.timeOrigin),loadsB=await pb.evaluate(()=>performance.timeOrigin);
  await pa.getByRole('button',{name:'Adicionar Story',exact:true}).click();
  await pa.getByRole('button',{name:'Texto',exact:true}).click();
  const storyText=`Story E2E ${crypto.randomUUID().slice(0,8)}`;
  await pa.getByPlaceholder('Comece a digitar...').fill(storyText);
  await pa.getByRole('button',{name:'Publicar Story',exact:true}).click();
  await pb.getByRole('button',{name:/Ver Stories de Teste browserautor/}).waitFor({timeout:20000});
  await pb.getByRole('button',{name:/Ver Stories de Teste browserautor/}).click();
  await pb.getByRole('button',{name:'Pausar Story',exact:true}).click();
  assert(await pb.getByText(storyText,{exact:true}).isVisible());
  await responsive(pb,'Visualizador de Story');
  console.log('✓ Story criado pela interface chega ao perfil aberto em outra sessão');
  const published=await request(service.from('stories').select('id').eq('user_id',a.id).eq('content',storyText).single());
  await rpc(a.client,'delete_story',{p_story_id:published.id});
  await pb.getByText('Este Story foi removido ou expirou.',{exact:true}).waitFor({timeout:20000});
  await pb.getByRole('button',{name:'Voltar aos Stories',exact:true}).click();
  assert.equal(await pb.getByRole('button',{name:/Ver Stories de Teste browserautor/}).count(),0);
  console.log('✓ Story removido sai da barra e o visualizador mantém estado amigável');
  await pa.getByPlaceholder('O que está acontecendo?').fill(`Post E2E ${a.handle}`);
  await pa.locator('form').filter({has:pa.getByPlaceholder('O que está acontecendo?')}).getByRole('button',{name:'Postar',exact:true}).click();
  await pb.getByText(`Post E2E ${a.handle}`,{exact:true}).waitFor({timeout:20000});
  const post=await request(service.from('posts').select('id').eq('user_id',a.id).eq('content',`Post E2E ${a.handle}`).single());
  // Feed and detail use the same conversation, preserving the root composer on incoming replies.
  await pa.getByRole('button',{name:/^Comentar \(/}).first().click();
  const feedThread=pa.getByRole('region',{name:'Conversa da publicação'}).first();
  await feedThread.getByRole('textbox',{name:'Escrever comentário',exact:true}).fill('Conversa E2E em todos os níveis');
  await feedThread.getByRole('button',{name:'Comentar',exact:true}).click();
  await pb.goto(`${origin}/services/x/post/${post.id}`);
  const detailThread=pb.getByRole('region',{name:'Conversa da publicação'});
  await detailThread.getByText('Conversa E2E em todos os níveis',{exact:true}).waitFor();
  const conversationLoad=await pb.evaluate(()=>performance.timeOrigin);
  const rootComment=feedThread.getByRole('article').first();
  for(let edit=1;edit<=2;edit++){
    await rootComment.getByRole('button',{name:'Editar comentário',exact:true}).first().click();
    await rootComment.getByRole('textbox',{name:'Editar comentário',exact:true}).fill(`Conversa alterada ${edit}`);
    await rootComment.getByRole('button',{name:'Salvar',exact:true}).click();
    await detailThread.getByText(`Editado ${edit}x`,{exact:true}).waitFor({timeout:20000});
  }
  for(let level=1;level<=5;level++){
    const parent=detailThread.getByRole('article').last();
    await parent.getByRole('button',{name:'Responder',exact:true}).first().click();
    const replyBox=parent.getByRole('textbox',{name:'Escrever resposta',exact:true});
    assert((await replyBox.inputValue()).startsWith('@'));
    await replyBox.fill(`Resposta E2E nível ${level}`);
    await parent.locator('form').getByRole('button',{name:'Responder',exact:true}).click();
    await feedThread.getByText(`Resposta E2E nível ${level}`,{exact:true}).waitFor({timeout:20000});
  }
  await responsive(pb,'Conversa com cinco níveis de respostas');
  await detailThread.getByRole('textbox',{name:'Escrever comentário',exact:true}).fill('Rascunho preservado na conversa');
  await rootComment.getByRole('button',{name:'Remover comentário',exact:true}).first().click();
  await detailThread.getByText('Este comentário foi removido.',{exact:true}).waitFor({timeout:20000});
  assert(await detailThread.getByText('Resposta E2E nível 5',{exact:true}).isVisible());
  assert.equal(await detailThread.getByRole('textbox',{name:'Escrever comentário',exact:true}).inputValue(),'Rascunho preservado na conversa');
  assert.equal(await pb.evaluate(()=>performance.timeOrigin),conversationLoad);
  await pb.goto(`${origin}/services/x/profile/${a.handle}`);
  await pb.getByText(`Post E2E ${a.handle}`,{exact:true}).waitFor();
  console.log('✓ Conversa compartilhada no Feed e detalhe: duas edições, cinco níveis, menções e remoção preservam respostas e formulário');
  await pa.getByPlaceholder('O que está acontecendo?').fill('Rascunho preservado durante eventos');
  await rpc(a.client,'delete_post',{p_post_id:post.id});
  await pb.getByText(`Post E2E ${a.handle}`,{exact:true}).waitFor({state:'detached',timeout:20000});
  assert.equal(await pa.getByPlaceholder('O que está acontecendo?').inputValue(),'Rascunho preservado durante eventos');
  assert.equal(await pa.evaluate(()=>performance.timeOrigin),loadsA);
  console.log('✓ Post criado e removido atualiza perfil; formulário e documento da página permanecem');
  await request(service.from('profiles').update({x_bio:'Bio atualizada com perfil aberto',x_username:`Nome atualizado ${a.handle}`}).eq('id',a.id));
  await pb.getByText('Bio atualizada com perfil aberto',{exact:true}).waitFor({timeout:20000});
  await responsive(pb,'Perfil da Rede X');
  console.log('✓ Nome e bio públicos atualizam no perfil de outra sessão');
  await pb.goto(`${origin}/services/x/post/${post.id}`);
  await pb.getByText('Esta publicação foi removida.',{exact:true}).waitFor({timeout:20000});
  console.log('✓ Detalhe de publicação removida oferece retorno ao feed');
  await request(service.from('documents').insert({user_id:a.id,type:'CNH',document_number:`E2E${crypto.randomUUID().slice(0,8)}`,issued_at:new Date().toISOString(),is_valid:true}));
  page=pa; await pa.goto(`${origin}/services/dic`);
  await pa.getByRole('button',{name:'Visualizar',exact:true}).first().waitFor({timeout:30000});
  for(const width of [320,360,375,390,412,430,768,1024,1440]) {
    await pa.setViewportSize({width,height:950});
    await pa.getByRole('button',{name:'Visualizar',exact:true}).first().click();
    const close=pa.getByRole('button',{name:'Fechar documento',exact:true}),flip=pa.getByRole('button',{name:'Virar documento',exact:true});
    await close.waitFor();
    await waitFor(async()=>Math.abs((await close.boundingBox()).width-44)<0.1,'fim da animação do documento');
    const c=await close.boundingBox(),f=await flip.boundingBox();
    const card=await pa.getByRole('dialog').locator('[data-official-document]').first().boundingBox();
    assert(c.x>=card.x&&c.y>=card.y&&f.x+f.width<=card.x+card.width&&f.y+f.height<=card.y+card.height, 'controles dentro do documento '+width);

    assert(c.width>=43.9 && c.height>=43.9 && f.width>=43.9 && f.height>=43.9 && c.y<f.y && c.x>=0 && c.x+c.width<=width,`controles DIC ${width}`);
    await flip.click(); await close.focus(); assert(await close.evaluate(el=>el===document.activeElement));
    if([320,390,1440].includes(width)) await pa.screenshot({path:`/tmp/govrp-world-dic-${width}.png`});
    await close.click();
    console.log(`✓ DIC ${width}px: fechar e virar acessíveis e clicáveis nos dois lados`);
  }
  await request(service.from('profiles').update({role:'Juiz'}).eq('id',b.id));
  await pb.getByRole('heading',{name:'Você assumiu um novo cargo!',exact:true}).waitFor({timeout:20000});
  await pb.setViewportSize({width:320,height:950}); await pb.screenshot({path:'/tmp/govrp-world-role-320.png'});
  await responsive(pb,'Modal de cargo');
  await pb.getByRole('button',{name:'Entendi',exact:true}).click();
  console.log('✓ Alteração de cargo abre modal online e registra ciência pela interface');
  const learner=await actor('tutorialpolitico','Cidadão',{tutorial_dont_show_again:false,initial_aspiration:'politics'});
  const pt=await login(learner);
  await pt.getByRole('button',{name:'Próximo',exact:true}).click(); await pt.getByText(/Como você demonstrou interesse pela política/).waitFor({timeout:20000});
  await pt.setViewportSize({width:320,height:950}); await pt.screenshot({path:'/tmp/govrp-world-tutorial-320.png'});
  await responsive(pt,'Tutorial personalizado');
  for(const width of widths){await pt.setViewportSize({width,height:640});const dialog=pt.getByRole('dialog');assert(await dialog.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'tutorial sem scroll '+width);assert(await pt.getByRole('button',{name:'Próximo',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'rodapé visível '+width);}
  console.log('✓ Tutorial cabe em 640px de altura nas nove larguras, com rodapé visível');
  await pt.getByRole('button',{name:'Pular',exact:true}).click(); await pt.context().close();
  const pt2=await login(learner);
  await pt2.getByRole('button',{name:'Próximo',exact:true}).click(); await pt2.getByText(/Como você demonstrou interesse pela política/).waitFor({timeout:20000});
  await pt2.getByRole('checkbox',{name:'Não mostrar novamente',exact:true}).click();
  await pt2.getByRole('button',{name:'Pular',exact:true}).click(); await pt2.context().close();
  const pt3=await login(learner); await pt3.getByRole('heading',{name:/Bem-vindo ao GOVRP/}).waitFor({state:'hidden',timeout:10000});
  assert((await request(learner.client.from('profiles').select('tutorial_dont_show_again').eq('id',learner.id).single())).tutorial_dont_show_again);
  console.log('✓ Tutorial personalizado volta em nova sessão sem checkbox e persiste a recusa quando marcado');

  const legislator=await actor('browserdeputado','Deputado');
  const houses=await request(service.from('parliament_houses').select('id,name'));
  const chamber=houses.find(house=>/c.mara/i.test(house.name)) || await request(service.from('parliament_houses').insert({id:'a1b2c3d4-e5f6-7890-1234-567890abcdef',name:'Câmara dos Deputados',description:'Casa legislativa da sessão de testes'}).select('*').single());
  await request(service.from('parliament_members').insert({user_id:legislator.id,house_id:chamber.id,term_start_date:new Date(Date.now()-86400000).toISOString().slice(0,10),term_end_date:new Date(Date.now()+86400000).toISOString().slice(0,10)}));
  const pl=await login(legislator); page=pl;
  if(await pl.getByRole('button',{name:'Entendi',exact:true}).isVisible()) await pl.getByRole('button',{name:'Entendi',exact:true}).click();
  await pl.goto(`${origin}/services/parliament/panel`);
  await pl.getByRole('button',{name:'Modelos de Propostas',exact:true}).waitFor({timeout:30000});
  await pl.getByRole('button',{name:'Modelos de Propostas',exact:true}).click();
  await pl.getByLabel('Modelo',{exact:true}).click(); await pl.getByRole('option',{name:'Alterar Imposto Empresarial',exact:true}).click();
  const salesRule=await request(service.from('government_rules').select('description').eq('rule_key','corporate_tax_rate').single());await waitFor(async()=>(await pl.getByLabel('Regra vigente',{exact:true}).innerText()).includes(salesRule.description),'modelo resolve a regra vigente');
  const proposalTitle=`Lei E2E ${crypto.randomUUID().slice(0,8)}`;
  await pl.getByLabel('Título',{exact:true}).fill(proposalTitle);
  for(const width of [320,360,375,390,412,430,768,1024,1440]) {
    await pl.setViewportSize({width,height:950});
    const dialog=pl.getByRole('dialog');
    assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`proposta sem rolagem horizontal ${width}`);
    if([320,1440].includes(width)) await pl.screenshot({path:`/tmp/govrp-world-law-${width}.png`});
  }
  await pl.getByRole('checkbox',{name:/Revisei o texto/}).check();
  await pl.getByRole('button',{name:'Enviar proposta para tramitação',exact:true}).click();
  await waitFor(async()=> (await request(service.from('bills').select('id').eq('title',proposalTitle))).length===1,'proposta da interface persistida');
  console.log('✓ Modelo parametrizado enviado pela interface parlamentar nas nove larguras');
  const executive=await actor('browserpresidente','Presidente');
  const voteHouse=await request(service.from('parliament_houses').insert({name:`Casa E2E ${crypto.randomUUID().slice(0,8)}`}).select('id').single());
  const mandate=await request(service.from('parliament_members').insert({user_id:legislator.id,house_id:voteHouse.id,term_start_date:new Date(Date.now()-86400000).toISOString().slice(0,10),term_end_date:new Date(Date.now()+86400000).toISOString().slice(0,10)}).select('id').single());
  for(const person of [a,b]) await request(service.from('accounts').upsert({user_id:person.id,account_number:crypto.randomUUID().replaceAll('-','').slice(0,12),agency_number:'0001',balance:100000},{onConflict:'user_id'}));
  const item=await rpc(b.client,'save_business_product',{p_product_id:null,p_business_id:null,p_name:`Produto E2E ${crypto.randomUUID().slice(0,8)}`,p_description:'Produto para validar carrinho e cotação durante alteração legal.',p_price:100,p_image_url:'https://example.invalid/item.png',p_product_type:'one-time',p_subscription_interval:null,p_category:'Outros',p_stock:10,p_promotion_price:null,p_promotion_expires_at:null});
  const quoted=await rpc(a.client,'get_products_with_final_price');
  const original=Number(quoted.find(product=>product.id===item.id).final_price);
  const money=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\s/g,' ');
  page=pa; await pa.goto(`${origin}/services/business`);
  const card=pa.locator('div.glass-effect').filter({has:pa.getByText(item.name,{exact:true})}).filter({has:pa.getByRole('button',{name:'Adicionar ao Carrinho',exact:true})});
  await card.getByRole('button',{name:'Adicionar ao Carrinho',exact:true}).click();
  await pa.getByRole('button',{name:/^Carrinho/}).click();
  await pa.getByRole('button',{name:'Finalizar Compra',exact:true}).click();
  await pt3.goto(`${origin}/services/business/product/${item.id}`);
  await pt3.getByRole('button',{name:'Comprar Agora',exact:true}).click();
  const cartDialog=pa.getByRole('dialog'), buyDialog=pt3.getByRole('dialog');
  await waitFor(async()=> (await cartDialog.innerText()).replace(/\s/g,' ').includes(money(original)),'valor inicial do carrinho');
  const cartOrigin=await pa.evaluate(()=>performance.timeOrigin),buyOrigin=await pt3.evaluate(()=>performance.timeOrigin);
  const tax=await rpc(legislator.client,'submit_structured_legal_measure',{p_source_kind:'bill',p_title:'Taxa com compra aberta E2E',p_summary:'A alteração legal deve atualizar o carrinho e a compra em andamento.',p_full_text:'Art. 1º. Cria-se a taxa estruturada de cinco reais por venda. Art. 2º. As novas operações devem registrar seu valor.',p_house_id:voteHouse.id,p_effects:[{kind:'fee',action:'create',rule_key:`e2e_${crypto.randomUUID().replaceAll('-','')}`,name:'Taxa E2E de compra',value:5,definition:{basis:'purchase',nature:'fixed',payer:'buyer',audience:'all'}}]});
  testSources.push(tax.id);
  const voting=await rpc(executive.client,'start_parliament_bill_voting',{p_bill_id:tax.id,p_house_id:voteHouse.id,p_title:'Votação E2E',p_description:'Votação parlamentar real para imposto na interface.'});
  await rpc(legislator.client,'cast_parliament_vote',{p_voting_id:voting.id,p_member_id:mandate.id,p_vote:'Aprovar'});
  await rpc(legislator.client,'update_bill_status',{p_bill_id:tax.id,p_new_status:'Aguardando sanção presidencial'});
  await rpc(executive.client,'update_bill_status',{p_bill_id:tax.id,p_new_status:'Sancionado'});
  for(const dialog of [cartDialog,buyDialog]) await waitFor(async()=> (await dialog.innerText()).replace(/\s/g,' ').includes(money(original+5)),'compra aberta recebe nova taxa');
  assert.equal(await pa.evaluate(()=>performance.timeOrigin),cartOrigin);assert.equal(await pt3.evaluate(()=>performance.timeOrigin),buyOrigin);
  await responsive(pa,'Carrinho tributado');
  await cartDialog.getByRole('button',{name:'Confirmar e Pagar',exact:true}).click();
  await waitFor(async()=>!(await cartDialog.count()),'compra do carrinho confirmada');
  const paid=await request(service.from('transactions').select('metadata').eq('metadata->>product_id',item.id));
  assert(paid.some(tx=>Number(tx.metadata.total_debited)===original+5),'carrinho cobra o total vigente mostrado');
  console.log('✓ Lei sancionada atualiza duas compras abertas sem reload e o carrinho cobra o valor exibido');
  // Remove this test-only levy through the same legislative path so other suites remain independent.
  const feeEffect=(await request(service.from('law_effects').select('effect_data').eq('source_id',tax.id).single())).effect_data;
  const revocation=await rpc(legislator.client,'submit_structured_legal_measure',{p_source_kind:'bill',p_title:'Revogação da taxa E2E',p_summary:'Encerra a taxa do cenário integrado sem alterar compras antigas.',p_full_text:'Art. 1º. Revoga-se a taxa estruturada de compra do cenário E2E. Art. 2º. Preservam-se os registros históricos.',p_house_id:voteHouse.id,p_effects:[{...feeEffect,action:'revoke',value:0}]});
  const revokeVote=await rpc(executive.client,'start_parliament_bill_voting',{p_bill_id:revocation.id,p_house_id:voteHouse.id,p_title:'Revogação E2E',p_description:'Votação parlamentar real para encerrar a cobrança.'});
  await rpc(legislator.client,'cast_parliament_vote',{p_voting_id:revokeVote.id,p_member_id:mandate.id,p_vote:'Aprovar'});
  await rpc(legislator.client,'update_bill_status',{p_bill_id:revocation.id,p_new_status:'Aguardando sanção presidencial'});
  await rpc(executive.client,'update_bill_status',{p_bill_id:revocation.id,p_new_status:'Sancionado'});
  page=pb; await pb.goto(`${origin}/services/justice?view=authority`);
  const dailyReminder=pb.getByRole('button',{name:'Lembrar mais tarde',exact:true});
  if(await dailyReminder.isVisible()) await dailyReminder.click();
  await pb.getByRole('heading',{name:/Justiça/}).first().waitFor({timeout:30000});
  await responsive(pb,'Justiça');


} catch (error) { if (page) { await page.screenshot({ path: '/tmp/govrp-world-interface-error.png' }); console.error((await page.locator('body').innerText()).slice(-6000)); } throw error; }
finally {
  if(testSources.length) {
    await request(service.from('government_rules').update({is_active:false}).in('source_id',testSources));
    await request(service.from('law_effects').update({status:'revoked'}).in('source_id',testSources));
  }
  await browser?.close(); dev.kill('SIGTERM'); output.end(); await cleanup(); }
