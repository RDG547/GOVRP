begin;

-- Reset only runs through an authenticated administrator's confirmed request.
-- Account credentials, OOC identity, donations, support and security audit survive.
create table if not exists private.rp_reset_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id),
  scope text not null check (scope in ('selected_users','all_users','full_rp')),
  user_ids uuid[] not null,
  country_snapshots jsonb not null default '[]',
  reason text not null check (char_length(reason) between 5 and 500),
  preview jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '15 minutes',
  completed_at timestamptz,
  result jsonb
);
alter table private.rp_reset_requests enable row level security;
revoke all on private.rp_reset_requests from public, anon, authenticated;
create index if not exists rp_reset_requests_actor_idx on private.rp_reset_requests(requested_by,created_at desc);

create or replace function private.rp_reset_policy()
returns table(table_name text, reset_mode text, owner_columns text[])
language sql immutable set search_path='' as $$
  values
    ('accounts', 'clear', '{user_id}'::text[]),
    ('achievements', 'keep', '{}'::text[]),
    ('agies_missions', 'clear', '{agent_id}'::text[]),
    ('app_config', 'keep', '{}'::text[]),
    ('appeals', 'clear', '{filed_by}'::text[]),
    ('armed_forces_enlistment', 'clear', '{user_id}'::text[]),
    ('armed_forces_operations', 'clear', '{commander_id}'::text[]),
    ('armed_forces_reports', 'clear', '{reporter_id}'::text[]),
    ('arrests', 'clear', '{suspect_id}'::text[]),
    ('bill_status_history', 'clear', '{}'::text[]),
    ('bill_suggestions', 'clear', '{author_id}'::text[]),
    ('bill_votes', 'clear', '{}'::text[]),
    ('bills', 'clear', '{author_id}'::text[]),
    ('bills_of_exchange', 'clear', '{issuer_id,payer_id}'::text[]),
    ('business_balance_cycles', 'clear', '{owner_id}'::text[]),
    ('business_economic_snapshots', 'clear', '{}'::text[]),
    ('business_employees', 'clear', '{profile_id}'::text[]),
    ('business_transactions', 'clear', '{}'::text[]),
    ('business_types', 'keep', '{}'::text[]),
    ('businesses', 'clear', '{owner_id}'::text[]),
    ('candidates', 'clear', '{user_id,vice_candidate_id}'::text[]),
    ('card_invoice_items', 'clear', '{}'::text[]),
    ('card_invoices', 'clear', '{user_id}'::text[]),
    ('cards', 'clear', '{user_id}'::text[]),
    ('case_charges', 'clear', '{defendant_id}'::text[]),
    ('case_documents', 'clear', '{author_id}'::text[]),
    ('case_evidence', 'clear', '{}'::text[]),
    ('case_parties', 'clear', '{profile_id}'::text[]),
    ('case_timeline_events', 'clear', '{}'::text[]),
    ('citizen_economic_snapshots', 'clear', '{profile_id}'::text[]),
    ('citizen_economic_statuses', 'clear', '{profile_id}'::text[]),
    ('citizen_justice_requests', 'clear', '{requester_id}'::text[]),
    ('citizen_lifecycle_events', 'clear', '{user_id}'::text[]),
    ('citizen_objective_definitions', 'keep', '{}'::text[]),
    ('citizen_objective_progress', 'clear', '{user_id}'::text[]),
    ('comments', 'clear', '{user_id}'::text[]),
    ('commerce_orders', 'clear', '{buyer_id}'::text[]),
    ('constitution_amendments', 'clear', '{}'::text[]),
    ('constitution_articles', 'keep', '{}'::text[]),
    ('constitution_sections', 'keep', '{}'::text[]),
    ('country_constitutions', 'keep', '{}'::text[]),
    ('country_population_segments', 'reset', '{}'::text[]),
    ('country_rp_economic_snapshots', 'clear', '{}'::text[]),
    ('country_rp_events', 'clear', '{}'::text[]),
    ('country_rp_exchange_history', 'clear', '{}'::text[]),
    ('country_rp_exchange_rates', 'clear', '{}'::text[]),
    ('country_rp_states', 'reset', '{}'::text[]),
    ('credit_card_applications', 'clear', '{user_id}'::text[]),
    ('criminal_cases', 'clear', '{}'::text[]),
    ('criminal_investigations', 'clear', '{}'::text[]),
    ('criminal_records', 'clear', '{user_id}'::text[]),
    ('currency_market_cycles', 'clear', '{}'::text[]),
    ('currency_market_states', 'reset', '{}'::text[]),
    ('daily_check_ins', 'clear', '{user_id}'::text[]),
    ('decrees', 'clear', '{author_id}'::text[]),
    ('document_history', 'clear', '{user_id}'::text[]),
    ('document_requests', 'clear', '{user_id}'::text[]),
    ('documents', 'clear', '{user_id}'::text[]),
    ('domain_events', 'clear', '{}'::text[]),
    ('donation_webhook_events', 'keep', '{}'::text[]),
    ('donations', 'keep', '{}'::text[]),
    ('dou_entries', 'clear', '{}'::text[]),
    ('economic_alerts', 'clear', '{}'::text[]),
    ('economic_audit_log', 'clear', '{}'::text[]),
    ('economic_bulletins', 'clear', '{}'::text[]),
    ('economic_calibrations', 'keep', '{}'::text[]),
    ('economic_engine_runs', 'clear', '{}'::text[]),
    ('economic_events', 'clear', '{actor_profile_id}'::text[]),
    ('economic_forecasts', 'clear', '{}'::text[]),
    ('economic_indicators', 'clear', '{}'::text[]),
    ('economic_periods', 'clear', '{}'::text[]),
    ('economic_policy_decisions', 'clear', '{}'::text[]),
    ('economic_policy_effects', 'clear', '{}'::text[]),
    ('economic_sector_snapshots', 'clear', '{}'::text[]),
    ('economic_sectors', 'keep', '{}'::text[]),
    ('economic_shocks', 'clear', '{}'::text[]),
    ('economic_state', 'reset', '{}'::text[]),
    ('election_audit_log', 'clear', '{}'::text[]),
    ('election_office_assignments', 'clear', '{profile_id}'::text[]),
    ('election_settlements', 'clear', '{}'::text[]),
    ('election_types', 'keep', '{}'::text[]),
    ('elections', 'clear', '{}'::text[]),
    ('evidence_custody_events', 'clear', '{}'::text[]),
    ('fine_appeals', 'clear', '{appellant_id}'::text[]),
    ('fine_hearing_requests', 'clear', '{requester_id}'::text[]),
    ('fiscal_periods', 'clear', '{}'::text[]),
    ('followers', 'clear', '{follower_id,following_id}'::text[]),
    ('government_expenditures', 'clear', '{}'::text[]),
    ('government_finances', 'reset', '{}'::text[]),
    ('government_media_contracts', 'clear', '{}'::text[]),
    ('government_ministries', 'reset', '{}'::text[]),
    ('government_popularity_events', 'clear', '{}'::text[]),
    ('government_popularity_state', 'reset', '{}'::text[]),
    ('government_projects', 'clear', '{}'::text[]),
    ('government_revenues', 'clear', '{}'::text[]),
    ('government_rules', 'clear', '{}'::text[]),
    ('hearing_participants', 'clear', '{profile_id}'::text[]),
    ('hearings', 'clear', '{}'::text[]),
    ('investigation_events', 'clear', '{}'::text[]),
    ('investigation_parties', 'clear', '{profile_id}'::text[]),
    ('investigation_subjects', 'clear', '{profile_id}'::text[]),
    ('investment_operations', 'clear', '{user_id}'::text[]),
    ('investment_options', 'keep', '{}'::text[]),
    ('investment_portfolio_snapshots', 'clear', '{user_id}'::text[]),
    ('judicial_decisions', 'clear', '{}'::text[]),
    ('judicial_requests', 'clear', '{requested_by,target_profile_id}'::text[]),
    ('justice_audit_log', 'clear', '{}'::text[]),
    ('justice_deadlines', 'clear', '{}'::text[]),
    ('justice_number_counters', 'clear', '{}'::text[]),
    ('labor_market_snapshots', 'clear', '{}'::text[]),
    ('law_effects', 'clear', '{}'::text[]),
    ('likes', 'clear', '{user_id}'::text[]),
    ('loan_applications', 'clear', '{user_id}'::text[]),
    ('loans', 'clear', '{user_id}'::text[]),
    ('media_outlets', 'clear', '{editor_id}'::text[]),
    ('minister_history', 'clear', '{minister_profile_id}'::text[]),
    ('ministers', 'clear', '{user_id}'::text[]),
    ('monetary_policy_meetings', 'clear', '{}'::text[]),
    ('national_event_decision_options', 'clear', '{}'::text[]),
    ('national_event_responses', 'clear', '{}'::text[]),
    ('national_game_events', 'clear', '{}'::text[]),
    ('national_indicator_points', 'clear', '{}'::text[]),
    ('national_media_briefs', 'clear', '{}'::text[]),
    ('news_articles', 'clear', '{author_id}'::text[]),
    ('news_categories', 'keep', '{}'::text[]),
    ('notifications', 'clear', '{user_id,sender_id}'::text[]),
    ('parliament_commission_houses', 'clear', '{}'::text[]),
    ('parliament_commission_members', 'clear', '{}'::text[]),
    ('parliament_commission_supports', 'clear', '{}'::text[]),
    ('parliament_commissions', 'clear', '{}'::text[]),
    ('parliament_houses', 'keep', '{}'::text[]),
    ('parliament_leadership_candidates', 'clear', '{}'::text[]),
    ('parliament_leadership_elections', 'clear', '{}'::text[]),
    ('parliament_leadership_terms', 'clear', '{}'::text[]),
    ('parliament_leadership_votes', 'clear', '{}'::text[]),
    ('parliament_members', 'clear', '{user_id}'::text[]),
    ('parliament_voting_votes', 'clear', '{}'::text[]),
    ('parliament_votings', 'clear', '{}'::text[]),
    ('party_affiliation_requests', 'clear', '{user_id}'::text[]),
    ('party_history', 'clear', '{}'::text[]),
    ('party_members', 'clear', '{user_id}'::text[]),
    ('penal_code', 'keep', '{}'::text[]),
    ('penal_time_brackets', 'keep', '{}'::text[]),
    ('plebiscite_votes', 'clear', '{voter_id}'::text[]),
    ('plebiscites', 'clear', '{author_id}'::text[]),
    ('police_fines', 'clear', '{user_id}'::text[]),
    ('police_investigations', 'clear', '{}'::text[]),
    ('police_occurrences', 'clear', '{user_id}'::text[]),
    ('police_reports', 'clear', '{}'::text[]),
    ('police_wanted_list', 'clear', '{profile_id}'::text[]),
    ('political_parties', 'clear', '{founder_id,owner_id}'::text[]),
    ('political_point_events', 'clear', '{user_id}'::text[]),
    ('population_segment_events', 'clear', '{}'::text[]),
    ('post_likes', 'clear', '{user_id}'::text[]),
    ('posts', 'clear', '{user_id}'::text[]),
    ('price_basket_items', 'reset', '{}'::text[]),
    ('price_observations', 'clear', '{}'::text[]),
    ('prison_activities', 'keep', '{}'::text[]),
    ('prison_activity_runs', 'clear', '{inmate_id}'::text[]),
    ('prison_appeals', 'clear', '{user_id}'::text[]),
    ('prison_cells', 'keep', '{}'::text[]),
    ('prison_events', 'clear', '{}'::text[]),
    ('prison_facilities', 'keep', '{}'::text[]),
    ('prison_hearings', 'clear', '{user_id}'::text[]),
    ('prison_terms', 'clear', '{inmate_id}'::text[]),
    ('prison_visits', 'clear', '{inmate_id,visitor_id}'::text[]),
    ('prison_wings', 'keep', '{}'::text[]),
    ('product_ownership_history', 'clear', '{user_id}'::text[]),
    ('product_reviews', 'clear', '{user_id}'::text[]),
    ('products', 'clear', '{seller_id}'::text[]),
    ('profiles', 'reset', '{}'::text[]),
    ('public_integrity_case_events', 'clear', '{}'::text[]),
    ('public_integrity_cases', 'clear', '{}'::text[]),
    ('public_safety_campaigns', 'clear', '{}'::text[]),
    ('reposts', 'clear', '{user_id}'::text[]),
    ('rp_time_settings', 'reset', '{}'::text[]),
    ('salary_payments', 'clear', '{user_id}'::text[]),
    ('security_audit_log', 'keep', '{}'::text[]),
    ('sentences', 'clear', '{defendant_id}'::text[]),
    ('state_enterprises', 'reset', '{}'::text[]),
    ('stories', 'clear', '{user_id}'::text[]),
    ('support_ticket_messages', 'keep', '{}'::text[]),
    ('support_tickets', 'keep', '{}'::text[]),
    ('system_settings', 'reset', '{}'::text[]),
    ('trade_settlement_audit', 'clear', '{user_id}'::text[]),
    ('trade_settlement_locks', 'clear', '{user_id}'::text[]),
    ('trades', 'clear', '{user_id}'::text[]),
    ('transactions', 'clear', '{}'::text[]),
    ('trends', 'clear', '{}'::text[]),
    ('user_achievements', 'clear', '{user_id}'::text[]),
    ('user_activity_sessions', 'clear', '{user_id}'::text[]),
    ('user_inventory', 'clear', '{user_id}'::text[]),
    ('user_investments', 'clear', '{user_id}'::text[]),
    ('user_page_views', 'clear', '{user_id}'::text[]),
    ('user_services', 'clear', '{user_id}'::text[]),
    ('user_subscriptions', 'clear', '{user_id,seller_id}'::text[]),
    ('users', 'keep', '{}'::text[]),
    ('votes', 'clear', '{voter_id}'::text[]),
    ('warrants', 'clear', '{target_profile_id}'::text[]),
    ('x_conversation_participants', 'clear', '{user_id}'::text[]),
    ('x_conversations', 'clear', '{}'::text[]),
    ('x_messages', 'clear', '{sender_id}'::text[])
