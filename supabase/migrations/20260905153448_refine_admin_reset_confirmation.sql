begin;

-- Keep the existing request history and allow an omitted/blank reason.
alter table private.rp_reset_requests alter column reason set default '';
alter table private.rp_reset_requests drop constraint rp_reset_requests_reason_check;
alter table private.rp_reset_requests add constraint rp_reset_requests_reason_check
  check (char_length(reason) <= 500);

create or replace function public.admin_prepare_rp_reset(
  p_scope text, p_user_ids uuid[] default '{}', p_reason text default '', p_country_snapshots jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.assert_reset_admin(); v_ids uuid[]; v_preview jsonb; v_id uuid; s jsonb; k text;
begin
  if p_scope is null or p_scope not in ('selected_users','all_users','full_rp') then raise exception 'Escopo de reset inválido.'; end if;
  p_reason:=trim(coalesce(p_reason,''));
  if char_length(p_reason)>500 then raise exception 'O motivo deve ter no máximo 500 caracteres.'; end if;
  if p_scope='selected_users' then
    select array_agg(distinct x order by x) into v_ids from unnest(p_user_ids) x where x is not null;
    if coalesce(cardinality(v_ids),0)=0 or exists(
      select 1 from unnest(v_ids) x where not exists(select 1 from public.profiles where id=x and deleted_at is null)
    ) then raise exception 'Selecione contas ativas e válidas.'; end if;
  else
    if coalesce(cardinality(p_user_ids),0)>0 then raise exception 'O reset global não aceita uma seleção parcial.'; end if;
    select coalesce(array_agg(id order by id),'{}') into v_ids from public.profiles where deleted_at is null;
  end if;
  if p_scope='full_rp' then
    if jsonb_typeof(p_country_snapshots) is distinct from 'array' or jsonb_array_length(p_country_snapshots)=0 then
      raise exception 'Consulte os indicadores reais antes de resetar o RP.';
    end if;
    if exists(select 1 from jsonb_array_elements(p_country_snapshots) x group by x->>'country_code' having count(*)>1)
      or exists(select 1 from public.country_rp_states c where c.is_playable and not exists(
        select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'=c.country_code))
      or exists(select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'<>'BR'
        and not exists(select 1 from public.country_rp_states c where c.is_playable and c.country_code=x->>'country_code'))
      or not exists(select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'='BR') then
      raise exception 'A referência real precisa incluir o Brasil e todos os países ativos, sem duplicatas.';
    end if;
    for s in select * from jsonb_array_elements(p_country_snapshots) loop
      if coalesce(s->>'country_code','') !~ '^[A-Z]{2}$' or nullif(trim(s->>'country_name'),'') is null
        or jsonb_typeof(s->'economy') is distinct from 'object'
        or jsonb_typeof(s->'demographics') is distinct from 'object'
        or jsonb_typeof(s->'politics') is distinct from 'object'
        or (s->>'fetched_at')::timestamptz is null
        or (s->>'fetched_at')::timestamptz < clock_timestamp()-interval '30 minutes'
        or (s->>'fetched_at')::timestamptz > clock_timestamp()+interval '1 minute' then
        raise exception 'A fotografia real está incompleta ou expirada.';
      end if;
      foreach k in array array['gdp','growth','inflation','unemployment','exchangeUsd','exchangeEur'] loop
        if jsonb_typeof(s->'economy'->k) is distinct from 'number' then raise exception 'Indicador real ausente: %.',k; end if;
      end loop;
      if (s->'economy'->>'gdp')::numeric<=0 or (s->'economy'->>'exchangeUsd')::numeric<=0
        or (s->'economy'->>'exchangeEur')::numeric<=0
        or coalesce((s->'demographics'->>'population')::numeric,0)<=0
        or s->'economy'->>'gdpCurrency' is distinct from 'USD'
        or coalesce(jsonb_array_length(s->'economy'->'referenceSources'),0)=0 then
        raise exception 'Os valores de referência reais são inválidos.';
      end if;
      if s->>'country_code'='BR' then
        if jsonb_typeof(s->'economy'->'selic') is distinct from 'number'
          or (s->'economy'->>'selic')::numeric not between 0 and 100 then raise exception 'A Selic real é obrigatória e deve ser válida.'; end if;
        foreach k in array array['USD','EUR','GBP','JPY','CNY'] loop
          if jsonb_typeof(s->'exchange_rates'->k) is distinct from 'number' or (s->'exchange_rates'->>k)::numeric<=0 then
            raise exception 'Cotação real ausente: %.',k;
          end if;
        end loop;
      end if;
    end loop;
  else p_country_snapshots:='[]'; end if;
  v_preview:=private.build_rp_reset_plan(p_scope,v_ids);
  insert into private.rp_reset_requests(requested_by,scope,user_ids,reason,country_snapshots,preview)
  values(v_actor,p_scope,v_ids,trim(p_reason),p_country_snapshots,v_preview) returning id into v_id;
  return v_preview || jsonb_build_object('request_id',v_id,'scope',p_scope,'expires_in_seconds',900,
    'confirmation','RESETAR');
end; $$;

create or replace function public.admin_execute_rp_reset(p_request_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
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

  -- A removed party cannot remain attached to another citizen's profile.
  update public.profiles set party_affiliation=null where party_affiliation in (
    select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.political_parties'::regclass
  );
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
    privatized_at=null,privatization_price=null,updated_at=clock_timestamp()
  where privatization_buyer_id=any(req.user_ids);
  update public.political_parties set president_id=null where president_id=any(req.user_ids);
  update public.political_parties set vice_president_id=null where vice_president_id=any(req.user_ids);

  if req.scope='full_rp' then
    -- Reset mutable state to schema defaults; retain only catalog definitions.
    for t in select * from (values
      ('economic_state','{id}'::text[]),
      ('government_finances','{id}'::text[]),
      ('government_popularity_state','{country_code}'::text[]),
      ('currency_market_states','{country_code,currency_code,base_brl_per_unit}'::text[]),
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
    update public.government_ministries set annual_budget=0,spent_budget=0,efficiency_score=default,public_impact=0,created_by=null where id is not null;
    update public.price_basket_items set current_price=base_price,updated_at=clock_timestamp() where id is not null;
    delete from public.state_enterprises where not is_system;
    update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_price=null,
      privatization_buyer_id=null,privatized_at=null,created_by=null,market_value=default,health_score=default,is_active=true where is_system;
    update public.rp_time_settings set rp_epoch_real_at=clock_timestamp(),rp_epoch_game_at=clock_timestamp(),
      is_paused=false,paused_real_at=null,paused_rp_at=null,updated_by=v_actor,updated_at=clock_timestamp() where id=true;
    insert into public.rp_time_settings(id,rp_epoch_game_at) values(true,clock_timestamp()) on conflict do nothing;
    delete from public.system_settings where key in (
      'executive_governance','election_office_sync','government_budget','national_budget','government_balance',
      'economic_policy','bank_policy','tax_rates','transaction_tax'
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
      ('government_budget','{"areas":[]}'),('national_budget','0');
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
    insert into public.currency_market_states(country_code,currency_code,base_brl_per_unit)
    select 'BR',key,value::numeric from jsonb_each_text(v_brazil->'exchange_rates') where key in ('USD','EUR','GBP','JPY','CNY');
    insert into public.currency_market_states(country_code,currency_code,base_brl_per_unit) values('BR','BRL',1);
    insert into public.country_rp_exchange_rates(country_code,currency_code,brl_per_unit,source)
    select 'BR',key,value::numeric,'real_baseline' from jsonb_each_text(v_brazil->'exchange_rates') where key in ('USD','EUR','GBP','JPY','CNY');
  else
    -- Reset bypasses gameplay award triggers, so reconcile remaining social counts.
    update public.posts p set likes_count=(select count(*) from (
        select user_id from public.post_likes where post_id=p.id union select user_id from public.likes where post_id=p.id
      ) liked),
      comments_count=(select count(*) from public.comments c where c.post_id=p.id and c.parent_comment_id is null),
      reposts_count=(select count(*) from public.reposts r where r.post_id=p.id) where p.id is not null;
    update public.comments c set replies_count=(select count(*) from public.comments reply where reply.parent_comment_id=c.id) where c.id is not null;
    delete from public.trends where hashtag is not null;
    insert into public.trends(hashtag,post_count,last_used_at)
    select tag,count(distinct p.id),max(p.created_at) from public.posts p,
      lateral unnest(public.extract_hashtags(p.content)) tag group by tag;
  end if;

  for tr in select * from pg_temp.rp_reset_triggers loop
    execute format('alter table public.%I %s trigger %I',tr.table_name,
      case tr.tgenabled when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,tr.tgname);
  end loop;
  v_result:=v_result||jsonb_build_object('success',true,'request_id',req.id,'scope',req.scope,'completed_at',clock_timestamp());
  update private.rp_reset_requests set completed_at=clock_timestamp(),result=v_result where id=req.id;
  return v_result;
end; $$;

-- Replacing these functions preserves ownership and the existing grants.
-- All global writes now have explicit predicates, including social counters,
-- so the API's safeupdate protection stays enabled throughout the reset.
notify pgrst, 'reload schema';
commit;
