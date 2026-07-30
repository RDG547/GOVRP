begin;

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

commit;