$$;

create or replace function private.assert_reset_admin()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid := auth.uid();
begin
  if v_id is null or not exists (
    select 1 from public.profiles where id=v_id and role='Admin' and deleted_at is null
  ) then raise exception 'Apenas administradores ativos podem resetar o RP.' using errcode='42501'; end if;
  return v_id;
end; $$;

-- Classify every application table explicitly. A newly added domain fails closed
-- until its reset policy is reviewed; it is never silently truncated or forgotten.
create or replace function private.build_rp_reset_plan(p_scope text, p_user_ids uuid[])
returns jsonb language plpgsql set search_path='' as $$
declare t record; f record; v_rows bigint; v_added bigint; v_predicate text; v_result jsonb;
begin
  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and not exists(select 1 from private.rp_reset_policy() p where p.table_name=c.relname)
  ) then raise exception 'Existem tabelas sem política de reset. Atualize a migração antes de continuar.'; end if;
  drop table if exists pg_temp.rp_reset_rows;
  drop table if exists pg_temp.rp_reset_tables;
  create temporary table rp_reset_rows (relation oid, row_key jsonb, primary key(relation,row_key)) on commit drop;
  create temporary table rp_reset_tables (relation oid primary key, table_name text, key_sql text, owner_columns text[]) on commit drop;
  insert into pg_temp.rp_reset_tables
  select c.oid,c.relname,
    'jsonb_build_object(' || string_agg(format('%L,r.%I',a.attname,a.attname),',' order by a.attnum) || ')',
    p.owner_columns
  from private.rp_reset_policy() p
  join pg_catalog.pg_class c on c.oid=to_regclass('public.'||p.table_name)
  join pg_catalog.pg_index i on i.indrelid=c.oid and i.indisprimary
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey)
  where p.reset_mode='clear' group by c.oid,c.relname,p.owner_columns;
  for t in select * from pg_temp.rp_reset_tables loop
    if p_scope='full_rp' then v_predicate := 'true';
    else
      select string_agg(format('r.%I=any($1)',x),' or ') into v_predicate from unnest(t.owner_columns) x;
    end if;
    if v_predicate is not null then
      execute format('insert into pg_temp.rp_reset_rows select %s,%s from public.%I r where %s on conflict do nothing',
        t.relation,t.key_sql,t.table_name,v_predicate) using p_user_ids;
    end if;
  end loop;
  -- Conversations belong to all participants; deleting one also removes the
  -- shared messages. Unrelated conversations and other citizens remain intact.
  if p_scope<>'full_rp' then
    insert into pg_temp.rp_reset_rows
    select 'public.x_conversations'::regclass,jsonb_build_object('id',conversation_id)
    from public.x_conversation_participants where user_id=any(p_user_ids) on conflict do nothing;
  end if;
  loop
    v_added:=0;
    for f in
      select fk.conrelid,fk.confrelid,child.table_name,child.key_sql,
        parent.table_name parent_name,replace(parent.key_sql,'r.','p.') parent_key_sql,
        string_agg(format('r.%I=p.%I',ca.attname,pa.attname),' and ' order by k.ordinality) join_sql
      from pg_catalog.pg_constraint fk
      join pg_temp.rp_reset_tables child on child.relation=fk.conrelid
      join pg_temp.rp_reset_tables parent on parent.relation=fk.confrelid
      cross join lateral unnest(fk.conkey,fk.confkey) with ordinality k(child_col,parent_col,ordinality)
      join pg_catalog.pg_attribute ca on ca.attrelid=fk.conrelid and ca.attnum=k.child_col
      join pg_catalog.pg_attribute pa on pa.attrelid=fk.confrelid and pa.attnum=k.parent_col
      where fk.contype='f'
      group by fk.oid,fk.conrelid,fk.confrelid,child.table_name,child.key_sql,parent.table_name,parent.key_sql
    loop
      execute format('insert into pg_temp.rp_reset_rows select %s,%s from public.%I r join public.%I p on %s join pg_temp.rp_reset_rows chosen on chosen.relation=%s and chosen.row_key=%s on conflict do nothing',
        f.conrelid,f.key_sql,f.table_name,f.parent_name,f.join_sql,f.confrelid,f.parent_key_sql);
      get diagnostics v_rows=row_count; v_added:=v_added+v_rows;
    end loop;
    exit when v_added=0;
  end loop;
  select coalesce(jsonb_object_agg(planned.table_name,x.total),'{}') into v_result
  from (select relation,count(*) total from pg_temp.rp_reset_rows group by relation) x
  join pg_temp.rp_reset_tables planned using(relation);
  return jsonb_build_object('users',cardinality(p_user_ids),'records',v_result,
    'total_records',(select count(*) from pg_temp.rp_reset_rows));
