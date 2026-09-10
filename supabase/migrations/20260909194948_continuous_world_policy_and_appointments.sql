begin;

alter table public.economic_state drop constraint economic_state_rates;
alter table public.economic_state add constraint economic_state_rates check (
 current_selic between -20 and 100 and inflation_target between 0 and 100 and exchange_rate>0 and cpi_index>0 and gdp_deflator>0
 and consumer_confidence between 0 and 100 and business_confidence between 0 and 100 and fiscal_confidence between 0 and 100
 and player_share between 0 and 1 and simulated_share between 0 and 1 and abs(player_share+simulated_share-1)<.000001);


CREATE OR REPLACE FUNCTION public.apply_policy_decision(p_policy_type text, p_new_value numeric, p_justification text, p_market_expectation numeric DEFAULT NULL::numeric, p_effective_at_rp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  previous_value numeric;
  delta numeric;
  decision_id uuid;
  impacts jsonb;
  rp_effective timestamptz := coalesce(p_effective_at_rp,public.rp_now());
  real_effective timestamptz;
  authority_name text;
  item record;
  start_lag interval;
  peak_lag interval;
  end_lag interval;
begin
  if actor_id is null then
    raise exception 'Autenticação obrigatória.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_justification,'')))<20 then
    raise exception 'A justificativa deve possuir pelo menos 20 caracteres.';
  end if;
  if p_policy_type in ('selic','inflation_target','reserve_requirement','exchange_intervention') then
    if not public.economic_has_role(array[
      'Admin','Presidente','Presidente do Banco Central','Banco Central'
    ]) then
      raise exception 'Cargo sem competência monetária.' using errcode='42501';
    end if;
    authority_name := case
      when public.economic_has_role(array['Presidente do Banco Central','Banco Central'])
        then 'Banco Central'
      else 'Presidência'
    end;
  else
    if not public.economic_has_role(array[
      'Admin','Presidente','Ministro da Fazenda','Ministro da Economia','Ministro'
    ]) then
      raise exception 'Cargo sem competência fiscal.' using errcode='42501';
    end if;
    authority_name := 'Governo';
  end if;

  previous_value := case p_policy_type
    when 'selic' then (select current_selic from public.economic_state where id=true)
    when 'inflation_target' then (select inflation_target from public.economic_state where id=true)
    else coalesce((select new_value from public.economic_policy_decisions
      where policy_type=p_policy_type and status in ('announced','effective')
      order by announced_at_real desc limit 1),0)
  end;
  delta := p_new_value-previous_value;
  if p_new_value is null or p_new_value::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Valor inválido.';
  end if;
  if (p_policy_type='selic' and (p_new_value < -20 or p_new_value>100)) or (p_policy_type='inflation_target' and (p_new_value<0 or p_new_value>100)) then
    raise exception 'Taxa fora do intervalo permitido.';
  end if;
  if p_policy_type in ('consumption_tax','corporate_tax','income_tax','payroll_tax')
     and (p_new_value<0 or p_new_value>60 or abs(delta)>10) then
    raise exception 'Alteração tributária fora dos limites.';
  end if;

  real_effective := public.rp_date_to_real_date(rp_effective);
  impacts := economy_private.policy_impacts(p_policy_type,previous_value,p_new_value);

  update public.economic_policy_decisions
  set status='superseded'
  where policy_type=p_policy_type and status in ('announced','effective');

  insert into public.economic_policy_decisions(
    policy_type,authority,authority_profile_id,previous_value,new_value,
    value_unit,justification,announced_at_rp,effective_at_real,effective_at_rp,
    status,expected_impacts,market_expectation,surprise_index
  )
  values (
    p_policy_type,authority_name,actor_id,previous_value,p_new_value,
    case when p_policy_type='minimum_wage' then 'BRL' else 'percent' end,
    trim(p_justification),public.rp_now(),real_effective,rp_effective,
    case when rp_effective<=public.rp_now() then 'effective' else 'announced' end,
    impacts,p_market_expectation,
    case when p_market_expectation is null then 0 else p_new_value-p_market_expectation end
  )
  returning id into decision_id;

  for item in select key as effect_code,(value #>> '{}')::numeric as impact
              from jsonb_each(impacts)
              where jsonb_typeof(value)='number'
                and key not in ('previous_value','new_value','confidence')
  loop
    start_lag := case
      when item.effect_code in ('consumer_confidence','business_confidence','credit_percent') then interval '0'
      else interval '1 month'
    end;
    peak_lag := case
      when item.effect_code='inflation_points' then interval '6 months'
      when item.effect_code in ('output_percent','employment_percent') then interval '4 months'
      else interval '2 months'
    end;
    end_lag := case
      when item.effect_code='inflation_points' then interval '12 months'
      else interval '8 months'
    end;
    insert into public.economic_policy_effects(
      policy_decision_id,effect_code,total_impact,starts_at_rp,peaks_at_rp,ends_at_rp
    )
    values (
      decision_id,item.effect_code,item.impact,
      rp_effective+start_lag,rp_effective+peak_lag,rp_effective+end_lag
    );
  end loop;

  if p_policy_type='selic' and rp_effective<=public.rp_now() then
    update public.economic_state set current_selic=p_new_value,updated_at=now() where id=true;
  elsif p_policy_type='inflation_target' and rp_effective<=public.rp_now() then
    update public.economic_state set inflation_target=p_new_value,updated_at=now() where id=true;
  end if;

  perform economy_private.audit(
    'apply_policy_decision','economic_policy_decision',decision_id::text,
    jsonb_build_object('value',previous_value),
    jsonb_build_object('value',p_new_value,'impacts',impacts),
    p_justification,actor_id
  );
  perform economy_private.create_alert(
    'policy_'||decision_id::text,'info','Nova decisão econômica',
    format('%s alterada de %s para %s.',p_policy_type,previous_value,p_new_value),
    null,'economic_policy_decision',decision_id::text,
    jsonb_build_object('policy_type',p_policy_type)
  );
  return jsonb_build_object('decision_id',decision_id,'previous_value',previous_value,
    'new_value',p_new_value,'expected_impacts',impacts,'effective_at_rp',rp_effective);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.sync_global_monetary_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  economic_policy jsonb := '{}'::jsonb;
  bank_policy jsonb := '{}'::jsonb;
  previous_monthly numeric;
  current_monthly numeric;
  loan_spread numeric;
  card_spread numeric;
  debt_spread numeric;
begin
  select coalesce(setting.value, '{}'::jsonb)
    into economic_policy
  from public.system_settings setting
  where setting.key = 'economic_policy';

  select coalesce(setting.value, '{}'::jsonb)
    into bank_policy
  from public.system_settings setting
  where setting.key = 'bank_policy';

  economic_policy := coalesce(economic_policy, '{}'::jsonb) || jsonb_build_object(
    'selic_rate', new.current_selic,
    'updated_at', now(),
    'updated_by', auth.uid()
  );

  previous_monthly := round(
    (power(1 + coalesce(old.current_selic, new.current_selic) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );
  current_monthly := round(
    (power(1 + new.current_selic / 100, 1.0 / 12.0) - 1) * 100,
    2
  );

  loan_spread := coalesce(
    nullif(bank_policy->>'loan_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'loan_interest_rate', '')::numeric, 2.5) - previous_monthly)
  );
  card_spread := coalesce(
    nullif(bank_policy->>'credit_card_revolving_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'credit_card_revolving_rate', '')::numeric, 8.9) - previous_monthly)
  );
  debt_spread := coalesce(
    nullif(bank_policy->>'government_debt_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'government_debt_interest_rate', '')::numeric, 1.75) - previous_monthly)
  );

  bank_policy := coalesce(bank_policy, '{}'::jsonb) || jsonb_build_object(
    'loan_interest_spread', loan_spread,
    'credit_card_revolving_spread', card_spread,
    'government_debt_interest_spread', debt_spread,
    'loan_interest_rate', round(current_monthly + loan_spread, 2),
    'credit_card_revolving_rate', round(current_monthly + card_spread, 2),
    'government_debt_interest_rate', round(current_monthly + debt_spread, 2),
    'selic_reference', new.current_selic,
    'updated_at', now()
  );

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'economic_policy',
    economic_policy,
    'Política monetária nacional sincronizada com o motor econômico.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'bank_policy',
    bank_policy,
    'Política de juros e crédito sincronizada com a Selic nacional.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  update public.investment_options option
  set annual_return_rate = round(greatest(
    -0.95,
    (
      new.current_selic * case option.risk_level
        when 'low' then 0.90
        when 'high' then 1.20
        when 'very-high' then 1.35
        else 1.05
      end
      + case option.risk_level
        when 'low' then -0.40
        when 'high' then 2.20
        when 'very-high' then 4.50
        else 0.80
      end
    ) / 100
  ), 6)
  where option.id is not null;

  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION economy_private.update_activity_mix()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_active_players integer;
  v_transactions integer;
  v_businesses integer;
  v_participation integer;
  v_score numeric;
  v_level text;
  v_target numeric;
  v_current numeric; v_override numeric;
  v_player numeric;
begin
  select count(distinct session.user_id)::integer into v_active_players
  from public.user_activity_sessions session
  where session.last_seen_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_transactions from public.transactions
  where created_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_businesses from public.businesses
  where status='active' and updated_at>=clock_timestamp()-interval '14 days';
  select coalesce(sum(total),0)::integer into v_participation from (
    select count(*) total from public.posts where created_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.bill_votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.criminal_cases where created_at>=clock_timestamp()-interval '7 days'
  ) activity;
  v_score:=coalesce(v_active_players,0)*3+least(coalesce(v_transactions,0),300)*.15
    +coalesce(v_businesses,0)*4+least(coalesce(v_participation,0),200)*.35;
  v_level:=case when v_score<15 then 'very_low' when v_score<40 then 'low'
    when v_score<90 then 'medium' when v_score<180 then 'high' else 'very_high' end;
  v_target:=case v_level when 'very_low' then .25 when 'low' then .35
    when 'medium' then .50 when 'high' then .60 else .75 end;
  select player_share,(metadata->'activity_mix_override'->>'player_share')::numeric into v_current,v_override from public.economic_state where id=true for update;
  v_current:=coalesce(v_current,.25);
  v_player:=coalesce(v_override,round(least(v_current+.08,greatest(v_current-.08,v_current*.75+v_target*.25)),6));

  -- All consumers store four decimal places. Round before computing the complement.
  v_player:=round(v_player,4);

  update public.economic_state
  set player_activity_level=v_level,player_share=v_player,simulated_share=1-v_player,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'activity_score',round(v_score,4),'active_players',v_active_players,
        'recent_transactions',v_transactions,'active_businesses',v_businesses,
        'participation_actions',v_participation,'influence_model',case when v_override is null then 'dynamic_smoothed' else 'admin_configured' end,
        'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player
      ),updated_at=clock_timestamp()
  where id=true;
  update public.country_rp_states
  set player_share=v_player,simulated_share=1-v_player,
      economic_current=economic_current||jsonb_build_object('playerShare',v_player,'simulatedShare',1-v_player),
      updated_at=clock_timestamp()
  where is_playable;
  update public.government_popularity_state
  set player_activity_weight=v_player,simulation_weight=1-v_player,updated_at=clock_timestamp()
  where country_code='BR';
  return jsonb_build_object('level',v_level,'score',round(v_score,4),
    'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player);
end;
$function$

;

CREATE OR REPLACE FUNCTION economy_private.policy_impacts(p_policy_type text, p_previous_value numeric, p_new_value numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  delta numeric := coalesce(p_new_value,0)-coalesce(p_previous_value,0);
  result jsonb;
begin
  -- Large decisions remain possible; lagged demand responses saturate instead of exploding.
  if p_policy_type='selic' then delta:=20*tanh(delta/20); end if;
  result := case p_policy_type
    when 'selic' then jsonb_build_object(
      'credit_percent', round(-delta*4,4),
      'consumption_percent', round(-delta*1.4,4),
      'investment_percent', round(-delta*1.8,4),
      'output_percent', round(-delta*.55,4),
      'inflation_points', round(-delta*.35,4),
      'employment_percent', round(delta*.22,4),
      'consumer_confidence', round(-delta*.7,4),
      'business_confidence', round(-delta*.9,4),
      'debt_cost_points', round(delta,4)
    )
    when 'consumption_tax' then jsonb_build_object(
      'consumption_percent',round(-delta*1.1,4),
      'output_percent',round(-delta*.35,4),
      'inflation_points',round(delta*.55,4),
      'revenue_percent',round(delta*1.4,4),
      'consumer_confidence',round(-delta*.65,4)
    )
    when 'corporate_tax' then jsonb_build_object(
      'investment_percent',round(-delta*.8,4),
      'output_percent',round(-delta*.22,4),
      'revenue_percent',round(delta,4),
      'business_confidence',round(-delta*.7,4)
    )
    when 'income_tax' then jsonb_build_object(
      'consumption_percent',round(-delta*.55,4),
      'revenue_percent',round(delta*.9,4),
      'consumer_confidence',round(-delta*.35,4)
    )
    when 'payroll_tax' then jsonb_build_object(
      'employment_percent',round(delta*.65,4),
      'output_percent',round(-delta*.15,4),
      'revenue_percent',round(delta*.7,4),
      'business_confidence',round(-delta*.4,4)
    )
    when 'minimum_wage' then jsonb_build_object(
      'consumption_percent',round(delta*.18,4),
      'employment_percent',round(greatest(delta-5,0)*.12,4),
      'inflation_points',round(delta*.06,4),
      'consumer_confidence',round(delta*.16,4),
      'business_confidence',round(-delta*.08,4)
    )
    when 'public_spending' then jsonb_build_object(
      'output_percent',round(delta*.45,4),
      'employment_percent',round(-delta*.18,4),
      'inflation_points',round(delta*.12,4),
      'consumer_confidence',round(delta*.18,4),
      'business_confidence',round(delta*.12,4)
    )
    when 'inflation_target' then jsonb_build_object(
      'inflation_points',round(delta*.2,4),
      'business_confidence',round(-abs(delta)*.2,4)
    )
    else jsonb_build_object('output_percent',round(delta*.1,4))
  end;
  return result;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.adjust_existing_levy(p_rule_key text, p_value numeric, p_expected_version bigint, p_nature text)
 RETURNS government_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.government_rules%rowtype; actor uuid:=auth.uid(); d uuid; e uuid; explanation text; max_value numeric; effect jsonb; next_definition jsonb;
begin
  if not exists(select 1 from public.profiles where id=actor and role in('Admin','Presidente')) then raise exception 'Somente o Presidente pode ajustar tributos vigentes.' using errcode='42501'; end if;
  perform public.process_due_legal_effects();
  select * into r from public.government_rules where rule_key=p_rule_key for update;
  if not found or r.rule_kind not in('tax','fee') or not r.is_active or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() then raise exception 'Selecione um imposto ou tarifa vigente. Criar ou extinguir exige o processo legislativo.'; end if;
  if p_expected_version is null or r.version<>p_expected_version then raise exception 'O valor foi atualizado por outra medida. Confira a nova alíquota antes de salvar.'; end if;
  select decree_max_value into max_value from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
  if max_value is null then raise exception 'O regime vigente não permite ajuste executivo de alíquotas.'; end if;
  if p_nature is null or p_nature not in('percentage','fixed') then raise exception 'Escolha percentual ou valor fixo.'; end if;
  next_definition:=r.definition||jsonb_build_object('nature',p_nature);
  if p_nature='percentage' then max_value:=least(1,max_value); end if;
  if p_value is null or p_value::text in('NaN','Infinity','-Infinity') or p_value<0 or p_value>max_value then raise exception 'Informe um valor dentro dos limites permitidos.'; end if;
  if r.numeric_value=p_value and r.definition->>'nature'=p_nature then return r; end if;
  explanation:=r.description||': '||r.numeric_value||' ('||(r.definition->>'nature')||') → '||p_value||' ('||p_nature||'). Ajuste executivo do valor e da forma de cobrança, preservados escopo e vigência da norma.';
  insert into public.decrees(title,content,author_id,is_published) values('Ajuste de '||r.description,explanation,actor,false) returning id into d;
  effect:=jsonb_build_object('kind',r.rule_kind,'action','change','rule_key',r.rule_key,'name',r.description,'value',p_value,'definition',next_definition,'executive_rate_adjustment',true);
  -- Scope, payer, exemptions and dates remain governed by the existing legal authority.
  insert into public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,status,configured_by,activated_at,effect_data,valid_from,valid_until,previous_snapshot)
  values('decree',d,r.rule_key,'set',p_value,explanation,'active',actor,clock_timestamp(),effect,clock_timestamp(),r.valid_until,to_jsonb(r)) returning id into e;
  update public.government_rules set numeric_value=p_value,definition=next_definition,unit=case when p_nature='percentage' then 'ratio' else 'BRL' end,source_kind='decree',source_id=d,active_effect_id=e,version=version+1,updated_at=clock_timestamp() where rule_key=r.rule_key;
  update public.decrees set is_published=true,published_at=clock_timestamp() where id=d;
  perform economy_private.audit('executive_levy_adjusted','government_rules',r.rule_key,to_jsonb(r),effect,explanation,actor);
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
  values('legal_effect_activated','government','law_effects',e,actor,effect,'legal-effect:'||e);
  select * into r from public.government_rules where rule_key=p_rule_key;
  return r;
end; $function$

;

create or replace function public.adjust_existing_levy(p_rule_key text,p_value numeric,p_expected_version bigint)
returns public.government_rules language sql security definer set search_path='' as $$
 select public.adjust_existing_levy(p_rule_key,p_value,p_expected_version,(select definition->>'nature' from public.government_rules where rule_key=p_rule_key));
$$;
alter function public.adjust_existing_levy(text,numeric,bigint,text) owner to postgres;
revoke all on function public.adjust_existing_levy(text,numeric,bigint,text) from public,anon;
grant execute on function public.adjust_existing_levy(text,numeric,bigint,text) to authenticated;
update public.legal_authority_rules set description='Executivo pode ajustar o valor e a natureza percentual ou fixa de tributos vigentes. Criação, extinção, escopo, pagador, isenções e vigência seguem o processo legislativo.' where capability='executive_rate_adjustment';


create or replace function private.check_legal_effect_definition()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.government_rules%rowtype; ceiling numeric;
begin
 if new.effect_data is null then return new; end if;
 perform private.validate_legal_definition(new.effect_data);
 if new.effect_data->>'executive_rate_adjustment'='true' then
   select * into r from public.government_rules where rule_key=new.effect_key for update;
   select decree_max_value into ceiling from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
   if tg_op<>'INSERT' or new.status<>'active' or new.source_kind<>'decree' or new.configured_by is distinct from auth.uid()
     or not exists(select 1 from public.profiles where id=auth.uid() and role in('Admin','Presidente'))
     or r.rule_key is null or not r.is_active or r.rule_kind not in('tax','fee') or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
     or new.effect_data->>'action'<>'change' or new.effect_data->>'kind'<>r.rule_kind
     or (new.effect_data->'definition')-'nature' is distinct from r.definition-'nature' or new.previous_snapshot is distinct from to_jsonb(r)
     or new.valid_until is distinct from r.valid_until or ceiling is null or new.effect_value>ceiling
     or not exists(select 1 from public.decrees where id=new.source_id and not is_published and author_id=auth.uid())
   then raise exception 'Este ajuste exige um tributo vigente e autoridade executiva válida.' using errcode='42501'; end if;
   perform private.validate_legal_measure(r.rule_kind,new.effect_data,'bill');
 else perform private.validate_legal_measure(new.effect_data->>'kind',new.effect_data,new.source_kind); end if;
 return new;
end; $$;



create or replace function private.is_executive_candidate(p_user_id uuid,p_office_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_user_id and p.deleted_at is null and p.onboarding_completed
  and p.role not in('Admin','Presidente','Vice-Presidente')
  and not exists(select 1 from public.system_settings s cross join lateral jsonb_each(coalesce(s.value->'specialAppointments','{}')) a
    where s.key='executive_governance' and a.key<>p_office_key and a.value->>'user_id'=p.id::text)
  and not exists(select 1 from public.ministers m where m.user_id=p.id and m.status='active'));
$$;
alter function private.is_executive_candidate(uuid,text) owner to postgres;
revoke all on function private.is_executive_candidate(uuid,text) from public,anon,authenticated;
create or replace function public.search_executive_candidates(p_office_key text,p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in('Admin','Presidente') and deleted_at is null) then raise exception 'A consulta exige autoridade presidencial.' using errcode='42501'; end if;
 if p_office_key is null or (p_office_key<>'minister' and not exists(select 1 from public.executive_office_definitions where office_key=p_office_key)) then raise exception 'Selecione um cargo válido.'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)), '[]') into result from (
  select p.id,p.full_name,p.username,p.avatar_url,p.role from public.profiles p
  where private.is_executive_candidate(p.id,p_office_key)
   and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(coalesce(p.full_name,'')||' '||coalesce(p.username,'')))>0)
  order by p.full_name,p.id limit 51 offset p_offset
 ) c;
 return jsonb_build_object('candidates',case when jsonb_array_length(result)>50 then result-50 else result end,'has_more',jsonb_array_length(result)>50);
end; $$;
alter function public.search_executive_candidates(text,text,integer) owner to postgres;
revoke all on function public.search_executive_candidates(text,text,integer) from public,anon;
grant execute on function public.search_executive_candidates(text,text,integer) to authenticated;


CREATE OR REPLACE FUNCTION public.appoint_minister(p_user_id uuid, p_ministry text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ministry public.government_ministries%rowtype; current_holder uuid; result public.ministers%rowtype;
begin
  if public.get_user_role(actor) not in('Presidente','Admin') then return json_build_object('success',false,'message','Apenas a Presidência pode nomear ministros.'); end if;
  perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  perform 1 from public.profiles where id=p_user_id for update;
  if not private.is_executive_candidate(p_user_id,'minister') then return json_build_object('success',false,'message','Este cidadão não está elegível para a nomeação ministerial.'); end if;
  select * into ministry from public.government_ministries where name=p_ministry and is_active for update;
  if not found then return json_build_object('success',false,'message','Ministério inexistente ou inativo.'); end if;
  select user_id into current_holder from public.ministers where ministry_id=ministry.id and status='active' for update;
  if current_holder is not null and current_holder<>p_user_id then
    update public.ministers set status='dismissed',ended_at=clock_timestamp() where user_id=current_holder;
    insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(current_holder,ministry.id,'dismissed','Exoneração por substituição ministerial.',actor);
  end if;
  insert into public.ministers(user_id,ministry,ministry_id,appointed_by,status,appointed_at,ended_at)
  values(p_user_id,ministry.name,ministry.id,actor,'active',clock_timestamp(),null)
  on conflict(user_id) do update set ministry=excluded.ministry,ministry_id=excluded.ministry_id,appointed_by=actor,status='active',appointed_at=clock_timestamp(),ended_at=null
  returning * into result;
  update public.profiles set role='Ministro' where id=p_user_id;
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(p_user_id,ministry.id,'appointed','Nomeação para '||ministry.name||'.',actor);
  perform public.apply_government_impact('politics','minister_appointed','Nomeação ministerial realizada.',.2,0,'ministers',result.id::text,jsonb_build_object('ministerId',p_user_id,'ministry',ministry.name));
  return json_build_object('success',true,'message','Ministro nomeado com sucesso.','minister',to_jsonb(result));
end; $function$

;

CREATE OR REPLACE FUNCTION public.manage_executive_appointment(p_office_key text, p_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in('Presidente','Admin')) then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into office from public.executive_office_definitions where office_key=p_office_key;
 if not found then raise exception 'Escolha um cargo executivo válido.'; end if;
 select coalesce(value,'{}') into cfg from public.system_settings where key='executive_governance' for update;
 cfg:=coalesce(cfg,'{}');previous:=cfg->'specialAppointments'->p_office_key;
 if p_user_id is not null then
   select * into target from public.profiles where id=p_user_id and onboarding_completed and deleted_at is null for update;
   if not found or not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Escolha um cidadão elegível para a nomeação.'; end if;
   if previous->>'user_id'=p_user_id::text then return previous; end if;
   if exists(select 1 from jsonb_each(coalesce(cfg->'specialAppointments','{}')) a where a.key<>p_office_key and a.value->>'user_id'=p_user_id::text) then raise exception 'Este cidadão já ocupa outra nomeação estratégica.'; end if;
 end if;
 if previous->>'user_id' is not null then
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',auth.uid(),'previous_role',target.role,'note',p_note);
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',auth.uid(),'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),auth.uid());
 return coalesce(entry,'{}');
end; $function$

;

commit;