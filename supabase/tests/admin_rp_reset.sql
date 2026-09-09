-- Run only on an isolated schema clone. Every fixture and reset is rolled back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists(select 1 from public.profiles) then
    raise exception 'RESET TESTS REQUIRE AN EMPTY, ISOLATED DATABASE. Refusing to touch existing accounts.';
  end if;
end $$;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; raise notice 'PASS: %',message; end $$;

select pg_temp.assert_true(current_setting('safeupdate.enabled')='on','test session reproduces API safeupdate protection');

-- Fixtures intentionally include closed/immutable ledgers, a shared transfer,
-- party membership, a self-referencing thread, investments and legal consequences.
create temporary table test_trigger_modes as
select c.relname,g.tgname,g.tgenabled from pg_trigger g join pg_class c on c.oid=g.tgrelid
where c.relnamespace='public'::regnamespace and not g.tgisinternal and g.tgenabled<>'D';
do $$ declare t record; begin for t in select * from test_trigger_modes loop
execute format('alter table public.%I disable trigger %I',t.relname,t.tgname); end loop; end $$;
insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values
('10000000-0000-0000-0000-000000000001','admin@reset-test.invalid','unchanged-password','{"real_full_name":"Admin real"}'),
('10000000-0000-0000-0000-000000000002','first@reset-test.invalid','unchanged-password','{}'),
('10000000-0000-0000-0000-000000000003','second@reset-test.invalid','unchanged-password','{}'),
('10000000-0000-0000-0000-000000000004','third@reset-test.invalid','unchanged-password','{}');
insert into public.profiles(id,username,full_name,role,onboarding_completed,onboarding_step,reputation_points,political_points,is_imprisoned,release_date,has_seen_tutorial,character_gender,titles)
select id,'test_'||right(id::text,1),'Cidadão anterior',case when right(id::text,1)='1' then 'Admin' else 'Ministro' end,
true,'completed',500,800,true,clock_timestamp()+interval '1 day',true,'male','{Ministro}' from auth.users;
insert into private.account_identities(user_id,email,real_full_name,real_date_of_birth,phone) select id,email,'Nome real preservado','1990-01-01','11999999999' from auth.users;
insert into public.accounts(id,user_id,account_number,agency_number,balance) values
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','000002','0001',4321),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','000003','0001',8765),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','000004','0001',9000);
insert into public.transactions(from_account_id,to_account_id,amount,type) values
('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',50,'transfer'),
('20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003',80,'transfer');
insert into public.posts(id,user_id,content) values
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Vida antiga #teste'),
('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','Vida preservada #outra');
insert into public.posts(user_id,content,parent_post_id) values
('10000000-0000-0000-0000-000000000003','Resposta compartilhada','30000000-0000-0000-0000-000000000002');
insert into public.post_likes(post_id,user_id) values('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002');
insert into public.comments(id,post_id,user_id,content) values
('35000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','Comentário preservado'),
('35000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','Comentário removido');
insert into public.comments(post_id,user_id,content,parent_comment_id) values
('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','Resposta removida','35000000-0000-0000-0000-000000000003');
insert into public.documents(user_id,type,document_number,full_name,is_valid) values
('10000000-0000-0000-0000-000000000002','CPF','12345678901','Cidadão anterior',true);
insert into public.criminal_records(user_id,crime,is_active) values('10000000-0000-0000-0000-000000000002','Crime antigo',true);
insert into public.political_parties(id,name,acronym,ideology,founder_id,owner_id,registration_number) values
('40000000-0000-0000-0000-000000000002','Partido anterior','PAA','Centro','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','RP-TEST002');
insert into public.party_members(party_id,user_id) values
('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003');
update public.profiles set party_affiliation='40000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000003';
insert into public.country_rp_states(country_code,country_name,is_playable,economic_baseline,economic_current,reference_snapshot_at)
values('BR','Brasil',true,'{"gdp":500}','{"gdp":900,"exchangeUsd":9,"currency":"BRL"}',clock_timestamp());
insert into public.economic_state(id,current_selic,public_debt,base_monthly_gdp) values(true,99,999999,111111) on conflict(id) do update set current_selic=99,public_debt=999999,base_monthly_gdp=111111;
insert into public.government_finances(id,treasury_balance,loans_balance) values(1,99999,999);
insert into public.rp_time_settings(id) values(true);
insert into public.economic_events(event_type,economic_classification,actor_profile_id,nominal_amount,economic_amount,real_amount,source_table,source_id,occurred_at_rp)
values('transfer','not_in_gdp','10000000-0000-0000-0000-000000000002',50,50,50,'transactions','test-event',clock_timestamp());
insert into public.system_settings(key,value) values
('executive_governance','{"specialAppointments":{"national_bank_president":{"user_id":"10000000-0000-0000-0000-000000000002"},"federal_police_director":{"user_id":"10000000-0000-0000-0000-000000000004"}}}'),
('election_office_sync','{"active_assignments":[{"user_id":"10000000-0000-0000-0000-000000000002","office_role":"Presidente"},{"user_id":"10000000-0000-0000-0000-000000000004","office_role":"Senador"}]}'),
('citizen_onboarding','{"version":2,"initial_bank_balance":1000}'),
('service_availability','{"bank":true}');
insert into public.security_audit_log(action,target_table,target_id) values('test_security','profile','preserve');
create temporary table before_profiles as select * from public.profiles;
do $$ declare t record; begin for t in select * from test_trigger_modes loop
execute format('alter table public.%I %s trigger %I',t.relname,case t.tgenabled when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,t.tgname); end loop; end $$;