end; $$;

create or replace function public.admin_prepare_rp_reset(
  p_scope text, p_user_ids uuid[] default '{}', p_reason text default '', p_country_snapshots jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.assert_reset_admin(); v_ids uuid[]; v_preview jsonb; v_id uuid; s jsonb; k text;
begin
  if p_scope is null or p_scope not in ('selected_users','all_users','full_rp') then raise exception 'Escopo de reset inválido.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Informe um motivo entre 5 e 500 caracteres.'; end if;
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
    'confirmation',case when p_scope='full_rp' then 'RESETAR RP' else 'RESETAR USUARIOS' end);
end; $$;

-- Remove references to retired citizens embedded in institutional JSON settings.
-- This prevents the office synchronization worker from re-granting old offices.
create or replace function private.remove_reset_profile_references(p_value jsonb, p_ids uuid[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb; e record;
begin
  if jsonb_typeof(p_value)='object' then
    if exists(select 1 from jsonb_each(p_value) x where jsonb_typeof(x.value)='string'
      and trim(both '"' from x.value::text)=any(p_ids::text[])) then return null; end if;
    v_result:='{}';
    for e in select * from jsonb_each(p_value) loop
      v_result:=v_result||jsonb_strip_nulls(jsonb_build_object(e.key,private.remove_reset_profile_references(e.value,p_ids)));
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(v) filter(where v is not null),'[]') into v_result
    from (select private.remove_reset_profile_references(value,p_ids) v from jsonb_array_elements(p_value)) x;
    return v_result;
  end if;
  if jsonb_typeof(p_value)='string' and trim(both '"' from p_value::text)=any(p_ids::text[]) then return null; end if;
  return p_value;
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
  if p_confirmation is distinct from (case when req.scope='full_rp' then 'RESETAR RP' else 'RESETAR USUARIOS' end) then
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
      execute format('update public.%I set %s',t.table_name,v_assignments);
    end loop;
    insert into public.economic_state(id) values(true) on conflict do nothing;
    insert into public.government_finances(id) values(1) on conflict do nothing;
    insert into public.government_popularity_state(country_code) values('BR') on conflict do nothing;
    update public.government_finances set treasury_balance=0,loans_balance=0,corporate_card_used=0;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind) values
      ('corporate_tax_rate',0.10,'ratio','Alíquota sobre receitas empresariais','system'),
      ('consumption_tax_rate',0.03,'ratio','Alíquota incidente sobre compras de produtos','system'),
      ('business_license_fee',250,'BRL','Taxa para abertura de empresa','system'),
      ('public_safety_policy_index',50,'index','Intensidade da política nacional de segurança','system'),
      ('social_welfare_policy_index',50,'index','Intensidade da política nacional de bem-estar','system');
    update public.government_ministries set annual_budget=0,spent_budget=0,efficiency_score=default,public_impact=0,created_by=null;
    update public.price_basket_items set current_price=base_price,updated_at=clock_timestamp();
    delete from public.state_enterprises where not is_system;
    update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_price=null,
      privatization_buyer_id=null,privatized_at=null,created_by=null,market_value=default,health_score=default,is_active=true;
    update public.rp_time_settings set rp_epoch_real_at=clock_timestamp(),rp_epoch_game_at=clock_timestamp(),
      is_paused=false,paused_real_at=null,paused_rp_at=null,updated_by=v_actor,updated_at=clock_timestamp();
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
      simulated_share=0.5,player_share=0.5,metadata=jsonb_build_object('origin','real_baseline','reset_request_id',req.id);
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
      +case risk_level when 'low' then -.4 when 'high' then 2.2 when 'very-high' then 4.5 else .8 end)/100,4);
    update public.country_rp_states set is_playable=false,economic_baseline='{}',economic_current='{}',
      political_current='{}',demographic_current='{}',economic_engine_cursor='{}',reference_snapshot_at=null,
      economy_influence=0,politics_influence=0,society_influence=0,revision=0,last_event_type=null,last_event_summary=null,
      started_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=v_actor;
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
    delete from public.country_population_segments;
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
    delete from public.currency_market_states;
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
      reposts_count=(select count(*) from public.reposts r where r.post_id=p.id);
    update public.comments c set replies_count=(select count(*) from public.comments reply where reply.parent_comment_id=c.id);
    delete from public.trends;
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

create or replace function public.admin_get_rp_reset_history()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_reset_admin();
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select id,requested_by,scope,reason,completed_at,result from private.rp_reset_requests
    where completed_at is not null order by completed_at desc limit 30
  ) x),'[]');
end; $$;

revoke all on function private.rp_reset_policy(),private.assert_reset_admin(),private.build_rp_reset_plan(text,uuid[]),
  private.remove_reset_profile_references(jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.admin_prepare_rp_reset(text,uuid[],text,jsonb),
  public.admin_execute_rp_reset(uuid,text),public.admin_get_rp_reset_history() from public,anon;
grant execute on function public.admin_prepare_rp_reset(text,uuid[],text,jsonb),
  public.admin_execute_rp_reset(uuid,text),public.admin_get_rp_reset_history() to authenticated;

commit;
