import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, cleanup } from './lib/world-test.mjs';

try {
  const [president, owner, citizen] = await Promise.all([actor('enterprise-editor-president', 'Presidente'), actor('enterprise-editor-owner'), actor('enterprise-editor-citizen')]);
  const output = execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: `begin;
do $test$
declare e public.state_enterprises%rowtype; b uuid; denied boolean; before_gazette bigint;
begin
  select * into e from public.state_enterprises where service_key='national_housing' for update;
  update public.state_enterprises set is_privatized=false,privatization_buyer_id=null,operating_business_id=null where id=e.id;
  select count(*) into before_gazette from public.dou_entries;
  perform set_config('request.jwt.claim.sub','${president.id}',true);
  perform public.update_enterprise_details(e.id,'Habitação de teste',e.sector,'Descrição alterada na gestão',12345,88);
  if not exists(select 1 from public.state_enterprises where id=e.id and name='Habitação de teste' and market_value=12345 and health_score=88)
    or (select count(*) from public.dou_entries)<>before_gazette+1 then raise exception 'Authorized edit or publication missing';end if;
  if not exists(select 1 from public.economic_audit_log where action='state_enterprise_details_updated' and actor_profile_id='${president.id}') then raise exception 'Audit missing';end if;
  denied:=false;
  begin perform public.update_enterprise_details(e.id,'Habitação de teste',e.sector,'Descrição',-1,88);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Negative valuation accepted';end if;
  denied:=false;
  begin perform public.update_enterprise_details(e.id,'Habitação de teste','Banco Nacional','Descrição',1,88);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'System service changed sectors';end if;
  perform set_config('request.jwt.claim.sub','${citizen.id}',true);
  denied:=false;
  begin perform public.update_enterprise_details(e.id,'Ataque',e.sector,'Descrição',1,88);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Citizen edited third-party service';end if;
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.businesses(owner_id,business_type_id,name,status,region_code) values('${owner.id}','incorporadora','Operadora de teste','active','SP') returning id into b;
  update public.state_enterprises set is_privatized=true,privatization_buyer_id='${owner.id}',operating_business_id=b where id=e.id;
  perform set_config('request.jwt.claim.sub','${president.id}',true);
  denied:=false;
  begin perform public.update_enterprise_details(e.id,'Interferência',e.sector,'Descrição',1,88);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Government retained privatized management';end if;
  perform set_config('request.jwt.claim.sub','${owner.id}',true);
  perform public.update_enterprise_details(e.id,'Operadora privada',e.sector,'Descrição privada',54321,90);
  if not exists(select 1 from public.state_enterprises where id=e.id and name='Operadora privada') then raise exception 'New owner cannot manage service';end if;
  if (select count(*) from public.dou_entries)<>before_gazette+1 then raise exception 'Private edit published as governmental act';end if;
  if has_function_privilege('anon','public.update_enterprise_details(uuid,text,text,text,numeric,numeric)','execute') then raise exception 'Anonymous permission exposed';end if;
  raise notice 'PASS: authority, field validation, audit, publication and privatized ownership';
end $test$;
rollback;`,
  });
  assert(output.includes('ROLLBACK'));
  console.log('✓ Gestão de estatais: validações reais aprovadas, com rollback.');
} finally { await cleanup(); }
