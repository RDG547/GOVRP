begin;

create or replace function economy_private.policy_impacts(
  p_policy_type text,
  p_previous_value numeric,
  p_new_value numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  delta numeric := coalesce(p_new_value,0)-coalesce(p_previous_value,0);
  result jsonb;
begin
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
$$;

create or replace function economy_private.forecast_policy(
  p_policy_type text,
  p_new_value numeric,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_value numeric;
  impacts jsonb;
  uncertainty numeric;
  base_result jsonb;
  optimistic jsonb;
  pessimistic jsonb;
  forecast_id uuid;
  base_period_id uuid;
begin
  current_value := case p_policy_type
    when 'selic' then (select current_selic from public.economic_state where id=true)
    when 'inflation_target' then (select inflation_target from public.economic_state where id=true)
    else coalesce(
      (select new_value from public.economic_policy_decisions
       where policy_type=p_policy_type and status in ('announced','effective')
       order by announced_at_real desc limit 1),
      0
    )
  end;
  impacts := economy_private.policy_impacts(p_policy_type,current_value,p_new_value);
  uncertainty := economy_private.clamp(
    .22
      + abs(coalesce((select business_confidence from public.economic_state where id=true),50)-50)/250
      + abs(p_new_value-current_value)/100,
    .15,.55
  );
  base_result := impacts || jsonb_build_object(
    'previous_value',current_value,
    'new_value',p_new_value,
    'economic_cycle',(select economic_cycle from public.economic_state where id=true),
    'confidence',round(1-uncertainty,4)
  );
  optimistic := (
    select coalesce(jsonb_object_agg(k,
      case
        when jsonb_typeof(v)='number'
          and k not in ('previous_value','new_value','confidence')
          then to_jsonb(round(
            (v #>> '{}')::numeric
            * case when (v #>> '{}')::numeric>=0 then 1+uncertainty else 1-uncertainty end,
            4
          ))
        else v
      end
    ),'{}'::jsonb)
    from jsonb_each(base_result) as e(k,v)
  );
  pessimistic := (
    select coalesce(jsonb_object_agg(k,
      case
        when jsonb_typeof(v)='number'
          and k not in ('previous_value','new_value','confidence')
          then to_jsonb(round(
            (v #>> '{}')::numeric
            * case when (v #>> '{}')::numeric>=0 then 1-uncertainty else 1+uncertainty end,
            4
          ))
        else v
      end
    ),'{}'::jsonb)
    from jsonb_each(base_result) as e(k,v)
  );
  select id into base_period_id
  from public.economic_periods
  where period_type='quarter' and status='closed'
  order by ends_at_rp desc limit 1;

  insert into public.economic_forecasts(
    forecast_type,policy_type,policy_payload,base_period_id,
    optimistic_scenario,base_scenario,pessimistic_scenario,
    confidence_interval,assumptions,created_by
  )
  values (
    'policy_simulation',p_policy_type,
    jsonb_build_object('previous_value',current_value,'new_value',p_new_value),
    base_period_id,optimistic,base_result,pessimistic,1-uncertainty,
    jsonb_build_object(
      'model','elasticidades graduais GOVRP',
      'not_a_guarantee',true,
      'activity_mix',(select jsonb_build_object(
        'simulated_share',simulated_share,'player_share',player_share
      ) from public.economic_state where id=true)
    ),
    p_created_by
  )
  returning id into forecast_id;

  return jsonb_build_object(
    'forecast_id',forecast_id,
    'optimistic',optimistic,
    'base',base_result,
    'pessimistic',pessimistic,
    'confidence_interval',round(1-uncertainty,4)
  );
end;
$$;

create or replace function public.simulate_economic_policy(
  p_policy_type text,
  p_new_value numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Autenticação obrigatória.' using errcode='42501';
  end if;
  if p_policy_type not in (
    'selic','inflation_target','consumption_tax','corporate_tax','income_tax',
    'payroll_tax','minimum_wage','public_spending','subsidy',
    'reserve_requirement','exchange_intervention','debt_limit','emergency_rule'
  ) then
    raise exception 'Política econômica inválida.';
  end if;
  if p_new_value is null or p_new_value::text in ('NaN','Infinity','-Infinity')
     or abs(p_new_value)>1000000000000 then
    raise exception 'Valor de simulação inválido.';
  end if;
  return economy_private.forecast_policy(p_policy_type,p_new_value,auth.uid());
end;
$$;

create or replace function public.apply_policy_decision(
  p_policy_type text,
  p_new_value numeric,
  p_justification text,
  p_market_expectation numeric default null,
  p_effective_at_rp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_policy_type in ('selic','inflation_target') and (p_new_value<0 or p_new_value>100) then
    raise exception 'Taxa fora do intervalo permitido.';
  end if;
  if p_policy_type='selic' and abs(delta)>5 then
    raise exception 'A Selic só pode variar até 5 pontos por decisão.';
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
$$;

create or replace function public.apply_economic_shock(
  p_shock_type text,
  p_title text,
  p_description text,
  p_origin text,
  p_intensity numeric,
  p_duration_rp_months numeric,
  p_affected_sector_ids uuid[],
  p_impacts jsonb,
  p_expected_consequences text[],
  p_justification text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  shock_id uuid;
  rp_start timestamptz := public.rp_now();
  rp_end timestamptz;
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem criar choques.' using errcode='42501';
  end if;
  if p_intensity<=0 or p_intensity>1 or p_duration_rp_months<=0 or p_duration_rp_months>24 then
    raise exception 'Intensidade ou duração fora dos limites.';
  end if;
  if length(trim(coalesce(p_justification,'')))<20 then
    raise exception 'Justificativa insuficiente.';
  end if;
  rp_end := rp_start+make_interval(days=>round(p_duration_rp_months*365/12)::integer);
  insert into public.economic_shocks(
    shock_type,title,description,origin,intensity,
    starts_at_real,starts_at_rp,ends_at_real,ends_at_rp,
    affected_sector_ids,impacts,expected_consequences,status,
    created_by,justification
  )
  values (
    p_shock_type,trim(p_title),trim(p_description),p_origin,p_intensity,
    now(),rp_start,public.rp_date_to_real_date(rp_end),rp_end,
    coalesce(p_affected_sector_ids,array[]::uuid[]),coalesce(p_impacts,'{}'::jsonb),
    coalesce(p_expected_consequences,array[]::text[]),'active',
    auth.uid(),trim(p_justification)
  )
  returning id into shock_id;
  perform economy_private.audit('apply_economic_shock','economic_shock',shock_id::text,
    null,to_jsonb((select s from public.economic_shocks s where s.id=shock_id)),
    p_justification,auth.uid());
  return shock_id;
end;
$$;

create or replace function public.propose_government_project(
  p_name text,
  p_description text,
  p_ministry text,
  p_sector_id uuid,
  p_project_type text,
  p_approved_budget numeric,
  p_expected_completion_at_rp timestamptz,
  p_productivity_impact numeric default 0,
  p_employment_impact numeric default 0,
  p_inflation_impact numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare project_id uuid;
begin
  if auth.uid() is null or not public.economic_has_role(array[
    'Admin','Presidente','Ministro','Ministro da Fazenda','Ministro da Economia'
  ]) then
    raise exception 'Cargo sem competência para propor projetos.' using errcode='42501';
  end if;
  if p_approved_budget<=0 or p_approved_budget>
      economy_private.calibration_numeric('max_government_project_budget',500000000) then
    raise exception 'Orçamento do projeto fora dos limites.';
  end if;
  insert into public.government_projects(
    name,description,ministry,sector_id,project_type,approved_budget,
    expected_completion_at,productivity_impact,employment_impact,inflation_impact,
    immediate_multiplier,future_multiplier,created_by
  )
  values (
    trim(p_name),trim(p_description),trim(p_ministry),p_sector_id,p_project_type,
    p_approved_budget,public.rp_date_to_real_date(p_expected_completion_at_rp),
    p_productivity_impact,p_employment_impact,p_inflation_impact,
    case p_project_type when 'infrastructure' then 1.35 when 'social_assistance' then 1.25 else 1 end,
    case p_project_type when 'education' then 1.65 when 'technology' then 1.75 when 'infrastructure' then 1.45 else 1 end,
    auth.uid()
  )
  returning id into project_id;
  perform economy_private.audit('propose_government_project','government_project',project_id::text,
    null,to_jsonb((select p from public.government_projects p where p.id=project_id)),
    'Proposta registrada pelo responsável.',auth.uid());
  return project_id;
end;
$$;

create or replace function public.approve_government_project(
  p_project_id uuid,
  p_justification text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare project_row public.government_projects%rowtype;
  treasury numeric;
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin','Presidente']) then
    raise exception 'Aprovação restrita à Presidência ou Administração.' using errcode='42501';
  end if;
  select * into project_row from public.government_projects where id=p_project_id for update;
  if not found or project_row.status not in ('proposed','pending_parliament') then
    raise exception 'Projeto não está disponível para aprovação.';
  end if;
  select treasury_balance into treasury from public.government_finances where id=1 for update;
  if treasury<project_row.approved_budget then
    raise exception 'Tesouro sem recursos para reservar o orçamento.';
  end if;
  update public.government_projects
  set status='funded',reserved_amount=approved_budget,approved_by=auth.uid(),
      approved_at=now(),started_at=now(),updated_at=now()
  where id=p_project_id;
  update public.government_finances
  set treasury_balance=treasury_balance-project_row.approved_budget,updated_at=now()
  where id=1;
  perform economy_private.audit('approve_government_project','government_project',p_project_id::text,
    to_jsonb(project_row),to_jsonb((select p from public.government_projects p where p.id=p_project_id)),
    p_justification,auth.uid());
  return jsonb_build_object('project_id',p_project_id,'status','funded',
    'reserved_amount',project_row.approved_budget);
end;
$$;

create or replace function economy_private.process_project(
  p_project_id uuid,
  p_installment numeric default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare project_row public.government_projects%rowtype;
  installment numeric;
  new_spent numeric;
  new_progress numeric;
  expenditure_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:project:'||p_project_id::text));
  select * into project_row from public.government_projects where id=p_project_id for update;
  if not found or project_row.status not in ('funded','in_progress','delayed') then
    raise exception 'Projeto não está em execução.';
  end if;
  installment := least(
    coalesce(p_installment,project_row.approved_budget*.1),
    project_row.approved_budget-project_row.spent_amount
  );
  if installment<=0 then
    return jsonb_build_object('project_id',p_project_id,'status','completed');
  end if;
  new_spent:=project_row.spent_amount+installment;
  new_progress:=least(100,new_spent/project_row.approved_budget*100);
  insert into public.government_expenditures(
    expenditure_type,ministry,project_id,source_table,source_id,sector_id,
    amount,productive_share,occurred_at_rp,metadata
  )
  values (
    'government_project',project_row.ministry,p_project_id,'government_projects',
    p_project_id::text||':'||to_char(new_spent,'FM999999999999990D00'),
    project_row.sector_id,installment,1,public.rp_now(),
    jsonb_build_object('quality_score',project_row.quality_score,'progress',new_progress)
  )
  returning id into expenditure_id;
  update public.government_projects
  set spent_amount=new_spent,progress=new_progress,
      status=case when new_progress>=100 then 'completed' else 'in_progress' end,
      completed_at=case when new_progress>=100 then now() else completed_at end,
      updated_at=now()
  where id=p_project_id;
  return jsonb_build_object('project_id',p_project_id,'installment',installment,
    'spent_amount',new_spent,'progress',new_progress,'expenditure_id',expenditure_id);
end;
$$;

create or replace function public.process_government_project(
  p_project_id uuid,
  p_installment numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array[
    'Admin','Presidente','Ministro','Ministro da Fazenda','Ministro da Economia'
  ]) then
    raise exception 'Cargo sem competência para executar projetos.' using errcode='42501';
  end if;
  return economy_private.process_project(p_project_id,p_installment,auth.uid());
end;
$$;

create or replace function public.process_automatic_stabilizers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unemployment numeric:=coalesce(economy_private.latest_indicator('unemployment_rate'),8.5);
  threshold numeric:=economy_private.calibration_numeric('automatic_stabilizer_unemployment_threshold',10);
  transfer_amount numeric;
  source_id text;
  expenditure_id uuid;
begin
  if auth.uid() is not null and not public.economic_has_role(array['Admin']) then
    raise exception 'Execução manual restrita ao Admin.' using errcode='42501';
  end if;
  if unemployment<=threshold then
    return jsonb_build_object('status','not_required','unemployment_rate',unemployment);
  end if;
  transfer_amount:=least(
    (unemployment-threshold)*economy_private.calibration_numeric('baseline_population',2000000)*25,
    economy_private.calibration_numeric('automatic_stabilizer_monthly_cap',100000000)
  );
  source_id:='unemployment:'||to_char(date_trunc('month',public.rp_now()),'YYYY-MM');
  insert into public.government_expenditures(
    expenditure_type,ministry,source_table,source_id,amount,productive_share,
    occurred_at_rp,metadata
  )
  values (
    'social_assistance','Assistência Social','automatic_stabilizers',source_id,
    transfer_amount,0,public.rp_now(),
    jsonb_build_object('unemployment_rate',unemployment,'threshold',threshold)
  )
  on conflict (source_table,source_id,expenditure_type) do nothing
  returning id into expenditure_id;
  if expenditure_id is null then
    return jsonb_build_object('status','already_processed','source_id',source_id);
  end if;
  return jsonb_build_object('status','processed','amount',transfer_amount,
    'expenditure_id',expenditure_id);
end;
$$;

create or replace function public.update_economic_calibration(
  p_key text,
  p_value jsonb,
  p_justification text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare old_row public.economic_calibrations%rowtype;
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem calibrar o motor.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_justification,'')))<20 then
    raise exception 'Justificativa insuficiente.';
  end if;
  select * into old_row from public.economic_calibrations where key=p_key for update;
  if not found then raise exception 'Calibração inexistente.'; end if;
  update public.economic_calibrations
  set value=p_value,updated_by=auth.uid(),updated_at=now(),
      engine_version=(string_to_array(engine_version,'.'))[1]||'.'||
        coalesce((string_to_array(engine_version,'.'))[2]::integer+1,1)||'.0'
  where key=p_key;
  perform economy_private.audit('update_economic_calibration','economic_calibration',p_key,
    to_jsonb(old_row),to_jsonb((select c from public.economic_calibrations c where c.key=p_key)),
    p_justification,auth.uid());
  return to_jsonb((select c from public.economic_calibrations c where c.key=p_key));
end;
$$;

create or replace function public.update_citizen_labor_status(
  p_labor_status text,
  p_actively_seeking boolean,
  p_available_for_work boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if p_labor_status not in ('self_employed','unemployed','outside_labor_force','retired') then
    raise exception 'Status manual inválido. Emprego, prisão e empresa são derivados.';
  end if;
  if p_labor_status='unemployed' and not p_actively_seeking then
    raise exception 'Desempregado deve estar procurando trabalho.';
  end if;
  insert into public.citizen_economic_statuses(
    profile_id,labor_status,actively_seeking,available_for_work,
    last_economic_activity_at,updated_at
  )
  values (auth.uid(),p_labor_status,p_actively_seeking,p_available_for_work,now(),now())
  on conflict (profile_id) do update set
    labor_status=excluded.labor_status,
    actively_seeking=excluded.actively_seeking,
    available_for_work=excluded.available_for_work,
    last_economic_activity_at=excluded.last_economic_activity_at,
    updated_at=now();
  return to_jsonb((select s from public.citizen_economic_statuses s where s.profile_id=auth.uid()));
end;
$$;

create or replace function public.get_public_economic_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with history as (
    select p.id,p.period_type,p.rp_year,p.rp_quarter,p.rp_month,p.ends_at_rp,
      jsonb_object_agg(i.indicator_code,coalesce(i.real_value,i.nominal_value)) as indicators
    from public.economic_periods p
    join public.economic_indicators i on i.period_id=p.id
    where p.status='closed'
    group by p.id
    order by p.ends_at_rp desc
    limit 24
  ),
  sectors as (
    select es.code,es.name,ss.value_added,ss.real_value_added,ss.growth_rate,
           ss.employment,ss.capacity_utilization,ss.confidence_index
    from public.economic_sector_snapshots ss
    join public.economic_sectors es on es.id=ss.sector_id
    where ss.period_id=(select period_id from public.economic_sector_snapshots
      order by created_at desc limit 1)
    order by ss.value_added desc
  )
  select jsonb_build_object(
    'generated_at',now(),
    'rp_now',public.rp_now(),
    'state',to_jsonb(s),
    'headline',jsonb_build_object(
      'gdp_nominal',economy_private.latest_indicator('gdp_nominal'),
      'gdp_real',economy_private.latest_indicator('gdp_real'),
      'gdp_growth_quarterly',economy_private.latest_indicator('gdp_growth_quarterly'),
      'gdp_growth_year_over_year',economy_private.latest_indicator('gdp_growth_year_over_year'),
      'inflation_monthly',economy_private.latest_indicator('inflation_monthly'),
      'inflation_annual',economy_private.latest_indicator('inflation_annual'),
      'unemployment_rate',economy_private.latest_indicator('unemployment_rate'),
      'average_wage',economy_private.latest_indicator('average_wage'),
      'real_average_wage',economy_private.latest_indicator('real_average_wage'),
      'debt_to_gdp',economy_private.latest_indicator('debt_to_gdp'),
      'primary_fiscal_result',economy_private.latest_indicator('primary_fiscal_result'),
      'purchasing_power',economy_private.latest_indicator('average_purchasing_power')
    ),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.ends_at_rp) from history h),'[]'::jsonb),
    'sectors',coalesce((select jsonb_agg(to_jsonb(x)) from sectors x),'[]'::jsonb),
    'basket',coalesce((select jsonb_agg(jsonb_build_object(
      'code',b.code,'name',b.name,'weight',b.weight,
      'index',round(b.current_price/greatest(b.base_price,.000001)*b.base_index,6)
    ) order by b.weight desc) from public.price_basket_items b where b.is_active),'[]'::jsonb),
    'bulletins',coalesce((select jsonb_agg(to_jsonb(b) order by b.published_at desc)
      from (select id,bulletin_type,title,summary,highlights,published_at,period_id
            from public.economic_bulletins where status in ('published','corrected')
            order by published_at desc limit 8) b),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.detected_at desc)
      from (select id,alert_code,severity,title,message,detected_at,metadata
            from public.economic_alerts where status='active'
            order by detected_at desc limit 12) a),'[]'::jsonb)
  )
  from public.economic_state s
  where s.id=true
$$;

create or replace function public.get_citizen_economic_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  select jsonb_build_object(
    'status',to_jsonb(s),
    'latest_snapshot',to_jsonb(cs),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.ends_at_rp)
      from (
        select p.ends_at_rp,c.nominal_income,c.disposable_income,c.real_income,
          c.consumption,c.savings,c.debt,c.basket_cost,c.purchasing_power_index,
          c.consumer_confidence,c.poverty_status
        from public.citizen_economic_snapshots c
        join public.economic_periods p on p.id=c.period_id
        where c.profile_id=auth.uid()
        order by p.ends_at_rp desc limit 12
      ) h),'[]'::jsonb),
    'opportunities',jsonb_build_object(
      'open_vacancies',economy_private.latest_indicator('open_vacancies'),
      'average_wage',economy_private.latest_indicator('average_wage'),
      'inflation_annual',economy_private.latest_indicator('inflation_annual'),
      'current_selic',(select current_selic from public.economic_state where id=true)
    )
  ) into result
  from public.citizen_economic_statuses s
  left join lateral (
    select c.* from public.citizen_economic_snapshots c
    join public.economic_periods p on p.id=c.period_id
    where c.profile_id=auth.uid()
    order by p.ends_at_rp desc limit 1
  ) cs on true
  where s.profile_id=auth.uid();
  return coalesce(result,jsonb_build_object('status',null,'latest_snapshot',null,'history','[]'::jsonb));
end;
$$;

create or replace function public.get_business_economic_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  return jsonb_build_object(
    'businesses',coalesce((
      select jsonb_agg(jsonb_build_object(
        'business',to_jsonb(b),
        'sector',to_jsonb(es),
        'latest_snapshot',to_jsonb(bs)
      ) order by b.name)
      from public.businesses b
      left join public.economic_sectors es on es.id=b.economic_sector_id
      left join lateral (
        select x.* from public.business_economic_snapshots x
        join public.economic_periods p on p.id=x.period_id
        where x.business_id=b.id order by p.ends_at_rp desc limit 1
      ) bs on true
      where b.owner_id=auth.uid()
    ),'[]'::jsonb),
    'macro',jsonb_build_object(
      'selic',(select current_selic from public.economic_state where id=true),
      'business_confidence',(select business_confidence from public.economic_state where id=true),
      'gdp_growth',economy_private.latest_indicator('gdp_growth_quarterly'),
      'inflation',economy_private.latest_indicator('inflation_annual')
    )
  );
end;
$$;

create or replace function public.get_presidential_economic_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array[
    'Admin','Presidente','Vice-Presidente','Ministro','Ministro da Fazenda','Ministro da Economia'
  ]) then
    raise exception 'Painel restrito ao Governo.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'public',public.get_public_economic_dashboard(),
    'fiscal',to_jsonb((select f from public.fiscal_periods f
      join public.economic_periods p on p.id=f.period_id order by p.ends_at_rp desc limit 1)),
    'treasury',to_jsonb((select g from public.government_finances g where g.id=1)),
    'projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc)
      from public.government_projects p),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.announced_at_real desc)
      from (select * from public.economic_policy_decisions order by announced_at_real desc limit 20) p),'[]'::jsonb),
    'forecasts',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc)
      from (select * from public.economic_forecasts order by created_at desc limit 12) f),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_central_bank_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array[
    'Admin','Presidente','Presidente do Banco Central','Banco Central'
  ]) then
    raise exception 'Painel restrito à autoridade monetária.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'state',to_jsonb((select s from public.economic_state s where s.id=true)),
    'inflation',jsonb_build_object(
      'monthly',economy_private.latest_indicator('inflation_monthly'),
      'annual',economy_private.latest_indicator('inflation_annual'),
      'services',economy_private.latest_indicator('services_inflation'),
      'food',economy_private.latest_indicator('food_inflation'),
      'energy',economy_private.latest_indicator('energy_inflation')
    ),
    'credit',jsonb_build_object(
      'default_rate',economy_private.latest_indicator('household_default_rate'),
      'business_default_rate',economy_private.latest_indicator('business_default_rate'),
      'credit_growth',economy_private.latest_indicator('credit_growth')
    ),
    'meetings',coalesce((select jsonb_agg(to_jsonb(m) order by m.scheduled_at_rp desc)
      from (select * from public.monetary_policy_meetings order by scheduled_at_rp desc limit 12) m),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.announced_at_rp desc)
      from (select * from public.economic_policy_decisions
            where policy_type in ('selic','inflation_target','reserve_requirement','exchange_intervention')
            order by announced_at_rp desc limit 12) d),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_economic_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Painel restrito à Administração.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'state',to_jsonb((select s from public.economic_state s where s.id=true)),
    'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc)
      from (select * from public.economic_engine_runs order by started_at desc limit 30) r),'[]'::jsonb),
    'periods',coalesce((select jsonb_agg(to_jsonb(p) order by p.starts_at_rp desc)
      from (select * from public.economic_periods order by starts_at_rp desc limit 30) p),'[]'::jsonb),
    'suspicious_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (select id,event_type,source_table,source_id,actor_profile_id,business_id,
        nominal_amount,economic_amount,metadata,created_at
        from public.economic_events where is_suspicious order by created_at desc limit 50) e),'[]'::jsonb),
    'calibrations',coalesce((select jsonb_agg(to_jsonb(c) order by c.key)
      from public.economic_calibrations c),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (select * from public.economic_audit_log order by created_at desc limit 50) a),'[]'::jsonb)
  );