-- Permission denial includes NULL auth and regular citizens, even with forged scopes.
do $$ begin
  perform public.admin_prepare_rp_reset('all_users','{}','Teste sem autenticação');
  raise exception 'anonymous request unexpectedly accepted';
exception when insufficient_privilege then raise notice 'PASS: anonymous cannot reset'; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
  perform public.admin_prepare_rp_reset('all_users','{}','Teste sem permissão');
  raise exception 'citizen request unexpectedly accepted';
exception when insufficient_privilege then raise notice 'PASS: citizen cannot reset'; end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin
  perform public.admin_prepare_rp_reset('selected_users','{}','Seleção vazia');
  raise exception 'empty request unexpectedly accepted';
exception when raise_exception then
  if sqlerrm<>'Selecione contas ativas e válidas.' then raise; end if;
  raise notice 'PASS: empty selection rejected';
end $$;
do $$ declare reason_value text; begin
  foreach reason_value in array array[null::text,'','   ','x','  teste  ',repeat('a',500)] loop
    perform public.admin_prepare_rp_reset('selected_users','{10000000-0000-0000-0000-000000000002}',reason_value);
  end loop;
  raise notice 'PASS: null, blank, short and 500-character reasons are accepted';
end $$;
do $$ begin
  perform public.admin_prepare_rp_reset('selected_users','{10000000-0000-0000-0000-000000000002}',repeat('a',501));
  raise exception 'oversized reason unexpectedly accepted';
exception when raise_exception then
  if sqlerrm<>'O motivo deve ter no máximo 500 caracteres.' then raise; end if;
  raise notice 'PASS: reasons over 500 characters are rejected';
end $$;
select public.admin_prepare_rp_reset('selected_users','{10000000-0000-0000-0000-000000000002}') as plan \gset
reset role;
select pg_temp.assert_true((:'plan'::jsonb->>'users')::int=1,'preview contains exactly one citizen');
select pg_temp.assert_true((:'plan'::jsonb->>'confirmation')='RESETAR','preview asks for RESETAR only');
select pg_temp.assert_true((select reason='' from private.rp_reset_requests where id=(:'plan'::jsonb->>'request_id')::uuid),'reset reason can be omitted');

select pg_temp.assert_true((select count(*) from public.accounts)=3,'preview changes no account');
select set_config('test.request_id',:'plan'::jsonb->>'request_id',true);
set local role authenticated;
do $$ begin
  perform public.admin_execute_rp_reset(current_setting('test.request_id')::uuid,'RESETAR USUARIOS');
  raise exception 'wrong confirmation unexpectedly accepted';
exception when raise_exception then
  if sqlerrm<>'Digite a frase de confirmação exatamente como exibida.' then raise; end if;
  raise notice 'PASS: only the simplified typed confirmation is accepted';
end $$;
select public.admin_execute_rp_reset(current_setting('test.request_id')::uuid,'RESETAR');
reset role;
select pg_temp.assert_true((select p.onboarding_completed=false and p.onboarding_step='welcome' and p.full_name is null
 and p.character_gender is null and p.reputation_points=0 and p.political_points=0 and not p.is_imprisoned and p.release_date is null
 and not p.has_seen_tutorial and p.titles='{}' and p.role='Cidadão' and p.citizen_id<>b.citizen_id
 from public.profiles p join before_profiles b using(id) where p.id='10000000-0000-0000-0000-000000000002'),'character identity, rewards, sentence and offices cleared');
