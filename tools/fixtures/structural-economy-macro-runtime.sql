CREATE OR REPLACE FUNCTION economy_private.clamp(p_value numeric, p_min numeric, p_max numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select greatest(p_min, least(p_max, p_value))
$function$
;

CREATE OR REPLACE FUNCTION economy_private.latest_indicator(p_code text, p_before_rp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_code in ('gdp_nominal', 'average_wage') then i.nominal_value
    when p_code = 'real_average_wage' then i.real_value
    else coalesce(i.real_value, i.nominal_value)
  end
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = case p_code
      when 'real_average_wage' then 'average_wage'
      when 'average_purchasing_power' then 'purchasing_power_index'
      else p_code
    end
    and p.status = 'closed'
    and (p_before_rp is null or p.ends_at_rp <= p_before_rp)
  order by p.ends_at_rp desc
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION economy_private.period_for(p_period_type text, p_rp_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_id uuid;
begin
  perform economy_private.ensure_periods(p_rp_at);

  select ep.id into period_id
  from public.economic_periods ep
  where ep.period_type = p_period_type
    and p_rp_at >= ep.starts_at_rp
    and p_rp_at < ep.ends_at_rp
  order by ep.starts_at_rp desc
  limit 1;

  return period_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION economy_private.upsert_indicator(p_period_id uuid, p_code text, p_nominal numeric, p_real numeric, p_variation numeric, p_unit text, p_metadata jsonb DEFAULT '{}'::jsonb, p_status text DEFAULT 'official'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  indicator_id uuid;
begin
  insert into public.economic_indicators (
    period_id,
    indicator_code,
    nominal_value,
    real_value,
    variation,
    unit,
    status,
    metadata,
    engine_version
  )
  values (
    p_period_id,
    p_code,
    p_nominal,
    p_real,
    p_variation,
    p_unit,
    p_status,
    coalesce(p_metadata, '{}'::jsonb),
    '1.0.0'
  )
  on conflict (period_id, indicator_code) do update set
    nominal_value = excluded.nominal_value,
    real_value = excluded.real_value,
    variation = excluded.variation,
    unit = excluded.unit,
    status = excluded.status,
    metadata = excluded.metadata,
    engine_version = excluded.engine_version
  returning id into indicator_id;

  return indicator_id;
end;
$function$
;