end;
$$;

create or replace function public.calculate_labor_market(p_period_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(l) from public.labor_market_snapshots l where l.period_id=p_period_id
$$;
create or replace function public.calculate_fiscal_result(p_period_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(f) from public.fiscal_periods f where f.period_id=p_period_id
$$;
create or replace function public.calculate_public_debt(p_period_id uuid)
returns numeric language sql stable security definer set search_path='' as $$
  select gross_debt from public.fiscal_periods where period_id=p_period_id
$$;
create or replace function public.calculate_consumer_confidence(p_period_id uuid)
returns numeric language sql stable security definer set search_path='' as $$
  select nominal_value from public.economic_indicators
  where period_id=p_period_id and indicator_code='consumer_confidence'
$$;
create or replace function public.calculate_business_confidence(p_period_id uuid)
returns numeric language sql stable security definer set search_path='' as $$
  select nominal_value from public.economic_indicators
  where period_id=p_period_id and indicator_code='business_confidence'
$$;
create or replace function public.detect_economic_cycle(p_period_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(metadata->>'cycle',(select economic_cycle from public.economic_state where id=true))
  from public.economic_indicators
  where period_id=p_period_id and indicator_code='gdp_growth_quarterly'
$$;
create or replace function public.publish_economic_bulletin(
  p_period_id uuid,p_bulletin_type text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem publicar boletins.' using errcode='42501';
  end if;
  return economy_private.publish_bulletin(p_period_id,p_bulletin_type);
end;
$$;
create or replace function public.rebuild_economic_period(
  p_period_id uuid,p_justification text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.economic_periods%rowtype;
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem reconstruir períodos.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_justification,'')))<20 then raise exception 'Justificativa insuficiente.'; end if;
  select * into p from public.economic_periods where id=p_period_id;
  if p.period_type='month' then return economy_private.close_month(p_period_id,true,auth.uid());
  elsif p.period_type='quarter' then return economy_private.close_quarter(p_period_id,true,auth.uid());
  elsif p.period_type='year' then return economy_private.close_year(p_period_id,true,auth.uid());
  end if;
  raise exception 'Período inválido.';
end;
$$;

revoke all on function public.simulate_economic_policy(text,numeric) from public,anon;
revoke all on function public.apply_policy_decision(text,numeric,text,numeric,timestamptz) from public,anon;
revoke all on function public.apply_economic_shock(text,text,text,text,numeric,numeric,uuid[],jsonb,text[],text) from public,anon;
revoke all on function public.propose_government_project(text,text,text,uuid,text,numeric,timestamptz,numeric,numeric,numeric) from public,anon;
revoke all on function public.approve_government_project(uuid,text) from public,anon;
revoke all on function public.process_government_project(uuid,numeric) from public,anon;
revoke all on function public.process_automatic_stabilizers() from public,anon;
revoke all on function public.update_economic_calibration(text,jsonb,text) from public,anon;
revoke all on function public.update_citizen_labor_status(text,boolean,boolean) from public,anon;
revoke all on function public.get_public_economic_dashboard() from public;
revoke all on function public.get_citizen_economic_dashboard() from public,anon;
revoke all on function public.get_business_economic_dashboard() from public,anon;
revoke all on function public.get_presidential_economic_dashboard() from public,anon;
revoke all on function public.get_central_bank_dashboard() from public,anon;
revoke all on function public.get_economic_admin_dashboard() from public,anon;
revoke all on function public.calculate_labor_market(uuid) from public;
revoke all on function public.calculate_fiscal_result(uuid) from public;
revoke all on function public.calculate_public_debt(uuid) from public;
revoke all on function public.calculate_consumer_confidence(uuid) from public;
revoke all on function public.calculate_business_confidence(uuid) from public;
revoke all on function public.detect_economic_cycle(uuid) from public;
revoke all on function public.publish_economic_bulletin(uuid,text) from public,anon;
revoke all on function public.rebuild_economic_period(uuid,text) from public,anon;

grant execute on function public.simulate_economic_policy(text,numeric) to authenticated,service_role;
grant execute on function public.apply_policy_decision(text,numeric,text,numeric,timestamptz) to authenticated,service_role;
grant execute on function public.apply_economic_shock(text,text,text,text,numeric,numeric,uuid[],jsonb,text[],text) to authenticated,service_role;
grant execute on function public.propose_government_project(text,text,text,uuid,text,numeric,timestamptz,numeric,numeric,numeric) to authenticated,service_role;
grant execute on function public.approve_government_project(uuid,text) to authenticated,service_role;
grant execute on function public.process_government_project(uuid,numeric) to authenticated,service_role;
grant execute on function public.process_automatic_stabilizers() to authenticated,service_role;
grant execute on function public.update_economic_calibration(text,jsonb,text) to authenticated,service_role;
grant execute on function public.update_citizen_labor_status(text,boolean,boolean) to authenticated,service_role;
grant execute on function public.get_public_economic_dashboard() to anon,authenticated,service_role;
grant execute on function public.get_citizen_economic_dashboard() to authenticated,service_role;
grant execute on function public.get_business_economic_dashboard() to authenticated,service_role;
grant execute on function public.get_presidential_economic_dashboard() to authenticated,service_role;
grant execute on function public.get_central_bank_dashboard() to authenticated,service_role;
grant execute on function public.get_economic_admin_dashboard() to authenticated,service_role;
grant execute on function public.calculate_labor_market(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_fiscal_result(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_public_debt(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_consumer_confidence(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_business_confidence(uuid) to anon,authenticated,service_role;
grant execute on function public.detect_economic_cycle(uuid) to anon,authenticated,service_role;
grant execute on function public.publish_economic_bulletin(uuid,text) to authenticated,service_role;
grant execute on function public.rebuild_economic_period(uuid,text) to authenticated,service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('govrp-economic-engine-hourly','govrp-economic-projects-hourly');
    perform cron.schedule(
      'govrp-economic-engine-hourly',
      '7 * * * *',
      $cron$select economy_private.run_operational_engine();$cron$
    );
    perform cron.schedule(
      'govrp-economic-projects-hourly',
      '17 * * * *',
      $cron$
        select economy_private.process_project(id,null,null)
        from public.government_projects
        where status in ('funded','in_progress','delayed');
        select public.process_automatic_stabilizers();
      $cron$
    );
  end if;
end
$$;

commit;
