import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {chromium} from 'playwright';
import {actor,local,service,request,rpc,waitFor,cleanup} from './lib/world-test.mjs';
const origin='http://127.0.0.1:3115',log=createWriteStream('/tmp/govrp-formation-countdown.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3115','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY||local.SERVICE_ROLE_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(log);dev.stderr.pipe(log);let browser,p;
try{
 const president=await actor('countdown-president');
 execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qc',`begin;select set_config('govrp.executive_transition','replacing',true);update public.profiles set role='Cidadão' where role in('Presidente','Vice-Presidente');update public.government_terms set ended_at=clock_timestamp() where ended_at is null;select set_config('govrp.executive_transition','',true);update public.profiles set role='Presidente',manual_role_override=true,role_assigned_at=clock_timestamp() where id='${president.id}';commit;`],{stdio:'ignore'});
 const offices=await request(service.from('executive_office_definitions').select('*').eq('required_for_formation',true)),ministries=await request(service.from('government_ministries').select('*').eq('is_active',true));
 for(const office of offices){const person=await actor('countdown-office');await rpc(president.client,'manage_executive_appointment',{p_office_key:office.office_key,p_user_id:person.id,p_note:'Nomeação controlada para verificar formação de governo no ambiente local.'});}
 for(const ministry of ministries){const person=await actor('countdown-invited');await rpc(president.client,'appoint_minister',{p_user_id:person.id,p_ministry:ministry.name});}
 const formation=await rpc(president.client,'get_presidential_formation');assert.equal(formation.awaiting,ministries.length);assert(formation.offices.every(o=>o.appointment?.user_id));
 await rpc(president.client,'claim_daily_check_in');await request(service.from('notifications').update({metadata:{popup_shown_at:new Date().toISOString()}}).eq('user_id',president.id));
 await waitFor(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}},'Vite local',30000);
 browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});p=await browser.newPage({viewport:{width:390,height:950}});
 p.on('pageerror',error=>console.error('PAGEERROR',error.message));await p.goto(origin+'/login');await p.getByLabel('E-mail da conta',{exact:true}).fill(president.email);await p.getByLabel('Senha',{exact:true}).fill(president.password);await p.getByRole('button',{name:'Somente essenciais',exact:true}).click();await p.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();
 await p.getByRole('heading',{name:'Aguardando sua equipe',exact:true}).waitFor({timeout:30000});await p.getByRole('progressbar',{name:'Tempo para fechar',exact:true}).waitFor();const started=await p.evaluate(()=>performance.timeOrigin);await p.getByRole('heading',{name:'Aguardando sua equipe',exact:true}).waitFor({state:'hidden',timeout:15000});
 assert.equal(await p.evaluate(()=>performance.timeOrigin),started);assert.equal((await rpc(president.client,'get_presidential_formation')).awaiting,ministries.length);assert(await p.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 console.log('✓ Formação real: cargos nomeados, todos os convites pendentes, contador e fechamento automático sem reload; convites continuam persistidos.');
}catch(error){if(p){await p.screenshot({path:'/tmp/govrp-formation-countdown-error.png'});console.error((await p.locator('body').innerText()).slice(-2000));}throw error;}
finally{await browser?.close();dev.kill('SIGTERM');log.end();await cleanup();}
