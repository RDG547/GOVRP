import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { geoArea, geoCentroid } from 'd3-geo';
import { actor, cleanup } from './lib/world-test.mjs';
const execute=sql=>execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024});
try{
 const owner=await actor('runtime-recovery');
 const source=readFileSync('supabase/migrations/20260930222933_economic_population_market_integration.sql','utf8');const bootstrap=source.slice(source.indexOf('do $$',source.indexOf('-- A capped bootstrap')),source.indexOf('revoke all on function private.regularize'));
 const check=(condition,label)=>`select pg_temp.check(${condition},'${label}');`;
 const migration=readFileSync('supabase/migrations/20260930033128_economic_regions_and_company_accounts.sql','utf8');
 assert(migration.includes('update public.businesses set owner_id=owner_id;'),'migração deve acionar o gatilho das empresas legadas');
 const script=`begin;
 create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Falha: %',label;end if;raise notice 'PASS: %',label;end $$;
 update public.businesses set owner_id=null,control_kind='population' where id in(select md5('govrp-population-business:'||x)::uuid from unnest(array['tecnologia','solar','transportadora'])x);
 update public.government_finances set treasury_balance=2000000000 where id=1;
 create temp table initial_cash as select (select sum(balance) from public.accounts)+(select treasury_balance from public.government_finances where id=1) amount;
 ${bootstrap}
 ${check("(select count(*) from public.investment_options where asset_symbol in('TECH3','SOLR3','LOGI3'))=3",'três companhias iniciais com ações negociáveis')}
 ${check("abs(((select sum(balance) from public.accounts)+(select treasury_balance from public.government_finances where id=1))-(select amount from initial_cash))<.01",'abertura inicial conserva dinheiro no mundo')}
 ${check("(select treasury_balance from public.government_finances where id=1)>=1980000000",'capitalização limitada a um por cento do Tesouro')}
 ${check("not exists(select 1 from public.businesses b where b.control_kind='population' and b.economic_sector_id is null)",'empresas da população vinculadas aos setores econômicos')}
 create temp table recovery as select * from public.businesses where id=md5('govrp-population-business:tecnologia')::uuid;
 update public.businesses set last_fiscal_cycle_at=now()-interval '8 days',loss_cycles=2 where id=(select id from recovery);
 insert into public.business_transactions(business_id,type,amount,description,metadata,accounting_date) values((select id from recovery),'expense',-100,'Custo de validação','{"kind":"overhead"}',current_date-5);
 select private.close_company_fiscal_cycle((select id from recovery),now());
 ${check("(select is_for_sale and loss_cycles=3 from public.businesses where id=(select id from recovery))",'perda real de exercício aciona oferta e insolvência sem coluna inexistente')}
 update public.businesses set loss_cycles=6 where id=(select id from recovery);
 update public.accounts set balance=0 where id=(select bank_account_id from recovery);
 select private.adjust_population_company((select id from recovery),-100);
 ${check("(select operational_status='closed' from public.businesses where id=(select id from recovery))",'insolvência prolongada encerra a produção')}
 update public.businesses set owner_id='${owner.id}',control_kind='player' where id=(select id from recovery);
 select set_config('request.jwt.claim.sub','${owner.id}',true);
 do $$ begin perform public.resume_company_operations((select id from recovery));raise exception 'Retomada sem recursos foi aceita';exception when raise_exception then if sqlerrm not like 'O caixa precisa%' and sqlerrm not like 'Pague os salários%' then raise;end if;end $$;
 update public.accounts set balance=1000000 where id=(select bank_account_id from recovery);
 update public.business_employees set wage_due=0 where business_id=(select id from recovery);
 select public.resume_company_operations((select id from recovery));
 ${check("(select operational_status='starting' and loss_cycles=6 from public.businesses where id=(select id from recovery))",'reestruturação exige caixa e conserva histórico de perdas')}
 ${check("(public.get_regional_economy()->'regions'->0) ? 'registered_unemployment' and (public.get_regional_economy()->'regions'->0) ? 'weekly_gdp'",'painel regional expõe PIB registrado e desemprego cadastrado')}
 update public.state_enterprises set last_fiscal_cycle_at=now()-interval '8 days' where is_system and not is_privatized;
 select private.close_state_enterprise_cycles();
 ${check("exists(select 1 from public.business_balance_cycles where state_enterprise_id is not null and metadata->>'source'='government_ledger')",'balanço estatal deriva dos registros governamentais')}
 ${check("not exists(select 1 from unnest(array['business_employees','business_transactions','business_balance_cycles','business_types','healthcare_visits','investment_options']) t where not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename=t))",'todas as tabelas dos canais empresariais publicadas')}
 ${check("not exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and not exists(select 1 from private.rp_reset_policy() p where p.table_name=c.relname))",'reset cobre todas as tabelas existentes')}
 rollback;`;
 execute(script);console.log('✓ Inicialização, ciclos, insolvência, retomada e política de reset validados com rollback');
 const map=JSON.parse(readFileSync('public/maps/brazil-states.json','utf8'));assert.equal(map.features.length,27);for(const feature of map.features){const area=geoArea(feature),[lon,lat]=geoCentroid(feature);assert(area>0&&area<1,'polígono representa o estado, sem preencher o restante do globo');assert(lon>=-76&&lon<=-32&&lat>=-35&&lat<=7,'centro projetado no Brasil');}console.log('✓ Os 27 polígonos têm orientação e centroides corretos para o mapa');
}finally{await cleanup();}
