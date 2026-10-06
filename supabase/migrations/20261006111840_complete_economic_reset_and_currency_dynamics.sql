begin;
-- The existing per-currency model calibration, shared by season resets.
create or replace function private.currency_market_defaults()
returns table(currency_code text,economic_strength numeric,interest_factor numeric,inflation_factor numeric,
  risk_factor numeric,stability_factor numeric,trend numeric,international_demand numeric,volatility numeric)
language sql immutable set search_path='' as $$
  values
    ('BRL',50::numeric,55::numeric,52::numeric,58::numeric,55::numeric,0::numeric,50::numeric,.008::numeric),
    ('USD',72,62,48,22,88,.0008,92,.0045),
    ('EUR',68,51,45,28,83,.0002,78,.0042),
    ('GBP',64,56,49,31,79,.0004,67,.0052),
    ('JPY',58,18,35,25,91,-.0002,63,.0065),
    ('CNY',76,47,41,38,74,.0005,85,.0035);
$$;
revoke all on function private.currency_market_defaults() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_execute_rp_reset(p_request_id uuid, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=private.assert_reset_admin(); req private.rp_reset_requests%rowtype;
  t record; tr record; s jsonb; v_ids uuid[]; v_result jsonb; v_progress integer;
  v_assignments text; v_brazil jsonb; v_selic numeric; v_monthly numeric;
begin
  -- Serialize administrative resets; each request is bound to its administrator
  -- and is idempotent even if the browser retries after losing the response.
  perform pg_catalog.pg_advisory_xact_lock(725104,1);
  select * into req from private.rp_reset_requests where id=p_request_id for update;
  if not found or req.requested_by<>v_actor then raise exception 'Solicitação de reset inválida.'; end if;
  if p_confirmation is distinct from 'RESETAR' then
    raise exception 'Digite a frase de confirmação exatamente como exibida.';
  end if;
  if req.completed_at is not null then return req.result; end if;
  if req.expires_at<clock_timestamp() then raise exception 'A prévia expirou. Prepare uma nova confirmação.'; end if;

  -- Locks include catalogs/configuration because gameplay triggers may write to
  -- them. No other transaction can observe or write a half-reset world.
  for t in select * from private.rp_reset_policy() order by table_name loop
    execute format('lock table public.%I in access exclusive mode',t.table_name);
  end loop;
  perform private.assert_reset_admin();
  if req.scope<>'selected_users' then
    select coalesce(array_agg(id order by id),'{}') into v_ids from public.profiles where deleted_at is null;
    if v_ids is distinct from req.user_ids then raise exception 'A lista de usuários mudou. Revise uma nova prévia.'; end if;
  elsif exists(select 1 from unnest(req.user_ids) x where not exists(
    select 1 from public.profiles where id=x and deleted_at is null
  )) then raise exception 'Uma conta selecionada foi removida. Revise uma nova prévia.'; end if;
  if req.scope='full_rp' and (
    exists(select 1 from public.country_rp_states c where c.is_playable
      and not exists(select 1 from jsonb_array_elements(req.country_snapshots) x where x->>'country_code'=c.country_code))
    or exists(select 1 from jsonb_array_elements(req.country_snapshots) x where x->>'country_code'<>'BR'
      and not exists(select 1 from public.country_rp_states c where c.is_playable and c.country_code=x->>'country_code'))
  ) then
    raise exception 'A lista de países mudou. Consulte novamente as referências reais.';
  end if;
  lock table private.business_daily_effort, private.company_operations,
    private.population_demand_runs in access exclusive mode;
  v_result:=private.build_rp_reset_plan(req.scope,req.user_ids);
  -- The plan includes dependent/shared records; re-check under the write locks.
  -- Only user triggers are suspended, never FK/check/unique constraints. Their
  -- original enable modes are restored before commit (and on error by rollback).
  drop table if exists pg_temp.rp_reset_triggers;
  create temporary table rp_reset_triggers on commit drop as
    select c.relname table_name,g.tgname,g.tgenabled
    from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid=g.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join private.rp_reset_policy() p on p.table_name=c.relname
    where n.nspname='public' and not g.tgisinternal and g.tgenabled<>'D' and p.reset_mode<>'keep';
  update public.party_treasuries fund set balance=coalesce((select sum(entry.amount) from public.party_treasury_entries entry where entry.party_id=fund.party_id),0),updated_at=clock_timestamp() where fund.party_id is not null;

  set constraints public.accounts_business_id_fkey immediate;
  set constraints public.accounts_business_id_fkey deferred;
  for tr in select * from pg_temp.rp_reset_triggers loop
    execute format('alter table public.%I disable trigger %I',tr.table_name,tr.tgname);
  end loop;

  -- Profiles are stable login anchors. Replace only the character and its fields.
  select string_agg(format('%I=default',attname),',') into v_assignments
  from pg_catalog.pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
    and attname not in ('id','created_at','role','username','username_is_generated','deleted_at','anonymized_at','deletion_reason');
  execute 'update public.profiles set '||v_assignments||
    ',username=''u_''||left(replace(gen_random_uuid()::text,''-'',''''),18),username_is_generated=true,role=case when role=''Admin'' then ''Admin'' else ''Cidadão'' end where id=any($1)'
    using req.user_ids;

  delete from private.citizen_need_actions where user_id=any(req.user_ids);
  -- A removed party cannot remain attached to another citizen's profile.
  update public.profiles set party_affiliation=null where party_affiliation in (
    select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.political_parties'::regclass
  );
  delete from private.professional_work_answers where session_id in(select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.professional_work_sessions'::regclass);
  delete from private.infrastructure_maintenance where project_id in(select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.government_projects'::regclass);
  delete from private.business_daily_effort where business_id in (
    select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.businesses'::regclass
  );
  delete from private.company_operations where req.scope='full_rp' or actor_id=any(req.user_ids)
    or payload->>'business_id' in (
      select row_key->>'id' from pg_temp.rp_reset_rows where relation='public.businesses'::regclass
    );
  if req.scope='full_rp' then
    delete from private.population_demand_runs where operation_date is not null;
  end if;
  -- Delete children before parents, letting PostgreSQL enforce every FK. Self
  -- references are deleted together. Any unhandled dependency aborts everything.
  while exists(select 1 from pg_temp.rp_reset_rows) loop
    v_progress:=0;
    for t in select * from pg_temp.rp_reset_tables where relation in (select relation from pg_temp.rp_reset_rows) order by table_name loop
      begin
        execute format('delete from public.%I r using pg_temp.rp_reset_rows chosen where chosen.relation=$1 and chosen.row_key=%s',t.table_name,t.key_sql) using t.relation;
        delete from pg_temp.rp_reset_rows where relation=t.relation;
        v_progress:=v_progress+1;
      exception when foreign_key_violation then null;
      end;
    end loop;
    if v_progress=0 then raise exception 'Uma dependência impediu o reset; nenhuma alteração foi salva.'; end if;
  end loop;

  update public.system_settings set value=coalesce(private.remove_reset_profile_references(value,req.user_ids),'{}'),updated_at=clock_timestamp()
  where key in ('executive_governance','election_office_sync');
  -- Private ownership must not survive via a privatized state enterprise.
  update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_buyer_id=null,
    privatized_at=null,privatization_price=null,operating_business_id=null,manager_id=null,commission_value=0,publication_mode='automatic',updated_at=clock_timestamp()
  where privatization_buyer_id=any(req.user_ids);
  update public.state_enterprises set manager_id=null where manager_id=any(req.user_ids);
  update public.political_parties set president_id=null where president_id=any(req.user_ids);
  update public.political_parties set vice_president_id=null where vice_president_id=any(req.user_ids);

  if req.scope='full_rp' then
    -- Reset mutable state to schema defaults; retain only catalog definitions.
    for t in select * from (values
      ('economic_state','{id}'::text[]),
      ('government_finances','{id}'::text[]),
      ('government_popularity_state','{country_code}'::text[]),
      ('country_population_segments','{country_code,segment_key,name,description,population_share}'::text[])
    ) x(table_name,keep_columns) loop
      select string_agg(format('%I=default',attname),',') into v_assignments
      from pg_catalog.pg_attribute where attrelid=to_regclass('public.'||t.table_name) and attnum>0 and not attisdropped
        and not attname=any(t.keep_columns);
      execute format('update public.%I set %s where %I is not null',t.table_name,v_assignments,t.keep_columns[1]);
    end loop;
    insert into public.economic_state(id) values(true) on conflict do nothing;
    insert into public.government_finances(id) values(1) on conflict do nothing;
    insert into public.government_popularity_state(country_code) values('BR') on conflict do nothing;
    update public.government_finances set treasury_balance=0,loans_balance=0,corporate_card_used=0 where id=1;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind) values
      ('corporate_tax_rate',0.10,'ratio','Alíquota sobre receitas empresariais','system'),
      ('consumption_tax_rate',0.03,'ratio','Alíquota incidente sobre compras de produtos','system'),
      ('business_license_fee',250,'BRL','Taxa para abertura de empresa','system'),
      ('public_safety_policy_index',50,'index','Intensidade da política nacional de segurança','system'),
      ('social_welfare_policy_index',50,'index','Intensidade da política nacional de bem-estar','system');

    update public.government_rules set rule_kind='tax',definition=jsonb_build_object('basis','purchase','payer',case when rule_key='corporate_tax_rate' then 'seller' else 'buyer' end,'nature','percentage','audience',case when rule_key='corporate_tax_rate' then 'business' else 'all' end) where rule_key in('corporate_tax_rate','consumption_tax_rate');
    update public.government_rules set rule_kind='fee',definition='{"basis":"license","nature":"fixed","payer":"buyer","audience":"all"}' where rule_key='business_license_fee';
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition) values('transaction_tax',0,'ratio','Imposto sobre transferências','system','tax','{"basis":"transfer","nature":"percentage","payer":"buyer","audience":"all"}');
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'penalty_'||replace(id::text,'-',''),maximum_sentence_units,'years_rp',name,'system','penalty',jsonb_build_object('penal_code_id',id,'minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine) from public.penal_code;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'license_'||id,registration_fee,'BRL','Licenciamento específico: '||name,'system','fee',
      jsonb_build_object('basis','license','payer','buyer','nature','fixed','audience','business','category',id)
    from public.business_types where is_active and registration_fee>0;
    update public.government_ministries set annual_budget=0,spent_budget=0,efficiency_score=default,public_impact=0,created_by=null where id is not null;
    update public.price_basket_items set current_price=base_price,updated_at=clock_timestamp() where id is not null;
    delete from public.state_enterprises where not is_system;
    update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_price=null,
      privatization_buyer_id=null,privatized_at=null,created_by=null,market_value=default,health_score=default,is_active=true,operating_business_id=null,manager_id=null,commission_type='percentage',commission_value=0,publication_mode='automatic',fixed_sale_fee=default,active_listing_fee_enabled=default,active_listing_fee_amount=default,active_listing_fee_period=default,seller_fees=default,management_settings=default,last_fiscal_cycle_at=clock_timestamp() where is_system;
    update public.rp_time_settings set rp_epoch_real_at=clock_timestamp(),rp_epoch_game_at=clock_timestamp(),
      is_paused=false,paused_real_at=null,paused_rp_at=null,updated_by=v_actor,updated_at=clock_timestamp() where id=true;
    insert into public.rp_time_settings(id,rp_epoch_game_at) values(true,clock_timestamp()) on conflict do nothing;
    delete from public.system_settings where key in (
      'executive_governance','election_office_sync','government_budget','national_budget','government_balance',
      'economic_policy','bank_policy','tax_rates','transaction_tax','enterprise_costs','basic_service_prices','national_health_policy','stock_market_session','automatic_elections'
    );
    select value into v_brazil from jsonb_array_elements(req.country_snapshots) where value->>'country_code'='BR';
    v_selic:=(v_brazil->'economy'->>'selic')::numeric;
    v_monthly:=round((power(1+v_selic/100,1.0/12)-1)*100,2);
    update public.economic_state set current_selic=v_selic,exchange_rate=(v_brazil->'economy'->>'exchangeUsd')::numeric,
      base_monthly_gdp=(v_brazil->'economy'->>'gdp')::numeric*(v_brazil->'economy'->>'exchangeUsd')::numeric/12,
      simulated_share=0.5,player_share=0.5,metadata=jsonb_build_object('origin','real_baseline','reset_request_id',req.id) where id=true;
    insert into public.system_settings(key,value) values
      ('economic_policy',jsonb_build_object('selic_rate',v_selic)),
      ('bank_policy',jsonb_build_object('loan_interest_spread',1.66,'credit_card_revolving_spread',8.06,
        'government_debt_interest_spread',0.91,'loan_interest_rate',v_monthly+1.66,
        'credit_card_revolving_rate',v_monthly+8.06,'government_debt_interest_rate',v_monthly+0.91,'credit_card_default_limit',5000)),
      ('tax_rates','{"product_tax":0,"service_tax":0}'),
      ('transaction_tax','{"type":"percentage","value":0}'),
      ('government_budget','{"areas":[]}'),('national_budget','0'),
      ('national_health_policy','{"daily_budget":5000,"cost_per_visit":25,"recovery":20,"daily_capacity":200}'),
      ('stock_market_session','{"is_open":true,"quote_interval_seconds":60}');
    update public.investment_options set annual_return_rate=round(greatest(0.5,
      v_selic*case risk_level when 'low' then .9 when 'high' then 1.2 when 'very-high' then 1.35 else 1.05 end
      +case risk_level when 'low' then -.4 when 'high' then 2.2 when 'very-high' then 4.5 else .8 end)/100,4) where id is not null;
    update public.country_rp_states set is_playable=false,economic_baseline='{}',economic_current='{}',
      political_current='{}',demographic_current='{}',economic_engine_cursor='{}',reference_snapshot_at=null,
      economy_influence=0,politics_influence=0,society_influence=0,revision=0,last_event_type=null,last_event_summary=null,
      started_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=v_actor where country_code is not null;
    for s in select * from jsonb_array_elements(req.country_snapshots) loop
      insert into public.country_rp_states(country_code,country_name,is_playable,economic_baseline,economic_current,
        political_current,demographic_current,economic_engine_cursor,reference_snapshot_at,started_at,updated_by)
      values(s->>'country_code',s->>'country_name',true,s->'economy',s->'economy',s->'politics',s->'demographics',
        jsonb_build_object('exchangeUsd',(s->'economy'->>'exchangeUsd')::numeric),clock_timestamp(),clock_timestamp(),v_actor)
      on conflict(country_code) do update set is_playable=true,economic_baseline=excluded.economic_baseline,
        economic_current=excluded.economic_current,political_current=excluded.political_current,
        demographic_current=excluded.demographic_current,economic_engine_cursor=excluded.economic_engine_cursor,
        reference_snapshot_at=excluded.reference_snapshot_at,started_at=excluded.started_at;
      insert into public.country_rp_economic_snapshots(country_code,revision,economic_state,event_type)
      values(s->>'country_code',0,s->'economy','rp_reference_snapshot');
    end loop;
    delete from public.country_population_segments where country_code is not null;
    insert into public.country_population_segments(country_code,segment_key,name,description,population_share,
      population_count,welfare_index,political_influence,economic_participation)
    select c.country_code,v.segment_key,v.name,v.description,v.share,
      round((c.demographic_current->>'population')::numeric*v.share)::bigint,v.welfare,v.influence,v.participation
    from public.country_rp_states c cross join (values
      ('urban_workers','Trabalhadores urbanos','Cidadãos empregados nos centros urbanos.',.34,55,62,82),
      ('rural_workers','Trabalhadores rurais','Cidadãos ligados à produção e às comunidades rurais.',.14,49,45,74),
      ('entrepreneurs','Empreendedores','Proprietários e gestores de negócios produtivos.',.08,66,70,91),
      ('public_servants','Servidores públicos','Profissionais das instituições e serviços do Estado.',.09,61,72,79),
      ('students','Estudantes','População em formação acadêmica ou profissional.',.16,58,48,28),
      ('retirees','Aposentados','Cidadãos fora da população economicamente ativa.',.11,54,58,12),
      ('unemployed','Desempregados','Cidadãos em busca ativa de ocupação.',.08,35,40,8)
    ) v(segment_key,name,description,share,welfare,influence,participation) where c.is_playable;
    -- Rebuild the exchange market from real quotes, with no old RP strength/trend.
    delete from public.currency_market_states where country_code is not null;
    insert into public.currency_market_states(country_code,currency_code,base_brl_per_unit,
      economic_strength,interest_factor,inflation_factor,risk_factor,stability_factor,trend,international_demand,volatility)
    select 'BR',d.currency_code,case when d.currency_code='BRL' then 1 else (v_brazil->'exchange_rates'->>d.currency_code)::numeric end,
      d.economic_strength,d.interest_factor,d.inflation_factor,d.risk_factor,d.stability_factor,d.trend,d.international_demand,d.volatility
    from private.currency_market_defaults() d;
    insert into public.country_rp_exchange_rates(country_code,currency_code,brl_per_unit,source)
    select 'BR',key,value::numeric,'real_baseline' from jsonb_each_text(v_brazil->'exchange_rates') where key in ('USD','EUR','GBP','JPY','CNY');
  else
    -- Reset bypasses gameplay award triggers, so reconcile remaining social counts.
    update public.posts p set likes_count=(select count(*) from (
        select user_id from public.post_likes where post_id=p.id union select user_id from public.likes where post_id=p.id
      ) liked),
      comments_count=(select count(*) from public.comments c where c.post_id=p.id and c.parent_comment_id is null and c.deleted_at is null),
      reposts_count=(select count(*) from public.reposts r where r.post_id=p.id) where p.id is not null;
    update public.comments c set replies_count=(select count(*) from public.comments reply where reply.parent_comment_id=c.id and reply.deleted_at is null) where c.id is not null;
    delete from public.trends where hashtag is not null;
    insert into public.trends(hashtag,post_count,last_used_at)
    select tag,count(distinct p.id),max(p.created_at) from public.posts p,
      lateral unnest(public.extract_hashtags(p.content)) tag group by tag;
  end if;

  update public.party_treasuries fund set balance=coalesce((select sum(entry.amount) from public.party_treasury_entries entry where entry.party_id=fund.party_id),0),updated_at=clock_timestamp() where fund.party_id is not null;

  set constraints public.accounts_business_id_fkey immediate;
  set constraints public.accounts_business_id_fkey deferred;
  for tr in select * from pg_temp.rp_reset_triggers loop
    execute format('alter table public.%I %s trigger %I',tr.table_name,
      case tr.tgenabled when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,tr.tgname);
  end loop;
  if req.scope='full_rp' then perform private.refresh_regional_infrastructure();end if;
  v_result:=v_result||jsonb_build_object('success',true,'request_id',req.id,'scope',req.scope,'completed_at',clock_timestamp());
  update private.rp_reset_requests set completed_at=clock_timestamp(),result=v_result where id=req.id;
  return v_result;
end; $function$;

create or replace function public.recalculate_currency_market(
  p_country_code text,p_cycle_key text,p_advance boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_country text:=upper(coalesce(nullif(p_country_code,''),'BR'));
  v_cycle text:=coalesce(nullif(p_cycle_key,''),to_char(clock_timestamp(),'YYYY-MM-DD-HH24'));
  v_state public.currency_market_states%rowtype;
  v_economy public.economic_state%rowtype;
  v_driver numeric;
  v_delta numeric;
  v_brl_strength numeric:=1;
  v_revision bigint:=0;
  v_result jsonb;
  v_step bigint;
  v_cycle_pressure numeric;
  v_drivers jsonb:='{}';
begin
  if p_advance then
    perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
    perform 1 from public.economic_state where id=true for update;
    perform pg_advisory_xact_lock(hashtext('govrp:currency:'||v_country));
  end if;
  if p_advance and exists(
    select 1 from public.currency_market_cycles where country_code=v_country and cycle_key=v_cycle
  ) then
    select state_snapshot into v_result from public.currency_market_cycles
    where country_code=v_country and cycle_key=v_cycle;
    return v_result;
  end if;
  select * into v_economy from public.economic_state where id=true;
  select revision into v_revision from public.country_rp_states where country_code=v_country;

  -- A persisted cycle ordinal makes simulation reproducible and retries idempotent.
  select count(*) into v_step from public.currency_market_cycles where country_code=v_country;
  v_step:=v_step+1;

  for v_state in
    select * from public.currency_market_states where country_code=v_country
    order by currency_code for update
  loop
    v_cycle_pressure:=0;
    if v_state.currency_code='BRL' then
      v_driver:=coalesce(v_economy.current_selic,10)*.00045
        -coalesce(v_economy.inflation_target,3)*.00065
        +(coalesce(v_economy.consumer_confidence,50)-50)*.00008
        +(coalesce(v_economy.fiscal_confidence,50)-50)*.00009
        -(v_state.risk_factor-50)*.00008;
    else
      v_driver:=(v_state.economic_strength-50)*.000025
        +(v_state.interest_factor-50)*.000018
        -(v_state.inflation_factor-50)*.00002
        -(v_state.risk_factor-50)*.000018
        +(v_state.stability_factor-50)*.000012
        +(v_state.international_demand-50)*.000015
        +v_state.trend;
      -- Independent economic cycles modulate each currency's own fundamentals.
      -- Different interest/inflation/risk profiles determine period and amplitude;
      -- no random/shared percentage is applied to the five BRL pairs.
      v_cycle_pressure:=v_state.volatility * (
        .45*sin((v_step+v_state.interest_factor)/(12+v_state.inflation_factor/5))
        +.25*sin((v_step+v_state.international_demand)/(36+v_state.risk_factor/2))
      ) * (1+(50-v_state.stability_factor)/200);
      v_driver:=v_driver+v_cycle_pressure;
    end if;
    v_delta:=greatest(-v_state.volatility,least(v_state.volatility,
      v_driver+(1-v_state.current_strength)*.025));
    if p_advance then
      update public.currency_market_states
      set current_strength=greatest(.5,least(1.5,current_strength+v_delta)),
          last_cycle_key=v_cycle,updated_at=clock_timestamp()
      where country_code=v_country and currency_code=v_state.currency_code
      returning current_strength into v_state.current_strength;
    end if;
    v_drivers:=v_drivers||jsonb_build_object(v_state.currency_code,jsonb_build_object(
      'fundamentalDriver',v_driver-v_cycle_pressure,'cyclePressure',v_cycle_pressure,
      'strengthDelta',v_delta,'cycleNumber',v_step));
    if v_state.currency_code='BRL' then v_brl_strength:=v_state.current_strength; end if;
  end loop;

  for v_state in
    select * from public.currency_market_states where country_code=v_country and currency_code<>'BRL'
    order by currency_code
  loop
    perform public.upsert_country_rp_exchange_rate(
      v_country,v_state.currency_code,
      greatest(.000001,v_state.base_brl_per_unit*v_state.current_strength/greatest(.5,v_brl_strength)),
      'independent_currency_market',v_revision
    );
  end loop;
  select jsonb_object_agg(rate.currency_code,jsonb_build_object(
    'brlPerUnit',rate.brl_per_unit,'strength',state.current_strength,'updatedAt',rate.updated_at
  ) || coalesce(v_drivers->rate.currency_code,'{}'::jsonb)) into v_result
  from public.country_rp_exchange_rates rate
  join public.currency_market_states state using(country_code,currency_code)
  where rate.country_code=v_country;
  if p_advance then
    insert into public.currency_market_cycles(country_code,cycle_key,state_snapshot)
    values(v_country,v_cycle,coalesce(v_result,'{}'::jsonb))
    on conflict(country_code,cycle_key) do nothing;
  end if;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;


notify pgrst,'reload schema';
commit;