select pg_temp.assert_true((select count(*) from public.accounts)=2 and (select balance from public.accounts where user_id='10000000-0000-0000-0000-000000000003')=8765,'unselected balances untouched');
select pg_temp.assert_true((select count(*) from public.transactions)=1,'only related transfers removed');
select pg_temp.assert_true((select count(*) from public.posts)=1,'old posts and dependent replies removed');
select pg_temp.assert_true((select comments_count=1 and likes_count=0 from public.posts where id='30000000-0000-0000-0000-000000000004') and (select replies_count=0 from public.comments where id='35000000-0000-0000-0000-000000000003'),'remaining comment, reply and like counters match surviving content');
select pg_temp.assert_true((select count(*) from public.documents)=0 and (select count(*) from public.criminal_records)=0,'documents and legal consequences removed');
select pg_temp.assert_true((select count(*) from public.political_parties)=0 and (select party_affiliation is null from public.profiles where id='10000000-0000-0000-0000-000000000003'),'party dependencies cleared without deleting another citizen');
select pg_temp.assert_true((select count(*) from public.economic_events)=0,'immutable economic ledger reset through protected path');
select pg_temp.assert_true((select value->'specialAppointments' ? 'federal_police_director' and not(value->'specialAppointments' ? 'national_bank_president') from public.system_settings where key='executive_governance'),'only reset citizens lose JSON appointments');
select pg_temp.assert_true((select jsonb_array_length(value->'active_assignments') from public.system_settings where key='election_office_sync')=1,'old office sync cannot restore reset offices');
select pg_temp.assert_true((select economic_current->>'gdp' from public.country_rp_states where country_code='BR')='900','individual reset preserves national economy');
select pg_temp.assert_true((select count(*) from auth.users where encrypted_password='unchanged-password')=4 and (select count(*) from private.account_identities)=4,'login credentials and private account identity preserved');
select pg_temp.assert_true(not exists(select 1 from test_trigger_modes b join pg_class c on c.relname=b.relname and c.relnamespace='public'::regnamespace join pg_trigger g on g.tgrelid=c.oid and g.tgname=b.tgname where g.tgenabled<>b.tgenabled),'all gameplay and immutable triggers restored');
set local role authenticated;
select public.admin_execute_rp_reset(current_setting('test.request_id')::uuid,'RESETAR');
reset role;
select pg_temp.assert_true((select count(*) from private.rp_reset_requests where completed_at is not null)=1,'retry returns saved result without a second reset');

-- Fresh onboarding uses the existing authoritative RPC and generates a new bank account.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.get_my_citizen_onboarding() as onboarding \gset
reset role;
select pg_temp.assert_true(:'onboarding'::jsonb->'profile'->>'onboarding_step'='welcome','returning citizen sees first onboarding step');

set local role authenticated;
select public.start_citizen_onboarding();
select public.save_citizen_identity('Cidadão Reiniciado','cidadao_reiniciado','1995-05-10','Nova vida',null,'male');
select public.save_citizen_origin('SP','3550308','São Paulo','SP','3550308','São Paulo');
select public.save_citizen_aspiration('civil_life');
select public.issue_citizen_onboarding_document('CPF');
select public.issue_citizen_onboarding_document('RG');
select public.issue_citizen_onboarding_document('Título de Eleitor');
select public.issue_citizen_onboarding_document('CTD');
select public.ensure_citizen_bank_account();
select public.finalize_citizen_onboarding();
select public.ensure_citizen_bank_account();
reset role;
select pg_temp.assert_true((select onboarding_completed and full_name='Cidadão Reiniciado' from public.profiles where id='10000000-0000-0000-0000-000000000002'),'reset citizen completes the entire onboarding again');
select pg_temp.assert_true((select count(*)=1 and min(balance)=1000 from public.accounts where user_id='10000000-0000-0000-0000-000000000002'),'new bank account receives starting balance only once');
select pg_temp.assert_true((select count(*)=4 from public.documents where user_id='10000000-0000-0000-0000-000000000002'),'four fresh civil documents issued');

