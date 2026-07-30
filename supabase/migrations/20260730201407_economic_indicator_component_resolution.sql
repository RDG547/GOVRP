begin;

create or replace function economy_private.latest_indicator(
  p_code text,
  p_before_rp timestamptz default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

commit;