-- Selected bulk reset leaves the third citizen's identity intact.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.admin_prepare_rp_reset('selected_users','{10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000003}','Teste de reset em lote') as batch \gset
select public.admin_execute_rp_reset((:'batch'::jsonb->>'request_id')::uuid,'RESETAR');
reset role;
select pg_temp.assert_true((select p.citizen_id=b.citizen_id and p.onboarding_completed from public.profiles p join before_profiles b using(id) where p.id='10000000-0000-0000-0000-000000000004'),'bulk selection preserves unselected citizen');
select pg_temp.assert_true((select role='Admin' and not onboarding_completed from public.profiles where id='10000000-0000-0000-0000-000000000001'),'administrator keeps access while their citizen resets');
set local role authenticated;
select public.admin_prepare_rp_reset('all_users','{}','Teste de todos os usuários') as all_plan \gset
select public.admin_execute_rp_reset((:'all_plan'::jsonb->>'request_id')::uuid,'RESETAR');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.profiles where onboarding_completed) and (select count(*) from public.accounts)=0,'all users restart without bank accounts');

-- Full reset: a deterministic source fixture, never a network-dependent expected value.
select jsonb_build_array(jsonb_build_object('country_code','BR','country_name','Brasil','fetched_at',clock_timestamp(),
 'economy','{"gdp":2000000000000,"gdpCurrency":"USD","currency":"BRL","growth":2.5,"inflation":4.5,"unemployment":6,"exchangeUsd":5,"exchangeEur":6,"selic":12,"referenceSources":["Test reference"]}'::jsonb,
 'demographics','{"population":200000000,"area":8000000}'::jsonb,'politics','{}'::jsonb,
 'exchange_rates','{"USD":5,"EUR":6,"GBP":7,"JPY":0.03,"CNY":0.7}'::jsonb)) as snapshots \gset
-- A country disabled after the preview must not be reactivated by an old request.
insert into public.country_rp_states(country_code,country_name,is_playable) values('PT','Portugal',true);
select (:'snapshots'::jsonb || jsonb_build_array((:'snapshots'::jsonb->0) || '{"country_code":"PT","country_name":"Portugal"}'::jsonb)) as two_countries \gset
set local role authenticated;
select public.admin_prepare_rp_reset('full_rp','{}','Teste de alteração dos países',:'two_countries'::jsonb) as country_plan \gset
reset role;
update public.country_rp_states set is_playable=false where country_code='PT';
select set_config('test.country_request',:'country_plan'::jsonb->>'request_id',true);
select set_config('test.country_snapshots',:'two_countries',true);
set local role authenticated;
do $$ begin
  perform public.admin_execute_rp_reset(current_setting('test.country_request')::uuid,'RESETAR');
  raise exception 'reset unexpectedly reactivated a disabled country';
exception when raise_exception then
  if sqlerrm<>'A lista de países mudou. Consulte novamente as referências reais.' then raise; end if;
  raise notice 'PASS: changed countries require a fresh preview';
end $$;
do $$ begin
  perform public.admin_prepare_rp_reset('full_rp','{}','Teste de país não ativo',current_setting('test.country_snapshots')::jsonb);
  raise exception 'preview unexpectedly included a disabled country';
exception when raise_exception then
  if sqlerrm<>'A referência real precisa incluir o Brasil e todos os países ativos, sem duplicatas.' then raise; end if;
  raise notice 'PASS: preview cannot include inactive countries';
end $$;
select public.admin_prepare_rp_reset('full_rp','{}','Teste de nova temporada',:'snapshots'::jsonb) as full_plan \gset
reset role;
insert into public.posts(user_id,content) values('10000000-0000-0000-0000-000000000004','Must survive failed reset');
create temporary table before_failed_reset as select id,citizen_id from public.profiles;
alter table public.economic_state add constraint test_reset_rollback check(current_selic=99);
select set_config('test.full_request',:'full_plan'::jsonb->>'request_id',true);
set local role authenticated;
do $$ begin
  perform public.admin_execute_rp_reset(current_setting('test.full_request')::uuid,'RESETAR');
  raise exception 'full reset unexpectedly ignored forced failure';
exception when check_violation then raise notice 'PASS: failed economic reset aborts the entire operation'; end $$;
reset role;
select pg_temp.assert_true((select count(*) from public.posts where content='Must survive failed reset')=1,'failed full reset restores deleted posts');
select pg_temp.assert_true(not exists(select 1 from public.profiles p join before_failed_reset b using(id) where p.citizen_id<>b.citizen_id),'failed full reset restores citizen identities');
select pg_temp.assert_true(not exists(select 1 from test_trigger_modes b join pg_class c on c.relname=b.relname and c.relnamespace='public'::regnamespace join pg_trigger g on g.tgrelid=c.oid and g.tgname=b.tgname where g.tgenabled<>b.tgenabled),'failed full reset restores trigger enable modes');
alter table public.economic_state drop constraint test_reset_rollback;
set local role authenticated;
select public.admin_execute_rp_reset((:'full_plan'::jsonb->>'request_id')::uuid,'RESETAR');
reset role;
select pg_temp.assert_true((select economic_current=economic_baseline and (economic_current->>'gdp')::numeric=2000000000000
 and revision=0 and economy_influence=0 and reference_snapshot_at is not null from public.country_rp_states where country_code='BR'),'full RP starts from real snapshot and revision zero');
select pg_temp.assert_true((select current_selic=12 and public_debt=0 and last_operational_run_at is null and player_share=.5 and simulated_share=.5 from public.economic_state),'economy uses reference interest rate with zero RP debt and clean engine');
select pg_temp.assert_true((select treasury_balance=0 and loans_balance=0 from public.government_finances),'public funds and government loans reset');
select pg_temp.assert_true((select count(*) from public.country_rp_economic_snapshots)=1 and (select count(*) from public.economic_events)=0 and (select count(*) from public.transactions)=0,'only new economic baseline remains');
select pg_temp.assert_true((select count(*) from public.currency_market_states)=6 and (select count(*) from public.currency_market_states where current_strength<>1)=0,'currency market starts from real quotes without old RP pressure');
select pg_temp.assert_true((select count(*) from public.security_audit_log)=1 and (select value from public.system_settings where key='service_availability')='{"bank":true}'::jsonb,'security records and service configuration survive complete reset');
select pg_temp.assert_true((select count(*) from public.products where state_enterprise_id is not null)=20,'full reset preserves the state food and housing catalog');
select pg_temp.assert_true((select count(*) from public.profiles)=4 and (select count(*) from private.account_identities)=4,'full reset preserves all account anchors');
select pg_temp.assert_true(not exists(select 1 from test_trigger_modes b join pg_class c on c.relname=b.relname and c.relnamespace='public'::regnamespace join pg_trigger g on g.tgrelid=c.oid and g.tgname=b.tgname where g.tgenabled<>b.tgenabled),'triggers remain enabled after full reset');

select pg_temp.assert_true((select count(*)=7 and sum(population_count)=200000000 from public.country_population_segments where country_code='BR'),'population sectors restart from the new real population');
set local role authenticated;
select public.admin_prepare_rp_reset('selected_users','{10000000-0000-0000-0000-000000000002}','Prévia expirada') as expired \gset
reset role;
update private.rp_reset_requests set expires_at=clock_timestamp()-interval '1 second' where id=(:'expired'::jsonb->>'request_id')::uuid;
select set_config('test.expired_request',:'expired'::jsonb->>'request_id',true);
set local role authenticated;
do $$ begin
  perform public.admin_execute_rp_reset(current_setting('test.expired_request')::uuid,'RESETAR');
  raise exception 'expired reset unexpectedly accepted';
exception when raise_exception then
  if sqlerrm<>'A prévia expirou. Prepare uma nova confirmação.' then raise; end if;
  raise notice 'PASS: expired preview cannot reset a citizen';
end $$;
reset role;
select pg_temp.assert_true((select count(*)=6 from public.government_rules where rule_key in('corporate_tax_rate','consumption_tax_rate','business_license_fee','public_safety_policy_index','social_welfare_policy_index','transaction_tax')) and public.get_government_rule('business_license_fee')=250 and (select rule_kind='fee' from public.government_rules where rule_key='business_license_fee') and (select count(*)=7 from public.legal_authority_rules) and exists(select 1 from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed),'initial government rules are ready for the next laws and businesses');
update public.economic_state set exchange_rate=6 where id=true;
select pg_temp.assert_true((select (economic_baseline->>'exchangeUsd')::numeric=5 and (economic_current->>'exchangeUsd')::numeric=6 from public.country_rp_states where country_code='BR'),'RP engine changes current economy without overwriting the real baseline');
select pg_temp.assert_true(not has_function_privilege('authenticated','private.build_rp_reset_plan(text,uuid[])','execute'),'private reset helpers cannot be called directly');
select pg_temp.assert_true(current_setting('safeupdate.enabled')='on','API safeupdate protection remains enabled after every reset mode');
rollback;
